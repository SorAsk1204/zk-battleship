/**
 * useGame 取数层的纯投影/解码/排序单测(Task 3.6)。
 *
 * useGame 本身是 React 钩子(readContract + getLogs + watchContractEvent),其取数与订阅在浏览器
 * 验收;这里只钉死与网络无关的**链上→派生输入**投影(本仓 vitest node 环境、无 testing-library,
 * 同 gameView/gameListReducer 治理):
 *   - projectSnapshot:getGame struct(viem 命名对象)→ GameSnapshot(uint8→number、承诺 bigint、turn 收窄)。
 *     这是「我有没有读对 struct 字段」的契约面——字段错位/类型漏转在这里被抓。
 *   - toResolvedShot:ShotResolved log → ResolvedShot(坐标级 hit/miss);坏 log(缺字段)→ null。
 *   - toLogEntry:四类事件 log → GameLogEntry(战报流投影);非四类 / 缺 pos → null。
 *   - comparePos:事件日志按 (blockNumber, logIndex) 升序(append-only 时间序)。
 */
import { describe, expect, it } from 'vitest';
import type { Address } from '../lib/contracts.ts';
import { Phase } from './gameView.ts';
import {
  applyBlockTimes,
  collectUntimedBlocks,
  comparePos,
  projectSnapshot,
  toLogEntry,
  toResolvedShot,
  type GameLogEntry,
  type GetGameResult,
} from './useGame.ts';

const P0 = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266' as Address;
const P1 = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8' as Address;
const ZERO = '0x0000000000000000000000000000000000000000' as Address;

/** shotMap 位图小工具:把若干格序号(y*10+x)置位成一个 bigint。 */
function bits(...cells: number[]): bigint {
  return cells.reduce((acc, c) => acc | (1n << BigInt(c)), 0n);
}

/** 造一个 getGame 返回的 struct(viem 命名对象形态)。 */
function struct(overrides: Partial<GetGameResult> = {}): GetGameResult {
  return {
    p0: P0,
    p1: P1,
    commitment0: 111n,
    commitment1: 222n,
    phase: Phase.AwaitingAttack,
    turn: 0,
    pendingX: 0,
    pendingY: 0,
    hits: [0, 0],
    shotMap: [0n, 0n],
    lastActionAt: 1_700_000_000n,
    winner: ZERO,
    ...overrides,
  };
}

describe('projectSnapshot — getGame struct → GameSnapshot', () => {
  it('原样投影玩家/承诺,uint8→number,承诺保持 bigint', () => {
    const s = projectSnapshot(struct({ commitment0: 999n, commitment1: 888n }));
    expect(s.p0).toBe(P0);
    expect(s.p1).toBe(P1);
    expect(s.commitment0).toBe(999n);
    expect(s.commitment1).toBe(888n);
    expect(typeof s.commitment0).toBe('bigint');
  });

  it('phase/turn/pending/hits/lastActionAt 全转 number,turn 收窄 0/1', () => {
    const s = projectSnapshot(
      struct({ phase: Phase.AwaitingResponse, turn: 1, pendingX: 3, pendingY: 6, hits: [5, 9], lastActionAt: 1_700_000_123n }),
    );
    expect(s.phase).toBe(Phase.AwaitingResponse);
    expect(s.turn).toBe(1);
    expect(s.pendingX).toBe(3);
    expect(s.pendingY).toBe(6);
    expect(s.hits).toEqual([5, 9]);
    expect(s.lastActionAt).toBe(1_700_000_123);
    expect(typeof s.lastActionAt).toBe('number');
  });

  it('不存在的局(零 struct,phase None)→ phase None(下游判 notfound)', () => {
    const s = projectSnapshot(struct({ p0: ZERO, p1: ZERO, phase: Phase.None, commitment0: 0n, commitment1: 0n }));
    expect(s.phase).toBe(Phase.None);
    expect(s.p0).toBe(ZERO);
  });

  it('winner 原样投影(Finished 局)', () => {
    const s = projectSnapshot(struct({ phase: Phase.Finished, winner: P0 }));
    expect(s.winner).toBe(P0);
  });

  it('越界 phase(理论不达)保守归 None', () => {
    const s = projectSnapshot(struct({ phase: 99 }));
    expect(s.phase).toBe(Phase.None);
  });

  it('turn 异常值(非 0/1)收窄为 0', () => {
    expect(projectSnapshot(struct({ turn: 7 })).turn).toBe(0);
  });

  it('shotMap 投影为两个 bigint(原样保精度;派生层据此给 firedCells)', () => {
    const s = projectSnapshot(struct({ shotMap: [bits(12), bits(34, 56)] }));
    expect(s.shotMap[0]).toBe(bits(12));
    expect(s.shotMap[1]).toBe(bits(34, 56));
    expect(typeof s.shotMap[0]).toBe('bigint');
  });

  it('shotMap 大位图(bit 99 置位)不丢精度', () => {
    const s = projectSnapshot(struct({ shotMap: [1n << 99n, 0n] }));
    expect(s.shotMap[0]).toBe(1n << 99n);
  });

  it('shotMap 空(双 0n)→ 投影双 0n', () => {
    const s = projectSnapshot(struct({ shotMap: [0n, 0n] }));
    expect(s.shotMap).toEqual([0n, 0n]);
  });
});

describe('toResolvedShot — ShotResolved log → ResolvedShot', () => {
  it('完整 log → 坐标级结果(defender/x/y/result/totalHits)', () => {
    const r = toResolvedShot({ args: { defender: 1, x: 3, y: 6, result: 1, totalHits: 4 } } as never);
    expect(r).toEqual({ defender: 1, x: 3, y: 6, result: 1, totalHits: 4 });
  });

  it('miss(result=0)', () => {
    const r = toResolvedShot({ args: { defender: 0, x: 1, y: 1, result: 0, totalHits: 0 } } as never);
    expect(r?.result).toBe(0);
    expect(r?.defender).toBe(0);
  });

  it('缺字段(脏 log)→ null,不污染派生输入', () => {
    expect(toResolvedShot({ args: { defender: 1, x: 3 } } as never)).toBeNull();
    expect(toResolvedShot({ args: {} } as never)).toBeNull();
  });

  it('totalHits 缺省 → 0', () => {
    const r = toResolvedShot({ args: { defender: 1, x: 2, y: 2, result: 1 } } as never);
    expect(r?.totalHits).toBe(0);
  });
});

describe('toLogEntry — 四类事件 → GameLogEntry', () => {
  const pos = { blockNumber: 5n, logIndex: 2 };

  it('GameJoined → joined + p1', () => {
    const e = toLogEntry({ eventName: 'GameJoined', blockNumber: 5n, logIndex: 2, args: { p1: P1 } } as never);
    expect(e).toMatchObject({ kind: 'joined', p1: P1, pos });
  });

  it('ShotFired → fired + attacker/坐标', () => {
    const e = toLogEntry({ eventName: 'ShotFired', blockNumber: 5n, logIndex: 2, args: { attacker: 1, x: 4, y: 7 } } as never);
    expect(e).toMatchObject({ kind: 'fired', side: 1, x: 4, y: 7 });
  });

  it('ShotResolved → resolved + defender/result/totalHits', () => {
    const e = toLogEntry({
      eventName: 'ShotResolved',
      blockNumber: 5n,
      logIndex: 2,
      args: { defender: 0, x: 1, y: 1, result: 1, totalHits: 3 },
    } as never);
    expect(e).toMatchObject({ kind: 'resolved', side: 0, x: 1, y: 1, result: 1, totalHits: 3 });
  });

  it('GameFinished → finished + winner/reason', () => {
    const e = toLogEntry({
      eventName: 'GameFinished',
      blockNumber: 5n,
      logIndex: 2,
      args: { winner: P0, reason: '17hits' },
    } as never);
    expect(e).toMatchObject({ kind: 'finished', winner: P0, reason: '17hits' });
  });

  it('非四类事件(如 GameCreated)→ null(不进单局战报流)', () => {
    expect(toLogEntry({ eventName: 'GameCreated', blockNumber: 5n, logIndex: 2, args: { p0: P0 } } as never)).toBeNull();
  });

  it('缺 pos(pending log)→ null', () => {
    expect(toLogEntry({ eventName: 'GameJoined', blockNumber: null, logIndex: null, args: { p1: P1 } } as never)).toBeNull();
  });
});

describe('comparePos — 日志按 (blockNumber, logIndex) 升序', () => {
  const mk = (blockNumber: bigint, logIndex: number): GameLogEntry => ({
    kind: 'fired',
    pos: { blockNumber, logIndex },
  });

  it('块号优先升序', () => {
    const arr = [mk(7n, 0), mk(3n, 9), mk(5n, 1)].sort(comparePos);
    expect(arr.map((e) => e.pos.blockNumber)).toEqual([3n, 5n, 7n]);
  });

  it('同块内按 logIndex 升序', () => {
    const arr = [mk(5n, 3), mk(5n, 0), mk(5n, 1)].sort(comparePos);
    expect(arr.map((e) => e.pos.logIndex)).toEqual([0, 1, 3]);
  });

  it('大块号 bigint 不溢出(> Number.MAX_SAFE_INTEGER 仍正确)', () => {
    const big = 9_007_199_254_740_993n; // MAX_SAFE_INTEGER + 2
    const arr = [mk(big + 1n, 0), mk(big, 0)].sort(comparePos);
    expect(arr.map((e) => e.pos.blockNumber)).toEqual([big, big + 1n]);
  });
});

describe('collectUntimedBlocks — 块时间 memo 纯核(挑出需 getBlock 的去重块号)', () => {
  /** 造若干条目,块号取自入参(logIndex 递增,内容无关紧要)。 */
  const entries = (...blockNumbers: bigint[]): GameLogEntry[] =>
    blockNumbers.map((bn, i) => ({ kind: 'fired', pos: { blockNumber: bn, logIndex: i } }));

  it('全新块、无缓存无在取 → 全部去重返回(升序)', () => {
    const need = collectUntimedBlocks(entries(7n, 3n, 5n), new Set(), new Set());
    expect(need).toEqual([3n, 5n, 7n]);
  });

  it('同块多条事件 → 去重为一个块号(33 事件对每个唯一块只发一次 getBlock)', () => {
    const need = collectUntimedBlocks(entries(5n, 5n, 5n), new Set(), new Set());
    expect(need).toEqual([5n]);
  });

  it('已缓存的块跳过(timed.has 命中即不再取)', () => {
    // 用 Map 当 timed(实际传 blockTimeRef Map):块 5 已缓存 → 只剩块 7 待取。
    const timed = new Map<bigint, number>([[5n, 1_700_000_000]]);
    const need = collectUntimedBlocks(entries(5n, 7n), timed, new Set());
    expect(need).toEqual([7n]);
  });

  it('正在取的块跳过(inFlight 防并发重取)', () => {
    const need = collectUntimedBlocks(entries(5n, 7n), new Set(), new Set([7n]));
    expect(need).toEqual([5n]);
  });

  it('既缓存又在取 → 都跳过,空数组(无需再发 getBlock)', () => {
    const timed = new Map<bigint, number>([[5n, 1]]);
    const need = collectUntimedBlocks(entries(5n, 7n), timed, new Set([7n]));
    expect(need).toEqual([]);
  });

  it('空条目 → 空数组', () => {
    expect(collectUntimedBlocks([], new Set(), new Set())).toEqual([]);
  });
});

describe('applyBlockTimes — 块时间 memo 纯核(把已知块时间贴到条目 ts,读时套用不 mutate)', () => {
  const e = (bn: bigint, logIndex = 0): GameLogEntry => ({ kind: 'fired', pos: { blockNumber: bn, logIndex } });

  it('块号在 timeMap → 写 ts(unix 秒)', () => {
    const out = applyBlockTimes([e(5n)], new Map([[5n, 1_700_000_123]]));
    expect(out[0].ts).toBe(1_700_000_123);
  });

  it('块号不在 timeMap(未取到/失败)→ ts 缺省(条目仍返回,渲染层降级不显时间)', () => {
    const out = applyBlockTimes([e(9n)], new Map([[5n, 1]]));
    expect(out[0].ts).toBeUndefined();
    expect(out.length).toBe(1); // 条目不丢
  });

  it('混合:部分块有时间、部分没有 → 各按自身块号套用', () => {
    const out = applyBlockTimes([e(5n, 0), e(9n, 1)], new Map([[5n, 1_700_000_000]]));
    expect(out[0].ts).toBe(1_700_000_000);
    expect(out[1].ts).toBeUndefined();
  });

  it('不 mutate 入参条目(池内条目恒为无 ts 的原始投影,ts 只在输出层附加)', () => {
    const src = e(5n);
    applyBlockTimes([src], new Map([[5n, 1_700_000_000]]));
    expect(src.ts).toBeUndefined(); // 原对象未被改
  });

  it('空条目 → 空数组', () => {
    expect(applyBlockTimes([], new Map())).toEqual([]);
  });
});
