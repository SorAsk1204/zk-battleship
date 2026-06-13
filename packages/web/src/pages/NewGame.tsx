/**
 * NewGame —— 创建对局页(路由 /game/new,Task 3.4)。
 *
 * 本页是「布阵幕(create 模式)」的**临时最小版**:Task 3.5 会用真实布阵交互(FleetDock 点选 / 预览 /
 * R 旋转 / 非法染红 / 拖回)**替换下方的固定布局 + 按钮 UI**,但**复用同一个 useLockFleet 管线**——
 * create 的证明 + 交易 + 持久化逻辑已在 hook 里,3.5 只换「怎么得到 board」这一段。
 *
 * 临时:下方 FIXED_BOARD 是合法的固定布局(5 船贴左逐行,validateBoard 必过),仅为让 create 在 3.4
 * 端到端跑通(真证明、真交易、真持久化、真事件)。明确标注「3.5 将替换为真实布阵交互」。
 *
 * 流程(§7.3 锁定舰队 + §7.5 两阶段文案):
 *   点「锁定舰队」→ useLockFleet({mode:'create', board:FIXED_BOARD, salt:randomSalt()})
 *   → ProofStatus 显示 本地计算(编译证明 + 字节%)→ 链上确认 → done
 *   → 导航到 /game/${gameId}(3.6 起那里是 phase 驱动的三幕;3.4–3.5 期间是占位)。
 *
 * 仅 demo 构建可用(需本地链 + 账户 + deployment);非 demo 给出行动指引。
 * ExportButton(§8 导出部署文件)推迟到 3.5 与真实布阵一起做——3.4 保持最小但真实。
 */
import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAccount } from 'wagmi';
import type { Board } from '../lib/boardLogic.ts';
import { randomSalt } from '../lib/salt.ts';
import { IS_DEMO } from '../lib/wagmi.ts';
import { useLockFleet } from '../hooks/useLockFleet.ts';
import ProofStatus from '../components/ProofStatus.tsx';

// ╔═══════════════════════════════════════════════════════════════════════════╗
// ║ 临时固定布局 —— Task 3.5 将替换为真实布阵交互(FleetDock + 棋盘预览)。      ║
// ║ 5 船贴左逐行,长度 [5,4,3,3,2],validateBoard 必过(同 DevProve fixture)。   ║
// ╚═══════════════════════════════════════════════════════════════════════════╝
const FIXED_BOARD: Board = [
  { x: 0, y: 0, dir: 0 },
  { x: 0, y: 1, dir: 0 },
  { x: 0, y: 2, dir: 0 },
  { x: 0, y: 3, dir: 0 },
  { x: 0, y: 4, dir: 0 },
];

export default function NewGame() {
  const navigate = useNavigate();
  const { isConnected } = useAccount();
  const { status, lockFleet } = useLockFleet();

  const busy =
    status.phase === 'proving' || status.phase === 'sending' || status.phase === 'confirming';

  // done → 导航到该局(§7.3:成功后进入等待/对战;3.6 起 /game/:id 是 phase 驱动三幕)。
  useEffect(() => {
    if (status.phase === 'done') {
      navigate(`/game/${status.gameId.toString()}`);
    }
  }, [status, navigate]);

  function onLock() {
    // 每局新 salt(§5.1/§5.5:跨局重用同一布船+salt 会泄露上一局棋盘)。
    void lockFleet({ mode: 'create', board: FIXED_BOARD, salt: randomSalt() });
  }

  return (
    <section className="space-y-6">
      <div className="space-y-1">
        <h1 className="font-display text-3xl font-bold text-phosphor">部署舰队</h1>
        <p className="text-sm text-mist">
          锁定你的布阵并开局。对局编号将在创建后生成,把它发给对手即可对战。
        </p>
      </div>

      <div className="space-y-4 border border-grid bg-console p-5">
        {/* 临时布局说明牌(3.5 替换) */}
        <div className="border border-dashed border-mist/50 bg-abyss px-3 py-2">
          <p className="font-mono text-xs text-mist">
            临时:使用固定示例布局(5 船贴左逐行)。3.5 将替换为真实布阵交互(点选舰船、预览、R 旋转、
            非法位置染红)。
          </p>
        </div>

        {/* 固定布局一览(只读展示,等宽坐标) */}
        <div className="space-y-1">
          <p className="font-mono text-xs text-foam">布阵(只读):</p>
          <ul className="grid grid-cols-1 gap-0.5 sm:grid-cols-2">
            {FIXED_BOARD.map((s, i) => (
              <li key={i} className="font-mono text-xs text-mist">
                舰 {i + 1}:({s.x}, {s.y}) {s.dir === 0 ? '水平' : '垂直'}
              </li>
            ))}
          </ul>
        </div>

        {/* 主按钮:锁定舰队(§7.6 动词化) */}
        <button
          type="button"
          data-testid="lock-fleet"
          onClick={onLock}
          disabled={busy || !isConnected || !IS_DEMO}
          className="border border-phosphor bg-grid px-4 py-2 font-display text-sm font-bold text-phosphor hover:bg-grid/80 disabled:opacity-50"
        >
          {busy ? '锁定中…' : '锁定舰队'}
        </button>

        {/* 两阶段状态(§7.5;ProofStatus 内部叠 board 证明进度) */}
        <ProofStatus status={status} circuit="board" />

        {!IS_DEMO && (
          <p className="font-mono text-xs text-mist">
            (非 demo 构建:创建对局需先在另一个终端运行 pnpm demo 启动本地链与账户)
          </p>
        )}
        {IS_DEMO && !isConnected && (
          <p className="font-mono text-xs text-mist">尚未连接账户(demo 应自动连接 P0/P1)。</p>
        )}
      </div>
    </section>
  );
}
