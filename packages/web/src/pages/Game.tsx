/**
 * Game —— 单局相位驱动页(路由 /game/:id,Design §7.1 三幕同路由 + §4 状态机)。
 *
 * 唯一数据源是 useGame(id):它取 getGame struct(真理源)+ ShotResolved 回放,喂 deriveGameView 出
 * GameView,本页只读 view.act 分派三幕(+ loading/notfound/error)。整页随 useGame 的 watch 实时刷新
 * (事件触发 refetch),**无手动刷新按钮**(§7.1:用户永不手动刷新)。
 *
 * 账户切换(§7.1 killer feature):useGame 对 address 纯派生、零 refetch——P0↔P1 切换即让本页从同一份
 * 链上数据翻成对手视角(whose-turn、my/opponent 命中数全翻)。本页无需为此做任何事(view 已翻)。
 *
 * 三幕(本任务 3.6:placement 收口完整 create→join 切换;battle/finish 给**最小但真实派生**占位,
 * 3.7 对战幕 / 3.8 结算幕在原位替换为完整双盘 + 倒计时):
 *   - act='placement'(phase Created):
 *       · 我是 P0(等 P1)→ 从 storage 还原 P0 棋盘 → PostLockPanel(上锁盘 + 导出 + 等待);缺失则
 *         最小提示(完整持久化横幅/导入是 3.8)+ 等待文案。
 *       · 非 P0(observer / 未连,p1 尚空)→ join 模式布阵(复用 PlacementBoard/FleetDock/reducer/
 *         useLockFleet(join)/ProofStatus)。join 成功 → 合约 phase 转 AwaitingAttack → useGame refetch →
 *         act 自动变 battle(无需本页跳转)。
 *   - act='battle'(AwaitingAttack/AwaitingResponse)→ 最小占位 + 真实派生(轮到谁、双方命中、pending、
 *     双方炮击数、对手短地址)。证明 useGame 正确喂战斗态;3.7 换成双盘 + 准星 + 自动应答。
 *   - act='finish'(Finished/Cancelled)→ 最小占位(你赢了 / 对局已取消 / 对手获胜)+ 返回大厅。
 */
import { useEffect, useReducer, useState, type ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useAccount } from 'wagmi';
import { shortAddr } from '../lib/format.ts';
import { loadDeployment, type Deployment } from '../lib/contracts.ts';
import { loadBoard, type BoardRecord } from '../lib/storage.ts';
import type { Board } from '../lib/boardLogic.ts';
import { randomSalt } from '../lib/salt.ts';
import { Phase, type GameView } from '../hooks/gameView.ts';
import { useGame } from '../hooks/useGame.ts';
import { useLockFleet } from '../hooks/useLockFleet.ts';
import { preload } from '../hooks/useProver.ts';
import ProofStatus from '../components/ProofStatus.tsx';
import PostLockPanel from '../components/PostLockPanel.tsx';
import FleetDock from '../components/board/FleetDock.tsx';
import PlacementBoard from '../components/board/PlacementBoard.tsx';
import {
  allPlaced,
  initialPlacement,
  placedCount,
  placementReducer,
  toBoard,
  validateFinal,
  type PlacementAction,
} from '../components/board/placement.ts';

export default function Game() {
  const { id: idParam } = useParams();
  const id = Number(idParam);
  const { view, isLoading, isNotFound, error } = useGame(id);

  // ── loading / notfound / error 优先于三幕 ──
  if (error) {
    return (
      <Shell>
        <div className="border border-flare/50 bg-console px-4 py-6" data-testid="game-error">
          <p className="font-mono text-sm text-flare">{error}</p>
          <BackToLobby className="mt-3" />
        </div>
      </Shell>
    );
  }

  if (isNotFound) {
    return (
      <Shell>
        <div className="border border-dashed border-grid bg-console/50 px-4 py-8 text-center" data-testid="game-notfound">
          <p className="font-display text-lg text-foam">
            未找到对局 <span className="font-mono text-flare">#{idParam}</span>
          </p>
          <p className="mt-1 text-sm text-mist">这个编号还没有对局,或编号有误。</p>
          <BackToLobby className="mt-4 inline-block" />
        </div>
      </Shell>
    );
  }

  if (isLoading || !view) {
    return (
      <Shell>
        <div className="flex items-center gap-3 border border-grid bg-console px-4 py-6" data-testid="game-loading">
          <Spinner />
          <p className="font-mono text-sm text-phosphor">声呐扫描中…</p>
        </div>
      </Shell>
    );
  }

  // ── 三幕分派 ──
  return (
    <Shell gameId={idParam}>
      {view.act === 'placement' && <PlacementAct id={id} view={view} />}
      {view.act === 'battle' && <BattleAct view={view} />}
      {view.act === 'finish' && <FinishAct view={view} />}
    </Shell>
  );
}

// ───────────────────────────── placement 幕 ─────────────────────────────

/**
 * placement 幕:phase Created。两条路——
 *   myIdx===0(我是 P0,等 P1):PostLockPanel(从 storage 还原棋盘 + 导出 + 等待)。
 *   否则(非 P0、p1 尚空):join 模式布阵。
 */
function PlacementAct({ id, view }: { id: number; view: GameView }) {
  if (view.myIdx === 0) return <P0Waiting id={id} />;
  return <JoinPlacement id={id} />;
}

/** P0 等待对手:从 storage 还原本局棋盘 → PostLockPanel;缺失则最小提示 + 等待文案(完整恢复是 3.8)。 */
function P0Waiting({ id }: { id: number }) {
  const { address } = useAccount();
  const [deployment, setDeployment] = useState<Deployment | null>(null);
  const [record, setRecord] = useState<BoardRecord | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let alive = true;
    void loadDeployment()
      .then((d) => {
        if (!alive) return;
        setDeployment(d);
        if (address) setRecord(loadBoard(d.chainId, d.battleship, id, address));
      })
      .catch(() => {})
      .finally(() => {
        if (alive) setLoaded(true);
      });
    return () => {
      alive = false;
    };
  }, [id, address]);

  // 还没读完 storage / deployment:轻提示(极短,本地同步读 localStorage 通常瞬间完成)。
  if (!loaded) {
    return (
      <div className="flex items-center gap-3 border border-grid bg-console px-4 py-6">
        <Spinner />
        <p className="font-mono text-sm text-phosphor">读取本地棋盘…</p>
      </div>
    );
  }

  // 棋盘在本地 → 完整 PostLockPanel(上锁盘 + 导出 + 等待)。
  if (deployment && record && address) {
    return (
      <PostLockPanel
        board={record.ships as Board}
        salt={record.salt}
        commitment={record.commitment}
        gameId={BigInt(id)}
        address={address}
        chainId={deployment.chainId}
        contract={deployment.battleship}
      />
    );
  }

  // 棋盘缺失(换浏览器 / 清过存储):最小提示 + 等待文案(完整持久化横幅 + 导入恢复是 3.8)。
  return (
    <div className="space-y-3" data-testid="p0-waiting-no-board">
      <div className="border border-grid bg-console px-4 py-4">
        <p className="font-mono text-sm text-phosphor">声呐搜索对手中…</p>
        <p className="mt-1 font-mono text-xs text-foam">
          把对局编号 <span className="font-bold text-flare">#{id}</span> 发给你的对手。
        </p>
      </div>
      <p className="font-mono text-xs text-mist" data-testid="board-missing-note">
        本地棋盘缺失,无法展示布局(完整恢复 / 导入备份见结算前的持久化提示)。
      </p>
    </div>
  );
}

/**
 * join 模式布阵:非 P0 的已连账户(p1 尚空)布阵后 joinGame。复用布阵幕全套原语 + useLockFleet(join)。
 * join 成功后**不**本页跳转——合约 phase 转 AwaitingAttack,useGame 的 watch 收到 GameJoined → refetch →
 * view.act 自动变 battle,本页自然切到对战幕(§7.1 相位驱动)。
 */
function JoinPlacement({ id }: { id: number }) {
  const { isConnected } = useAccount();
  const { status, lockFleet, reset } = useLockFleet();
  const [state, rawDispatch] = useReducer(placementReducer, undefined, initialPlacement);

  const busy = status.phase === 'proving' || status.phase === 'sending' || status.phase === 'confirming';
  const isError = status.phase === 'error';

  // 预热 board 证明工件(同 NewGame:把 zkey 拉取藏在布阵时间后)。
  useEffect(() => {
    void preload('board').catch(() => {});
  }, []);

  function dispatch(action: PlacementAction) {
    if (isError && action.type !== 'hover') reset();
    rawDispatch(action);
  }

  function onLock() {
    if (!allPlaced(state)) return;
    const board = toBoard(state.placed);
    const v = validateFinal(state.placed);
    if (!v.ok) return;
    const salt = randomSalt();
    void lockFleet({ mode: 'join', gameId: BigInt(id), board, salt });
  }

  const ready = allPlaced(state);

  return (
    <section className="space-y-6">
      <div className="space-y-1">
        <h1 className="font-display text-2xl font-bold text-phosphor">加入对局 #{id}</h1>
        <p className="text-sm text-mist">
          部署你的舰队迎战。R 旋转,Esc 取消,点已放置的船可拿回重放。锁定后即开战。
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-[auto_minmax(0,1fr)]">
        <div className="space-y-3">
          <PlacementBoard state={state} dispatch={dispatch} />
        </div>
        <div className="space-y-5">
          <FleetDock
            placed={state.placed}
            carrying={state.carrying}
            onSelect={(shipId) => dispatch({ type: 'carry', shipId })}
            disabled={busy}
          />
          {!ready && (
            <p className="font-mono text-xs text-mist" data-testid="placement-progress">
              已就位 {placedCount(state)} / 5 —— 放满 5 艘后即可锁定舰队加入。
            </p>
          )}
          {ready && (
            <button
              type="button"
              data-testid="lock-fleet"
              onClick={onLock}
              disabled={busy || !isConnected}
              className="border border-phosphor bg-grid px-4 py-2 font-display text-sm font-bold text-phosphor hover:bg-grid/80 disabled:opacity-50"
            >
              {busy ? '锁定中…' : '锁定舰队 · 加入'}
            </button>
          )}
          <ProofStatus status={status} circuit="board" />
          {!isConnected && (
            <p className="font-mono text-xs text-mist">尚未连接账户(demo 应自动连接 P0/P1)。</p>
          )}
        </div>
      </div>
    </section>
  );
}

// ───────────────────────────── battle 幕(3.6 最小占位,真实派生)─────────────────────────────

/**
 * battle 幕最小占位(3.7 实现完整对战幕)。**渲染真实派生状态**证明 useGame 正确喂战斗态:
 * 轮到谁(isMyTurn + phase 推 4 态文案)、双方被命中数、pending 坐标、双方炮击数、对手短地址。
 * 3.7 在原位替换为己方海域 + 敌方声呐屏 + 准星 + 自动应答。
 */
function BattleAct({ view }: { view: GameView }) {
  const turnLabel = whoseTurnLabel(view);
  return (
    <section className="space-y-5" data-testid="battle-act">
      <div className="flex items-center justify-between">
        <h1 className="font-display text-2xl font-bold text-phosphor">对战中</h1>
        <span className="border border-grid px-2 py-0.5 font-mono text-[11px] text-mist">
          对战 · Task 3.7 实现
        </span>
      </div>

      {/* 回合横幅(真实派生:isMyTurn × phase) */}
      <div
        className="border border-phosphor/40 bg-abyss px-4 py-3"
        data-testid="turn-banner"
        data-my-turn={view.isMyTurn ? '1' : '0'}
      >
        <p className="font-mono text-sm text-phosphor">{turnLabel}</p>
      </div>

      {/* 命中盘(§4:17 命中即败;hits[i]=玩家 i 被命中) */}
      <div className="grid gap-3 sm:grid-cols-2">
        <Stat label="我方战损(被命中)" value={`${view.myHits ?? '—'} / 17`} testid="my-hits" />
        <Stat label="对手战损(被命中)" value={`${view.opponentHits ?? '—'} / 17`} testid="opp-hits" />
      </div>

      {/* 炮击计数 + pending + 对手 */}
      <dl className="space-y-2 border border-grid bg-console px-4 py-3 font-mono text-xs">
        <Row k="我方开炮数">{view.myShots.length}</Row>
        <Row k="对手开炮数">{view.enemyShots.length}</Row>
        <Row k="待应答炮击">
          {view.pendingShot
            ? `${view.pendingShot.coord}（${view.pendingShotIsForMe ? '待我应答' : '待对手应答'}）`
            : '—'}
        </Row>
        <Row k="对手">{view.opponent ? shortAddr(view.opponent) : '—'}</Row>
        <Row k="我的视角">{view.myIdx === 0 ? 'P0' : view.myIdx === 1 ? 'P1' : '旁观'}</Row>
      </dl>

      <BackToLobby className="inline-block" />
    </section>
  );
}

/** 回合文案(真实派生,§4.2 义务方):4 态——我开炮 / 等对手开炮 / 我应答 / 对手应答中。 */
function whoseTurnLabel(view: GameView): string {
  if (!view.isPlayer) {
    // 旁观:按 phase + turn 客观描述,不用「你」。
    const who = view.obligatedIdx === 0 ? 'P0' : 'P1';
    return view.phase === Phase.AwaitingResponse ? `等待 ${who} 应答` : `等待 ${who} 开炮`;
  }
  if (view.phase === Phase.AwaitingResponse) {
    return view.pendingShotIsForMe ? '轮到你应答（对手已开炮）' : '对手应答中…';
  }
  // AwaitingAttack
  return view.isMyTurn ? '轮到你开炮' : '等待对手开炮';
}

// ───────────────────────────── finish 幕(3.6 最小占位)─────────────────────────────

/** finish 幕最小占位(3.8 实现完整结算幕 + 持久化闭环)。 */
function FinishAct({ view }: { view: GameView }) {
  const outcome = view.isCancelled
    ? '对局已取消'
    : view.iWon
      ? '你赢了'
      : view.isPlayer
        ? '对手获胜'
        : view.winner
          ? `${shortAddr(view.winner)} 获胜`
          : '对局结束';
  return (
    <section className="space-y-5" data-testid="finish-act">
      <div className="flex items-center justify-between">
        <h1 className="font-display text-2xl font-bold text-phosphor">对局结束</h1>
        <span className="border border-grid px-2 py-0.5 font-mono text-[11px] text-mist">
          结算 · Task 3.8 实现
        </span>
      </div>
      <div className="border border-phosphor/40 bg-abyss px-4 py-6" data-testid="outcome">
        <p className="font-display text-xl text-phosphor">{outcome}</p>
        <p className="mt-2 font-mono text-xs text-mist">
          我方战损 {view.myHits ?? '—'} / 17 · 对手战损 {view.opponentHits ?? '—'} / 17
        </p>
      </div>
      <BackToLobby className="inline-block" />
    </section>
  );
}

// ───────────────────────────── 共用小件 ─────────────────────────────

/** 外壳:标题（带可选 #id）+ 内容。三幕/状态共用同一外框。 */
function Shell({ gameId, children }: { gameId?: string; children: ReactNode }) {
  return (
    <section className="space-y-4">
      {gameId !== undefined && (
        <p className="font-mono text-xs text-mist" data-testid="game-id-label">
          对局 #{gameId}
        </p>
      )}
      {children}
    </section>
  );
}

function BackToLobby({ className = '' }: { className?: string }) {
  return (
    <Link to="/" className={`font-mono text-xs text-phosphor underline ${className}`} data-testid="back-to-lobby">
      ← 返回大厅
    </Link>
  );
}

function Spinner() {
  return (
    <span
      aria-hidden
      className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-phosphor border-t-transparent"
    />
  );
}

function Stat({ label, value, testid }: { label: string; value: string; testid?: string }) {
  return (
    <div className="border border-grid bg-console px-4 py-3" data-testid={testid}>
      <p className="text-xs text-mist">{label}</p>
      <p className="mt-1 font-mono text-lg font-bold text-phosphor">{value}</p>
    </div>
  );
}

function Row({ k, children }: { k: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between">
      <dt className="text-mist">{k}</dt>
      <dd className="text-foam">{children}</dd>
    </div>
  );
}
