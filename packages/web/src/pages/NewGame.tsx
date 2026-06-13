/**
 * NewGame —— 布阵幕 create 模式(路由 /game/new,Design §7.3)。
 *
 * Task 3.5 把 3.4 的临时固定布局**换成真实布阵交互**:船坞点选 → 棋盘预览(随鼠标/键盘焦点)→
 * R 旋转 / Esc 取消 / 非法整船染 --flare → 落子 → 已放置可拿回。5 船全部就位后出现唯一主按钮
 * 「锁定舰队」,复用 3.4 的 useLockFleet(mode:'create')管线(证明 → 交易 → 持久化,未改)。
 *
 * 布阵态(placement.ts 的 useReducer,组件作用域、瞬时):刷新即弃——锁定前不持久化(§8 只在锁定
 * 成功落盘);这是有意的最小面,避免给一处临时交互引全局 store(YAGNI,记 DECISIONS)。
 *
 * 锁定 → 导出 → 等待的信息架构(IA 决策,记 DECISIONS):锁定成功后**留在本页 in-place**,不立即
 * 导航到 /game/:id。因为 3.6 才把 /game/:id 建成相位驱动页;若现在就跳过去,§8 的「导出部署文件」
 * 与 §7.3 的等待态会落在一个还没实现它们的占位页上 = 导出按钮够不到。故 3.5 在本页就地呈现:
 * 棋盘上锁(锁标 + 网格变暗 + 网格维度)+「导出部署文件」(ExportButton,§8 必须可达)+ 等待态
 * 「声呐搜索对手中… 对局编号 #N,把它发给你的对手」(§7.3;声呐动画是 M4,这里静态简版)+ 一个
 * 「进入对局」链接手动去 /game/:id。完整自动切幕在 3.6 收口。
 *
 * 预热(3.4 handoff 建议):进入本幕即 preload('board'),把 8.35MB zkey 拉取藏在布阵时间后,
 * 「锁定舰队」时证明少等网络。仅 demo 构建可锁定(需本地链);非 demo 给行动指引。
 */
import { useEffect, useReducer, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAccount } from 'wagmi';
import type { Board } from '../lib/boardLogic.ts';
import { computeCommitment } from '../lib/commitment.ts';
import { loadDeployment, type Deployment } from '../lib/contracts.ts';
import { randomSalt } from '../lib/salt.ts';
import { IS_DEMO } from '../lib/wagmi.ts';
import { useLockFleet } from '../hooks/useLockFleet.ts';
import { preload } from '../hooks/useProver.ts';
import ProofStatus from '../components/ProofStatus.tsx';
import ExportButton from '../components/ExportButton.tsx';
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

export default function NewGame() {
  const { address, isConnected } = useAccount();
  const { status, lockFleet, reset } = useLockFleet();
  const [state, rawDispatch] = useReducer(placementReducer, undefined, initialPlacement);

  // 锁定成功定格的全部信息(done 后导出/上锁/等待态都要用):board/salt/commitment(本次锁定,
  // 每次新 salt §5.5)+ gameId(done 解析自 GameCreated)。非 null 即「已上锁」。
  const [locked, setLocked] = useState<{
    board: Board;
    salt: bigint;
    commitment: bigint;
    gameId: bigint;
  } | null>(null);
  // 导出需要 chainId/contract;本页单独 load 一次(useLockFleet 内部用的 deployment 不外露)。
  const [deployment, setDeployment] = useState<Deployment | null>(null);

  const busy = status.phase === 'proving' || status.phase === 'sending' || status.phase === 'confirming';
  const isError = status.phase === 'error';

  // 进入布阵幕:预热 board 证明工件(隐藏 zkey 拉取延迟)。失败静默——锁定时会再尝试并把错误显式报出。
  useEffect(() => {
    void preload('board').catch(() => {});
  }, []);

  // demo 下加载部署信息供导出用(失败静默;非 demo 本就不可锁定)。
  useEffect(() => {
    if (!IS_DEMO) return;
    void loadDeployment()
      .then(setDeployment)
      .catch(() => {});
  }, []);

  // 本次锁定尝试定格的 board/salt/commitment(写在发起时,done effect 读取——避免放 state 引起额外渲染)。
  const lockSnapRef = useRef<{ board: Board; salt: bigint; commitment: bigint } | null>(null);

  // 锁定成功:把 done 的 gameId 与定格的 board/salt 组合成上锁态(留在本页,见模块注释 IA 决策)。
  useEffect(() => {
    if (status.phase === 'done') {
      const snap = lockSnapRef.current;
      if (snap) setLocked({ ...snap, gameId: status.gameId });
    }
  }, [status]);

  /**
   * 包装 dispatch:错误态下用户重新编辑布局时,先 reset() 把管线回 idle(任务要求:error 后
   * 用户编辑布局即清错、按钮恢复;pending 键由 useLockFleet 保留供重试)。只对会改动布局的 action 触发。
   */
  function dispatch(action: PlacementAction) {
    if (isError && action.type !== 'hover') reset();
    rawDispatch(action);
  }

  function onLock() {
    if (!allPlaced(state)) return;
    const board = toBoard(state.placed);
    // 锁定前最终总校验(双保险,与电路同判据);理论上 allPlaced 时必合法,防御性拦一道。
    const v = validateFinal(state.placed);
    if (!v.ok) return;
    // 每局新 salt(§5.5:跨局重用同一布船+salt 会泄露上一局棋盘)。
    const salt = randomSalt();
    const commitment = computeCommitment(board, salt);
    lockSnapRef.current = { board, salt, commitment };
    void lockFleet({ mode: 'create', board, salt });
  }

  const ready = allPlaced(state);

  return (
    <section className="space-y-6">
      <div className="space-y-1">
        <h1 className="font-display text-3xl font-bold text-phosphor">部署舰队</h1>
        <p className="text-sm text-mist">
          {locked
            ? '舰队已锁定并上链。对局编号已生成,把它发给对手即可对战。'
            : '从船坞点选舰船,放置到海图上。R 旋转,Esc 取消,点已放置的船可拿回重放。'}
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-[auto_minmax(0,1fr)]">
        {/* 左:棋盘(布阵 / 上锁) */}
        <div className="space-y-3">
          <PlacementBoard state={state} dispatch={dispatch} locked={!!locked} />
          {/* 上锁后的网格维度标注(§7.3:加锁 + 网格维度) */}
          {locked && (
            <p className="flex items-center gap-2 font-mono text-xs text-phosphor" data-testid="locked-banner">
              <span aria-hidden>🔒</span> 已锁定 · 10×10 · 17 占格
            </p>
          )}
        </div>

        {/* 右:船坞 + 主按钮 + 状态 */}
        <div className="space-y-5">
          {!locked && (
            <FleetDock
              placed={state.placed}
              carrying={state.carrying}
              onSelect={(shipId) => dispatch({ type: 'carry', shipId })}
              disabled={busy}
            />
          )}

          {/* 就位进度(未满 5 时给行动指引;§7.6 空状态给指引) */}
          {!locked && !ready && (
            <p className="font-mono text-xs text-mist" data-testid="placement-progress">
              已就位 {placedCount(state)} / 5 —— 放满 5 艘后即可锁定舰队。
            </p>
          )}

          {/* 唯一主按钮「锁定舰队」:5 船就位前隐藏(§7.3 全部就位后出现) */}
          {!locked && ready && (
            <button
              type="button"
              data-testid="lock-fleet"
              onClick={onLock}
              disabled={busy || !isConnected || !IS_DEMO}
              className="border border-phosphor bg-grid px-4 py-2 font-display text-sm font-bold text-phosphor hover:bg-grid/80 disabled:opacity-50"
            >
              {busy ? '锁定中…' : '锁定舰队'}
            </button>
          )}

          {/* 两阶段状态(§7.5):证明(本地)/ 链上确认;ProofStatus 内部叠 board 进度 */}
          <ProofStatus status={status} circuit="board" />

          {/* 锁定成功:导出部署文件(§8 必须可达)+ 等待对手态(§7.3) */}
          {locked && deployment && address && (
            <div className="space-y-4" data-testid="post-lock">
              <ExportButton
                chainId={deployment.chainId}
                contract={deployment.battleship}
                gameId={locked.gameId}
                address={address}
                board={locked.board}
                salt={locked.salt}
                commitment={locked.commitment}
              />

              {/* 等待对手(静态简版;声呐空转动画是 M4) */}
              <div
                className="space-y-2 border border-grid bg-console px-4 py-4"
                data-testid="waiting-opponent"
              >
                <p className="font-mono text-sm text-phosphor">声呐搜索对手中…</p>
                <p className="font-mono text-xs text-foam">
                  对局编号{' '}
                  <span className="font-bold text-flare" data-testid="game-id">
                    #{locked.gameId.toString()}
                  </span>{' '}
                  —— 把它发给你的对手。
                </p>
                <Link
                  to={`/game/${locked.gameId.toString()}`}
                  className="inline-block font-mono text-xs text-phosphor underline"
                >
                  进入对局 →
                </Link>
              </div>
            </div>
          )}

          {/* 非 demo / 未连接的行动指引(§7.6) */}
          {!IS_DEMO && (
            <p className="font-mono text-xs text-mist">
              (非 demo 构建:创建对局需先在另一个终端运行 pnpm demo 启动本地链与账户)
            </p>
          )}
          {IS_DEMO && !isConnected && (
            <p className="font-mono text-xs text-mist">尚未连接账户(demo 应自动连接 P0/P1)。</p>
          )}
        </div>
      </div>
    </section>
  );
}
