/**
 * r1csfile 无官方类型(snarkjs 的依赖,本仓只作 r1cs 头部读取 fallback)。
 * 0.0.48 的 readR1cs 第二参支持 options 对象(loadConstraints 默认 true)。
 */
declare module 'r1csfile' {
  export function readR1cs(
    fileName: string,
    options?: {
      loadConstraints?: boolean;
      loadMap?: boolean;
      loadCustomGates?: boolean;
      singleThread?: boolean;
    },
  ): Promise<{
    nConstraints: number;
    nPubInputs: number;
    nPrvInputs: number;
    nOutputs: number;
    nVars: number;
    [k: string]: unknown;
  }>;
}
