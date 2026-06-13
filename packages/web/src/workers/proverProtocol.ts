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

/**
 * 合约就绪的 Groth16 calldata,**hex 字符串形态**(Task 3.3)。
 *
 * 为什么在 worker 里产出:合约要的是 BoardProof{a,b,c,pubSignals}(含 pi_b limb 交换),其唯一实现
 * formatProofCalldata 走 snarkjs 的 exportSolidityCallData(D3:禁止手写 limb 交换)。snarkjs 只活在
 * worker(浏览器安全纪律 3.1/D2),故格式化也必须在 worker 做——主线程不得 import @circuits/proof。
 *
 * 为什么 hex 字符串而非 bigint:formatProofCalldata 产出 bigint,但 (a) 跨 postMessage 虽然 structured
 * clone 支持 bigint,本协议既有约定是「统一 string 过线最稳」(见 ProveInputs);(b) 用 0x-hex 无歧义,
 * 主线程拿到后在 writeContract 前一刻 BigInt() 还原即可(viem 合约入参要 bigint)。
 * 形状锁死合约 ABI:a/c 各 2 项,b 是 2×2,pubSignals 是 board=1 / shot=4 项(均 0x-hex 串)。
 */
export type ProofCalldataHex = {
  a: [string, string];
  b: [[string, string], [string, string]];
  c: [string, string];
  pubSignals: string[];
};

/** main → worker 请求。preload 只拉取并缓存 wasm+zkey(后续 prove 免拉取);prove 真正出证明。 */
export type ProveReq =
  | { id: number; type: 'preload'; circuit: Circuit }
  | { id: number; type: 'prove'; circuit: Circuit; inputs: ProveInputs };

/** progress 的四个真实阶段(顺序即发生序)。fetch-* 仅在缓存未命中时出现。 */
export type ProveStage = 'fetch-wasm' | 'fetch-zkey' | 'witness' | 'prove';

/**
 * worker → main 响应。
 * - progress:带 circuit(每个 post 点 worker 都已知电路),让上层能按电路分桶并渲染
 *   「正在编译 board 证明 · fetch-zkey 61%」。loaded/total 仅 fetch-* 阶段有(来自 Content-Length);
 *   witness/prove 不带字节数。
 * - done:仅 prove 请求产出。带三样:proof / publicSignals(DevProve 的 main 线程 verify 与
 *   3.7 结果读取需要原始证明对象)+ calldata(合约就绪的 hex 形态,Task 3.3,主线程 BigInt() 还原后
 *   直接喂 writeContract;格式化在 worker 完成因 snarkjs 只能在 worker——见 ProofCalldataHex 注释)。
 * - preloaded:preload 请求完成(只拉满 wasm+zkey 入缓存,无 proof);与 done 分开,让 id 路由
 *   能干净区分「预热完成」与「出证完成」。
 * - error:任何抛错统一收口于此,带可读 message。
 */
export type ProveRes =
  | {
      id: number;
      type: 'progress';
      circuit: Circuit;
      stage: ProveStage;
      loaded?: number;
      total?: number;
    }
  | {
      id: number;
      type: 'done';
      proof: Groth16Proof;
      publicSignals: string[];
      calldata: ProofCalldataHex;
    }
  | { id: number; type: 'preloaded' }
  | { id: number; type: 'error'; message: string };

/**
 * 进度快照(useProver 对外暴露给未来 ProofStatus 组件;只含本地计算阶段,不含链上等待)。
 * 带 circuit:进度按电路分桶(域内最多 board + shot 各一条并发),ProofStatus 可据此区分
 * 「在算哪个电路」,且 board 证明(3.5)与 shot 证明(3.7)并发时互不覆盖。
 */
export type ProgressSnapshot = {
  circuit: Circuit;
  stage: ProveStage;
  loaded?: number;
  total?: number;
};
