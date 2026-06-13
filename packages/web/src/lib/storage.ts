/**
 * 布船 + salt 本地持久化(Design §8:棋盘即资产,丢失 = 无法应答 = 必然超时输)。
 *
 * 键模板(§8):
 *   正式键   bs:{chainId}:{contract}:{gameId}:{address}
 *   pending  bs:{chainId}:{contract}:pending:{address}
 * createGame 上链拿到 gameId 前先写 pending(此刻还没有 gameId),收到回执后 promotePending
 * 迁移到正式键。
 *
 * 值类型 StoredBoard:bigint(salt/commitment)一律存 hex 字符串('0x…'),
 * localStorage 只能存字符串、且 JSON 不支持 bigint——序列化/反序列化的 bigint↔hex 互转
 * 全部封装在本模块,调用方拿到的是 bigint。
 *
 * 地址大小写:viem 地址大小写敏感(EIP-55 checksum),但同一账户的 checksum 与小写指向同一地址。
 * 键里一律用小写归一(toLowerCase),避免 0xAbC… 与 0xabc… 写出两条记录互相看不见。
 *
 * 失败面(C1,关键):写盘可能抛。store()===null 只覆盖 localStorage **缺失**(SSR / 禁 cookie 的 iframe);
 * 但 localStorage **存在**时,setItem 仍可能抛——配额耗尽(QuotaExceededError),Safari 隐私模式
 * setItem 必抛。createGame / 锁定流程里写盘失败 = 棋盘从未落盘 = §8 丢失应答能力 = 必然超时输。
 * 故 saveBoard / savePending 把 setItem 的抛包成 StorageWriteError 显式上抛(不再静默吞),
 * 由消费方(3.5 布阵幕 / 3.8 结算幕)捕获并弹**阻断式**警告,而非让用户以为已保存。
 *
 * 承诺校验归属:本模块主职是"持久化 + 形状校验"。唯一例外是 importBoardJSON——导入的是用户手上
 * 的外部文件,必须在入口就把"布局非法 / 棋盘与承诺不一致"挡掉(I1),故它委托 commitment.ts 的
 * validateBoard / verifyBoardCommitment 做语义校验。常规存取仍不碰承诺(§8)。
 */
import type { Ship } from '@zk-battleship/circuits';
import { validateBoard } from '@zk-battleship/circuits';
import { verifyBoardCommitment } from './commitment.ts';

/**
 * 写盘失败(C1)。setItem 抛(配额耗尽 / Safari 隐私模式)时由 saveBoard / savePending 抛出。
 * message 点名后果,供消费方直接展示给用户(§8:丢失应答能力 = 必然超时输)。
 * cause 保留原始 DOMException(QuotaExceededError 等),便于上层判型 / 上报。
 */
export class StorageWriteError extends Error {
  constructor(cause?: unknown) {
    super('本地无法保存棋盘,继续将导致丢失应答能力。请检查浏览器存储空间或退出隐私模式后重试。');
    this.name = 'StorageWriteError';
    if (cause !== undefined) this.cause = cause;
  }
}

/** 当前持久化 schema 版本;结构变更时 +1 并在 load 处迁移/弃用旧版。 */
export const STORAGE_VERSION = 1 as const;

/** localStorage 中的布船记录。bigint 以 hex 字符串落盘(见模块注释)。 */
export type StoredBoard = {
  ships: Ship[];
  /** salt,hex 字符串 '0x…'(原 bigint) */
  salt: string;
  /** Poseidon 承诺,hex 字符串 '0x…'(原 bigint) */
  commitment: string;
  version: typeof STORAGE_VERSION;
};

/** 内存态:调用方实际使用的形态,bigint 已还原。 */
export type BoardRecord = {
  ships: Ship[];
  salt: bigint;
  commitment: bigint;
};

const KEY_PREFIX = 'bs';

/** 取 localStorage;SSR/隐私模式下 globalThis.localStorage 可能不存在,返回 null 由调用方降级。 */
function store(): Storage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    // 某些环境访问 localStorage 直接抛(如禁用 cookie 的 iframe)。
    return null;
  }
}

/**
 * 写一项;setItem 抛(配额耗尽 / Safari 隐私模式)→ 包成 StorageWriteError 上抛(C1)。
 * store()===null(localStorage 缺失)时静默返回——那是"无持久层"的降级,与"写失败"语义不同:
 * 无持久层下游本就走无存储路径,而写失败是用户以为存了却没存,必须打断。
 */
function writeItem(key: string, value: string): void {
  const s = store();
  if (!s) return;
  try {
    s.setItem(key, value);
  } catch (e) {
    throw new StorageWriteError(e);
  }
}

/** 地址归一:小写(见模块注释的大小写说明)。 */
function normAddr(address: string): string {
  return address.toLowerCase();
}

/** 正式键:bs:{chainId}:{contract}:{gameId}:{address} */
export function boardKey(
  chainId: number,
  contract: string,
  gameId: number | bigint,
  address: string,
): string {
  return `${KEY_PREFIX}:${chainId}:${normAddr(contract)}:${gameId}:${normAddr(address)}`;
}

/** pending 键:bs:{chainId}:{contract}:pending:{address} */
export function pendingKey(chainId: number, contract: string, address: string): string {
  return `${KEY_PREFIX}:${chainId}:${normAddr(contract)}:pending:${normAddr(address)}`;
}

// ============ bigint ↔ hex 与 (de)serialize ============

function toHex(v: bigint): string {
  return `0x${v.toString(16)}`;
}

function fromHex(s: string): bigint {
  // BigInt('0x…') 原生支持;非法串(空/缺 0x)抛错,由 import 校验提前拦。
  return BigInt(s);
}

/** BoardRecord(bigint) → StoredBoard(hex 字符串,可 JSON 序列化)。 */
export function toStored(rec: BoardRecord): StoredBoard {
  return {
    ships: rec.ships,
    salt: toHex(rec.salt),
    commitment: toHex(rec.commitment),
    version: STORAGE_VERSION,
  };
}

const HEX_RE = /^0x[0-9a-fA-F]+$/;

/** 校验任意对象是否是合法 StoredBoard(用于 load 与 import 的脏数据防线)。 */
export function isStoredBoard(v: unknown): v is StoredBoard {
  if (typeof v !== 'object' || v === null) return false;
  const o = v as Record<string, unknown>;
  if (o.version !== STORAGE_VERSION) return false;
  if (typeof o.salt !== 'string' || !HEX_RE.test(o.salt)) return false;
  if (typeof o.commitment !== 'string' || !HEX_RE.test(o.commitment)) return false;
  if (!Array.isArray(o.ships) || o.ships.length !== 5) return false;
  for (const s of o.ships) {
    if (typeof s !== 'object' || s === null) return false;
    const ship = s as Record<string, unknown>;
    if (!Number.isInteger(ship.x) || !Number.isInteger(ship.y)) return false;
    if (ship.dir !== 0 && ship.dir !== 1) return false;
  }
  return true;
}

/** StoredBoard(hex) → BoardRecord(bigint)。入参须先过 isStoredBoard。 */
export function fromStored(s: StoredBoard): BoardRecord {
  return {
    ships: s.ships,
    salt: fromHex(s.salt),
    commitment: fromHex(s.commitment),
  };
}

// ============ 正式键存取 ============

/** 写正式键。写失败(setItem 抛)→ StorageWriteError(C1)。 */
export function saveBoard(
  chainId: number,
  contract: string,
  gameId: number | bigint,
  address: string,
  rec: BoardRecord,
): void {
  writeItem(boardKey(chainId, contract, gameId, address), JSON.stringify(toStored(rec)));
}

/**
 * 读正式键;不存在或损坏 → null(损坏视同丢失,UI 走"重算承诺不一致→导入"路径)。
 * M7 / TODO(3.8):当前把"坏 JSON"与"键不存在"都压成 null,无法区分。3.8 的"导入你的备份" UX
 * 可能需要区分"存过但坏了"(提示导入)vs"从没存过"(提示首次布阵),届时再让本函数 / parseRecord
 * 回传判别信息(如 'corrupt' | 'absent')。现在不实现——等 3.8 的具体形态确定后按需加,避免空设计。
 */
export function loadBoard(
  chainId: number,
  contract: string,
  gameId: number | bigint,
  address: string,
): BoardRecord | null {
  const s = store();
  if (!s) return null;
  const raw = s.getItem(boardKey(chainId, contract, gameId, address));
  if (raw === null) return null;
  return parseRecord(raw);
}

/** 删正式键(§8:Finished 后该键可清理)。 */
export function removeBoard(
  chainId: number,
  contract: string,
  gameId: number | bigint,
  address: string,
): void {
  const s = store();
  if (!s) return;
  s.removeItem(boardKey(chainId, contract, gameId, address));
}

// ============ pending 键存取与迁移 ============

/** 写 pending 键(createGame 上链前,gameId 未知时)。写失败 → StorageWriteError(C1)。 */
export function savePending(
  chainId: number,
  contract: string,
  address: string,
  rec: BoardRecord,
): void {
  writeItem(pendingKey(chainId, contract, address), JSON.stringify(toStored(rec)));
}

/** 读 pending 键;不存在或损坏 → null。 */
export function loadPending(
  chainId: number,
  contract: string,
  address: string,
): BoardRecord | null {
  const s = store();
  if (!s) return null;
  const raw = s.getItem(pendingKey(chainId, contract, address));
  if (raw === null) return null;
  return parseRecord(raw);
}

/**
 * 把 pending 记录迁移到正式键(收到 createGame 回执拿到 gameId 后)。
 * 写正式键 + 删 pending,原子语义(localStorage 单线程,两步之间无并发)。
 * 无 pending 记录时返回 null(调用方据此判断是否有可迁移数据)。
 */
export function promotePending(
  chainId: number,
  contract: string,
  address: string,
  gameId: number | bigint,
): BoardRecord | null {
  const rec = loadPending(chainId, contract, address);
  if (!rec) return null;
  saveBoard(chainId, contract, gameId, address, rec);
  const s = store();
  s?.removeItem(pendingKey(chainId, contract, address));
  return rec;
}

// ============ 导出 / 导入(§8:锁定成功后导出 JSON,清存后导入恢复) ============

/**
 * 导出为下载用的纯对象(StoredBoard 形态,hex 字符串,可直接 JSON.stringify 下载)。
 * 带上定位用的 meta,便于用户/导入端识别这份文件属于哪条链/哪局。
 */
export type ExportedBoard = StoredBoard & {
  chainId: number;
  contract: string;
  gameId: number | string;
  address: string;
};

export function exportBoardJSON(
  chainId: number,
  contract: string,
  gameId: number | bigint,
  address: string,
  rec: BoardRecord,
): ExportedBoard {
  return {
    ...toStored(rec),
    chainId,
    contract: normAddr(contract),
    gameId: typeof gameId === 'bigint' ? gameId.toString() : gameId,
    address: normAddr(address),
  };
}

/**
 * 解析导入的 JSON(字符串或已解析对象)→ BoardRecord。三道关卡,各报各的(I1):
 *   1. 形状:JSON 合法 + isStoredBoard(字段齐、version 对、hex 合法、5 条船 dir∈{0,1})。
 *   2. 布局合法:validateBoard——挡掉越界坐标(x:50)、出界船尾、重叠船,报具体 code+shipId。
 *   3. 承诺一致:verifyBoardCommitment——挡掉 commitment 与 ships/salt 对不上(如 '0x0')。
 *
 * 为何在入口就做 2、3 而不延后:延后到对战幕生成证明才发现,会以 PROOF_MISMATCH 形式爆出来,
 * 那个文案是"清过存储/导入备份"的指引,对"导入的文件本身就坏"是误导。入口拦截给的是准确诊断。
 * 只取 ships/salt/commitment 三项还原;meta 字段(chainId 等)由调用方另行核对是否对得上当前局。
 */
export function importBoardJSON(input: string | unknown): BoardRecord {
  let parsed: unknown;
  if (typeof input === 'string') {
    try {
      parsed = JSON.parse(input);
    } catch {
      throw new Error('导入失败:文件不是合法 JSON。');
    }
  } else {
    parsed = input;
  }
  if (!isStoredBoard(parsed)) {
    throw new Error('导入失败:文件格式不符(缺少字段、版本不符或数据损坏)。');
  }
  // isStoredBoard 已保证 ships.length===5 且每条 x/y 整数、dir∈{0,1};validateBoard 入参要 Board(5-tuple)。
  const ships = parsed.ships as unknown as Parameters<typeof validateBoard>[0];
  const v = validateBoard(ships);
  if (!v.ok) {
    throw new Error(`导入失败:布局非法(${v.code},第 ${v.shipId + 1} 条船)。请导入正确的部署文件。`);
  }
  if (!verifyBoardCommitment(parsed.ships, parsed.salt, parsed.commitment)) {
    throw new Error('导入失败:棋盘与其承诺不一致。该文件可能被篡改或损坏,请导入正确的部署文件。');
  }
  return fromStored(parsed);
}

// ============ 内部 ============

/** 解析一条落盘记录;JSON 坏 / schema 不符一律当作"无有效记录"返回 null。 */
function parseRecord(raw: string): BoardRecord | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isStoredBoard(parsed)) return null;
  return fromStored(parsed);
}
