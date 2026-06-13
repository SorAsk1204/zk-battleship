/**
 * worker 的 hex calldata → 合约 BoardProof/ShotProof 入参(bigint 形态)(Task 3.3 + 3.7)。
 *
 * worker 把 formatProofCalldata 的 bigint 结果转 0x-hex 串过 postMessage(见 ProofCalldataHex);
 * 主线程在 writeContract 调用前一刻 BigInt() 还原。合约 struct 形状(见 abi.ts createGame.p / respond.p):
 *   BoardProof { a: uint256[2], b: uint256[2][2], c: uint256[2], pubSignals: uint256[1] }
 *   ShotProof  { a: uint256[2], b: uint256[2][2], c: uint256[2], pubSignals: uint256[4] }
 * viem 把 fixed-size 数组 / struct 映射为 JS tuple,故这里产出严格 tuple(长度被类型钉死)。
 *
 * board 电路 pubSignals 恰 1 项(commitment);shot 电路恰 4 项([result, commitment, tx, ty],
 * 顺序由 circom shot 电路的公开信号声明序锁定——result 在首位,respond(gameId, result, p) 的 result
 * 取 publicSignals[0])。两者各自的 toXxxProofArg 用 pubSignals.length 守卫,防把一种 calldata
 * 误喂另一个合约入口(board calldata → createGame/joinGame;shot calldata → respond)。
 */
import type { ProofCalldataHex } from '../workers/proverProtocol.ts';

/** 合约 BoardProof 的 viem 入参形态(全 bigint;数组长度严格)。 */
export type BoardProofArg = {
  a: readonly [bigint, bigint];
  b: readonly [readonly [bigint, bigint], readonly [bigint, bigint]];
  c: readonly [bigint, bigint];
  pubSignals: readonly [bigint];
};

/** 合约 ShotProof 的 viem 入参形态(全 bigint;pubSignals 恰 4 项,见模块注释的顺序锁定)。 */
export type ShotProofArg = {
  a: readonly [bigint, bigint];
  b: readonly [readonly [bigint, bigint], readonly [bigint, bigint]];
  c: readonly [bigint, bigint];
  pubSignals: readonly [bigint, bigint, bigint, bigint];
};

/** a/b/c 三元组(两 proof 共用形状)的 hex→bigint 还原;pubSignals 各自处理(长度不同)。 */
function abcToBigint(cd: ProofCalldataHex): {
  a: readonly [bigint, bigint];
  b: readonly [readonly [bigint, bigint], readonly [bigint, bigint]];
  c: readonly [bigint, bigint];
} {
  return {
    a: [BigInt(cd.a[0]), BigInt(cd.a[1])],
    b: [
      [BigInt(cd.b[0][0]), BigInt(cd.b[0][1])],
      [BigInt(cd.b[1][0]), BigInt(cd.b[1][1])],
    ],
    c: [BigInt(cd.c[0]), BigInt(cd.c[1])],
  };
}

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
  return { ...abcToBigint(cd), pubSignals: [BigInt(cd.pubSignals[0])] };
}

/**
 * ProofCalldataHex(hex 串)→ ShotProofArg(bigint tuple),供 respond(gameId, result, p)(Task 3.7)。
 * pubSignals 必须恰 4 项(shot 电路:[result, commitment, tx, ty]);非 4 项即抛(防把 board calldata
 * 误喂 respond,或电路改了公开信号数量却没同步本处——长度守卫即早失败信号)。
 * 调用方据 publicSignals[0](= result,命中 1 / 未命中 0)传 respond 的 result 入参(见 useAutoRespond)。
 */
export function toShotProofArg(cd: ProofCalldataHex): ShotProofArg {
  if (cd.pubSignals.length !== 4) {
    throw new Error(
      `toShotProofArg: shot 证明 pubSignals 应恰 4 项,实得 ${cd.pubSignals.length} 项。`,
    );
  }
  return {
    ...abcToBigint(cd),
    pubSignals: [
      BigInt(cd.pubSignals[0]),
      BigInt(cd.pubSignals[1]),
      BigInt(cd.pubSignals[2]),
      BigInt(cd.pubSignals[3]),
    ],
  };
}
