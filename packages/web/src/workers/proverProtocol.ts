/**
 * Worker 证明管线的锁定接口契约(Design §7.5;上层 useGame / ProofStatus 全部锁死此形状)。
 *
 * 为什么单独成文件:main 线程的 useProver 与 worker 的 prover.worker 必须共用**同一份**
 * 消息类型——任何一边私自改字段,另一边的 id 路由 / 进度渲染就会静默错位。把契约抽到
 * 既非 main-only 也非 worker-only 的模块,两边 `import type` 同一来源,类型层即可拦住分叉。
 *
 * 纪律(Design §0):progress 的四个 stage 全部对应**真实工作**,禁止假进度——
 * fetch-wasm / fetch-zkey 由 Content-Length 流式读出,witness / prove 由拆分 fullProve 得到。
 */

/** 两个电路。board=布阵证明(重,15334 约束,8.35MB zkey);shot=应答证明(轻,888 约束)。 */
export type Circuit = 'board' | 'shot';

/**
 * Groth16 证明对象(snarkjs.groth16.prove 的 proof 字段实测形状)。
 * 下游 formatProofCalldata(proof, publicSignals) 入参类型是 unknown,故这里给精确形状仅为自文档,
 * 不强约束消费方;pi_b 是 2×2(含末尾 [1,0] 投影行前的仿射坐标,snarkjs 已 toAffine)。
 */
export type Groth16Proof = {
  pi_a: string[];
  pi_b: string[][];
  pi_c: string[];
  protocol: 'groth16';
  curve: string;
};

/**
 * 证明输入:bigint 必须已是十进制字符串(toBoardInputs / toShotInputs 的产物)。
 * worker 跨线程 postMessage 不能传 bigint(structured clone 其实支持 bigint,但 circom witness
 * 计算器吃的就是字符串/可 unstringify 的形态,统一用 string 形态过线最稳),故约束为 string 形态。
 */
export type ProveInputs = Record<string, string | string[] | string[][]>;

/** main → worker 请求。preload 只拉取并缓存 wasm+zkey(后续 prove 免拉取);prove 真正出证明。 */
export type ProveReq =
  | { id: number; type: 'preload'; circuit: Circuit }
  | { id: number; type: 'prove'; circuit: Circuit; inputs: ProveInputs };

/** progress 的四个真实阶段(顺序即发生序)。fetch-* 仅在缓存未命中时出现。 */
export type ProveStage = 'fetch-wasm' | 'fetch-zkey' | 'witness' | 'prove';

/**
 * worker → main 响应。
 * - progress:loaded/total 仅 fetch-* 阶段有(来自 Content-Length);witness/prove 不带字节数。
 * - done:仅 prove 请求产出;preload 完成也回 done(无 proof/publicSignals,见下方 PreloadDone)。
 * - error:任何抛错统一收口于此,带可读 message。
 */
export type ProveRes =
  | { id: number; type: 'progress'; stage: ProveStage; loaded?: number; total?: number }
  | { id: number; type: 'done'; proof: Groth16Proof; publicSignals: string[] }
  | { id: number; type: 'preloaded' }
  | { id: number; type: 'error'; message: string };

/** 进度快照(useProver 对外暴露给未来 ProofStatus 组件;只含本地计算阶段,不含链上等待)。 */
export type ProgressSnapshot = { stage: ProveStage; loaded?: number; total?: number };
