/**
 * Lobby —— 大厅(Design §7.1:创建对局 | 输入 gameId 加入 | 进行中对局列表[扫事件重建])。
 *
 * 信息架构(Task 3.4 决策,见 DECISIONS):
 *   - 创建对局:按钮 → 导航 /game/new(布阵幕 create 模式;真正的 board 证明 + createGame 交易
 *     在那里的「锁定舰队」上发生,**不在大厅**)。
 *   - 加入对局:数字 gameId 输入 + 「加入」→ 导航 /game/:id(3.6 起按 phase 呈现;若 viewer 非玩家
 *     且 phase=Created 则 3.6 在那里渲染布阵幕 join 模式)。3.4 期间 /game/:id 仍是占位——预期之内,
 *     完整 join 在 3.6 收口。
 *   - 进行中对局列表:useGameList(getLogs 回填 + watchContractEvent 增量),点行 → /game/:id。
 *     **无手动刷新按钮**(§7.1:用户永不手动刷新;创建第二局列表自动更新)。
 *
 * 本页不再持有任何证明 / 交易逻辑(Task 3.3 的临时 createGame 已移除,泛化进 useLockFleet,
 * 由 /game/new 调用)。demo 账户切换器在 Layout 右上角(本页只读当前账户用于展示)。
 */
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAccount } from 'wagmi';
import { shortAddr } from '../lib/format.ts';
import { useGameList } from '../hooks/useGameList.ts';
import type { GameRow } from '../hooks/gameListReducer.ts';

/** status → 中文 chip 文案(§7.6:动词化 / 行动指引)。 */
function statusLabel(status: GameRow['status']): string {
  return status === 'waiting' ? '等待对手' : '进行中';
}

export default function Lobby() {
  const navigate = useNavigate();
  const { address, isConnected } = useAccount();
  const { games, loading, error } = useGameList();

  // 加入用 gameId 输入:仅数字;空 / 非法时「加入」禁用。
  const [joinId, setJoinId] = useState('');
  const trimmed = joinId.trim();
  const joinValid = /^\d+$/.test(trimmed) && BigInt(trimmed) >= 0n;

  function onJoin() {
    if (!joinValid) return;
    navigate(`/game/${trimmed}`);
  }

  return (
    <section className="space-y-8">
      {/* ── 标题 + 当前账户 ── */}
      <div className="flex items-end justify-between">
        <div className="space-y-1">
          <h1 className="font-display text-3xl font-bold text-phosphor">作战大厅</h1>
          <p className="text-sm text-mist">创建一局,或用编号加入对手的对局。</p>
        </div>
        <span className="font-mono text-xs text-mist">
          {isConnected && address ? `当前账户 ${shortAddr(address)}` : '未连接账户'}
        </span>
      </div>

      {/* ── 创建 / 加入 两入口 ── */}
      <div className="grid gap-4 md:grid-cols-2">
        {/* 创建对局 → /game/new */}
        <div className="flex flex-col justify-between gap-4 border border-grid bg-console p-5">
          <div className="space-y-1">
            <h2 className="font-display text-lg font-bold text-foam">创建对局</h2>
            <p className="text-sm text-mist">部署你的舰队、锁定开局,生成可分享的对局编号。</p>
          </div>
          <button
            type="button"
            data-testid="create-game"
            onClick={() => navigate('/game/new')}
            className="self-start border border-phosphor bg-grid px-4 py-2 font-display text-sm font-bold text-phosphor hover:bg-grid/80"
          >
            创建对局
          </button>
        </div>

        {/* 加入对局:gameId 输入 + 加入 */}
        <div className="flex flex-col justify-between gap-4 border border-grid bg-console p-5">
          <div className="space-y-1">
            <h2 className="font-display text-lg font-bold text-foam">加入对局</h2>
            <p className="text-sm text-mist">输入对手给你的对局编号。</p>
          </div>
          <form
            className="flex items-center gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              onJoin();
            }}
          >
            <input
              type="text"
              inputMode="numeric"
              data-testid="join-input"
              value={joinId}
              onChange={(e) => setJoinId(e.target.value.replace(/[^\d]/g, ''))}
              placeholder="对局编号"
              aria-label="对局编号"
              className="w-32 border border-grid bg-abyss px-3 py-2 font-mono text-sm text-phosphor placeholder:text-mist focus:border-phosphor focus:outline-none"
            />
            <button
              type="submit"
              data-testid="join-game"
              disabled={!joinValid}
              className="border border-phosphor bg-grid px-4 py-2 font-display text-sm font-bold text-phosphor hover:bg-grid/80 disabled:opacity-50"
            >
              加入
            </button>
          </form>
        </div>
      </div>

      {/* ── 进行中对局列表 ── */}
      <div className="space-y-3">
        <h2 className="font-display text-lg font-bold text-foam">进行中的对局</h2>

        {loading && (
          <p className="font-mono text-xs text-mist" data-testid="list-loading">
            正在回放对局事件…
          </p>
        )}

        {error && !loading && (
          <p className="font-mono text-xs text-flare" data-testid="list-error">
            {error}
          </p>
        )}

        {!loading && games.length === 0 && (
          // 空状态给行动指引(§7.6:不给装饰性感叹)。
          <div
            className="border border-dashed border-grid bg-console/50 px-4 py-6 text-center"
            data-testid="list-empty"
          >
            <p className="text-sm text-mist">
              还没有进行中的对局。创建一局,把编号发给对手。
            </p>
          </div>
        )}

        {games.length > 0 && (
          <ul className="space-y-2" data-testid="game-list">
            {games.map((g) => (
              <li key={g.gameId.toString()}>
                <button
                  type="button"
                  data-testid={`game-row-${g.gameId.toString()}`}
                  onClick={() => navigate(`/game/${g.gameId.toString()}`)}
                  className="flex w-full items-center justify-between border border-grid bg-console px-4 py-3 text-left hover:border-phosphor"
                >
                  <span className="flex items-center gap-3">
                    <span className="font-mono text-sm font-bold text-phosphor">
                      #{g.gameId.toString()}
                    </span>
                    <StatusChip status={g.status} />
                  </span>
                  <span className="flex items-center gap-2 font-mono text-xs text-mist">
                    <span>P0 {g.p0 ? shortAddr(g.p0) : '—'}</span>
                    <span className="text-grid">·</span>
                    <span>P1 {g.p1 ? shortAddr(g.p1) : '待加入'}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

/** 状态 chip:waiting=磷光(可加入),active=foam(进行中)。直角细边(§7.2)。 */
function StatusChip({ status }: { status: GameRow['status'] }) {
  const cls =
    status === 'waiting'
      ? 'border-phosphor/60 text-phosphor'
      : 'border-grid text-foam';
  return (
    <span className={`border px-2 py-0.5 font-mono text-[11px] ${cls}`}>
      {statusLabel(status)}
    </span>
  );
}
