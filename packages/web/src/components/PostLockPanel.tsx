/**
 * PostLockPanel —— 锁定成功后的「等待对手」面板(Design §7.3 锁定后等待 + §8 导出可达)。
 *
 * 从 NewGame 的 post-lock 内联块**抽出**(reviewer 建议:让 create 端的「就地等待」与 Game.tsx
 * p0-waiting 幕共用同一份 UI,不再两处各写一遍上锁棋盘 + 导出 + 等待文案)。3.6 起 NewGame 锁定成功
 * 即导航 /game/:id,Game.tsx 在 act='placement' 且 myIdx===0(我是 P0、等 P1 加入)时渲染本面板——
 * 故 create 后的等待态只有一处实现。
 *
 * 渲染:
 *   - 上锁棋盘:复用 BoardGrid(全盘 disabled + 占格 ▦ + 暗磷光 bg-phosphor/20),从 `board`(5 船)
 *     直接算占用格(shipCells 真理源),**不**经 PlacementBoard——本面板拿到的是 Board(storage 还原 /
 *     锁定定格),没有布阵 reducer 态;BoardGrid 是纯展示原语,正好用它铺只读盘(§7.3 棋盘上锁)。
 *   - 锁定横幅「🔒 已锁定 · 10×10 · 17 占格」。
 *   - ExportButton(§8:布船+salt 丢失 = 无法应答 = 必然超时输,锁定后必须给可离线备份)。
 *   - 等待文案「声呐搜索对手中… 把对局编号 #N 发给你的对手」(§7.3;声呐动画是 M4,这里静态简版)。
 *   - 可选「进入对局 →」链接(NewGame 就地展示时给;Game.tsx 已在该路由则不给)。
 *
 * 纯展示 + 受控:不取数、不持状态;board/salt/commitment/gameId/address/chainId/contract 由父级备好。
 */
import { Link } from 'react-router-dom';
import type { Address } from '../lib/contracts.ts';
import { SHIP_LENGTHS, shipCells, type Board } from '../lib/boardLogic.ts';
import ExportButton from './ExportButton.tsx';
import BoardGrid from './board/BoardGrid.tsx';
import { formatCoord } from '../lib/format.ts';

export type PostLockPanelProps = {
  /** 已锁定的棋盘(5 船;storage 还原或锁定定格)。 */
  board: Board;
  salt: bigint;
  /** 已算好的承诺(导出复用,避免重算 Poseidon)。 */
  commitment: bigint;
  gameId: bigint;
  /** 当前账户(= 写盘/导出地址,P0)。 */
  address: Address;
  chainId: number;
  contract: Address;
  /** 给「进入对局 →」链接(NewGame 就地等待时 true;Game.tsx 已在该路由则省略)。 */
  showEnterLink?: boolean;
};

/** 从 Board 算占用格集合(key=y*10+x,行主序,与链上 bit 同序);上锁盘据此染 ▦ + 暗磷光。 */
function occupiedSet(board: Board): Set<number> {
  const occ = new Set<number>();
  board.forEach((ship, id) => {
    for (const c of shipCells(ship, SHIP_LENGTHS[id])) occ.add(c.y * 10 + c.x);
  });
  return occ;
}

export default function PostLockPanel({
  board,
  salt,
  commitment,
  gameId,
  address,
  chainId,
  contract,
  showEnterLink = false,
}: PostLockPanelProps) {
  const occ = occupiedSet(board);
  const isShip = (x: number, y: number) => occ.has(y * 10 + x);

  return (
    <div className="grid gap-6 lg:grid-cols-[auto_minmax(0,1fr)]" data-testid="post-lock-panel">
      {/* 左:上锁棋盘(只读) */}
      <div className="space-y-3">
        <BoardGrid
          label="已锁定的布阵棋盘"
          testIdPrefix="locked"
          disabled
          renderCell={(x, y) =>
            isShip(x, y) ? (
              <span aria-hidden className="font-mono text-[10px] leading-none text-abyss">
                ▦
              </span>
            ) : null
          }
          cellClassName={(x, y) => (isShip(x, y) ? 'bg-phosphor/20' : 'bg-console')}
          ariaLabel={(x, y) => `${formatCoord(x, y)} ${isShip(x, y) ? '已部署(已锁定)' : '空'}`}
        />
        <p
          className="flex items-center gap-2 font-mono text-xs text-phosphor"
          data-testid="locked-banner"
        >
          <span aria-hidden>🔒</span> 已锁定 · 10×10 · 17 占格
        </p>
      </div>

      {/* 右:导出 + 等待对手 */}
      <div className="space-y-4">
        <ExportButton
          chainId={chainId}
          contract={contract}
          gameId={gameId}
          address={address}
          board={board}
          salt={salt}
          commitment={commitment}
        />

        {/* 等待对手(静态简版;声呐空转动画是 M4) */}
        <div className="space-y-2 border border-grid bg-console px-4 py-4" data-testid="waiting-opponent">
          <p className="font-mono text-sm text-phosphor">声呐搜索对手中…</p>
          <p className="font-mono text-xs text-foam">
            把对局编号{' '}
            <span className="font-bold text-flare" data-testid="game-id">
              #{gameId.toString()}
            </span>{' '}
            发给你的对手。
          </p>
          {showEnterLink && (
            <Link
              to={`/game/${gameId.toString()}`}
              className="inline-block font-mono text-xs text-phosphor underline"
            >
              进入对局 →
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}
