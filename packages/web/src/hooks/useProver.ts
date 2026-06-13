/**
 * useProver —— main 线程侧的证明管线门面(Design §7.5 本地计算阶段的唯一持有者)。
 *
 * 设计:模块级**懒单例 Worker**,跨账户 / 对局 / 组件共享一个实例(证明产物缓存在 worker 内,
 * 多账户切换不必重拉 12MB+ 工件)。每条请求分配单调自增 id,id → {resolve,reject,circuit,timer}
 * 路由消息;progress 按**电路**(非 id)落到模块级快照表,经 useSyncExternalStore 让任意组件
 * 订阅某电路的最新进度。
 *
 * 为什么按电路分桶(不是「所有在途取 max id」):域内可同时存在 board 证明(3.5 布阵)与 shot
 * 证明(3.7 useAutoRespond 应答)各一条;若塌缩成单条「最新」,后发起的 shot 会盖掉 board 的
 * 进度,且消费方拿不到「在算哪个电路」无法渲染「正在编译 board 证明 · fetch-zkey 61%」。
 * 故 progress 存 Map<Circuit, {id, snap}>,ProofStatus 用 useProverProgress(circuit) 取本电路那条。
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
  ProofCalldataHex,
  ProgressSnapshot,
  ProveInputs,
  ProveReq,
  ProveRes,
} from '../workers/proverProtocol.ts';

/**
 * prove 的结果。proof/publicSignals 是原始 Groth16 对象(DevProve 的 verify、3.7 结果读取用);
 * calldata 是合约就绪的 hex 形态(Task 3.3:worker 已用 formatProofCalldata 格式化好,主线程
 * BigInt() 还原后直接喂 writeContract,见 toBoardProofArgs)。
 */
export type ProveResult = {
  proof: Groth16Proof;
  publicSignals: string[];
  calldata: ProofCalldataHex;
};

/**
 * 单请求超时(ms)。证明实测亚秒级(board 本地计算 ~700ms),60s 是给「module worker 加载
 * 失败但不触发 onerror」「结构化克隆收发异常未冒泡」等未知卡死的保险:超时即 reject 一个可读
 * Error,让 ProofStatus 渲染真实错误而非无限转圈。
 */
const REQUEST_TIMEOUT_MS = 60_000;

// ── 模块级单例状态(整个应用共享一份) ──────────────────────────────────────

let worker: Worker | null = null;
let nextId = 1;

/**
 * id → 该请求的 promise 句柄。preload 的 resolve 不带值(void),prove 带 ProveResult。
 * 额外带 circuit(终态清理时据此定位 progress 桶)与 timer(settle 时清掉,防误触发超时)。
 */
type Pending =
  | {
      kind: 'preload';
      circuit: Circuit;
      timer: ReturnType<typeof setTimeout>;
      resolve: () => void;
      reject: (e: Error) => void;
    }
  | {
      kind: 'prove';
      circuit: Circuit;
      timer: ReturnType<typeof setTimeout>;
      resolve: (r: ProveResult) => void;
      reject: (e: Error) => void;
    };

const pending = new Map<number, Pending>();

/**
 * circuit → 该电路最新进度({id, snap})。按电路分桶,board / shot 互不覆盖。
 * 存 id 是为了「归属判定」:只有**当前占用该电路桶的那个 id** 的终态(done/error/超时)才清桶,
 * 避免一个已结束的旧请求误清掉同电路上一个更新请求的进度;同样,旧请求的迟到 progress 帧
 * 也不得覆盖更新请求(只接受 id ≥ 当前桶 id 的帧)。
 */
const progressByCircuit = new Map<Circuit, { id: number; snap: ProgressSnapshot }>();

/** useSyncExternalStore 订阅者集合;任何 progress 变动后逐一通知触发重渲染。 */
const listeners = new Set<() => void>();

function emitChange(): void {
  for (const l of listeners) l();
}

/**
 * 终态收口:清掉该 id 的超时定时器与 pending 项,并在该 id 仍占用其电路桶时清掉进度桶。
 * 返回被摘下的 pending 项(调用方据 kind resolve/reject);id 不存在(已被别的路径收口)返回 undefined。
 * 不在此 emitChange——由调用方在 resolve/reject 后统一发,避免重复通知。
 */
function settle(id: number): Pending | undefined {
  const entry = pending.get(id);
  if (!entry) return undefined;
  clearTimeout(entry.timer);
  pending.delete(id);
  const bucket = progressByCircuit.get(entry.circuit);
  if (bucket && bucket.id === id) {
    progressByCircuit.delete(entry.circuit);
  }
  return entry;
}

/**
 * 拒掉全部在途请求(用于脚本级 onerror / onmessageerror 这类 id 不可知的致命错误)。
 * 清空进度桶与 pending,逐一 reject,最后 emitChange 一次。
 */
function rejectAll(err: Error): void {
  for (const [, entry] of pending) {
    clearTimeout(entry.timer);
    entry.reject(err);
  }
  pending.clear();
  progressByCircuit.clear();
  emitChange();
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
    switch (msg.type) {
      case 'progress': {
        // 归属判定:同电路上只接受 id ≥ 当前桶 id 的帧(更新或同一请求),拒绝旧请求迟到帧。
        const bucket = progressByCircuit.get(msg.circuit);
        if (bucket && msg.id < bucket.id) return;
        progressByCircuit.set(msg.circuit, {
          id: msg.id,
          snap: {
            circuit: msg.circuit,
            stage: msg.stage,
            loaded: msg.loaded,
            total: msg.total,
          },
        });
        emitChange();
        return;
      }
      case 'preloaded': {
        const entry = settle(msg.id);
        if (entry && entry.kind === 'preload') entry.resolve();
        emitChange();
        return;
      }
      case 'done': {
        const entry = settle(msg.id);
        if (entry && entry.kind === 'prove') {
          entry.resolve({
            proof: msg.proof,
            publicSignals: msg.publicSignals,
            calldata: msg.calldata,
          });
        }
        emitChange();
        return;
      }
      case 'error': {
        const entry = settle(msg.id);
        if (entry) entry.reject(new Error(msg.message));
        emitChange();
        return;
      }
    }
  };

  // 脚本级致命错误(worker 加载失败 / 未捕获异常):拒掉全部在途,清空进度。
  w.onerror = (ev: ErrorEvent) => {
    rejectAll(new Error(`prover worker 致命错误:${ev.message || '未知'}`));
  };

  // 结构化克隆接收失败(收到无法反序列化的消息):此时 e.data 不可信、id 不可知,
  // 故拒掉全部在途并给可读 message,避免相关 promise 永挂。
  w.onmessageerror = () => {
    rejectAll(new Error('prover worker 消息反序列化失败(structured clone),已中止在途请求'));
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
 * 超时(REQUEST_TIMEOUT_MS)未回 → reject 并清理本请求的 pending / 进度桶。
 */
export function preload(circuit: Circuit): Promise<void> {
  const id = nextId++;
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => onTimeout(id), REQUEST_TIMEOUT_MS);
    pending.set(id, { kind: 'preload', circuit, timer, resolve, reject });
    postReq({ id, type: 'preload', circuit });
  });
}

/**
 * 生成证明。inputs 必须是 toBoardInputs / toShotInputs 的产物(bigint 已转十进制字符串)。
 * 返回 {proof, publicSignals};proof 可直接喂给 formatProofCalldata(经 web/lib 的 contracts re-export)。
 * 失败(worker error 消息 / 脚本级错误 / 超时)reject Error。
 */
export function prove(circuit: Circuit, inputs: ProveInputs): Promise<ProveResult> {
  const id = nextId++;
  return new Promise<ProveResult>((resolve, reject) => {
    const timer = setTimeout(() => onTimeout(id), REQUEST_TIMEOUT_MS);
    pending.set(id, { kind: 'prove', circuit, timer, resolve, reject });
    postReq({ id, type: 'prove', circuit, inputs });
  });
}

/**
 * 单请求超时收口:摘下该 id(settle 同时清其电路进度桶),reject 可读 Error,emitChange。
 * id 已被其它路径收口(竞态:done/error 与超时同帧)时 settle 返回 undefined,安全 no-op。
 */
function onTimeout(id: number): void {
  const entry = settle(id);
  if (entry) {
    entry.reject(new Error(`prover 超时(${REQUEST_TIMEOUT_MS / 1000}s)未响应,可能 worker 加载失败`));
    emitChange();
  }
}

// ── React 订阅:某电路的最新进度(供 ProofStatus) ──────────────────────────

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

/**
 * 每电路一个**稳定的** getSnapshot 闭包(useSyncExternalStore 要求 getSnapshot 引用稳定,
 * 否则每次渲染都重订阅)。同时做引用稳定化:内容不变时复用上次返回的 snap 对象,避免
 * useSyncExternalStore 用 Object.is 比较时误判变动导致死循环 / 抖动。
 */
const snapshotGetters = new Map<Circuit, () => ProgressSnapshot | null>();
const lastSnapByCircuit = new Map<Circuit, ProgressSnapshot>();

function getSnapshotGetter(circuit: Circuit): () => ProgressSnapshot | null {
  let getter = snapshotGetters.get(circuit);
  if (getter) return getter;
  getter = () => {
    const bucket = progressByCircuit.get(circuit);
    if (!bucket) {
      lastSnapByCircuit.delete(circuit);
      return null;
    }
    const prev = lastSnapByCircuit.get(circuit);
    const next = bucket.snap;
    if (
      prev &&
      prev.circuit === next.circuit &&
      prev.stage === next.stage &&
      prev.loaded === next.loaded &&
      prev.total === next.total
    ) {
      return prev;
    }
    lastSnapByCircuit.set(circuit, next);
    return next;
  };
  snapshotGetters.set(circuit, getter);
  return getter;
}

/**
 * Hook:订阅**指定电路**的最新本地计算进度。返回 {circuit, stage, loaded?, total?} 或 null
 * (该电路当前无在途计算)。给 §7.5 ProofStatus 用:它再叠加链上等待阶段,合成完整证明状态条。
 */
export function useProverProgress(circuit: Circuit): ProgressSnapshot | null {
  return useSyncExternalStore(
    subscribe,
    getSnapshotGetter(circuit),
    () => null,
  );
}

/**
 * 非 hook 同步读取某电路当前进度快照(无在途返回 null)。等价于 useProverProgress 的读路径,
 * 但不订阅 React——供单测断言 store 分桶/归属逻辑,以及非组件上下文按需取值。
 */
export function peekProgress(circuit: Circuit): ProgressSnapshot | null {
  return getSnapshotGetter(circuit)();
}

/**
 * useProver:把命令式 API 收成一个 hook 返回值,方便组件解构。
 * prove/preload 引用稳定(模块级函数),progress 经 useSyncExternalStore 实时更新(指定电路)。
 */
export function useProver(circuit: Circuit): {
  prove: typeof prove;
  preload: typeof preload;
  progress: ProgressSnapshot | null;
} {
  const progress = useProverProgress(circuit);
  return { prove, preload, progress };
}

// ── Vite HMR:dispose 旧 worker,避免热更新残留重复 worker 实例 ───────────────
// dev 下编辑本模块会重执行,但旧 worker 不会自动回收;dispose 钩子里 terminate 并清状态,
// 让下次 getWorker() 干净重建。生产构建无 import.meta.hot,该分支被剔除。
if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    worker?.terminate();
    worker = null;
    pending.clear();
    progressByCircuit.clear();
    listeners.clear();
    snapshotGetters.clear();
    lastSnapByCircuit.clear();
  });
}
