/**
 * NewGame —— 布阵幕 create 模式(路由 /game/new,Design §7.3)。
 *
 * 船坞点选 → 棋盘预览(随鼠标/键盘焦点)→ R 旋转 / Esc 取消 / 非法整船染 --flare → 落子 →
 * 已放置可拿回。5 船全部就位后出现唯一主按钮「锁定舰队」,复用 useLockFleet(mode:'create')管线
 * (证明 → 交易 → 持久化)。
 *
 * 布阵态(placement.ts 的 useReducer,组件作用域、瞬时):刷新即弃——锁定前不持久化(§8 只在锁定
 * 成功落盘);有意的最小面,避免给一处临时交互引全局 store(YAGNI)。
 *
 * 锁定成功 → **导航 /game/:id**(3.6 起):3.5 时 /game/:id 还是占位页,故 3.5 把锁定后的「导出 +
 * 等待」就地留在本页;3.6 把 /game/:id 建成相位驱动页后,p0-waiting 幕(act='placement' 且我是 P0)
 * 渲染 PostLockPanel(同一份上锁棋盘 + 导出 + 等待 UI)。故本页锁定成功后直接导航过去,**等待 UI 只有
 * 一处**(PostLockPanel),不再在本页重复实现(reviewer 建议的去重)。done→navigate 复用 3.4 的最简
 * 收口路径(彼时也是 done 即导航,只是当时落在占位页;现在落在真页)。
 *
 * 预热(3.4 handoff):进入本幕即 preload('board'),把 8.35MB zkey 拉取藏在布阵时间后,「锁定舰队」
 * 时证明少等网络。仅 demo 构建可锁定(需本地链);非 demo 给行动指引。
 */
import { useEffect, useReducer } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAccount } from 'wagmi';
import { randomSalt } from '../lib/salt.ts';
import { IS_DEMO } from '../lib/wagmi.ts';
import { useLockFleet } from '../hooks/useLockFleet.ts';
import { preload } from '../hooks/useProver.ts';
import ProofStatus from '../components/ProofStatus.tsx';
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
  const navigate = useNavigate();
  const { isConnected } = useAccount();
  const { status, lockFleet, reset } = useLockFleet();
  const [state, rawDispatch] = useReducer(placementReducer, undefined, initialPlacement);

  const busy = status.phase === 'proving' || status.phase === 'sending' || status.phase === 'confirming';
  const isError = status.phase === 'error';

  // 进入布阵幕:预热 board 证明工件(隐藏 zkey 拉取延迟)。失败静默——锁定时会再尝试并把错误显式报出。
  useEffect(() => {
    void preload('board').catch(() => {});
  }, []);

  // 锁定成功 → 导航 /game/:id(等待 UI 在 Game.tsx 的 p0-waiting 幕 / PostLockPanel,见模块注释)。
  useEffect(() => {
    if (status.phase === 'done') {
      navigate(`/game/${status.gameId.toString()}`);
    }
  }, [status, navigate]);

  /**
   * 包装 dispatch:错误态下用户重新编辑布局时,先 reset() 把管线回 idle(error 后用户编辑布局即清错、
   * 按钮恢复;pending 键由 useLockFleet 保留供重试)。只对会改动布局的 action 触发。
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
    // 每局新 salt(§5.5:跨局重用同一布船+salt 会泄露上一局棋盘)。承诺由 useLockFleet 内部算(落盘+上链)。
    const salt = randomSalt();
    void lockFleet({ mode: 'create', board, salt });
  }

  const ready = allPlaced(state);

  return (
    <section className="space-y-6">
      <div className="space-y-1">
        <h1 className="font-display text-3xl font-bold text-phosphor">部署舰队</h1>
        <p className="text-sm text-mist">
          从船坞点选舰船,放置到海图上。R 旋转,Esc 取消,点已放置的船可拿回重放。
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-[auto_minmax(0,1fr)]">
        {/* 左:布阵棋盘 */}
        <div className="space-y-3">
          <PlacementBoard state={state} dispatch={dispatch} />
        </div>

        {/* 右:船坞 + 主按钮 + 状态 */}
        <div className="space-y-5">
          <FleetDock
            placed={state.placed}
            carrying={state.carrying}
            onSelect={(shipId) => dispatch({ type: 'carry', shipId })}
            disabled={busy}
          />

          {/* 就位进度(未满 5 时给行动指引;§7.6 空状态给指引) */}
          {!ready && (
            <p className="font-mono text-xs text-mist" data-testid="placement-progress">
              已就位 {placedCount(state)} / 5 —— 放满 5 艘后即可锁定舰队。
            </p>
          )}

          {/* 唯一主按钮「锁定舰队」:5 船就位前隐藏(§7.3 全部就位后出现) */}
          {ready && (
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
