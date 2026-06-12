/**
 * snarkjs 0.7.x 无官方类型,这里只声明本仓用到的最小面。
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
  export const zKey: {
    newZKey(r1csFile: string, ptauFile: string, zkeyFile: string, logger?: unknown): Promise<unknown>;
    exportVerificationKey(zkeyFile: string): Promise<unknown>;
    exportSolidityVerifier(zkeyFile: string, templates: Record<string, string>): Promise<string>;
  };
}
