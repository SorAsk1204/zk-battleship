/**
 * snarkjs 0.7.6 无官方类型;这里声明 worker 证明管线 + dev 校验所需的最小面。
 *
 * 与 circuits 包的 snarkjs.d.ts 不同:本仓 worker 走**拆分 fullProve**(wtns.calculate + groth16.prove)
 * 以取得真实 witness / prove 两阶段进度,故需声明 fastfile 的 mem-object 形态。
 *
 * mem-object(packages 中 fastfile@0.0.20 实测):
 *   - 输入只读:{ type: 'mem'; data: Uint8Array }(readExisting 读 data.byteLength)
 *   - 输出可写:{ type: 'mem' }(createOverride 内部置 data = new Uint8Array;close() 后 slice 到真实长度)
 * 故 witness 输出对象传 { type: 'mem' },calculate 完成后其 data 即 witness 字节,再原样喂给 prove。
 */
declare module 'snarkjs' {
  /** fastfile 内存描述符:输入带 data,输出仅 type(calculate/prove 会就地写入 data)。 */
  export type FastFileMem = { type: 'mem'; data?: Uint8Array };

  export const wtns: {
    /**
     * 计算 witness。wasmFile / wtnsFile 经 fastfile.readExisting / createOverride 处理,
     * 支持 mem-object;options 可带 logger 等,本仓不传。
     * 完成后 wtnsFile.data 持有 witness 字节(close 已 slice 到真实长度)。
     */
    calculate(
      input: Record<string, unknown>,
      wasmFile: FastFileMem | Uint8Array | string,
      wtnsFile: FastFileMem,
      options?: unknown,
    ): Promise<void>;
  };

  export const groth16: {
    /**
     * 由 witness + zkey 出证明。zkeyFile 经 fastfile.readExisting,支持 mem-object;
     * witnessFile 传上一步 wtns.calculate 写好的同一 mem-object。
     */
    prove(
      zkeyFile: FastFileMem | Uint8Array | string,
      witnessFile: FastFileMem,
      logger?: unknown,
      options?: unknown,
    ): Promise<{ proof: unknown; publicSignals: string[] }>;
    /** dev 校验用:vkey + publicSignals + proof → 是否有效。 */
    verify(vkey: unknown, publicSignals: string[], proof: unknown): Promise<boolean>;
  };
}
