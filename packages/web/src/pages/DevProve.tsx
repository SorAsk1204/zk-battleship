/**
 * DevProve —— Task 3.2 验收用 dev-only 仪表盘(/dev/prove,仅 import.meta.env.DEV)。
 *
 * 它是真验收工具,不是假 UI:
 *   1) preload(circuit) 拉满工件并缓存(走 useProver 单例,与生产同路径);
 *   2) 出真证明并捕获**每个 progress 阶段**的到达时刻(fetch-wasm→fetch-zkey→witness→prove),计时;
 *   3) main 线程 groth16.verify(vkey, publicSignals, proof) 对 /zk/<c>/verification_key.json 验真;
 *   4) 展示 PASS/FAIL + 本地计算毫秒 + verify 毫秒 + 阶段时间线。
 *
 * 为什么本页自起一个 worker 实例:useProver 的命令式 prove 只回最终结果,progress 只暴露「最新快照」,
 * 拿不到逐阶段时间线。验收必须看到四个阶段按序触发,故本页直接 new 同一个 prover.worker.ts 实例,
 * 侦听其**原始消息流**精确记录每帧。这跑的是生产 worker 同代码(同文件),只是为取时间线而独立。
 *
 * 为什么 verify 放主线程:verify 是轻量配对检查(~ms),不值得为它再设 worker 协议;本页 dev-gated +
 * 经 App 里 import.meta.env.DEV 守卫的懒路由加载,production 构建走不到(Rollup 死代码消除),
 * snarkjs 不进主线程生产 bundle。这里**动态** import('snarkjs') 再加一道保险。
 *
 * 固定 salt 仅限本 dev fixture(§5.1:生产严禁固定 salt,可预测会让 17 格布阵被字典攻击还原)。
 */
import { useState } from 'react';
import { toBoardInputs, toShotInputs } from '../lib/commitment.ts';
import type { Board } from '../lib/boardLogic.ts';
import { validateBoard } from '../lib/boardLogic.ts';
import { preload } from '../hooks/useProver.ts';
import type {
  Circuit,
  ProveInputs,
  ProveReq,
  ProveRes,
  ProveStage,
} from '../workers/proverProtocol.ts';

// 固定合法布阵:5 条船全水平贴左排,长度 [5,4,3,3,2],逐行下移,界内无重叠(validateBoard 必过)。
const FIXED_BOARD: Board = [
  { x: 0, y: 0, dir: 0 }, // len5 → (0..4,0)
  { x: 0, y: 1, dir: 0 }, // len4 → (0..3,1)
  { x: 0, y: 2, dir: 0 }, // len3 → (0..2,2)
  { x: 0, y: 3, dir: 0 }, // len3 → (0..2,3)
  { x: 0, y: 4, dir: 0 }, // len2 → (0..1,4)
];
const FIXED_SALT = 12345678901234567890n;
// shot:打 (0,0) —— ship0 占该格,isHit=1,result 公开信号应为 1
const SHOT_TX = 0;
const SHOT_TY = 0;

type StageMark = { stage: ProveStage; atMs: number; loaded?: number; total?: number };

type RunState =
  | { phase: 'idle' }
  | { phase: 'running'; marks: StageMark[] }
  | {
      phase: 'done';
      verified: boolean;
      proveMs: number;
      verifyMs: number;
      marks: StageMark[];
      publicSignals: string[];
    }
  | { phase: 'error'; message: string; marks: StageMark[] };

async function fetchJson(url: string): Promise<unknown> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`拉取 ${url} 失败:HTTP ${res.status}`);
  return res.json();
}

function circuitInputs(circuit: Circuit): ProveInputs {
  return circuit === 'board'
    ? toBoardInputs(FIXED_BOARD, FIXED_SALT)
    : toShotInputs(FIXED_BOARD, FIXED_SALT, SHOT_TX, SHOT_TY);
}

/**
 * 出证明并捕获逐阶段时间线。自起一个 prover.worker.ts 实例,侦听原始消息流,
 * 每个 stage 仅记首帧到达(fetch-* 会发多帧 loaded,记首帧 + 末帧字节数)。
 * resolve {proof, publicSignals, marks}。完成后 terminate 该临时 worker。
 */
function proveWithTimeline(
  circuit: Circuit,
  inputs: ProveInputs,
): Promise<{ proof: unknown; publicSignals: string[]; marks: StageMark[]; doneMs: number }> {
  return new Promise((resolve, reject) => {
    const w = new Worker(new URL('../workers/prover.worker.ts', import.meta.url), {
      type: 'module',
    });
    const t0 = performance.now();
    // marks 每个 stage 记首帧到达时刻(start);fetch-* 的多帧只更新其字节进度,不重复记时。
    const marks: StageMark[] = [];
    const seen = new Set<ProveStage>();
    const id = 1;

    w.onmessage = (e: MessageEvent<ProveRes>) => {
      const msg = e.data;
      if (msg.type === 'progress') {
        if (!seen.has(msg.stage)) {
          seen.add(msg.stage);
          marks.push({
            stage: msg.stage,
            atMs: performance.now() - t0,
            loaded: msg.loaded,
            total: msg.total,
          });
        } else {
          // 同阶段后续帧:更新对应 mark 的字节进度(取最新 loaded),时刻保留首帧
          const m = marks.find((x) => x.stage === msg.stage);
          if (m) {
            m.loaded = msg.loaded;
            m.total = msg.total;
          }
        }
      } else if (msg.type === 'done') {
        w.terminate();
        resolve({
          proof: msg.proof,
          publicSignals: msg.publicSignals,
          marks,
          doneMs: performance.now() - t0,
        });
      } else if (msg.type === 'error') {
        w.terminate();
        reject(new Error(msg.message));
      }
    };
    w.onerror = (ev) => {
      w.terminate();
      reject(new Error(`worker 致命错误:${ev.message || '未知'}`));
    };

    const req: ProveReq = { id, type: 'prove', circuit, inputs };
    w.postMessage(req);
  });
}

export default function DevProve() {
  const [board, setBoard] = useState<RunState>({ phase: 'idle' });
  const [shot, setShot] = useState<RunState>({ phase: 'idle' });

  const validation = validateBoard(FIXED_BOARD);

  async function run(circuit: Circuit, setState: (s: RunState) => void) {
    setState({ phase: 'running', marks: [] });
    try {
      const inputs = circuitInputs(circuit);
      const { proof, publicSignals, marks, doneMs } = await proveWithTimeline(circuit, inputs);
      // 本地计算总耗时 = done 时刻(从发起到 worker 回 done)
      const proveMs = doneMs;

      const vkey = await fetchJson(`/zk/${circuit}/verification_key.json`);
      const snarkjs = await import('snarkjs');
      const vt0 = performance.now();
      const verified = await snarkjs.groth16.verify(vkey, publicSignals, proof);
      const verifyMs = performance.now() - vt0;

      setState({ phase: 'done', verified, proveMs, verifyMs, marks, publicSignals });
    } catch (err) {
      setState({
        phase: 'error',
        message: err instanceof Error ? err.message : String(err),
        marks: [],
      });
    }
  }

  return (
    <section className="space-y-6">
      <header className="space-y-1">
        <h1 className="font-display text-2xl font-bold text-phosphor">DEV · 证明管线验收</h1>
        <p className="font-mono text-xs text-mist">
          /dev/prove · 仅 dev 构建可达 · snarkjs 动态 import(生产主 bundle 不含)
        </p>
      </header>

      <div className="rounded border border-grid bg-console p-4">
        <p className="text-sm text-foam">
          固定布阵 validateBoard:{' '}
          {validation.ok ? (
            <span className="text-phosphor">ok</span>
          ) : (
            <span className="text-flare">
              非法({validation.code} @ ship{validation.shipId})
            </span>
          )}
        </p>
        <p className="mt-1 font-mono text-xs text-mist">
          board={JSON.stringify(FIXED_BOARD.map((s) => [s.x, s.y, s.dir]))} salt=
          {String(FIXED_SALT)} shot=({SHOT_TX},{SHOT_TY})
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Panel
          title="BOARD 证明(重:15334 约束 / 8.35MB zkey)"
          state={board}
          onPreload={() => void preload('board')}
          onRun={() => void run('board', setBoard)}
        />
        <Panel
          title="SHOT 证明(轻:888 约束 / 1.06MB zkey)"
          state={shot}
          onPreload={() => void preload('shot')}
          onRun={() => void run('shot', setShot)}
        />
      </div>
    </section>
  );
}

function Panel(props: {
  title: string;
  state: RunState;
  onPreload: () => void;
  onRun: () => void;
}) {
  const { title, state, onPreload, onRun } = props;
  return (
    <div className="space-y-3 rounded border border-grid bg-console p-4">
      <h2 className="text-sm font-semibold text-foam">{title}</h2>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={onPreload}
          className="rounded border border-grid px-3 py-1 text-xs text-phosphor hover:bg-grid"
        >
          preload
        </button>
        <button
          type="button"
          onClick={onRun}
          disabled={state.phase === 'running'}
          className="rounded border border-phosphor px-3 py-1 text-xs text-phosphor hover:bg-grid disabled:opacity-50"
        >
          {state.phase === 'running' ? '运行中…' : 'prove + verify'}
        </button>
      </div>

      {state.phase === 'done' && (
        <div className="space-y-1">
          <p className="text-lg font-bold">
            {state.verified ? (
              <span className="text-phosphor" data-testid="verdict">
                ✓ PASS
              </span>
            ) : (
              <span className="text-flare" data-testid="verdict">
                ✗ FAIL
              </span>
            )}
          </p>
          <p className="font-mono text-xs text-foam" data-testid="prove-ms">
            prove: {state.proveMs.toFixed(0)} ms · verify: {state.verifyMs.toFixed(1)} ms
          </p>
          <p className="font-mono text-xs text-mist">
            publicSignals: {JSON.stringify(state.publicSignals)}
          </p>
          <StageTimeline marks={state.marks} />
        </div>
      )}

      {state.phase === 'running' && <StageTimeline marks={state.marks} />}

      {state.phase === 'error' && (
        <div className="space-y-1">
          <p className="font-bold text-flare" data-testid="verdict">
            ✗ ERROR
          </p>
          <p className="font-mono text-xs text-flare">{state.message}</p>
        </div>
      )}
    </div>
  );
}

function StageTimeline({ marks }: { marks: StageMark[] }) {
  if (marks.length === 0) return null;
  return (
    <ul className="font-mono text-xs text-mist" data-testid="stages">
      {marks.map((m, i) => (
        <li key={i}>
          {m.stage} @ {m.atMs.toFixed(0)}ms
          {m.total != null && m.loaded != null
            ? ` (${(m.loaded / 1e6).toFixed(2)}/${(m.total / 1e6).toFixed(2)}MB)`
            : ''}
        </li>
      ))}
    </ul>
  );
}
