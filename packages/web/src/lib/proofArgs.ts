/**
 * worker 的 hex calldata → 合约 BoardProof/ShotProof 入参(bigint 形态)(Task 3.3)。
 *
 * worker 把 formatProofCalldata 的 bigint 结果转 0x-hex 串过 postMessage(见 ProofCalldataHex);
 * 主线程在 writeContract 调用前一刻 BigInt() 还原。合约 struct 形状(见 abi.ts createGame.p):
 *   BoardProof { a: uint256[2], b: uint256[2][2], c: uint256[2], pubSignals: uint256[1] }
 * viem 把 fixed-size 数组 / struct 映射为 JS tuple,故这里产出严格 tuple(长度被类型钉死)。
 *
 * board 电路 pubSignals 恰 1 项(commitment);本函数只为 board(createGame/joinGame)用,故把
 * pubSignals 收成 1-tuple。shot 证明(4 项)将来另写,本任务不需。
 */
import type { ProofCalldataHex } from '../workers/proverProtocol.ts';

/** 合约 BoardProof 的 viem 入参形态(全 bigint;数组长度严格)。 */
export type BoardProofArg = {
  a: readonly [bigint, bigint];
  b: readonly [readonly [bigint, bigint], readonly [bigint, bigint]];
  c: readonly [bigint, bigint];
  pubSignals: readonly [bigint];
};

/**
 * ProofCalldataHex(hex 串)→ BoardProofArg(bigint tuple)。
 * pubSignals 必须恰 1 项(board 电路);非 1 项即抛(防把 shot calldata 误喂 createGame)。
 */
export function toBoardProofArg(cd: ProofCalldataHex): BoardProofArg {
  if (cd.pubSignals.length !== 1) {
    throw new Error(
      `toBoardProofArg: board 证明 pubSignals 应恰 1 项,实得 ${cd.pubSignals.length} 项。`,
    );
  }
  return {
    a: [BigInt(cd.a[0]), BigInt(cd.a[1])],
    b: [
      [BigInt(cd.b[0][0]), BigInt(cd.b[0][1])],
      [BigInt(cd.b[1][0]), BigInt(cd.b[1][1])],
    ],
    c: [BigInt(cd.c[0]), BigInt(cd.c[1])],
    pubSignals: [BigInt(cd.pubSignals[0])],
  };
}
