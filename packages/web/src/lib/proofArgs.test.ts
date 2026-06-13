/**
 * proofArgs.ts 单测(Task 3.3 + 3.7)。
 *
 * 锁住 hex calldata → BoardProof/ShotProof bigint tuple 的转换:形状(a/c len2、b 2×2、pubSignals
 * board=1 / shot=4)、0x-hex 正确 BigInt 还原、以及「pubSignals 长度不符即抛」(防把一种 calldata 误喂
 * 另一个合约入口:board→createGame、shot→respond)。
 */
import { describe, expect, it } from 'vitest';
import type { ProofCalldataHex } from '../workers/proverProtocol.ts';
import { toBoardProofArg, toShotProofArg } from './proofArgs.ts';

const BOARD_CD: ProofCalldataHex = {
  a: ['0x1', '0xa'],
  b: [
    ['0x2', '0x3'],
    ['0x4', '0x5'],
  ],
  c: ['0xff', '0x10'],
  pubSignals: ['0x1bc16d674ec80000'], // 任意大数,验 BigInt 还原
};

describe('toBoardProofArg', () => {
  it('hex → bigint tuple,形状与值都对', () => {
    const arg = toBoardProofArg(BOARD_CD);
    expect(arg.a).toEqual([1n, 10n]);
    expect(arg.b).toEqual([
      [2n, 3n],
      [4n, 5n],
    ]);
    expect(arg.c).toEqual([255n, 16n]);
    expect(arg.pubSignals).toEqual([BigInt('0x1bc16d674ec80000')]);
  });

  it('pubSignals 恰 1 项(board 电路约束)', () => {
    expect(toBoardProofArg(BOARD_CD).pubSignals).toHaveLength(1);
  });

  it('pubSignals 非 1 项 → 抛(挡住误喂 shot calldata)', () => {
    const shotLike: ProofCalldataHex = { ...BOARD_CD, pubSignals: ['0x1', '0x2', '0x3', '0x4'] };
    expect(() => toBoardProofArg(shotLike)).toThrow(/pubSignals 应恰 1 项/);
  });
});

const SHOT_CD: ProofCalldataHex = {
  a: ['0x1', '0xa'],
  b: [
    ['0x2', '0x3'],
    ['0x4', '0x5'],
  ],
  c: ['0xff', '0x10'],
  // shot 电路 publicSignals = [result, commitment, tx, ty]
  pubSignals: ['0x1', '0x1bc16d674ec80000', '0x3', '0x7'],
};

describe('toShotProofArg', () => {
  it('hex → bigint tuple,形状(a/c len2、b 2×2、pubSignals 4)与值都对', () => {
    const arg = toShotProofArg(SHOT_CD);
    expect(arg.a).toEqual([1n, 10n]);
    expect(arg.b).toEqual([
      [2n, 3n],
      [4n, 5n],
    ]);
    expect(arg.c).toEqual([255n, 16n]);
    expect(arg.pubSignals).toEqual([1n, BigInt('0x1bc16d674ec80000'), 3n, 7n]);
  });

  it('pubSignals 恰 4 项(shot 电路约束)', () => {
    expect(toShotProofArg(SHOT_CD).pubSignals).toHaveLength(4);
  });

  it('publicSignals[0] = result(供 respond 的 result 入参;此处 hit=1)', () => {
    expect(Number(toShotProofArg(SHOT_CD).pubSignals[0])).toBe(1);
  });

  it('result=0(miss)亦正确还原', () => {
    const miss: ProofCalldataHex = { ...SHOT_CD, pubSignals: ['0x0', '0xabc', '0x0', '0x0'] };
    expect(Number(toShotProofArg(miss).pubSignals[0])).toBe(0);
  });

  it('pubSignals 非 4 项 → 抛(挡住误喂 board calldata)', () => {
    const boardLike: ProofCalldataHex = { ...SHOT_CD, pubSignals: ['0x1'] };
    expect(() => toShotProofArg(boardLike)).toThrow(/pubSignals 应恰 4 项/);
  });
});
