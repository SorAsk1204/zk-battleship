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
