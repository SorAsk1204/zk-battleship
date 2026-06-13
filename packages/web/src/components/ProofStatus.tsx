/**
 * ProofStatus —— 证明 / 链上确认两阶段状态条(Design §7.5;create 现用、对战幕将来复用)。
 *
 * §7.5 纪律(本组件的存在理由):两类等待**严格区分**——
 *   本地计算(证明生成):显示「正在编译舰队部署证明… 拉取 zkey 61%」——电路 + stage + 真实字节%,
 *     数据来自 useProverProgress(circuit)(worker Content-Length 流式读出,**非假进度条**)。
 *   链上确认(网络):显示「等待链上确认…」+ inline spinner——无字节、无百分比(链上耗时不可预估,
 *     给百分比就是假进度)。
 * 内联展示,**不弹模态**(§7.5);idle 不渲染;done/error 给干净终态。
 *
 * 设计成**纯展示**(presentational):状态由 useLockFleet 的 LockFleetStatus 喂入(props.status),
 * 本地计算进度由本组件内部订阅 useProverProgress(props.circuit) 叠加。本组件不持有业务状态、不发起
 * 任何动作——3.5 布阵幕 / 3.7 对战幕都把各自的 status 喂进来即可复用(circuit 由调用方指定:
 * 布阵=board,应答=shot)。
 *
 * 文案与按钮动词一致(§7.6):锁定舰队流程 → 「编译舰队部署证明」。
 */
import { useProverProgress } from '../hooks/useProver.ts';
import type { Circuit, ProveStage } from '../workers/proverProtocol.ts';
import type { LockFleetStatus } from '../hooks/useLockFleet.ts';
import type { AutoRespondStatus } from '../hooks/useAutoRespond.ts';

/**
 * ProofStatus 接受的状态:布阵/加入的 LockFleetStatus 或对战应答的 AutoRespondStatus。
 * 两者共享 idle/proving/sending/confirming/error 的相位形状;done 字段不同(LockFleet 的 done 带
 * mode/gameId,AutoRespond 的 done 极简)——本组件只在「无 doneLabel」时才读 LockFleet 的 mode,
 * 应答幕恒传 doneLabel,故不触达那条字段。
 */
type StageStatus = LockFleetStatus | AutoRespondStatus;

/** stage → 人话(本地计算四阶段,§7.5 真实阶段,顺序即发生序)。 */
const STAGE_LABEL: Record<ProveStage, string> = {
  'fetch-wasm': '拉取电路 wasm',
  'fetch-zkey': '拉取证明密钥 zkey',
  witness: '计算见证(witness)',
  prove: '生成 Groth16 证明',
};

/** 内联 spinner:CSS 旋转的磷光小环(非进度条;链上等待用,表「在进行、时长不可预估」)。 */
function Spinner() {
  return (
    <span
      aria-hidden
      className="inline-block h-3 w-3 animate-spin rounded-full border border-phosphor border-t-transparent align-[-1px]"
    />
  );
}

/** 字节进度 → "(3.4/8.4MB)";缺 loaded/total(witness/prove 阶段)返回空串。 */
function bytesLabel(loaded?: number, total?: number): string {
  if (loaded == null || total == null || total === 0) return '';
  const mb = (n: number) => (n / 1e6).toFixed(1);
  const pct = Math.min(100, Math.round((loaded / total) * 100));
  return ` ${mb(loaded)}/${mb(total)}MB · ${pct}%`;
}

export type ProofStatusProps = {
  /** 来自 useLockFleet 的离散状态,或对战应答的 AutoRespondStatus(共享相位形状,见 StageStatus)。 */
  status: StageStatus;
  /** 本地计算阶段订阅哪条电路的进度(布阵=board,应答=shot)。默认 board。 */
  circuit?: Circuit;
  /**
   * 证明阶段(proving)的标题文案(§7.6 动词化)。省略 → 「正在编译舰队部署证明…」(布阵默认)。
   * 应答幕传「正在应答 D-7 的炮击…」(reviewer 建议:不再把 respond 模式硬编进本组件,由调用方给文案)。
   */
  provingLabel?: string;
  /**
   * done 终态文案。省略 → 按 status.mode 给 create/join 文案(布阵默认)。
   * 应答幕的 respond status 无 mode 字段(见 AutoRespondStatus),故由调用方显式给(如「✓ 已应答 D-7」)。
   */
  doneLabel?: string;
};

/** done 态文案:优先调用方给的 doneLabel;否则按 create/join mode(布阵默认)。 */
function doneText(status: StageStatus, doneLabel?: string): string {
  if (doneLabel) return doneLabel;
  if (status.phase !== 'done') return '';
  // 仅 LockFleetStatus 的 done 带 mode/gameId(AutoRespondStatus 的 done 极简,但应答幕恒给 doneLabel
  // 已在上面 return,不达此)。'mode' in status 收窄到 LockFleet 分支,安全读 mode/gameId。
  if ('mode' in status) {
    return status.mode === 'create'
      ? `对局已创建 · 编号 #${status.gameId.toString()}`
      : `已加入对局 #${status.gameId.toString()}`;
  }
  return '';
}

/**
 * 渲染两阶段状态。idle → null(不占位)。
 *   proving    → 本地计算行:provingLabel(或布阵默认)+ stage + 字节%(useProverProgress)
 *   sending    → 链上行:提交交易中…(本地签名 → 广播)+ spinner
 *   confirming → 链上行:等待链上确认…(tx 短哈希)+ spinner
 *   done       → 干净成功行(doneLabel 或 create/join 文案)
 *   error      → 错误行(--flare;已是人话/阻断文案)
 */
export default function ProofStatus({
  status,
  circuit = 'board',
  provingLabel,
  doneLabel,
}: ProofStatusProps) {
  // 始终调用 hook(规则:hook 不能条件调用);proving 之外该值通常为 null,不渲染本地计算行。
  const progress = useProverProgress(circuit);

  if (status.phase === 'idle') return null;

  if (status.phase === 'proving') {
    const stage = progress ? STAGE_LABEL[progress.stage] : '准备中';
    const bytes = progress ? bytesLabel(progress.loaded, progress.total) : '';
    return (
      <div
        className="flex items-center gap-2 border border-phosphor/40 bg-abyss px-3 py-2"
        data-testid="proof-status"
        data-phase="proving"
        role="status"
        aria-live="polite"
      >
        <Spinner />
        <span className="font-mono text-xs text-phosphor">
          {provingLabel ?? '正在编译舰队部署证明…'} {stage}
          {bytes}
        </span>
      </div>
    );
  }

  if (status.phase === 'sending' || status.phase === 'confirming') {
    const text =
      status.phase === 'sending'
        ? '提交交易中(本地签名 → 广播)…'
        : `等待链上确认… tx ${status.hash.slice(0, 10)}…`;
    return (
      <div
        className="flex items-center gap-2 border border-phosphor/40 bg-abyss px-3 py-2"
        data-testid="proof-status"
        data-phase={status.phase}
        role="status"
        aria-live="polite"
      >
        <Spinner />
        <span className="font-mono text-xs text-phosphor">{text}</span>
      </div>
    );
  }

  if (status.phase === 'done') {
    const label = doneText(status, doneLabel);
    return (
      <div
        className="border border-phosphor/40 bg-abyss px-3 py-2"
        data-testid="proof-status"
        data-phase="done"
        role="status"
      >
        <p className="font-mono text-xs text-phosphor">✓ {label}</p>
      </div>
    );
  }

  // error
  return (
    <div
      className="border border-flare/50 bg-abyss px-3 py-2"
      data-testid="proof-status"
      data-phase="error"
      role="alert"
    >
      <p className="font-mono text-xs text-flare">✗ {status.message}</p>
    </div>
  );
}
