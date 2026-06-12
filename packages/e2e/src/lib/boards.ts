/**
 * e2e 固定棋盘 fixture(与 contracts 的 test/fixtures 无关,独立定义)。
 * 纪律:只有布阵本身与 salt 是固定输入;攻击序列/承诺一律由 circuits 真理源
 * (occupancyGrid/isHit/computeCommitment)推导,不手写坐标字面量。
 * 模块加载时自检,坏 fixture 直接 throw,不让错误流进场景脚本。
 */
import {
  computeCommitment,
  isHit,
  occupancyGrid,
  TOTAL_SHIP_CELLS,
  validateBoard,
  type Board,
} from '@zk-battleship/circuits';

// 布阵 A(P0 的棋盘)。船长固定 [5,4,3,3,2],顺序即 shipId。
export const boardA: Board = [
  { x: 1, y: 1, dir: 0 }, // len5: (1..5, 1)
  { x: 8, y: 3, dir: 1 }, // len4: (8, 3..6)
  { x: 2, y: 4, dir: 0 }, // len3: (2..4, 4)
  { x: 0, y: 6, dir: 1 }, // len3: (0, 6..8)
  { x: 5, y: 8, dir: 0 }, // len2: (5..6, 8)
];

// 布阵 B(P1 的棋盘),与 A 刻意不同形。
export const boardB: Board = [
  { x: 0, y: 9, dir: 0 }, // len5: (0..4, 9)
  { x: 9, y: 0, dir: 1 }, // len4: (9, 0..3)
  { x: 3, y: 2, dir: 1 }, // len3: (3, 2..4)
  { x: 5, y: 5, dir: 0 }, // len3: (5..7, 5)
  { x: 0, y: 0, dir: 0 }, // len2: (0..1, 0)
];

// 固定 salt(<2^128,与 randomSalt 同域;公知 fixture 值,无隐藏性要求)
// 显式标注 bigint:避免字面量类型让下方 saltA !== saltB 自检被 TS 判为"无重叠比较"
export const saltA: bigint = 0xe2ea_0000_0000_0000_0000_0000_0000_0001n;
export const saltB: bigint = 0xe2eb_0000_0000_0000_0000_0000_0000_0002n;

export type Cell = { x: number; y: number };

/** 从占用网格按行主序收集 want(1=船格/0=水格)的格子 */
function cellsOf(b: Board, want: 0 | 1): Cell[] {
  const grid = occupancyGrid(b);
  const out: Cell[] = [];
  for (let idx = 0; idx < 100; idx++) {
    if (grid[idx] === want) out.push({ x: idx % 10, y: Math.floor(idx / 10) });
  }
  return out;
}

/** P0 的攻击序列:B 的全部 17 个船格(行主序),打满即 17hits 获胜 */
export const bShipCells: Cell[] = cellsOf(boardB, 1);

/** P1 的攻击序列:A 的前 16 个水格(行主序),全 miss,P1 永不得分 */
export const aWaterCells: Cell[] = cellsOf(boardA, 0).slice(0, 16);

export const commitmentA = computeCommitment(boardA, saltA);
export const commitmentB = computeCommitment(boardB, saltB);

// ===== 模块加载自检 =====
function check(cond: boolean, msg: string): void {
  if (!cond) throw new Error(`boards fixture 自检失败:${msg}`);
}

const va = validateBoard(boardA);
check(va.ok, `boardA 非法 ${JSON.stringify(va)}`);
const vb = validateBoard(boardB);
check(vb.ok, `boardB 非法 ${JSON.stringify(vb)}`);
check(
  bShipCells.length === TOTAL_SHIP_CELLS,
  `bShipCells 应 ${TOTAL_SHIP_CELLS} 格,实际 ${bShipCells.length}`,
);
check(aWaterCells.length === 16, `aWaterCells 应 16 格,实际 ${aWaterCells.length}`);
check(
  bShipCells.every((c) => isHit(boardB, c.x, c.y) === 1),
  'bShipCells 必须全是 B 的命中格',
);
check(
  aWaterCells.every((c) => isHit(boardA, c.x, c.y) === 0),
  'aWaterCells 必须全是 A 的水格',
);
check(saltA !== saltB, 'saltA/saltB 必须互异');
check(commitmentA !== commitmentB, 'commitmentA/commitmentB 必须互异');
