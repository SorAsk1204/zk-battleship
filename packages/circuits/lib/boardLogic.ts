/**
 * 棋盘规则真理源(纯函数、同步、零依赖、浏览器安全)。
 * 规则锁定(Design.md §5.1):10×10,x,y∈[0,9] 左上 (0,0);5 船长度 [5,4,3,3,2](顺序即 shipId);
 * dir 0=水平占 (x..x+len-1, y),1=垂直占 (x, y..y+len-1);界内、无重叠、允许贴边相邻;合法总格数恒 17。
 */

export type Ship = { x: number; y: number; dir: 0 | 1 };
export type Board = [Ship, Ship, Ship, Ship, Ship];

export const SHIP_LENGTHS = [5, 4, 3, 3, 2] as const;
export const TOTAL_SHIP_CELLS = 17;

export type ValidateResult =
  | { ok: true }
  | { ok: false; code: 'OOB' | 'OVERLAP' | 'BAD_DIR' | 'BAD_COORD'; shipId: number };

/** 船占用的格子序列(从船头起)。不做合法性检查,调用方自行保证或走 validateBoard。 */
export function shipCells(ship: Ship, len: number): { x: number; y: number }[] {
  const cells: { x: number; y: number }[] = [];
  for (let k = 0; k < len; k++) {
    cells.push(ship.dir === 0 ? { x: ship.x + k, y: ship.y } : { x: ship.x, y: ship.y + k });
  }
  return cells;
}

function isCoord(v: number): boolean {
  return Number.isInteger(v) && v >= 0 && v <= 9;
}

/**
 * 校验布阵,报第一个违规船的 shipId。
 * 检查顺序:逐船(0→4)先查单船 BAD_COORD → BAD_DIR → OOB,全部通过后再逐船查 OVERLAP
 * (按放置序入格,首个落入已占格的船被报告)。
 * BAD_COORD = x/y 不是 0–9 整数;OOB = 船尾出界;BAD_DIR = dir∉{0,1};OVERLAP = 任意两船同格。
 */
export function validateBoard(b: Board): ValidateResult {
  for (let i = 0; i < 5; i++) {
    const { x, y, dir } = b[i];
    if (!isCoord(x) || !isCoord(y)) return { ok: false, code: 'BAD_COORD', shipId: i };
    if (dir !== 0 && dir !== 1) return { ok: false, code: 'BAD_DIR', shipId: i };
    const tail = (dir === 0 ? x : y) + SHIP_LENGTHS[i] - 1;
    if (tail > 9) return { ok: false, code: 'OOB', shipId: i };
  }
  const occupied = new Uint8Array(100);
  for (let i = 0; i < 5; i++) {
    for (const { x, y } of shipCells(b[i], SHIP_LENGTHS[i])) {
      const idx = y * 10 + x;
      if (occupied[idx]) return { ok: false, code: 'OVERLAP', shipId: i };
      occupied[idx] = 1;
    }
  }
  return { ok: true };
}

/** 占用网格,长度 100,行主序 idx = y*10 + x;合法布阵下取值 0/1 且总和恒 17。 */
export function occupancyGrid(b: Board): Uint8Array {
  const grid = new Uint8Array(100);
  for (let i = 0; i < 5; i++) {
    for (const { x, y } of shipCells(b[i], SHIP_LENGTHS[i])) {
      grid[y * 10 + x] = 1;
    }
  }
  return grid;
}

/**
 * (x,y) 是否被任意船占用。与 shot 电路的 result 语义一致(0=miss,1=hit)。
 * 定义域:x,y ∈ 0–9 整数;域外输入(非整数、负数、>9)一律返回 0。
 * 本函数是与电路对拍的真理源,垃圾输入不得给出语义错误的 1。
 */
export function isHit(b: Board, x: number, y: number): 0 | 1 {
  if (!isCoord(x) || !isCoord(y)) return 0;
  for (let i = 0; i < 5; i++) {
    const s = b[i];
    const len = SHIP_LENGTHS[i];
    if (s.dir === 0) {
      if (y === s.y && x >= s.x && x <= s.x + len - 1) return 1;
    } else {
      if (x === s.x && y >= s.y && y <= s.y + len - 1) return 1;
    }
  }
  return 0;
}
