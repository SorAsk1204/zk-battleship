/**
 * gameListReducer 单测(Task 3.4)。
 *
 * 锁住「事件流 → 进行中对局列表」的纯归约语义:
 *   - created → waiting,joined → active,finished → 从进行中剔除;
 *   - 顺序无关(乱序事件折叠出同一终态);
 *   - 幂等(重复 log 不改变结果);
 *   - 排序最新创建在前;
 *   - 多局并存各自归类。
 * useGameList 的 React/wagmi 部分(getLogs 回填 + watchContractEvent 增量)在浏览器验收,
 * 这里只钉死与网络无关的状态机(本仓 vitest 是 node 环境、无 testing-library)。
 */
import { describe, expect, it } from 'vitest';
import type { Address } from '../lib/contracts.ts';
import {
  buildInProgressList,
  reduceGameEvents,
  toInProgressList,
  type GameEvent,
} from './gameListReducer.ts';

const P0 = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266' as Address;
const P1 = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8' as Address;
const ZERO = '0x0000000000000000000000000000000000000000' as Address;

/** 简写造事件;pos 用 (block, idx)。 */
function created(gameId: number, block: number, idx = 0): GameEvent {
  return { kind: 'created', gameId: BigInt(gameId), p0: P0, pos: { blockNumber: BigInt(block), logIndex: idx } };
}
function joined(gameId: number, block: number, idx = 0): GameEvent {
  return { kind: 'joined', gameId: BigInt(gameId), p1: P1, pos: { blockNumber: BigInt(block), logIndex: idx } };
}
function finished(gameId: number, block: number, idx = 0, winner: Address = P0, reason = '17hits'): GameEvent {
  return { kind: 'finished', gameId: BigInt(gameId), winner, reason, pos: { blockNumber: BigInt(block), logIndex: idx } };
}

describe('reduceGameEvents — status 归类', () => {
  it('只有 created → waiting,带 p0', () => {
    const m = reduceGameEvents([created(1, 10)]);
    const r = m.get('1')!;
    expect(r.status).toBe('waiting');
    expect(r.p0).toBe(P0);
    expect(r.p1).toBeUndefined();
  });

  it('created + joined → active,带 p0/p1', () => {
    const m = reduceGameEvents([created(1, 10), joined(1, 11)]);
    const r = m.get('1')!;
    expect(r.status).toBe('active');
    expect(r.p0).toBe(P0);
    expect(r.p1).toBe(P1);
  });

  it('created + joined + finished → finished,带 winner', () => {
    const m = reduceGameEvents([created(1, 10), joined(1, 11), finished(1, 20, 0, P1)]);
    const r = m.get('1')!;
    expect(r.status).toBe('finished');
    expect(r.winner).toBe(P1);
  });

  it('created + finished(无人加入即 cancelled)→ finished', () => {
    const m = reduceGameEvents([created(1, 10), finished(1, 30, 0, ZERO, 'cancelled')]);
    expect(m.get('1')!.status).toBe('finished');
  });
});

describe('reduceGameEvents — 顺序无关 & 幂等', () => {
  it('事件乱序折叠出同一终态', () => {
    const evs = [finished(1, 20, 0, P1), created(1, 10), joined(1, 11)];
    const r = reduceGameEvents(evs).get('1')!;
    expect(r.status).toBe('finished');
    expect(r.p0).toBe(P0);
    expect(r.p1).toBe(P1);
    expect(r.winner).toBe(P1);
  });

  it('joined 先于 created 到达,仍归到 active 且补回 p0', () => {
    const r = reduceGameEvents([joined(1, 11), created(1, 10)]).get('1')!;
    expect(r.status).toBe('active');
    expect(r.p0).toBe(P0);
    expect(r.p1).toBe(P1);
  });

  it('finished 不被后到的 created/joined 降级(终态不可逆)', () => {
    const r = reduceGameEvents([finished(1, 20), created(1, 10), joined(1, 11)]).get('1')!;
    expect(r.status).toBe('finished');
  });

  it('重复喂同一批事件结果不变(幂等)', () => {
    const evs = [created(1, 10), joined(1, 11)];
    const once = reduceGameEvents(evs).get('1')!;
    const twice = reduceGameEvents([...evs, ...evs]).get('1')!;
    expect(twice).toEqual(once);
  });
});

describe('toInProgressList — 过滤 + 排序', () => {
  it('只保留 waiting/active,剔除 finished', () => {
    const m = reduceGameEvents([
      created(1, 10),
      created(2, 11),
      joined(2, 12),
      created(3, 13),
      finished(3, 14),
    ]);
    const list = toInProgressList(m);
    const ids = list.map((r) => Number(r.gameId)).sort((a, b) => a - b);
    expect(ids).toEqual([1, 2]); // 3 已 finished 被剔除
  });

  it('最新创建在前(createdPos 倒序)', () => {
    const list = buildInProgressList([created(1, 10), created(2, 20), created(3, 15)]);
    expect(list.map((r) => Number(r.gameId))).toEqual([2, 3, 1]); // 块号 20 > 15 > 10
  });

  it('同块多局按 logIndex 倒序(新在前)', () => {
    const list = buildInProgressList([created(1, 10, 0), created(2, 10, 1), created(3, 10, 2)]);
    expect(list.map((r) => Number(r.gameId))).toEqual([3, 2, 1]);
  });

  it('多局并存:waiting 与 active 混合,各自正确', () => {
    const list = buildInProgressList([
      created(1, 10),
      created(2, 11),
      joined(2, 12),
    ]);
    const byId = new Map(list.map((r) => [Number(r.gameId), r]));
    expect(byId.get(1)!.status).toBe('waiting');
    expect(byId.get(2)!.status).toBe('active');
  });

  it('空事件流 → 空列表', () => {
    expect(buildInProgressList([])).toEqual([]);
  });
});
