/**
 * snarkjs 0.7.x 无官方类型;此处只声明本包 tsc 编译面用到的最小面
 * (镜像 packages/circuits/lib/snarkjs.d.ts 的对应条目,同 contracts 包的处理)。
 * 注意:tsc -p . 会顺着场景脚本的 import 连带检查 circuits 的 lib/node.ts、
 * lib/proof.ts,而 circuits 自己的 snarkjs.d.ts 不在本编译单元内,
 * 故 fullProve/exportSolidityCallData 须在此声明。
 */
declare module 'snarkjs' {
  export const groth16: {
    fullProve(
      input: Record<string, unknown>,
      wasmFile: string,
      zkeyFile: string,
    ): Promise<{ proof: unknown; publicSignals: string[] }>;
    exportSolidityCallData(proof: unknown, publicSignals: string[]): Promise<string>;
    verify(vkey: unknown, publicSignals: string[], proof: unknown): Promise<boolean>;
  };
}
