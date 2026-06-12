/**
 * snarkjs 0.7.x 无官方类型;此处只声明 generate.ts 用到的最小面
 * (镜像 packages/circuits/lib/snarkjs.d.ts 的对应条目)。
 */
declare module 'snarkjs' {
  export const groth16: {
    verify(vkey: unknown, publicSignals: string[], proof: unknown): Promise<boolean>;
  };
}
