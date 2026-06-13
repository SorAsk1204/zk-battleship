/// <reference lib="webworker" />
/**
 * Groth16 证明 worker(Plan A:Vite module worker, vite.config worker.format='es')。
 *
 * 职责:接 ProveReq,流式拉取 wasm/zkey(按 Content-Length 出真实 fetch-* 进度)并按电路缓存,
 * 拆分 fullProve 为 witness / prove 两阶段(各自前置 progress),done 回 {proof, publicSignals};
 * 任何抛错统一 → error。
 *
 * 为什么 worker:snarkjs(经 ffjavascript)在证明期跑重 FFT/MSM,占满主线程会卡死整个 UI;
 * ffjavascript 还会再 spawn 一批 data-URL 子 worker 并行计算(实测:WebAssembly.Memory 非 shared,
 * 无 SharedArrayBuffer ⇒ **不需要 COOP/COEP 跨源隔离头**——这是本任务最大的事前风险点,已证伪)。
 *
 * 浏览器安全纪律(Design D2/3.1):snarkjs 只活在本 worker(与 dev 校验的 verify 调用,dev-gated);
 * main 线程的 useProver 绝不 import snarkjs。本文件是 worker 上下文,无 window/DOM,只有 self/fetch。
 *
 * 内存形态:wasm/zkey 以 Uint8Array 缓存,经 fastfile 的 { type:'mem', data } 喂给 snarkjs,
 * 让其从内存读而非反复走网络(preload 后再 prove 即零网络)。
 */
import * as snarkjs from 'snarkjs';
import type {
  Circuit,
  Groth16Proof,
  ProveReq,
  ProveRes,
  ProveStage,
} from './proverProtocol.ts';

// worker 全局 self 的精确类型,拿到 postMessage / onmessage 的 worker 重载
const ctx = self as unknown as DedicatedWorkerGlobalScope;

/** 单电路的内存缓存:wasm + zkey 字节。命中即跳过 fetch-* 阶段。 */
type CircuitCache = { wasm: Uint8Array; zkey: Uint8Array };

/** 按电路名缓存(board/shot 各一份);worker 单例,跨账户/对局共享。 */
const cache = new Map<Circuit, Partial<CircuitCache>>();

/** 静态产物 URL(vite 从 public/ 提供;路径见 DECISIONS / sync-web.ts)。 */
function artifactUrl(circuit: Circuit, kind: 'wasm' | 'zkey'): string {
  return `/zk/${circuit}/${circuit}.${kind}`;
}

function post(msg: ProveRes): void {
  ctx.postMessage(msg);
}

/**
 * 流式拉取一个产物,按 Content-Length 发真实进度(stage = fetch-wasm | fetch-zkey)。
 *
 * 为什么手动读 body 而非 res.arrayBuffer():arrayBuffer() 是黑盒,拿不到中途字节数,
 * 无法出真实进度(Design §0 禁止假进度)。getReader() 逐块读,累计 loaded,对照 total。
 * total 来自 Content-Length;若缺失(理论上 vite 静态服务总会给),total 置 undefined,
 * 仍逐块发 loaded(进度条按未知总量处理,不编造分母)。
 */
async function fetchWithProgress(
  url: string,
  id: number,
  stage: Extract<ProveStage, 'fetch-wasm' | 'fetch-zkey'>,
): Promise<Uint8Array> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`拉取 ${url} 失败:HTTP ${res.status} ${res.statusText}`);
  }
  const lenHeader = res.headers.get('Content-Length');
  const total = lenHeader ? Number(lenHeader) : undefined;
  if (!res.body) {
    // 极少数环境无可读流:退化为整体读取,仍发一次终态进度(loaded=total)。
    const buf = new Uint8Array(await res.arrayBuffer());
    post({ id, type: 'progress', stage, loaded: buf.byteLength, total: total ?? buf.byteLength });
    return buf;
  }

  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let loaded = 0;
  // 起始发一帧(loaded=0),让 UI 立刻进入该阶段
  post({ id, type: 'progress', stage, loaded: 0, total });
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      chunks.push(value);
      loaded += value.byteLength;
      post({ id, type: 'progress', stage, loaded, total });
    }
  }

  // 合并分块为单段连续内存(snarkjs 需要连续 Uint8Array)。
  // 关键:按**实际累计 loaded** 分配,绝不按 header total——若服务端 Content-Length 与实际解码
  // 字节数不符(传输压缩 / 代理改写 header),按 total 分配会让 out.set 越界 RangeError 或尾部留零
  // 污染 wasm/zkey。total 只用于进度分母,不用于分配。
  const out = new Uint8Array(loaded);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.byteLength;
  }
  return out;
}

/** 确保某电路的 wasm 在缓存;未命中则流式拉取并缓存。返回 wasm 字节。 */
async function ensureWasm(circuit: Circuit, id: number): Promise<Uint8Array> {
  const slot = cache.get(circuit) ?? {};
  if (!slot.wasm) {
    slot.wasm = await fetchWithProgress(artifactUrl(circuit, 'wasm'), id, 'fetch-wasm');
    cache.set(circuit, slot);
  }
  return slot.wasm;
}

/** 确保某电路的 zkey 在缓存;未命中则流式拉取并缓存。返回 zkey 字节。 */
async function ensureZkey(circuit: Circuit, id: number): Promise<Uint8Array> {
  const slot = cache.get(circuit) ?? {};
  if (!slot.zkey) {
    slot.zkey = await fetchWithProgress(artifactUrl(circuit, 'zkey'), id, 'fetch-zkey');
    cache.set(circuit, slot);
  }
  return slot.zkey;
}

/**
 * 真正出证明:拆 fullProve 为 witness / prove 两阶段,各自前置真实 progress。
 *
 * snarkjs 0.7.6 实测 API(读源码确认,见 snarkjs.d.ts):
 *   wtns.calculate(input, {type:'mem',data:wasm}, wtnsMem) — wtnsMem={type:'mem'} 作输出,
 *     完成后其 .data 持有 witness 字节(memFile.close 已 slice 到真实长度);
 *   groth16.prove({type:'mem',data:zkey}, wtnsMem) — 把同一 wtnsMem 喂进去,返回 {proof, publicSignals}。
 * 这正是 fullProve 内部做的事(它私建 {type:'mem'} 串起两步),此处显式拆开只为插入两段进度。
 */
async function runProve(
  circuit: Circuit,
  inputs: Record<string, unknown>,
  id: number,
): Promise<{ proof: Groth16Proof; publicSignals: string[] }> {
  const wasm = await ensureWasm(circuit, id);
  const zkey = await ensureZkey(circuit, id);

  // witness 阶段:circom witness 计算(CPU-bound,但远轻于 prove)
  post({ id, type: 'progress', stage: 'witness' });
  const wtns: { type: 'mem'; data?: Uint8Array } = { type: 'mem' };
  await snarkjs.wtns.calculate(inputs, { type: 'mem', data: wasm }, wtns);

  // prove 阶段:Groth16 证明生成(重活,ffjavascript 多 worker 并行 FFT/MSM)
  post({ id, type: 'progress', stage: 'prove' });
  const { proof, publicSignals } = await snarkjs.groth16.prove({ type: 'mem', data: zkey }, wtns);

  return { proof: proof as Groth16Proof, publicSignals };
}

ctx.onmessage = async (e: MessageEvent<ProveReq>) => {
  const req = e.data;
  try {
    if (req.type === 'preload') {
      // 预热:拉满 wasm+zkey 入缓存,后续 prove 零网络
      await ensureWasm(req.circuit, req.id);
      await ensureZkey(req.circuit, req.id);
      post({ id: req.id, type: 'preloaded' });
      return;
    }
    // prove
    const { proof, publicSignals } = await runProve(
      req.circuit,
      req.inputs as Record<string, unknown>,
      req.id,
    );
    post({ id: req.id, type: 'done', proof, publicSignals });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    post({ id: req.id, type: 'error', message });
  }
};
