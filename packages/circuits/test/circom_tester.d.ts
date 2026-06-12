/**
 * circom_tester 0.0.24 无官方类型;只声明本仓用到的 wasm tester 最小面。
 * 注意:其内部用字符串拼接 exec circom,路径含空格必炸(Windows 纪律 #1)。
 */
declare module 'circom_tester' {
  export type WasmTester = {
    calculateWitness(
      input: Record<string, bigint | number | string | Array<bigint | number | string>>,
      sanityCheck?: boolean,
    ): Promise<bigint[]>;
    checkConstraints(witness: bigint[]): Promise<void>;
    assertOut(witness: bigint[], expectedOut: Record<string, unknown>): Promise<void>;
  };
  export type WasmTesterOptions = {
    /** 产物目录;布局须为 <output>/<name>_js/<name>.wasm + <name>.sym + <name>.r1cs */
    output?: string;
    /** false = 不编译,直接吃 output 下的既有产物(目录缺失会抛错) */
    recompile?: boolean;
    /** circom -l 搜索路径 */
    include?: string | string[];
    verbose?: boolean;
  };
  export function wasm(circomFile: string, options?: WasmTesterOptions): Promise<WasmTester>;
  const tester: { wasm: typeof wasm; c: unknown };
  export default tester;
}
