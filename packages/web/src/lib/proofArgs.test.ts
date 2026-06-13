/**
 * proofArgs.ts 单测(Task 3.3)。
 *
 * 锁住 hex calldata → BoardProof bigint tuple 的转换:形状(a/c len2、b 2×2、pubSignals 1)、
 * 0x-hex 正确 BigInt 还原、以及「pubSignals 非 1 项即抛」(防把 shot 的 4 项 calldata 误喂 createGame)。
 */
import { describe, expect, it } from 'vitest';
import type { ProofCalldataHex } from '../workers/proverProtocol.ts';
import { toBoardProofArg } from './proofArgs.ts';

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
