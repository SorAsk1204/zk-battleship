/**
 * 测试共享常量与构造工具(smoke / board / shot 测试共用)。
 * 只放"多个测试文件都要、且必须保持一致"的东西;单文件私有素材留在各自文件里。
 */
import assert from 'node:assert/strict';
import type { Board } from '../lib/index.ts';

/**
 * BN254 标量域素数 p 减 1,即 -1 的域表示(≈2^254)。
 * 比较器健全性专测用:没有 Num2Bits(4) 先钉死位宽时,p-1 可伪装成小坐标混过 4bit 比较器。
 */
export const P_MINUS_1 = 21888242871839275222246405745257275088548364400416034343698204186575808495616n;

/** 128bit 固定测试 salt(board/shot 共用,保证两套测试对同一布阵算出同一承诺) */
export const SALT = 0x0123456789abcdef0123456789abcdefn;

/** 造 Board 的辅助:故意收 number,便于构造非法值(dir=2、x=10 等) */
export function mkBoard(ships: Array<{ x: number; y: number; dir: number }>): Board {
  return ships as unknown as Board;
}

/**
 * 合法主力布阵:横竖混合、坐标各异(15 个编码槽位大多不同,能暴露承诺编码顺序写错)。
 * board B1/B8 与 shot S1–S7 共用;占用格(行主序):
 * len5 (9,0..4) / len4 (0..3,9) / len3 (5..7,9) / len3 (0,0..2) / len2 (8,8..9)。
 */
export const LEGAL_BOARD: Board = mkBoard([
  { x: 9, y: 0, dir: 1 }, // len5: (9, 0..4)
  { x: 0, y: 9, dir: 0 }, // len4: (0..3, 9)
  { x: 5, y: 9, dir: 0 }, // len3: (5..7, 9)
  { x: 0, y: 0, dir: 1 }, // len3: (0, 0..2)
  { x: 8, y: 8, dir: 1 }, // len2: (8, 8..9) 尾格恰 y=9
]);

/**
 * 路径无空格断言:circom_tester 内部用字符串拼接 exec circom 且不加引号,
 * 仓库必须放在无空格路径下(DECISIONS.md Windows 纪律 #1)。每个电路测试 before 里调用。
 */
export function assertNoSpaceInPaths(paths: string[]): void {
  for (const p of paths) {
    assert.ok(
      !p.includes(' '),
      `路径含空格:"${p}"。circom_tester 内部用字符串拼接 exec circom 且不加引号,` +
        `仓库必须放在无空格路径下(DECISIONS.md Windows 纪律 #1)。`,
    );
  }
}
