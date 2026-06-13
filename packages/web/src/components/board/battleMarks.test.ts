/**
 * battleMarks 单测(Task 3.7)。
 *
 * 钉死对战幕「炮击标记 / 禁点集」的纯派生:命中/未命中落格、待应答(pending-out/in)与已应答的优先级
 * (resolved 优先,不被空心盖)、SonarBoard 的禁点集 = myFiredCells ∪ 在飞 pending(D11 真理)。
 * 这些是 gameplay 正确性的关键判定(渲染层在浏览器验收,纯核在此钉死,同 gameView 治理)。
 */
import { describe, expect, it } from 'vitest';
import {
  cellIdx,
  ownMarks,
  resolvedMarks,
  sonarDisabledSet,
  sonarMarks,
  type ShotLike,
} from './battleMarks.ts';

describe('cellIdx — 行主序 y*10+x', () => {
  it('(0,0)=0, (3,6)=63, (9,9)=99', () => {
    expect(cellIdx(0, 0)).toBe(0);
    expect(cellIdx(3, 6)).toBe(63);
    expect(cellIdx(9, 9)).toBe(99);
  });
});

describe('resolvedMarks — 已应答炮击落 hit/miss', () => {
  it('result=1 → hit,result=0 → miss,按 cellIdx 落格', () => {
    const shots: ShotLike[] = [
      { x: 3, y: 6, result: 1 },
      { x: 0, y: 0, result: 0 },
    ];
    const m = resolvedMarks(shots);
    expect(m.get(63)).toBe('hit');
    expect(m.get(0)).toBe('miss');
    expect(m.size).toBe(2);
  });

  it('空输入 → 空 Map', () => {
    expect(resolvedMarks([]).size).toBe(0);
  });
});

describe('sonarMarks — myShots + 待应答(pending-out)', () => {
  it('已应答的格画 hit/miss;在飞 pending 格画 pending-out', () => {
    const myShots: ShotLike[] = [{ x: 1, y: 0, result: 1 }];
    const m = sonarMarks(myShots, [cellIdx(5, 5)]);
    expect(m.get(cellIdx(1, 0))).toBe('hit');
    expect(m.get(cellIdx(5, 5))).toBe('pending-out');
  });

  it('resolved 优先:同格既 resolved 又在 pending 列表 → 保留 hit/miss(不盖空心)', () => {
    const myShots: ShotLike[] = [{ x: 2, y: 2, result: 0 }];
    // pending 列表里也含 (2,2)(理论上 ShotResolved 到达后该格已离开 pending,这里测兜底优先级)
    const m = sonarMarks(myShots, [cellIdx(2, 2)]);
    expect(m.get(cellIdx(2, 2))).toBe('miss');
  });

  it('多个 pending-out 格都标(链上 pending + 本地乐观可能并存)', () => {
    const m = sonarMarks([], [cellIdx(1, 1), cellIdx(2, 2)]);
    expect(m.get(cellIdx(1, 1))).toBe('pending-out');
    expect(m.get(cellIdx(2, 2))).toBe('pending-out');
  });
});

describe('ownMarks — enemyShots + 来袭(pending-in)', () => {
  it('敌方对我的命中/未命中 + 来袭格', () => {
    const enemyShots: ShotLike[] = [
      { x: 0, y: 1, result: 1 },
      { x: 9, y: 9, result: 0 },
    ];
    const m = ownMarks(enemyShots, cellIdx(4, 4));
    expect(m.get(cellIdx(0, 1))).toBe('hit');
    expect(m.get(cellIdx(9, 9))).toBe('miss');
    expect(m.get(cellIdx(4, 4))).toBe('pending-in');
  });

  it('pendingInCell=null → 无来袭标记', () => {
    const m = ownMarks([{ x: 0, y: 0, result: 1 }], null);
    expect(m.has(cellIdx(0, 0))).toBe(true);
    expect([...m.values()].includes('pending-in')).toBe(false);
  });

  it('来袭格已 resolved → 保留 hit/miss(不被 pending-in 盖)', () => {
    const m = ownMarks([{ x: 3, y: 3, result: 1 }], cellIdx(3, 3));
    expect(m.get(cellIdx(3, 3))).toBe('hit');
  });
});

describe('sonarDisabledSet — myFiredCells ∪ 在飞 pending(D11)', () => {
  it('并入已开炮格与在飞 pending 出炮格', () => {
    const fired = new Set<number>([cellIdx(0, 0), cellIdx(1, 0)]);
    const s = sonarDisabledSet(fired, [cellIdx(5, 5)]);
    expect(s.has(cellIdx(0, 0))).toBe(true);
    expect(s.has(cellIdx(1, 0))).toBe(true);
    expect(s.has(cellIdx(5, 5))).toBe(true);
    expect(s.has(cellIdx(9, 9))).toBe(false);
  });

  it('不 mutate 入参 myFiredCells(返回新 Set)', () => {
    const fired = new Set<number>([cellIdx(0, 0)]);
    const s = sonarDisabledSet(fired, [cellIdx(5, 5)]);
    expect(fired.has(cellIdx(5, 5))).toBe(false); // 原集未被改
    expect(s).not.toBe(fired);
  });

  it('无在飞 pending → 等于 myFiredCells 内容', () => {
    const fired = new Set<number>([cellIdx(2, 3), cellIdx(4, 5)]);
    const s = sonarDisabledSet(fired, []);
    expect([...s].sort((a, b) => a - b)).toEqual([cellIdx(2, 3), cellIdx(4, 5)].sort((a, b) => a - b));
  });
});
