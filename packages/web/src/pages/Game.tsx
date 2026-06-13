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
import { loadDeployment, type Address, type Deployment } from '../lib/contracts.ts';
import { loadBoard, type BoardRecord } from '../lib/storage.ts';
import type { Board } from '../lib/boardLogic.ts';
import { randomSalt } from '../lib/salt.ts';
import { Phase, type GameView } from '../hooks/gameView.ts';
import { useGame } from '../hooks/useGame.ts';
import type { GameLogEntry } from '../hooks/useGame.ts';
import { useLockFleet } from '../hooks/useLockFleet.ts';
import { preload } from '../hooks/useProver.ts';
import { useAutoRespond } from '../hooks/useAutoRespond.ts';
import { useClaimTimeout } from '../hooks/useClaimTimeout.ts';
import { useCountdown } from '../hooks/useCountdown.ts';
import ProofStatus from '../components/ProofStatus.tsx';
import PostLockPanel from '../components/PostLockPanel.tsx';
import TurnBanner from '../components/TurnBanner.tsx';
import HitProgress from '../components/HitProgress.tsx';
import EventLog from '../components/EventLog.tsx';
import FleetDock from '../components/board/FleetDock.tsx';
import PlacementBoard from '../components/board/PlacementBoard.tsx';
import OwnBoard from '../components/board/OwnBoard.tsx';
import SonarBoard from '../components/board/SonarBoard.tsx';
import { cellIdx } from '../components/board/battleMarks.ts';
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
  const { view, eventLog, isLoading, isNotFound, error } = useGame(id);

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
      {view.act === 'battle' && <BattleAct id={id} view={view} eventLog={eventLog} />}
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

// ───────────────────────────── battle 幕(3.7 完整对战幕)─────────────────────────────

/**
 * battle 幕(对战,§7.3):左己方海域 / 右敌方声呐屏 / 中缝回合横幅 + 双方命中进度 + 事件日志 +
 * 证明状态 + claimTimeout。我方回合在声呐屏点击开炮(+ 准星);对手回合**自动**应答(useAutoRespond);
 * 倒计时归零且我是非义务方 → 出「认领超时胜利」按钮。整页随 useGame watch 实时刷新,无手动刷新。
 *
 * 数据组织:
 *   - 我的棋盘从 storage 还原一次(loadDeployment + loadBoard),同源喂 OwnBoard(画轮廓)与
 *     useAutoRespond(出证明所需);缺失则 OwnBoard 不画轮廓、useAutoRespond 大声阻断(§8)。
 *   - pending 拆向:我是 attacker 的 pending → SonarBoard 的 chainPendingOutCell(待对手应答的我方出炮);
 *     我是 defender 的 pending → OwnBoard 的 pendingInCell(来袭,自动应答中)。
 *   - 旁观(myIdx==='observer'):双盘客观只读(无「你」语、不可交互、无自动应答 / 开炮 / claim)。
 */
function BattleAct({
  id,
  view,
  eventLog,
}: {
  id: number;
  view: GameView;
  eventLog: GameLogEntry[];
}) {
  const { address } = useAccount();
  const isPlayer = view.isPlayer;

  // 部署 + 我的棋盘(玩家才读;旁观无「我的棋盘」)。loadBoard 同步读 localStorage,deployment 异步一次。
  const [deployment, setDeployment] = useState<Deployment | null>(null);
  const [myBoard, setMyBoard] = useState<Board | null>(null);
  // 棋盘是否已读完(deployment 取到 + loadBoard 跑过)。用于「本地棋盘缺失」提示只在读完后显示,
  // 不在 deployment 异步加载期间(myBoard 暂为 null)闪一下误报。
  const [boardLoaded, setBoardLoaded] = useState(false);

  useEffect(() => {
    let alive = true;
    setBoardLoaded(false);
    void loadDeployment()
      .then((d) => {
        if (!alive) return;
        setDeployment(d);
        if (isPlayer && address) {
          const rec = loadBoard(d.chainId, d.battleship, id, address);
          setMyBoard(rec ? (rec.ships as Board) : null);
        } else {
          setMyBoard(null);
        }
        setBoardLoaded(true);
      })
      .catch(() => {
        if (alive) setBoardLoaded(true);
      });
    return () => {
      alive = false;
    };
    // address 变(切账户)→ 重读我的棋盘(同一局换立场,棋盘也换;§7.1 视角翻转)。
  }, [id, address, isPlayer]);

  // 预热 shot 证明工件(把 zkey 拉取藏在开战前,自动应答时少等网络)。
  useEffect(() => {
    void preload('shot').catch(() => {});
  }, []);

  // pending 拆向(§4.2:pendingShot.attacker / defender)。
  const pending = view.pendingShot;
  const iAmPendingAttacker =
    pending !== null && isPlayer && view.myIdx === pending.attacker;
  const chainPendingOutCell =
    iAmPendingAttacker && pending ? cellIdx(pending.x, pending.y) : null;
  const pendingInCell =
    pending !== null && view.pendingShotIsForMe ? cellIdx(pending.x, pending.y) : null;

  const isMyAttackTurn = isPlayer && view.phase === Phase.AwaitingAttack && view.isMyTurn;

  return (
    <section className="space-y-4" data-testid="battle-act">
      <div className="flex items-center justify-between">
        <h1 className="font-display text-2xl font-bold text-phosphor">作战室 · #{id}</h1>
        <span className="font-mono text-[11px] text-mist" data-testid="my-perspective">
          {view.myIdx === 0 ? '视角 P0' : view.myIdx === 1 ? '视角 P1' : '旁观'}
          {view.opponent ? ` · 对手 ${shortAddr(view.opponent)}` : ''}
        </span>
      </div>

      {/* 三栏:左己方海域 / 中缝 / 右敌方声呐屏。<1024px 堆叠(己方在下,§7.2)。 */}
      <div className="grid gap-5 lg:grid-cols-[auto_minmax(0,1fr)_auto]">
        {/* 中缝在 <lg 时排在最前(order-first),lg 时回中间(order-none) */}
        <div className="order-first space-y-3 lg:order-2">
          <TurnBanner view={view} />
          <HitProgress
            myHits={view.myHits}
            opponentHits={view.opponentHits}
            p0Label={isPlayer ? undefined : 'P0'}
            p1Label={isPlayer ? undefined : 'P1'}
          />
          {isPlayer && (
            <BattleStatus
              view={view}
              gameId={BigInt(id)}
              contract={deployment?.battleship}
              chainId={deployment?.chainId}
              address={address}
            />
          )}
          <EventLog entries={eventLog} myIdx={view.myIdx} />
        </div>

        {/* 左:己方海域(被打记录)。lg 时 order-1。 */}
        <div className="space-y-2 lg:order-1">
          <h2 className="font-mono text-xs uppercase tracking-wide text-mist">己方海域</h2>
          <OwnBoard board={myBoard} enemyShots={view.enemyShots} pendingInCell={pendingInCell} />
          {isPlayer && boardLoaded && myBoard === null && (
            <p className="max-w-[20rem] font-mono text-[11px] text-flare" data-testid="own-board-missing">
              本地棋盘缺失,无法显示己方布局(来袭与命中标记仍据链上显示)。若轮到你应答将无法生成证明,请导入部署文件。
            </p>
          )}
        </div>

        {/* 右:敌方声呐屏(我的炮击记录 + 开炮)。lg 时 order-3。 */}
        <div className="space-y-2 lg:order-3">
          <h2 className="font-mono text-xs uppercase tracking-wide text-mist">敌方海域</h2>
          <SonarBoard
            gameId={BigInt(id)}
            contract={(deployment?.battleship ?? '0x0000000000000000000000000000000000000000') as Address}
            myShots={view.myShots}
            myFiredCells={view.myFiredCells}
            chainPendingOutCell={chainPendingOutCell}
            // 部署未就绪时不放行点击(避免对 0x0 发交易);就绪后才允许我方攻击回合交互。
            isMyAttackTurn={isMyAttackTurn && deployment !== null}
          />
        </div>
      </div>

      <BackToLobby className="inline-block" />
    </section>
  );
}

/**
 * 中缝战斗状态条:自动应答状态(ProofStatus shot 电路)+ 开炮链上确认 + 倒计时 + claimTimeout +
 * §8 棋盘缺失阻断横幅。只玩家渲染(旁观无这些动作)。
 */
function BattleStatus({
  view,
  gameId,
  contract,
  chainId,
  address,
}: {
  view: GameView;
  gameId: bigint;
  contract: Address | undefined;
  chainId: number | undefined;
  address: Address | undefined;
}) {
  // 自动应答(对手回合,§7.3)。触发只读链上态,§10 重开自动补应答。
  const { status: respondStatus, respondingCoord } = useAutoRespond({
    view,
    gameId,
    contract,
    chainId,
    address,
  });

  // claimTimeout(§4.3):义务方超时 + 我是非义务方玩家 → 可认领。
  const { status: claimStatus, claim } = useClaimTimeout();

  // 倒计时(§4.3 TIMEOUT=300):仅对战且有义务方时计时。
  const hasObligation = view.obligatedIdx !== null;
  const { label: timeLabel, expired } = useCountdown({
    lastActionAt: view.lastActionAt,
    active: hasObligation,
  });

  // 我是否非义务方玩家(claimant):义务方负有行动义务、不能认领自己超时(§4.3 + §10)。
  const iAmObligated =
    (view.myIdx === 0 || view.myIdx === 1) && view.obligatedIdx === view.myIdx;
  const iAmClaimant = view.isPlayer && hasObligation && !iAmObligated;
  // 按钮可见:我是 claimant 且已超时(前端近似;点了由合约最终裁决,见 useCountdown 注释)。
  const canClaim = iAmClaimant && expired;

  return (
    <div className="space-y-2" data-testid="battle-status">
      {/* 倒计时:展示义务方剩余时间(我方义务 → 我的倒数;对手义务 → 对手的倒数)。 */}
      {hasObligation && (
        <div className="flex items-center justify-between border border-grid bg-console px-3 py-1.5">
          <span className="font-mono text-[11px] text-mist">
            {iAmObligated ? '你的行动倒计时' : '对手行动倒计时'}
          </span>
          <span
            className={'font-mono text-sm font-bold ' + (expired ? 'text-flare' : 'text-phosphor')}
            data-testid="countdown"
            data-expired={expired ? '1' : '0'}
          >
            {expired ? '00:00' : timeLabel}
          </span>
        </div>
      )}

      {/* §8 棋盘缺失 / 承诺不符:大声阻断横幅(绝不静默弃权)。 */}
      {respondStatus.phase === 'blocked' && (
        <div
          className="border border-flare bg-abyss px-3 py-2"
          data-testid="autorespond-blocked"
          role="alert"
        >
          <p className="font-mono text-xs text-flare">⚠ {respondStatus.message}</p>
        </div>
      )}

      {/* 自动应答状态(shot 证明 + 链上确认,§7.5 两阶段);proving 文案带坐标。 */}
      {respondStatus.phase !== 'idle' && respondStatus.phase !== 'blocked' && (
        <ProofStatus
          status={respondStatus}
          circuit="shot"
          provingLabel={`正在应答${respondingCoord ? ` ${respondingCoord}` : ''}的炮击…`}
          doneLabel={`已应答${respondingCoord ? ` ${respondingCoord}` : ''}`}
        />
      )}

      {/* 认领超时胜利按钮(§7.6 动词):仅 claimant 且已超时可见可点;--flare 提示(呼吸是 M4)。 */}
      {canClaim && contract && (
        <button
          type="button"
          data-testid="claim-timeout"
          onClick={() => void claim(gameId, contract)}
          disabled={claimStatus.phase === 'sending' || claimStatus.phase === 'confirming'}
          className="w-full border border-flare bg-flare/10 px-3 py-2 font-display text-sm font-bold text-flare hover:bg-flare/20 disabled:opacity-50"
        >
          {claimStatus.phase === 'sending' || claimStatus.phase === 'confirming'
            ? '认领中…'
            : '认领超时胜利'}
        </button>
      )}
      {claimStatus.phase === 'error' && (
        <p className="font-mono text-[11px] text-flare" data-testid="claim-error">
          {claimStatus.message}
        </p>
      )}
    </div>
  );
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

