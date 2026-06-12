/**
 * "@zk-battleship/circuits/proof" 入口 —— Groth16 calldata 格式化的全仓唯一实现(DECISIONS D3)。
 * 单独入口:避免 "." 把 snarkjs 拖进前端主线程 bundle;web/e2e 一律 re-export 此函数。
 *
 * 纪律:禁止手写 pi_b limb 交换 —— 只解析 snarkjs 官方 exportSolidityCallData 输出
 * (其返回形如 `["0x..","0x.."],[[..],[..]],["0x..","0x.."],["0x..",...]` 的字符串)。
 *
 * 注意:本函数行为依赖真实证明,Task 0.2 仅保证类型与编译;行为由 M1 的 fixture 自检覆盖。
 */
import * as snarkjs from 'snarkjs';

export type ProofCalldata = {
  a: [bigint, bigint];
  b: [[bigint, bigint], [bigint, bigint]];
  c: [bigint, bigint];
  pubSignals: bigint[];
};

export async function formatProofCalldata(
  proof: unknown,
  publicSignals: string[],
): Promise<ProofCalldata> {
  const calldata = await snarkjs.groth16.exportSolidityCallData(proof, publicSignals);
  const [a, b, c, pubSignals] = JSON.parse('[' + calldata + ']') as [
    [string, string],
    [[string, string], [string, string]],
    [string, string],
    string[],
  ];
  return {
    a: [BigInt(a[0]), BigInt(a[1])],
    b: [
      [BigInt(b[0][0]), BigInt(b[0][1])],
      [BigInt(b[1][0]), BigInt(b[1][1])],
    ],
    c: [BigInt(c[0]), BigInt(c[1])],
    pubSignals: pubSignals.map((s) => BigInt(s)),
  };
}
