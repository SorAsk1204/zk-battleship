/**
 * Lobby —— M3 落地真实大厅(Task 3.4 polish UX)。
 *
 * 本任务(3.3)只在此挂一个**最小但诚实**的 createGame 流程作为全栈验收载体:
 *   load deployment → 固定合法布阵 + 新 randomSalt → savePending → worker 出 board 证明 →
 *   writeContract createGame(commitment, calldata) → 等回执 → 解析 GameCreated/gameId →
 *   promotePending。每个状态都对应真实工作,无假进度;错误经 mapContractError 成人话。
 *
 * 3.4 会把这块替换成真正的大厅(列表/创建/加入);此处刻意从简(单按钮 + 状态行 + 证明进度),
 * 仅证明 worker→calldata→wagmi→anvil→事件 的完整链路通了。仅 demo 构建可用(需 deployment + 账户)。
 */
import { useState } from 'react';
import { parseEventLogs } from 'viem';
import { useAccount, usePublicClient, useWriteContract } from 'wagmi';
import { battleshipAbi } from '../lib/abi.ts';
import type { Board } from '../lib/boardLogic.ts';
import { computeCommitment } from '../lib/commitment.ts';
import { type Deployment, loadDeployment, reloadDeployment } from '../lib/contracts.ts';
import { mapContractError } from '../lib/errors.ts';
import { toBoardProofArg } from '../lib/proofArgs.ts';
import { randomSalt } from '../lib/salt.ts';
import { savePending, promotePending } from '../lib/storage.ts';
import { prove, useProverProgress } from '../hooks/useProver.ts';
import { IS_DEMO } from '../lib/wagmi.ts';
import { toBoardInputs } from '../lib/commitment.ts';

// 固定合法布阵(同 DevProve fixture):5 船贴左逐行,长度 [5,4,3,3,2],validateBoard 必过。
const FIXED_BOARD: Board = [
  { x: 0, y: 0, dir: 0 },
  { x: 0, y: 1, dir: 0 },
  { x: 0, y: 2, dir: 0 },
  { x: 0, y: 3, dir: 0 },
  { x: 0, y: 4, dir: 0 },
];

type Flow =
  | { phase: 'idle' }
  | { phase: 'proving' }
  | { phase: 'sending' } // 交易已构造,等钱包/节点接收(本地签名→eth_sendRawTransaction)
  | { phase: 'confirming'; hash: string }
  | { phase: 'done'; hash: string; gameId: bigint; p0: string }
  | { phase: 'error'; message: string };

export default function Lobby() {
  const { address, isConnected } = useAccount();
  const publicClient = usePublicClient();
  const { writeContractAsync } = useWriteContract();
  const [flow, setFlow] = useState<Flow>({ phase: 'idle' });
  // board 证明进度(worker 本地计算阶段);proving 期间渲染 fetch/witness/prove。
  const progress = useProverProgress('board');

  const busy = flow.phase === 'proving' || flow.phase === 'sending' || flow.phase === 'confirming';

  async function onCreate() {
    if (!address || !publicClient) {
      setFlow({ phase: 'error', message: '尚未连接账户或链客户端未就绪。' });
      return;
    }
    try {
      // 1. 部署信息:首取走缓存;若曾失败(demo 后启)则 reload 重取一次(契约:rejected promise 被缓存)。
      let deployment: Deployment;
      try {
        deployment = await loadDeployment();
      } catch {
        deployment = await reloadDeployment();
      }

      // 2. 固定布阵 + 全新 salt(§5.1:每局必须新 salt);承诺本地算(= 证明的 pubSignal[0])。
      const salt = randomSalt();
      const commitment = computeCommitment(FIXED_BOARD, salt);

      // 3. 先落 pending(§8:棋盘即资产,上链前先存;gameId 未知)。写失败抛 StorageWriteError。
      savePending(deployment.chainId, deployment.battleship, address, {
        ships: FIXED_BOARD,
        salt,
        commitment,
      });

      // 4. worker 出 board 证明(本地计算 → calldata 已在 worker 内 formatProofCalldata 好)。
      setFlow({ phase: 'proving' });
      const { calldata } = await prove('board', toBoardInputs(FIXED_BOARD, salt));

      // 5. writeContract createGame(commitment, BoardProof)。local-account connector 本地签名发 raw tx。
      setFlow({ phase: 'sending' });
      const hash = await writeContractAsync({
        abi: battleshipAbi,
        address: deployment.battleship,
        functionName: 'createGame',
        args: [commitment, toBoardProofArg(calldata)],
      });

      // 6. 等回执。
      setFlow({ phase: 'confirming', hash });
      const receipt = await publicClient.waitForTransactionReceipt({ hash });

      // 7. 从回执日志解析 GameCreated → gameId(indexed)。
      const logs = parseEventLogs({
        abi: battleshipAbi,
        eventName: 'GameCreated',
        logs: receipt.logs,
      });
      const ev = logs[0];
      if (!ev) {
        throw new Error('交易已上链但未解析到 GameCreated 事件。');
      }
      const gameId = ev.args.gameId;
      const p0 = ev.args.p0;

      // 8. pending → 正式键(拿到 gameId 后迁移)。
      promotePending(deployment.chainId, deployment.battleship, address, gameId);

      setFlow({ phase: 'done', hash, gameId, p0 });
    } catch (err) {
      setFlow({ phase: 'error', message: mapContractError(err) });
    }
  }

  return (
    <section className="space-y-6">
      <h1 className="font-display text-3xl font-bold text-phosphor">LOBBY</h1>
      <p className="text-foam">
        三幕(布阵 / 对战 / 结算)在 3.4+ 落地。本页当前承载 Task 3.3 的链上 createGame 全栈验收。
      </p>

      <div className="space-y-4 border border-grid bg-console p-5">
        <div className="flex items-center justify-between">
          <h2 className="font-display text-lg font-bold text-foam">创建对局(验收)</h2>
          <span className="font-mono text-xs text-mist">
            {isConnected ? `账户 ${address?.slice(0, 6)}…${address?.slice(-4)}` : '未连接账户'}
          </span>
        </div>

        <button
          type="button"
          data-testid="create-game"
          onClick={() => void onCreate()}
          disabled={busy || !isConnected}
          className="border border-phosphor bg-grid px-4 py-2 font-display text-sm font-bold text-phosphor hover:bg-grid disabled:opacity-50"
        >
          {busy ? '处理中…' : 'createGame(固定布阵)'}
        </button>

        {/* 证明进度(proving 期间):worker 本地计算阶段 */}
        {flow.phase === 'proving' && (
          <p className="font-mono text-xs text-phosphor" data-testid="flow-status">
            生成 board 证明中…
            {progress ? ` · ${progress.stage}` : ''}
            {progress?.loaded != null && progress.total != null
              ? ` (${(progress.loaded / 1e6).toFixed(1)}/${(progress.total / 1e6).toFixed(1)}MB)`
              : ''}
          </p>
        )}
        {flow.phase === 'sending' && (
          <p className="font-mono text-xs text-phosphor" data-testid="flow-status">
            提交交易中(本地签名 → eth_sendRawTransaction)…
          </p>
        )}
        {flow.phase === 'confirming' && (
          <p className="font-mono text-xs text-phosphor" data-testid="flow-status">
            等待回执 · tx {flow.hash.slice(0, 10)}…
          </p>
        )}
        {flow.phase === 'done' && (
          <div className="space-y-1 border border-phosphor/40 bg-abyss p-3" data-testid="flow-done">
            <p className="font-mono text-xs text-phosphor">✓ GameCreated</p>
            <p className="font-mono text-xs text-foam">gameId: {flow.gameId.toString()}</p>
            <p className="font-mono text-xs text-foam">p0: {flow.p0}</p>
            <p className="font-mono text-xs text-mist break-all">tx: {flow.hash}</p>
          </div>
        )}
        {flow.phase === 'error' && (
          <p className="font-mono text-xs text-flare" data-testid="flow-error">
            ✗ {flow.message}
          </p>
        )}

        {!IS_DEMO && (
          <p className="font-mono text-xs text-mist">
            (非 demo 构建:需先 pnpm demo 启动本地链与账户)
          </p>
        )}
      </div>
    </section>
  );
}
