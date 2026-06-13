/**
 * useProver —— main 线程侧的证明管线门面(Design §7.5 本地计算阶段的唯一持有者)。
 *
 * 设计:模块级**懒单例 Worker**,跨账户 / 对局 / 组件共享一个实例(证明产物缓存在 worker 内,
 * 多账户切换不必重拉 12MB+ 工件)。每条请求分配单调自增 id,id → {resolve,reject} 路由消息;
 * progress 按 id 落到模块级快照表,经 useSyncExternalStore 让任意组件订阅最新进度。
 *
 * 纪律(3.1 浏览器安全):本文件**不 import snarkjs、不碰任何 node API**——snarkjs 只在 worker 内。
 * 这里只 `new Worker(new URL('../workers/prover.worker.ts', import.meta.url), {type:'module'})`,
 * Vite 据 worker.format='es' 把 worker 单独打包并把 snarkjs / ffjavascript 拽进 worker chunk,
 * 不污染主线程 bundle。
 *
 * 边界:本 hook 只负责**本地计算**(fetch 工件 → witness → prove)。链上等待(交易确认)的进度
 * 是 §7.5 的另一段,由未来 useGame / ProofStatus 负责,**不**塞进这里。
 */
import { useSyncExternalStore } from 'react';
import type {
  Circuit,
  Groth16Proof,
  ProgressSnapshot,
  ProveInputs,
  ProveReq,
  ProveRes,
} from '../workers/proverProtocol.ts';

export type ProveResult = { proof: Groth16Proof; publicSignals: string[] };

// ── 模块级单例状态(整个应用共享一份) ──────────────────────────────────────

let worker: Worker | null = null;
let nextId = 1;

/** id → 该请求的 promise 句柄。preload 的 resolve 不带值(void),prove 带 ProveResult。 */
type Pending =
  | { kind: 'preload'; resolve: () => void; reject: (e: Error) => void }
  | { kind: 'prove'; resolve: (r: ProveResult) => void; reject: (e: Error) => void };

const pending = new Map<number, Pending>();

/** id → 最新进度快照;done/error/拒绝后清除。供 ProofStatus 订阅。 */
const progressById = new Map<number, ProgressSnapshot>();

/** useSyncExternalStore 订阅者集合;任何 progress 变动后逐一通知触发重渲染。 */
const listeners = new Set<() => void>();

function emitChange(): void {
  for (const l of listeners) l();
}

/**
 * 懒初始化 worker。首次 prove/preload 时创建;HMR / 测试环境下若已存在直接复用。
 * 失败回调:worker 自身 onerror(脚本级错误,区别于业务 error 消息)把所有在途请求拒掉,
 * 避免 promise 永挂。
 */
function getWorker(): Worker {
  if (worker) return worker;
  const w = new Worker(new URL('../workers/prover.worker.ts', import.meta.url), {
    type: 'module',
  });

  w.onmessage = (e: MessageEvent<ProveRes>) => {
    const msg = e.data;
    const entry = pending.get(msg.id);
    switch (msg.type) {
      case 'progress':
        progressById.set(msg.id, { stage: msg.stage, loaded: msg.loaded, total: msg.total });
        emitChange();
        return;
      case 'preloaded':
        progressById.delete(msg.id);
        if (entry && entry.kind === 'preload') {
          pending.delete(msg.id);
          entry.resolve();
        }
        emitChange();
        return;
      case 'done':
        progressById.delete(msg.id);
        if (entry && entry.kind === 'prove') {
          pending.delete(msg.id);
          entry.resolve({ proof: msg.proof, publicSignals: msg.publicSignals });
        }
        emitChange();
        return;
      case 'error':
        progressById.delete(msg.id);
        if (entry) {
          pending.delete(msg.id);
          entry.reject(new Error(msg.message));
        }
        emitChange();
        return;
    }
  };

  // 脚本级致命错误(worker 加载失败 / 未捕获异常):拒掉全部在途,清空进度
  w.onerror = (ev: ErrorEvent) => {
    const err = new Error(`prover worker 致命错误:${ev.message || '未知'}`);
    for (const [, entry] of pending) entry.reject(err);
    pending.clear();
    progressById.clear();
    emitChange();
  };

  worker = w;
  return w;
}

function postReq(req: ProveReq): void {
  getWorker().postMessage(req);
}

// ── 对外 API(命令式,可在事件处理/effect 中直接调用) ──────────────────────

/**
 * 预热某电路:拉取并缓存 wasm+zkey,后续 prove 免网络。可在进入布阵幕时调用以隐藏延迟。
 * 已在缓存时 worker 立即回 preloaded(仍走一遍消息,开销可忽略)。
 */
export function preload(circuit: Circuit): Promise<void> {
  const id = nextId++;
  return new Promise<void>((resolve, reject) => {
    pending.set(id, { kind: 'preload', resolve, reject });
    postReq({ id, type: 'preload', circuit });
  });
}

/**
 * 生成证明。inputs 必须是 toBoardInputs / toShotInputs 的产物(bigint 已转十进制字符串)。
 * 返回 {proof, publicSignals};proof 可直接喂给 formatProofCalldata(经 web/lib 的 contracts re-export)。
 * 失败(worker error 消息或脚本级错误)reject Error。
 */
export function prove(circuit: Circuit, inputs: ProveInputs): Promise<ProveResult> {
  const id = nextId++;
  return new Promise<ProveResult>((resolve, reject) => {
    pending.set(id, { kind: 'prove', resolve, reject });
    postReq({ id, type: 'prove', circuit, inputs });
  });
}

// ── React 订阅:最新进度(供 ProofStatus) ──────────────────────────────────

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

/**
 * 最近一条在途进度快照(across all in-flight ids 取最新写入的那条)。
 * §7.5 ProofStatus 只需展示「当前在算什么」;多请求并发极少(对战是回合制串行),取最新足够。
 * 无在途时返回 null。引用稳定:同一快照对象多次读返回同引用,避免 useSyncExternalStore 抖动。
 */
let lastSnapshotRef: { id: number; snap: ProgressSnapshot } | null = null;
function getLatestProgressSnapshot(): { id: number; snap: ProgressSnapshot } | null {
  if (progressById.size === 0) {
    lastSnapshotRef = null;
    return null;
  }
  // Map 迭代保留插入序;最后插入(或最近更新会 re-set 到末尾?Map.set 已存在 key 不改序)。
  // 为稳妥取「最大 id」=最近发起的请求,语义上即当前最该展示的那条。
  let pickId = -1;
  let pickSnap: ProgressSnapshot | null = null;
  for (const [id, snap] of progressById) {
    if (id > pickId) {
      pickId = id;
      pickSnap = snap;
    }
  }
  if (pickSnap === null) {
    lastSnapshotRef = null;
    return null;
  }
  // 引用稳定化:内容相同则复用旧引用(useSyncExternalStore 用 Object.is 比较)
  if (
    lastSnapshotRef &&
    lastSnapshotRef.id === pickId &&
    lastSnapshotRef.snap.stage === pickSnap.stage &&
    lastSnapshotRef.snap.loaded === pickSnap.loaded &&
    lastSnapshotRef.snap.total === pickSnap.total
  ) {
    return lastSnapshotRef;
  }
  lastSnapshotRef = { id: pickId, snap: pickSnap };
  return lastSnapshotRef;
}

/**
 * Hook:订阅最新本地计算进度。返回 {stage, loaded?, total?} 或 null(无在途)。
 * 给 §7.5 ProofStatus 用:它再叠加链上等待阶段,合成完整证明状态条。
 */
export function useProverProgress(): ProgressSnapshot | null {
  const ref = useSyncExternalStore(subscribe, getLatestProgressSnapshot, () => null);
  return ref ? ref.snap : null;
}

/**
 * useProver:把命令式 API 收成一个 hook 返回值,方便组件解构。
 * prove/preload 引用稳定(模块级函数),progress 经 useSyncExternalStore 实时更新。
 */
export function useProver(): {
  prove: typeof prove;
  preload: typeof preload;
  progress: ProgressSnapshot | null;
} {
  const progress = useProverProgress();
  return { prove, preload, progress };
}
