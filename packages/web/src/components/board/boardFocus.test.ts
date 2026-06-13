/**
 * boardFocus 走子单测(BoardGrid roving-tabindex 跳禁用格,Task 3.5 review Fix #1)。
 *
 * 钉死纯走子规则(node 环境,无 DOM):
 *   - nextEnabledInDirection:跳一个 / 跳一串 / 该方向到底无可用格→原地 / 整行禁用→原地;
 *   - firstEnabledInRow / lastEnabledInRow(Home/End)+ 整行禁用→null;
 *   - firstEnabledCell / seedFocus(初始 tabstop:initialFocus 优先、禁用则回退、全盘禁用兜底);
 *   - **无谓词等价**:disabled 省略时,方向键=步进+越界停、Home/End=行首尾、seed=(0,0),
 *     与抽取前 clamp 走子逐位一致(布阵零变更的证据)。
 */
import { describe, expect, it } from 'vitest';
import {
  BOARD_SIZE,
  STEP_UP,
  STEP_DOWN,
  STEP_LEFT,
  STEP_RIGHT,
  firstEnabledCell,
  firstEnabledInRow,
  lastEnabledInRow,
  nextEnabledInDirection,
  seedFocus,
  type DisabledFn,
} from './boardFocus.ts';

/** 列谓词:某些 x 列整列禁用。 */
const colsDisabled =
  (...cols: number[]): DisabledFn =>
  (x) =>
    cols.includes(x);

/** 行谓词:某些 y 行整行禁用。 */
const rowsDisabled =
  (...rows: number[]): DisabledFn =>
  (_x, y) =>
    rows.includes(y);

/** 具体格谓词。 */
const cellsDisabled =
  (...cells: { x: number; y: number }[]): DisabledFn =>
  (x, y) =>
    cells.some((c) => c.x === x && c.y === y);

describe('nextEnabledInDirection — 跳过禁用格', () => {
  it('无谓词:沿方向步进一格', () => {
    expect(nextEnabledInDirection(undefined, { x: 3, y: 3 }, STEP_RIGHT)).toEqual({ x: 4, y: 3 });
    expect(nextEnabledInDirection(undefined, { x: 3, y: 3 }, STEP_LEFT)).toEqual({ x: 2, y: 3 });
    expect(nextEnabledInDirection(undefined, { x: 3, y: 3 }, STEP_UP)).toEqual({ x: 3, y: 2 });
    expect(nextEnabledInDirection(undefined, { x: 3, y: 3 }, STEP_DOWN)).toEqual({ x: 3, y: 4 });
  });

  it('无谓词:越界即停(等价旧 clamp)', () => {
    expect(nextEnabledInDirection(undefined, { x: 5, y: 0 }, STEP_UP)).toEqual({ x: 5, y: 0 });
    expect(nextEnabledInDirection(undefined, { x: 5, y: 9 }, STEP_DOWN)).toEqual({ x: 5, y: 9 });
    expect(nextEnabledInDirection(undefined, { x: 0, y: 4 }, STEP_LEFT)).toEqual({ x: 0, y: 4 });
    expect(nextEnabledInDirection(undefined, { x: 9, y: 4 }, STEP_RIGHT)).toEqual({ x: 9, y: 4 });
  });

  it('跳一个:相邻禁用格被越过', () => {
    // 列 1 禁用:从 (0,3) 右行,跳过 (1,3) 落到 (2,3)。
    expect(nextEnabledInDirection(colsDisabled(1), { x: 0, y: 3 }, STEP_RIGHT)).toEqual({ x: 2, y: 3 });
  });

  it('跳一串:连续禁用格整段被越过', () => {
    // 列 1,2,3 禁用:从 (0,5) 右行,跳过 1..3 落到 (4,5)。
    expect(nextEnabledInDirection(colsDisabled(1, 2, 3), { x: 0, y: 5 }, STEP_RIGHT)).toEqual({
      x: 4,
      y: 5,
    });
    // 向下方向同理:行 1,2,3 禁用,从 (5,0) 下行落到 (5,4)。
    expect(nextEnabledInDirection(rowsDisabled(1, 2, 3), { x: 5, y: 0 }, STEP_DOWN)).toEqual({
      x: 5,
      y: 4,
    });
  });

  it('该方向到底全禁用 → 原地不动', () => {
    // 列 7,8,9 全禁用:从 (6,2) 右行,前方无可用格 → 停在 (6,2)。
    expect(nextEnabledInDirection(colsDisabled(7, 8, 9), { x: 6, y: 2 }, STEP_RIGHT)).toEqual({
      x: 6,
      y: 2,
    });
  });

  it('整行禁用,纵向跳过该行落到再下一行', () => {
    // 行 4 禁用:从 (3,3) 下行,跳过 y=4 落到 (3,5)。
    expect(nextEnabledInDirection(rowsDisabled(4), { x: 3, y: 3 }, STEP_DOWN)).toEqual({ x: 3, y: 5 });
  });

  it('从禁用格出发也只看前方(当前格禁用不影响走子起点)', () => {
    // 列 0 禁用,当前 (0,3)(本身禁用,但 seed 不会落这,这里测健壮性):右行落 (1,3)。
    expect(nextEnabledInDirection(colsDisabled(0), { x: 0, y: 3 }, STEP_RIGHT)).toEqual({ x: 1, y: 3 });
  });
});

describe('firstEnabledInRow / lastEnabledInRow — Home/End', () => {
  it('无谓词:行首=0、行尾=9(等价旧 Home/End)', () => {
    expect(firstEnabledInRow(undefined, 4)).toEqual({ x: 0, y: 4 });
    expect(lastEnabledInRow(undefined, 4)).toEqual({ x: 9, y: 4 });
  });

  it('行内前段禁用:Home 落第一个可用格', () => {
    // 列 0,1,2 禁用:行 6 的 Home 落 (3,6),End 仍 (9,6)。
    expect(firstEnabledInRow(colsDisabled(0, 1, 2), 6)).toEqual({ x: 3, y: 6 });
    expect(lastEnabledInRow(colsDisabled(0, 1, 2), 6)).toEqual({ x: 9, y: 6 });
  });

  it('行内后段禁用:End 落最后一个可用格', () => {
    // 列 7,8,9 禁用:End 落 (6,2),Home 仍 (0,2)。
    expect(lastEnabledInRow(colsDisabled(7, 8, 9), 2)).toEqual({ x: 6, y: 2 });
    expect(firstEnabledInRow(colsDisabled(7, 8, 9), 2)).toEqual({ x: 0, y: 2 });
  });

  it('整行全禁用 → null(调用方原地不动)', () => {
    expect(firstEnabledInRow(rowsDisabled(4), 4)).toBeNull();
    expect(lastEnabledInRow(rowsDisabled(4), 4)).toBeNull();
  });
});

describe('firstEnabledCell / seedFocus — 初始 tabstop', () => {
  it('无谓词:行主序第一个 = (0,0)', () => {
    expect(firstEnabledCell(undefined)).toEqual({ x: 0, y: 0 });
    expect(seedFocus(undefined)).toEqual({ x: 0, y: 0 });
  });

  it('(0,0) 禁用:seed 落行主序第一个可用格', () => {
    // 列 0 禁用 ⇒ 第一个可用格是 (1,0)。
    expect(firstEnabledCell(colsDisabled(0))).toEqual({ x: 1, y: 0 });
    expect(seedFocus(colsDisabled(0))).toEqual({ x: 1, y: 0 });
  });

  it('整个第 0 行禁用:seed 落 (0,1)', () => {
    expect(seedFocus(rowsDisabled(0))).toEqual({ x: 0, y: 1 });
  });

  it('initialFocus 可用 → 采用', () => {
    expect(seedFocus(undefined, { x: 3, y: 7 })).toEqual({ x: 3, y: 7 });
    expect(seedFocus(colsDisabled(0), { x: 5, y: 5 })).toEqual({ x: 5, y: 5 });
  });

  it('initialFocus 落在禁用格 → 回退到行主序第一个可用格', () => {
    // initialFocus (0,0) 但列 0 禁用 ⇒ 回退 (1,0)。
    expect(seedFocus(colsDisabled(0), { x: 0, y: 0 })).toEqual({ x: 1, y: 0 });
  });

  it('initialFocus 越界 → 回退到第一个可用格', () => {
    expect(seedFocus(undefined, { x: -1, y: 0 })).toEqual({ x: 0, y: 0 });
    expect(seedFocus(undefined, { x: 0, y: BOARD_SIZE })).toEqual({ x: 0, y: 0 });
  });

  it('全盘禁用(退化)→ 兜底 (0,0),不抛', () => {
    const allOff: DisabledFn = () => true;
    expect(firstEnabledCell(allOff)).toBeNull();
    expect(seedFocus(allOff)).toEqual({ x: 0, y: 0 });
    expect(seedFocus(allOff, { x: 3, y: 3 })).toEqual({ x: 0, y: 0 }); // initialFocus 也禁用 → 兜底
  });
});

describe('SonarBoard 场景:列 0 整列禁用(已开炮列)', () => {
  const disabled = cellsDisabled(
    { x: 0, y: 0 },
    { x: 0, y: 1 },
    { x: 0, y: 2 },
    { x: 0, y: 3 },
    { x: 0, y: 4 },
    { x: 0, y: 5 },
    { x: 0, y: 6 },
    { x: 0, y: 7 },
    { x: 0, y: 8 },
    { x: 0, y: 9 },
  );

  it('seed 跳过被禁用的 (0,0) → (1,0)', () => {
    expect(seedFocus(disabled)).toEqual({ x: 1, y: 0 });
  });

  it('从 (1,3) 左行无可用格(列 0 禁用)→ 原地', () => {
    expect(nextEnabledInDirection(disabled, { x: 1, y: 3 }, STEP_LEFT)).toEqual({ x: 1, y: 3 });
  });

  it('Home 跳过列 0 落 (1,y)', () => {
    expect(firstEnabledInRow(disabled, 3)).toEqual({ x: 1, y: 3 });
  });
});
