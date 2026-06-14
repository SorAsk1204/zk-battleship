/**
 * shotBurst 单测(Task 4.2a)。
 *
 * 钉死棋盘事件反馈的**增量核**——这是「命中/落空一次性动效」唯一能在 node 单测、也最容易静默出错的
 * 逻辑(WAAPI/ripple 视觉留浏览器验收)。承重点:**刷新不重放**。标记来自链上事件重放,挂载时一块
 * 棋盘可能已带满历史 hit/miss;若它们都触发一次性动效,每次刷新就是一片乱闪。这里逐位测死:
 *   - 用挂载时 marks 播种 seen → 之后 newlyResolved 为空(历史零触发);
 *   - 单个新 hit/miss 落格 → 恰好返回它一项(分类正确);
 *   - pending-out/pending-in 不触发(非应答事件);
 *   - 已并入 seen 的格不再返回(不重放);移除后再加(理论不会,但语义兜底)。
 */
import { describe, expect, it } from 'vitest';
import { cellIdx, type MarkKind } from './battleMarks.ts';
import { burstableCells, isBurstKind, newlyResolved } from './shotBurst.ts';

/** 便捷构造 marks。 */
function marksOf(entries: Array<[number, MarkKind]>): Map<number, MarkKind> {
  return new Map(entries);
}

describe('isBurstKind — 只 hit/miss 可触发', () => {
  it('hit/miss 为真;pending-out/pending-in 为假', () => {
    expect(isBurstKind('hit')).toBe(true);
    expect(isBurstKind('miss')).toBe(true);
    expect(isBurstKind('pending-out')).toBe(false);
    expect(isBurstKind('pending-in')).toBe(false);
  });
});

describe('burstableCells — 取 marks 里 hit/miss 的键(用于挂载播种)', () => {
  it('只收 hit/miss,丢 pending', () => {
    const marks = marksOf([
      [cellIdx(1, 1), 'hit'],
      [cellIdx(2, 2), 'miss'],
      [cellIdx(3, 3), 'pending-out'],
      [cellIdx(4, 4), 'pending-in'],
    ]);
    const s = burstableCells(marks);
    expect(s.has(cellIdx(1, 1))).toBe(true);
    expect(s.has(cellIdx(2, 2))).toBe(true);
    expect(s.has(cellIdx(3, 3))).toBe(false);
    expect(s.has(cellIdx(4, 4))).toBe(false);
    expect(s.size).toBe(2);
  });

  it('空 marks → 空集', () => {
    expect(burstableCells(new Map()).size).toBe(0);
  });
});

describe('newlyResolved — 当前 marks − seen,只 hit/miss', () => {
  it('seen 为空、marks 有一个 hit → 返回该 hit', () => {
    const marks = marksOf([[cellIdx(3, 6), 'hit']]);
    const out = newlyResolved(new Set(), marks);
    expect(out).toEqual([{ cell: cellIdx(3, 6), kind: 'hit' }]);
  });

  it('seen 为空、marks 有一个 miss → 返回该 miss(分类正确)', () => {
    const marks = marksOf([[cellIdx(0, 0), 'miss']]);
    const out = newlyResolved(new Set(), marks);
    expect(out).toEqual([{ cell: cellIdx(0, 0), kind: 'miss' }]);
  });

  it('pending-out / pending-in 不返回(非应答事件,不触发动效)', () => {
    const marks = marksOf([
      [cellIdx(1, 1), 'pending-out'],
      [cellIdx(2, 2), 'pending-in'],
    ]);
    expect(newlyResolved(new Set(), marks)).toEqual([]);
  });

  it('已在 seen 的 hit/miss 不返回(历史标记 / 已触发过,不重放)', () => {
    const marks = marksOf([
      [cellIdx(1, 0), 'hit'],
      [cellIdx(2, 0), 'miss'],
    ]);
    const seen = new Set([cellIdx(1, 0), cellIdx(2, 0)]);
    expect(newlyResolved(seen, marks)).toEqual([]);
  });

  it('混合:seen 含旧格,marks 多了一个新 hit → 只返回那个新 hit', () => {
    const seen = new Set([cellIdx(1, 0)]); // 旧:已 hit 过
    const marks = marksOf([
      [cellIdx(1, 0), 'hit'], // 旧,跳过
      [cellIdx(5, 5), 'hit'], // 新
      [cellIdx(2, 2), 'pending-out'], // 在飞,跳过
    ]);
    expect(newlyResolved(seen, marks)).toEqual([{ cell: cellIdx(5, 5), kind: 'hit' }]);
  });

  it('多个新格同帧到达 → 按 cell 升序返回(稳定)', () => {
    const marks = marksOf([
      [cellIdx(9, 9), 'hit'], // cell 99
      [cellIdx(0, 0), 'miss'], // cell 0
      [cellIdx(5, 3), 'hit'], // cell 35
    ]);
    const out = newlyResolved(new Set(), marks);
    expect(out.map((b) => b.cell)).toEqual([cellIdx(0, 0), cellIdx(5, 3), cellIdx(9, 9)]);
  });

  it('不 mutate 入参 seen 与 marks', () => {
    const seen = new Set([cellIdx(1, 1)]);
    const marks = marksOf([
      [cellIdx(1, 1), 'hit'],
      [cellIdx(2, 2), 'miss'],
    ]);
    const seenCopy = new Set(seen);
    const marksCopy = new Map(marks);
    newlyResolved(seen, marks);
    expect(seen).toEqual(seenCopy); // seen 原样
    expect(marks).toEqual(marksCopy); // marks 原样
  });
});

describe('刷新不重放 —— 承重语义(挂载播种 → 首帧后零触发,新事件才弹)', () => {
  it('挂载:用当时 marks 播种 seen → 历史标记此后 newlyResolved 为空', () => {
    // 模拟刷新重进:整局历史 hit/miss 已在 marks 里。
    const mounted = marksOf([
      [cellIdx(1, 0), 'hit'],
      [cellIdx(2, 0), 'miss'],
      [cellIdx(3, 0), 'hit'],
    ]);
    // 挂载首帧:播种 seen = 当时所有可触发格(历史标记)。
    const seen = burstableCells(mounted);
    // 同一批 marks 再算增量 → 全在 seen 里 → 零触发(刷新不闪)。
    expect(newlyResolved(seen, mounted)).toEqual([]);
  });

  it('播种后来了一个新应答 → 恰好弹这一个(且并入 seen 后不再弹)', () => {
    const mounted = marksOf([
      [cellIdx(1, 0), 'hit'],
      [cellIdx(2, 0), 'miss'],
    ]);
    const seen = burstableCells(mounted); // 播种历史
    expect(newlyResolved(seen, mounted)).toEqual([]); // 首帧零触发

    // 新一炮 resolve:marks 多一格。
    const next = marksOf([
      [cellIdx(1, 0), 'hit'],
      [cellIdx(2, 0), 'miss'],
      [cellIdx(7, 7), 'hit'], // 新命中
    ]);
    const fresh = newlyResolved(seen, next);
    expect(fresh).toEqual([{ cell: cellIdx(7, 7), kind: 'hit' }]);

    // 调用方并入 seen 后,下一帧同样的 marks 不再触发(模拟 ref 推进)。
    for (const b of fresh) seen.add(b.cell);
    expect(newlyResolved(seen, next)).toEqual([]);
  });

  it('pending → resolved 的转变:pending 阶段不弹、resolve 成 hit 才弹一次', () => {
    // 这是真实生命周期:先落 pending-out(开炮待应答),后 ShotResolved 到 → 转 hit。
    const seen = new Set<number>(); // 全新会话,无历史
    const pending = marksOf([[cellIdx(4, 4), 'pending-out']]);
    expect(newlyResolved(seen, pending)).toEqual([]); // pending 不触发,且未污染 seen

    const resolved = marksOf([[cellIdx(4, 4), 'hit']]); // 应答到 → 转 hit
    const fresh = newlyResolved(seen, resolved);
    expect(fresh).toEqual([{ cell: cellIdx(4, 4), kind: 'hit' }]); // 恰好弹一次
    for (const b of fresh) seen.add(b.cell);
    expect(newlyResolved(seen, resolved)).toEqual([]); // 之后不重放
  });
});
