/**
 * circomlibjs 无官方类型;仅声明测试互证用到的 buildPoseidon 最小面。
 * 注意:poseidon 返回内部域表示,必须 F.toObject(...) 转 bigint 再比对。
 */
declare module 'circomlibjs' {
  export type Poseidon = {
    (inputs: ReadonlyArray<bigint | number | string>): unknown;
    F: { toObject(e: unknown): bigint };
  };
  export function buildPoseidon(): Promise<Poseidon>;
}
