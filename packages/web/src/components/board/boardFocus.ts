/**
 * BoardGrid 的 roving-tabindex 焦点走子(纯几何,无 React/DOM)。
 *
 * 为什么单独成模块:BoardGrid 的方向键走子要能「跳过禁用格」(§7.7 键盘可达 + 3.7 SonarBoard:
 * 已开炮的格既不可再开炮、也不该被方向键停留)。这套「给定禁用谓词 + 当前格 + 方向 → 下一焦点格」
 * 是纯函数,可在 node 环境单测(本仓 vitest 无 DOM);把它从组件抽出,既能钉死走子规则,也让
 * BoardGrid 的 onKeyDown 只剩「调走子 + .focus()」的薄壳。
 *
 * 走子规则(全部「在界 + 跳过禁用」):
 *   - 方向键:沿方向向量逐格前进,跳过禁用格;若在找到可用格前越界 ⇒ **停在原地**(返回 from)。
 *     即「沿该方向的下一个可用格,没有则不动」。
 *   - Home/End:在**当前行**取第一个 / 最后一个可用格(与抽取前的行内 Home/End 同语义);
 *     整行全禁用 ⇒ 返回 null,调用方原地不动。
 *   - 初始 tabstop(seedFocus):优先用调用方给的 initialFocus(若该格可用);否则行主序第一个可用格;
 *     若全盘禁用(退化,不该出现)⇒ 兜底 (0,0),不抛。
 *
 * 当没有禁用谓词时(布阵幕的情形,disabled 恒 false):方向键=步进一格、越界即停,
 * 与抽取前的 clamp 语义**逐位等价**(ArrowUp@y=0 步到 y=-1 越界→停=原 clamp 到 y=0);
 * Home→(0,y)、End→(9,y);seed→(0,0)。故布阵行为零变更(见 boardFocus.test.ts)。
 */

/** 棋盘边长(恒 10×10;与 BoardGrid 渲染的 10 行 10 列一致)。 */
export const BOARD_SIZE = 10;

/** 焦点格坐标。 */
export type FocusTarget = { x: number; y: number };

/** 禁用谓词:某格是否被禁用(禁用格不可走子停留、不可点击)。 */
export type DisabledFn = (x: number, y: number) => boolean;

/** 方向向量(方向键 → 单位步)。 */
export type Step = { dx: number; dy: number };

/** 四个方向键对应的单位步向量。 */
export const STEP_UP: Step = { dx: 0, dy: -1 };
export const STEP_DOWN: Step = { dx: 0, dy: 1 };
export const STEP_LEFT: Step = { dx: -1, dy: 0 };
export const STEP_RIGHT: Step = { dx: 1, dy: 0 };

/** 是否在界内(0..size-1)。 */
function inBounds(x: number, y: number, size: number): boolean {
  return x >= 0 && x < size && y >= 0 && y < size;
}

/** 某格是否可用(无谓词 = 全部可用)。 */
function isEnabled(disabled: DisabledFn | undefined, x: number, y: number): boolean {
  return !disabled?.(x, y);
}

/**
 * 沿方向向量从 from 出发,返回**下一个可用格**;若在越界前找不到可用格,返回 from(原地不动)。
 * 逐格前进并跳过禁用格:跳一个、跳一串、该方向到底都没有 → 停,皆由本函数覆盖。
 */
export function nextEnabledInDirection(
  disabled: DisabledFn | undefined,
  from: FocusTarget,
  step: Step,
  size: number = BOARD_SIZE,
): FocusTarget {
  let x = from.x + step.dx;
  let y = from.y + step.dy;
  while (inBounds(x, y, size)) {
    if (isEnabled(disabled, x, y)) return { x, y };
    x += step.dx;
    y += step.dy;
  }
  return from; // 该方向无可用格 → 不动
}

/**
 * 当前行(同 y)第一个可用格(x 升序扫描);整行全禁用返回 null(调用方原地不动)。Home 键用。
 */
export function firstEnabledInRow(
  disabled: DisabledFn | undefined,
  y: number,
  size: number = BOARD_SIZE,
): FocusTarget | null {
  for (let x = 0; x < size; x++) {
    if (isEnabled(disabled, x, y)) return { x, y };
  }
  return null;
}

/**
 * 当前行(同 y)最后一个可用格(x 降序扫描);整行全禁用返回 null(调用方原地不动)。End 键用。
 */
export function lastEnabledInRow(
  disabled: DisabledFn | undefined,
  y: number,
  size: number = BOARD_SIZE,
): FocusTarget | null {
  for (let x = size - 1; x >= 0; x--) {
    if (isEnabled(disabled, x, y)) return { x, y };
  }
  return null;
}

/**
 * 行主序(y 外 x 内)第一个可用格;全盘禁用返回 null。初始 tabstop 兜底用。
 */
export function firstEnabledCell(
  disabled: DisabledFn | undefined,
  size: number = BOARD_SIZE,
): FocusTarget | null {
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (isEnabled(disabled, x, y)) return { x, y };
    }
  }
  return null;
}

/**
 * 初始焦点(唯一 tabstop)的落点:
 *   1. 若给了 initialFocus 且该格在界且可用 → 用它;
 *   2. 否则行主序第一个可用格;
 *   3. 全盘禁用(退化场景)→ 兜底 (0,0)(不抛,保证总有一个确定 tabstop)。
 * 无禁用谓词 + 无 initialFocus 时返回 (0,0),与抽取前硬编码初始焦点一致。
 */
export function seedFocus(
  disabled: DisabledFn | undefined,
  initialFocus?: FocusTarget,
  size: number = BOARD_SIZE,
): FocusTarget {
  if (
    initialFocus &&
    inBounds(initialFocus.x, initialFocus.y, size) &&
    isEnabled(disabled, initialFocus.x, initialFocus.y)
  ) {
    return { x: initialFocus.x, y: initialFocus.y };
  }
  return firstEnabledCell(disabled, size) ?? { x: 0, y: 0 };
}
