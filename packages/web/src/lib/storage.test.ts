import { beforeEach, describe, expect, it } from 'vitest';
import type { Ship } from '@zk-battleship/circuits';
import {
  STORAGE_VERSION,
  boardKey,
  pendingKey,
  saveBoard,
  loadBoard,
  removeBoard,
  savePending,
  loadPending,
  promotePending,
  exportBoardJSON,
  importBoardJSON,
  toStored,
  fromStored,
  isStoredBoard,
  StorageWriteError,
  type BoardRecord,
} from './storage.ts';
import { computeCommitment } from './commitment.ts';

const CHAIN = 31337;
const CONTRACT = '0x9fe46736679d2d9a65f0992f2272de9f3c7fa6e0';
const ADDR = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266'; // checksum 形式,带大写
const ADDR_LOWER = ADDR.toLowerCase();

const SHIPS: Ship[] = [
  { x: 9, y: 0, dir: 1 },
  { x: 0, y: 9, dir: 0 },
  { x: 5, y: 9, dir: 0 },
  { x: 0, y: 0, dir: 1 },
  { x: 8, y: 8, dir: 1 },
];

// SHIPS == circuits boardB;salt=0xdeadbeef 对应的真实 Poseidon 承诺(与 commitment.test 同一向量)。
// salt/commitment 必须自洽:importBoardJSON 现在会 verifyBoardCommitment,salt 与 commitment 对不上即 reject。
// commitment 本身是 77 位十进制数(远超 JS safe integer),已足以验证 hex 序列化无损。
const REC: BoardRecord = {
  ships: SHIPS,
  salt: 0xdeadbeefn,
  commitment: 10562143633053394694015122280104595996515830983000757199484363156303195434041n,
};

beforeEach(() => {
  localStorage.clear();
});

describe('键拼装与地址归一', () => {
  it('boardKey 模板 bs:{chainId}:{contract}:{gameId}:{address},地址/合约小写', () => {
    expect(boardKey(CHAIN, CONTRACT, 42, ADDR)).toBe(
      `bs:${CHAIN}:${CONTRACT.toLowerCase()}:42:${ADDR_LOWER}`,
    );
  });

  it('pendingKey 模板 bs:{chainId}:{contract}:pending:{address}', () => {
    expect(pendingKey(CHAIN, CONTRACT, ADDR)).toBe(
      `bs:${CHAIN}:${CONTRACT.toLowerCase()}:pending:${ADDR_LOWER}`,
    );
  });

  it('大小写不同的同一地址映射到同一键(viem checksum 坑)', () => {
    expect(boardKey(CHAIN, CONTRACT, 1, ADDR)).toBe(boardKey(CHAIN, CONTRACT, 1, ADDR_LOWER));
    // 存(大写) → 读(小写)拿得到
    saveBoard(CHAIN, CONTRACT, 1, ADDR, REC);
    const got = loadBoard(CHAIN, CONTRACT, 1, ADDR_LOWER);
    expect(got).not.toBeNull();
    expect(got!.salt).toBe(REC.salt);
  });
});

describe('bigint ↔ hex 序列化', () => {
  it('toStored 把 salt/commitment 写成 0x hex 字符串', () => {
    const s = toStored(REC);
    expect(s.version).toBe(STORAGE_VERSION);
    expect(s.salt).toMatch(/^0x[0-9a-f]+$/);
    expect(s.commitment).toMatch(/^0x[0-9a-f]+$/);
    expect(BigInt(s.salt)).toBe(REC.salt);
    expect(BigInt(s.commitment)).toBe(REC.commitment);
  });

  it('toStored → fromStored round-trip 无损(含超 safe-integer 的大数)', () => {
    const back = fromStored(toStored(REC));
    expect(back.salt).toBe(REC.salt);
    expect(back.commitment).toBe(REC.commitment);
    expect(back.ships).toEqual(REC.ships);
  });
});

describe('正式键 save/load/remove round-trip', () => {
  it('save → load 还原 ships/salt/commitment', () => {
    saveBoard(CHAIN, CONTRACT, 7, ADDR, REC);
    const got = loadBoard(CHAIN, CONTRACT, 7, ADDR);
    expect(got).toEqual(REC);
  });

  it('load 不存在的键 → null', () => {
    expect(loadBoard(CHAIN, CONTRACT, 999, ADDR)).toBeNull();
  });

  it('remove 后 load → null', () => {
    saveBoard(CHAIN, CONTRACT, 7, ADDR, REC);
    removeBoard(CHAIN, CONTRACT, 7, ADDR);
    expect(loadBoard(CHAIN, CONTRACT, 7, ADDR)).toBeNull();
  });

  it('load 到损坏的 JSON → null(视同丢失)', () => {
    localStorage.setItem(boardKey(CHAIN, CONTRACT, 7, ADDR), '{not json');
    expect(loadBoard(CHAIN, CONTRACT, 7, ADDR)).toBeNull();
  });

  it('load 到 schema 不符(version 错)→ null', () => {
    const bad = { ...toStored(REC), version: 2 };
    localStorage.setItem(boardKey(CHAIN, CONTRACT, 7, ADDR), JSON.stringify(bad));
    expect(loadBoard(CHAIN, CONTRACT, 7, ADDR)).toBeNull();
  });
});

describe('C1:写盘失败 → StorageWriteError(非静默吞)', () => {
  // localStorage 存在但 setItem 抛(配额耗尽 / Safari 隐私模式)。注入一个会抛的 setItem。
  function withThrowingSetItem(run: () => void): void {
    const orig = localStorage.setItem;
    const ex = new DOMException('mock quota', 'QuotaExceededError');
    localStorage.setItem = () => {
      throw ex;
    };
    try {
      run();
    } finally {
      localStorage.setItem = orig;
    }
  }

  it('saveBoard 在 setItem 抛时抛 StorageWriteError,消息点名丢失应答能力', () => {
    withThrowingSetItem(() => {
      let caught: unknown;
      try {
        saveBoard(CHAIN, CONTRACT, 7, ADDR, REC);
      } catch (e) {
        caught = e;
      }
      expect(caught).toBeInstanceOf(StorageWriteError);
      expect((caught as Error).message).toContain('丢失应答能力');
    });
  });

  it('savePending 在 setItem 抛时同样抛 StorageWriteError', () => {
    withThrowingSetItem(() => {
      expect(() => savePending(CHAIN, CONTRACT, ADDR, REC)).toThrow(StorageWriteError);
    });
  });

  it('StorageWriteError 保留原始 cause(便于上层判型 QuotaExceededError)', () => {
    withThrowingSetItem(() => {
      try {
        saveBoard(CHAIN, CONTRACT, 7, ADDR, REC);
        expect.unreachable('应已抛出');
      } catch (e) {
        expect(e).toBeInstanceOf(StorageWriteError);
        expect((e as { cause?: unknown }).cause).toBeInstanceOf(DOMException);
        expect(((e as { cause?: DOMException }).cause as DOMException).name).toBe(
          'QuotaExceededError',
        );
      }
    });
  });

  it('promotePending 在写正式键失败时上抛 StorageWriteError,pending 仍在(未误删)', () => {
    savePending(CHAIN, CONTRACT, ADDR, REC);
    withThrowingSetItem(() => {
      expect(() => promotePending(CHAIN, CONTRACT, ADDR, 42)).toThrow(StorageWriteError);
    });
    // saveBoard 抛在 removeItem 之前,pending 应原封不动 → 可重试/导出,数据没丢。
    expect(loadPending(CHAIN, CONTRACT, ADDR)).toEqual(REC);
  });
});

describe('pending → promote 迁移', () => {
  it('savePending → loadPending 还原', () => {
    savePending(CHAIN, CONTRACT, ADDR, REC);
    expect(loadPending(CHAIN, CONTRACT, ADDR)).toEqual(REC);
  });

  it('promotePending:写正式键 + 删 pending,返回被迁移记录', () => {
    savePending(CHAIN, CONTRACT, ADDR, REC);
    const moved = promotePending(CHAIN, CONTRACT, ADDR, 42);
    expect(moved).toEqual(REC);
    // 正式键拿得到
    expect(loadBoard(CHAIN, CONTRACT, 42, ADDR)).toEqual(REC);
    // pending 已清
    expect(loadPending(CHAIN, CONTRACT, ADDR)).toBeNull();
  });

  it('promotePending 无 pending 记录 → null,不写正式键', () => {
    expect(promotePending(CHAIN, CONTRACT, ADDR, 42)).toBeNull();
    expect(loadBoard(CHAIN, CONTRACT, 42, ADDR)).toBeNull();
  });
});

describe('导出 / 导入', () => {
  it('exportBoardJSON 产纯对象(hex 字符串 + meta),可 JSON.stringify', () => {
    const exp = exportBoardJSON(CHAIN, CONTRACT, 42, ADDR, REC);
    expect(exp.chainId).toBe(CHAIN);
    expect(exp.contract).toBe(CONTRACT.toLowerCase());
    expect(exp.address).toBe(ADDR_LOWER);
    expect(exp.gameId).toBe(42);
    expect(exp.salt).toMatch(/^0x[0-9a-f]+$/);
    // 可序列化(不含 bigint)
    expect(() => JSON.stringify(exp)).not.toThrow();
  });

  it('importBoardJSON:导出再导入 round-trip 还原 bigint', () => {
    const exp = exportBoardJSON(CHAIN, CONTRACT, 42, ADDR, REC);
    const back = importBoardJSON(JSON.stringify(exp));
    expect(back.salt).toBe(REC.salt);
    expect(back.commitment).toBe(REC.commitment);
    expect(back.ships).toEqual(REC.ships);
  });

  it('importBoardJSON 接受已解析对象', () => {
    const back = importBoardJSON(toStored(REC) as unknown);
    expect(back.commitment).toBe(REC.commitment);
  });

  it('importBoardJSON 对坏数据 reject', () => {
    expect(() => importBoardJSON('{not json')).toThrow();
    expect(() => importBoardJSON({})).toThrow();
    expect(() => importBoardJSON({ ...toStored(REC), salt: 'nothex' })).toThrow();
    expect(() => importBoardJSON({ ...toStored(REC), ships: [] })).toThrow(); // 船数不对
    expect(() => importBoardJSON({ ...toStored(REC), version: 99 })).toThrow();
  });
});

describe('I1:importBoardJSON 入口拦截非法布局 / 承诺不一致(此前会被接受)', () => {
  const VALID_STORED = toStored(REC); // 自洽:SHIPS=boardB,salt 0xdeadbeef,commitment 真值

  it('越界坐标(x:50)→ reject,报"布局非法"且点名 code', () => {
    // 形状校验只查 Number.isInteger,x:50 能过形状,到 validateBoard 才被 BAD_COORD 拦。
    const oob = {
      ...VALID_STORED,
      ships: [{ x: 50, y: 0, dir: 1 }, ...VALID_STORED.ships.slice(1)],
    };
    expect(isStoredBoard(oob)).toBe(true); // 确认确实越过形状关
    expect(() => importBoardJSON(oob)).toThrow(/布局非法/);
    expect(() => importBoardJSON(oob)).toThrow(/BAD_COORD/);
  });

  it('重叠船 → reject,报"布局非法(OVERLAP)"', () => {
    // 两条 dir=0 的船头都落在 (0,0),占格相交 → OVERLAP;坐标/dir 均合法,能过形状关。
    const overlap = {
      ...VALID_STORED,
      ships: [
        { x: 0, y: 0, dir: 0 },
        { x: 0, y: 0, dir: 0 },
        { x: 0, y: 5, dir: 0 },
        { x: 0, y: 7, dir: 0 },
        { x: 0, y: 9, dir: 0 },
      ],
    };
    expect(isStoredBoard(overlap)).toBe(true);
    expect(() => importBoardJSON(overlap)).toThrow(/布局非法/);
    expect(() => importBoardJSON(overlap)).toThrow(/OVERLAP/);
  });

  it("承诺不一致(commitment:'0x0')→ reject,报\"棋盘与其承诺不一致\"", () => {
    const badCommit = { ...VALID_STORED, commitment: '0x0' };
    expect(isStoredBoard(badCommit)).toBe(true); // '0x0' 过 hex 形状关
    expect(() => importBoardJSON(badCommit)).toThrow(/棋盘与其承诺不一致/);
  });

  it('布局合法但 salt 改了(承诺对不上)→ reject 承诺不一致(不是布局非法)', () => {
    // salt 换成别的合法 hex,布局照旧合法,但重算承诺 != 存的 commitment。
    const wrongSalt = { ...VALID_STORED, salt: '0xdeadbef0' };
    expect(() => importBoardJSON(wrongSalt)).toThrow(/棋盘与其承诺不一致/);
    expect(() => importBoardJSON(wrongSalt)).not.toThrow(/布局非法/);
  });

  it('自洽文件仍正常导入(回归:别误伤合法文件)', () => {
    const back = importBoardJSON(VALID_STORED as unknown);
    expect(back.salt).toBe(REC.salt);
    expect(back.commitment).toBe(REC.commitment);
    // 自检:存的 commitment 确实是 ships+salt 的真实 Poseidon 输出
    expect(computeCommitment(SHIPS as never, REC.salt)).toBe(REC.commitment);
  });
});

describe('isStoredBoard 形状校验', () => {
  it('合法 StoredBoard → true', () => {
    expect(isStoredBoard(toStored(REC))).toBe(true);
  });

  it('各类坏形状 → false', () => {
    expect(isStoredBoard(null)).toBe(false);
    expect(isStoredBoard({})).toBe(false);
    expect(isStoredBoard({ ...toStored(REC), commitment: 123 })).toBe(false); // 非字符串
    expect(isStoredBoard({ ...toStored(REC), ships: [{ x: 0, y: 0, dir: 2 }] })).toBe(false); // dir 非 0/1 且数量不足
    expect(
      isStoredBoard({
        ...toStored(REC),
        ships: [
          { x: 0, y: 0, dir: 2 },
          { x: 0, y: 0, dir: 0 },
          { x: 0, y: 0, dir: 0 },
          { x: 0, y: 0, dir: 0 },
          { x: 0, y: 0, dir: 0 },
        ],
      }),
    ).toBe(false); // 5 条但首条 dir=2
  });
});
