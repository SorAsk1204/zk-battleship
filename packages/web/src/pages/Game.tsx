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
import { useEffect, useReducer, useRef, useState, type ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useAccount } from 'wagmi';
import { shortAddr } from '../lib/format.ts';
import { loadDeployment, type Address, type Deployment } from '../lib/contracts.ts';
import { loadBoard, removeBoard, type BoardRecord } from '../lib/storage.ts';
import type { Board } from '../lib/boardLogic.ts';
import { randomSalt } from '../lib/salt.ts';
import { Phase, type GameView } from '../hooks/gameView.ts';
import { useGame } from '../hooks/useGame.ts';
import type { GameLogEntry } from '../hooks/useGame.ts';
import { useReducedMotion } from '../hooks/useReducedMotion.ts';
import { finishSweepKind } from './finishSweep.ts';
import { useLockFleet } from '../hooks/useLockFleet.ts';
import { preload } from '../hooks/useProver.ts';
import { useAutoRespond } from '../hooks/useAutoRespond.ts';
import { useClaimTimeout } from '../hooks/useClaimTimeout.ts';
import { useCountdown } from '../hooks/useCountdown.ts';
import ProofStatus from '../components/ProofStatus.tsx';
import PostLockPanel from '../components/PostLockPanel.tsx';
import PersistenceBanner from '../components/PersistenceBanner.tsx';
import TurnBanner from '../components/TurnBanner.tsx';
import HitProgress from '../components/HitProgress.tsx';
import EventLog from '../components/EventLog.tsx';
import FleetDock from '../components/board/FleetDock.tsx';
import PlacementBoard from '../components/board/PlacementBoard.tsx';
import OwnBoard from '../components/board/OwnBoard.tsx';
import SonarBoard from '../components/board/SonarBoard.tsx';
import { cellIdx } from '../components/board/battleMarks.ts';
import {
  computeBattleReport,
  formatDuration,
  formatRate,
  reasonText,
} from './battleReport.ts';
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
      {view.act === 'finish' && <FinishAct id={id} view={view} eventLog={eventLog} />}
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
  if (view.myIdx === 0) return <P0Waiting id={id} view={view} />;
  return <JoinPlacement id={id} />;
}

/**
 * P0 等待对手:从 storage 还原本局棋盘 → PostLockPanel;缺失 / 承诺不符 → PersistenceBanner(§8 守卫
 * + 导入恢复,3.8)+ 等待文案。导入成功(onImported)→ reloadVersion+1 重读棋盘 → 立刻显出上锁盘。
 */
function P0Waiting({ id, view }: { id: number; view: GameView }) {
  const { address } = useAccount();
  const [deployment, setDeployment] = useState<Deployment | null>(null);
  const [record, setRecord] = useState<BoardRecord | null>(null);
  const [loaded, setLoaded] = useState(false);
  // 导入恢复后重读 storage 的版本号(PersistenceBanner.onImported 触发)。
  const [reloadVersion, setReloadVersion] = useState(0);

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
  }, [id, address, reloadVersion]);

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

  // 棋盘缺失(换浏览器 / 清过存储):§8 持久化横幅(导入恢复)+ 等待文案。
  return (
    <div className="space-y-3" data-testid="p0-waiting-no-board">
      {deployment && address && (
        <PersistenceBanner
          chainId={deployment.chainId}
          contract={deployment.battleship}
          gameId={BigInt(id)}
          address={address}
          myCommitment={view.myCommitment}
          onImported={() => setReloadVersion((v) => v + 1)}
        />
      )}
      <div className="border border-grid bg-console px-4 py-4">
        <p className="font-mono text-sm text-phosphor">声呐搜索对手中…</p>
        <p className="mt-1 font-mono text-xs text-foam">
          把对局编号 <span className="font-bold text-flare">#{id}</span> 发给你的对手。
        </p>
      </div>
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
  // 导入恢复后重读 storage 的版本号(PersistenceBanner.onImported 触发):导入棋盘 → 重读 → OwnBoard 立刻显出布局
  // (同时 useAutoRespond 经 clearInFlight 的 re-fire 信号自动补应答,无需重载)。
  const [boardReloadVersion, setBoardReloadVersion] = useState(0);

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
    // boardReloadVersion 变(导入恢复)→ 重读(显出刚导入的棋盘)。
  }, [id, address, isPlayer, boardReloadVersion]);

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
      {/* §8 持久化守卫:玩家本地棋盘缺失 / 与链上承诺不符 → 顶部横幅 + 导入恢复。导入成功 → 重读棋盘
          (OwnBoard 显出布局)+ clearInFlight 让欠的应答自动 re-fire(无需重载,3.7 Rec 1 闭环)。
          只玩家挂(myCommitment 有值才守卫;旁观 myCommitment undefined → 横幅自隐)。 */}
      {isPlayer && deployment && address && (
        <PersistenceBanner
          chainId={deployment.chainId}
          contract={deployment.battleship}
          gameId={BigInt(id)}
          address={address}
          myCommitment={view.myCommitment}
          onImported={() => setBoardReloadVersion((v) => v + 1)}
        />
      )}

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
          <OwnBoard
            board={myBoard}
            enemyShots={view.enemyShots}
            pendingInCell={pendingInCell}
            // §7.1 账户切换零 RPC 翻视角时 OwnBoard 不重挂、只换成对方的标记;perspectiveKey=观者身份,
            // 用作 ShotBurst 的 React key,使切换那刻 ShotBurst 重挂、以新视角标记重播种 seen → 不乱闪
            // (切换后真正的新应答仍正常弹)。?? 'none' 兜断连。
            perspectiveKey={address ?? 'none'}
          />
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
            // 见 OwnBoard 同名 prop:观者身份,作 ShotBurst 的 key,切账户翻视角时只重挂 ShotBurst 重播种
            // seen(SonarSweep/SonarAfterglow/BoardGrid 焦点不动),消除切换那刻的虚假爆发。
            perspectiveKey={address ?? 'none'}
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

      {/* 自动应答状态(shot 证明 + 链上确认,§7.5 两阶段);proving 文案带坐标。
          progress(proving/sending/confirming)+ done 内联展示(§7.5 两阶段进度必须可见);
          **error 不在此内联**(toast-only,见 useAutoRespond.catch → useToast),避免与 toast 双重呈现;
          **blocked 也不在此**(顶部常驻横幅 + PersistenceBanner 承载,见上)。 */}
      {(respondStatus.phase === 'proving' ||
        respondStatus.phase === 'sending' ||
        respondStatus.phase === 'confirming' ||
        respondStatus.phase === 'done') && (
        <ProofStatus
          status={respondStatus}
          circuit="shot"
          provingLabel={`正在应答${respondingCoord ? ` ${respondingCoord}` : ''}的炮击…`}
          doneLabel={`已应答${respondingCoord ? ` ${respondingCoord}` : ''}`}
        />
      )}

      {/* 认领超时胜利按钮(§7.6 动词):仅 claimant 且已超时可见可点;--flare 提示(呼吸是 M4)。
          认领失败(NOT_TIMEOUT/NOT_CLAIMANT)经页内 Toast 呈现(useClaimTimeout → useToast),
          按钮下不再挂常驻红字。 */}
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
    </div>
  );
}

// ───────────────────────────── finish 幕(3.8 完整结算幕)─────────────────────────────

/**
 * 结算「扫屏」WAAPI 关键帧(M4.2b,§7.3:胜=整屏一次 --phosphor 扫亮;负=整屏短暂染 --flare 后熄灭
 * 为低亮度)。结算幕无声呐棋盘,「整屏」= outcome 面板自身。只动 opacity/filter(drop-shadow/brightness),
 * 合成层友好(§7.4);末态恒为可读稳定态(胜回正常亮度、负落 0.9 低亮度,文字始终清晰)。reduced-motion
 * 时**不**创建动画(useReducedMotion gate),面板即时呈现静态 accent 色(§7.4 保留颜色反馈)。
 */
const FINISH_SWEEP_MS = 720;

/** 胜:一次磷光提亮(亮度拉高 + 磷光 drop-shadow 涌起)后落回常态(末帧 = identity,稳定可读)。 */
const SWEEP_PHOSPHOR_KEYFRAMES: Keyframe[] = [
  { offset: 0, filter: 'brightness(1) drop-shadow(0 0 0 rgba(53,224,200,0))' },
  {
    offset: 0.4,
    filter: 'brightness(1.35) drop-shadow(0 0 14px rgba(53,224,200,0.55))',
  },
  { offset: 1, filter: 'brightness(1) drop-shadow(0 0 0 rgba(53,224,200,0))' },
];

/** 负:整屏短暂染 --flare(亮度涌起 + 橙 drop-shadow)后**熄灭为低亮度**(末帧 brightness 0.9,fill 持留)。 */
const SWEEP_FLARE_KEYFRAMES: Keyframe[] = [
  { offset: 0, filter: 'brightness(1) drop-shadow(0 0 0 rgba(255,122,69,0))' },
  {
    offset: 0.25,
    filter: 'brightness(1.3) drop-shadow(0 0 16px rgba(255,122,69,0.7))',
  },
  { offset: 1, filter: 'brightness(0.9) drop-shadow(0 0 0 rgba(255,122,69,0))' },
];

/**
 * finish 幕(结算,§7.3:展示战报[总回合、命中率、用时] + 「再来一局」回到大厅)。
 *
 * 战报全部从 eventLog + view 派生(computeBattleReport,纯函数已单测;无新链上读、无新乐观态)。
 * outcome 色 accent(胜 --phosphor / 负 --flare / 取消 --mist)+ §7.3 结算扫屏(M4.2b):进结算挂载即对
 * outcome 面板放一次扫屏——胜=磷光提亮扫亮、负=染 --flare 后熄灭为低亮度、取消=不扫(见下 sweepKind
 * + useEffect;reduced-motion 退化为静态 accent)。
 *
 * 存储清理(§8「Finished 后该键可清理」):进 finish 即清掉**我自己**这局的正式键(removeBoard,
 * 只清我的、不碰对手的)。时机选「进 finish 一次」而非「点再来一局」——一进结算棋盘就不再需要(应答
 * 阶段已过),且若复用同一 gameId 的下一局误读到陈旧棋盘会出错(3.4/3.5 的 stale-cross-session 教训)。
 * 故结算幕**不**展示己方盘、**不**挂 PersistenceBanner(棋盘已主动清,挂了反而恒报缺失自相矛盾);
 * 只呈现战报(战报不依赖棋盘 ships/salt,只依赖事件 + 链上 hits)。
 */
function FinishAct({ id, view, eventLog }: { id: number; view: GameView; eventLog: GameLogEntry[] }) {
  const { address } = useAccount();
  const navigate = useNavigate();
  const report = computeBattleReport(eventLog, view);
  const isPlayer = view.isPlayer;
  const reduced = useReducedMotion();
  // 结算扫屏的目标元素(outcome 面板 = 结算幕的「整屏」,因无声呐棋盘)。
  const outcomeRef = useRef<HTMLDivElement | null>(null);

  // 进 finish 一次:清掉我自己这局的棋盘键(§8;只我的、不碰对手)。deployment 异步取到 + 我是玩家才清。
  // 依赖 [id, address]:换账户(切到另一玩家视角)也各自清自己的键。observer 不清(没有「我的键」)。
  useEffect(() => {
    if (!isPlayer || !address) return;
    let alive = true;
    void loadDeployment()
      .then((d) => {
        if (!alive) return;
        removeBoard(d.chainId, d.battleship, id, address);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [id, address, isPlayer]);

  // outcome 文案 + accent 色(§7.3 胜/负/取消)。
  const outcome = view.isCancelled
    ? { headline: '对局已取消', accent: 'mist' as const }
    : view.iWon
      ? { headline: '你赢了', accent: 'phosphor' as const }
      : isPlayer
        ? { headline: '对手获胜', accent: 'flare' as const }
        : {
            headline: view.winner ? `对局结束 · 胜者 ${shortAddr(view.winner)}` : '对局结束',
            accent: 'phosphor' as const,
          };

  // 结算扫屏(M4.2b,§7.3 胜=磷光扫亮 / 负=染 --flare 后熄灭为低亮度)。outcome.accent 经 finishSweepKind
  // 映成扫屏种类(纯映射已单测);胜→phosphor 关键帧、负→flare 关键帧(fill:forwards 持留低亮末态)、
  // 取消(mist)→不扫。进结算挂载即播一次(finished 的 accent 稳定,deps 实质只在 reduced 切换时复跑)。
  // reduced-motion:不创建动画(§7.4),面板即时呈现静态 accent 色;false→true 实时切换时 cancel 在飞动画。
  const sweepKind = finishSweepKind(outcome.accent);
  useEffect(() => {
    const el = outcomeRef.current;
    if (!el) return;
    if (reduced || sweepKind === 'none') return; // reduce / 取消:不扫屏(静态 accent 已表意)
    const keyframes = sweepKind === 'flare' ? SWEEP_FLARE_KEYFRAMES : SWEEP_PHOSPHOR_KEYFRAMES;
    // willChange 只在扫屏进行时挂(本仓惯例:hint 跟随实际动画;扫屏是一次性的,常驻会白占合成层)。
    el.style.willChange = 'filter';
    const anim = el.animate(keyframes, {
      duration: FINISH_SWEEP_MS,
      easing: 'cubic-bezier(0.2, 0.7, 0.3, 1)',
      // 负:末帧为低亮度(brightness 0.9),用 forwards 持留(§7.3「熄灭为低亮度」);
      // 胜:末帧 = identity(常态亮度),无需持留(默认 fill 即落回常态)。
      fill: sweepKind === 'flare' ? 'forwards' : 'none',
    });
    const clearHint = () => {
      el.style.willChange = '';
    };
    anim.onfinish = clearHint; // 播完即清 hint(forwards 持留的低亮末态由 fill 维持,与 hint 无关)
    return () => {
      anim.cancel();
      clearHint();
    };
  }, [reduced, sweepKind]);

  // reason 人话(视角相关:胜/负措辞不同;observer 客观)。iWon 对玩家给 true/false,observer 给 undefined。
  // cancelled 时 headline 已是「对局已取消」,reasonText('cancelled') 同文,故取消态不再重复显示 reason。
  const iWonArg = isPlayer ? view.iWon : undefined;
  const reason = view.isCancelled ? '' : reasonText(report.finishReason, iWonArg);

  // accent → 边框/标题色 class(锁定调色板,直角 §7.2)。
  const accentBorder =
    outcome.accent === 'phosphor'
      ? 'border-phosphor/60'
      : outcome.accent === 'flare'
        ? 'border-flare/60'
        : 'border-mist/40';
  const accentText =
    outcome.accent === 'phosphor'
      ? 'text-phosphor'
      : outcome.accent === 'flare'
        ? 'text-flare'
        : 'text-mist';

  return (
    <section className="space-y-5" data-testid="finish-act">
      <div className="flex items-center justify-between">
        <h1 className="font-display text-2xl font-bold text-phosphor">作战结算 · #{id}</h1>
        <span className="font-mono text-[11px] text-mist" data-testid="my-perspective">
          {view.myIdx === 0 ? '视角 P0' : view.myIdx === 1 ? '视角 P1' : '旁观'}
        </span>
      </div>

      {/* outcome 头条 + reason。outcomeRef = 结算扫屏的「整屏」目标(M4.2b;胜磷光扫亮 / 负染橙熄灭,
          见上 useEffect。willChange 由该 effect 在扫屏进行时临时挂、播完/卸载即清,不常驻)。 */}
      <div
        ref={outcomeRef}
        className={`border ${accentBorder} bg-abyss px-5 py-6`}
        data-testid="outcome"
      >
        <p className={`font-display text-2xl font-bold ${accentText}`} data-accent={outcome.accent}>
          {outcome.headline}
        </p>
        {reason && <p className="mt-1 font-mono text-xs text-mist" data-testid="outcome-reason">{reason}</p>}
      </div>

      {/* 战报:总回合 / 用时 / 命中率(双方,视角相对)+ 双方最终战损(HitProgress 复用)。 */}
      <div className="space-y-4" data-testid="battle-report">
        <h2 className="font-mono text-xs uppercase tracking-wide text-mist">战报</h2>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <Stat label="总回合" value={String(report.rounds)} testid="stat-rounds" />
          <Stat label="用时" value={formatDuration(report.durationSec)} testid="stat-duration" />
          <Stat
            label={isPlayer ? '我方命中率' : 'P0 命中率'}
            value={formatRate(report.mine.rate)}
            sub={`${report.mine.hits}/${report.mine.fired}`}
            testid="stat-my-rate"
          />
          <Stat
            label={isPlayer ? '对手命中率' : 'P1 命中率'}
            value={formatRate(report.opponent.rate)}
            sub={`${report.opponent.hits}/${report.opponent.fired}`}
            testid="stat-opp-rate"
          />
        </div>

        {/* 双方最终战损(0–17;复用对战幕 HitProgress)。observer 用 P0/P1 标签。 */}
        <HitProgress
          myHits={report.myHits}
          opponentHits={report.opponentHits}
          p0Label={isPlayer ? undefined : 'P0'}
          p1Label={isPlayer ? undefined : 'P1'}
        />

        {/* 逐条作战记录(复用 EventLog;结算回看整局流水)。 */}
        <EventLog entries={eventLog} myIdx={view.myIdx} />
      </div>

      {/* 「再来一局」→ 回大厅(§7.3)。存储清理已在进 finish 时做(见上 effect),此处只导航。 */}
      <div className="flex items-center gap-4">
        <button
          type="button"
          data-testid="play-again"
          onClick={() => navigate('/')}
          className="border border-phosphor bg-grid px-4 py-2 font-display text-sm font-bold text-phosphor hover:bg-grid/80"
        >
          再来一局
        </button>
        <BackToLobby />
      </div>
    </section>
  );
}

/** 单个统计块(font-mono 数字 + 标签 + 可选副值)。结算战报用,直角 1px 边框(§7.2)。 */
function Stat({
  label,
  value,
  sub,
  testid,
}: {
  label: string;
  value: string;
  sub?: string;
  testid: string;
}) {
  return (
    <div className="border border-grid bg-console px-3 py-2" data-testid={testid}>
      <p className="font-mono text-[10px] uppercase tracking-wide text-mist">{label}</p>
      <p className="mt-0.5 font-mono text-xl font-bold text-foam">{value}</p>
      {sub && <p className="font-mono text-[10px] text-mist">{sub}</p>}
    </div>
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

