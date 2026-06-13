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
  type BoardRecord,
} from './storage.ts';

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

// 含高位的大 bigint,验证 hex 无损(超 JS safe integer)。
const REC: BoardRecord = {
  ships: SHIPS,
  salt: 0xdeadbeef_deadbeef_deadbeef_deadbeefn,
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
