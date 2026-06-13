/**
 * 承诺向量互验 —— 验证 web 经 re-export 拿到的 computeCommitment 与真理源结果逐位一致,
 * 且 `.`(浏览器安全)入口在此构建/测试环境可用、re-export 链路没断。
 *
 * 已知向量来自 circuits 包的 lib.test.ts(boardB, salt=0xdeadbeef);该常量在 circuits 测试里
 * 已与 circomlibjs Poseidon 独立互证过(test/lib.test.ts 的 "与 circomlibjs Poseidon 互证")。
 * 这里把它钉成硬常量断言:若 web 的 re-export 误接了别的实现或 poseidon-lite 子路径变动,立即红。
 */
import { describe, expect, it } from 'vitest';
import type { Board } from './boardLogic.ts';
import {
  computeCommitment,
  encodeShipsForHash,
  toBoardInputs,
  toShotInputs,
  verifyBoardCommitment,
} from './commitment.ts';

// 与 circuits/test/lib.test.ts 的 boardB 完全一致
const boardB: Board = [
  { x: 9, y: 0, dir: 1 },
  { x: 0, y: 9, dir: 0 },
  { x: 5, y: 9, dir: 0 },
  { x: 0, y: 0, dir: 1 },
  { x: 8, y: 8, dir: 1 },
];

// 由 packages/circuits 的 poseidon-lite 真理源算出并锁定(boardB, salt=0xdeadbeef)
const KNOWN_COMMITMENT_BOARDB_DEADBEEF =
  10562143633053394694015122280104595996515830983000757199484363156303195434041n;

describe('commitment re-export 链路与真理源互验', () => {
  it('computeCommitment(boardB, 0xdeadbeef) == 真理源已知向量', () => {
    expect(computeCommitment(boardB, 0xdeadbeefn)).toBe(KNOWN_COMMITMENT_BOARDB_DEADBEEF);
  });

  it('encodeShipsForHash 顺序为 [x0,y0,d0,...,x4,y4,d4],恰 15 个', () => {
    expect(encodeShipsForHash(boardB)).toEqual([
      9n, 0n, 1n, 0n, 9n, 0n, 5n, 9n, 0n, 0n, 0n, 1n, 8n, 8n, 1n,
    ]);
  });

  it('computeCommitment 确定性,salt 变则承诺变', () => {
    const c = computeCommitment(boardB, 0xdeadbeefn);
    expect(computeCommitment(boardB, 0xdeadbeefn)).toBe(c);
    expect(computeCommitment(boardB, 0xdeadbef0n)).not.toBe(c);
  });

  it('toBoardInputs 产十进制字符串 ships[5][3] + salt', () => {
    expect(toBoardInputs(boardB, 12345n)).toEqual({
      ships: [
        ['9', '0', '1'],
        ['0', '9', '0'],
        ['5', '9', '0'],
        ['0', '0', '1'],
        ['8', '8', '1'],
      ],
      salt: '12345',
    });
  });

  it('toShotInputs commitment 字段与 computeCommitment 一致', () => {
    const got = toShotInputs(boardB, 0xdeadbeefn, 3, 7);
    expect(got.commitment).toBe(KNOWN_COMMITMENT_BOARDB_DEADBEEF.toString(10));
    expect(got.tx).toBe('3');
    expect(got.ty).toBe('7');
  });
});

describe('verifyBoardCommitment(I1/M5:本地棋盘 vs 链上承诺)', () => {
  const SALT_HEX = '0xdeadbeef';
  const COMMIT_DEC = KNOWN_COMMITMENT_BOARDB_DEADBEEF.toString(10);
  const COMMIT_HEX = `0x${KNOWN_COMMITMENT_BOARDB_DEADBEEF.toString(16)}`;

  it('ships/salt/commitment 自洽 → true(十进制承诺串)', () => {
    expect(verifyBoardCommitment(boardB, SALT_HEX, COMMIT_DEC)).toBe(true);
  });

  it('承诺以 0x hex 串给出也认(按 bigint 比较,不挑进制)', () => {
    expect(verifyBoardCommitment(boardB, SALT_HEX, COMMIT_HEX)).toBe(true);
    expect(verifyBoardCommitment(boardB, '3735928559', COMMIT_DEC)).toBe(true); // salt 十进制同值
  });

  it('salt 不对 → false', () => {
    expect(verifyBoardCommitment(boardB, '0xdeadbef0', COMMIT_DEC)).toBe(false);
  });

  it('commitment 不对(0x0)→ false', () => {
    expect(verifyBoardCommitment(boardB, SALT_HEX, '0x0')).toBe(false);
  });

  it('ships 改一格 → false(承诺对船敏感)', () => {
    const moved = boardB.map((s, i) => (i === 0 ? { ...s, y: 1 } : s));
    expect(verifyBoardCommitment(moved, SALT_HEX, COMMIT_DEC)).toBe(false);
  });
});
