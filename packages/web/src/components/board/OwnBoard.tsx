/**
 * OwnBoard —— 己方海域(Design §7.3 对战幕左侧:被打记录),组合 BoardGrid 的纯展示盘。
 *
 * 渲染我自己的棋盘(不可交互——己方盘只读):
 *   - 我的舰队轮廓:从 storage 还原的 Board(5 船)算占用格 → ▦ + 暗磷光底(同 PostLockPanel 上锁盘);
 *     棋盘缺失(换浏览器 / 清存储)→ board=null,**不画轮廓**(仍画下面的来袭/命中标记,因为那些来自
 *     链上 enemyShots/pending,与本地棋盘无关),并由父级配一条「本地棋盘缺失」提示(§8)。
 *   - 敌方对我的炮击标记(enemyShots):命中我 = --flare 实心格;未命中 = --foam 余晖点(§7.3 hit/miss)。
 *   - 来袭标记(pending-in):对手已开炮、待我应答的那格(链上 pendingShot 我是 defender)——
 *     --flare 描边空心,示意「这一炮正打向我、正在自动应答」(应答完转 hit/miss,见 battleMarks.ownMarks)。
 *
 * 标记 vs 船轮廓的叠放:一格可能既是船格又被命中(我的船被打中)。视觉上「被命中」语义优先——
 * 命中格画 --flare 实心(盖过船的暗磷光底),让「哪艘船哪格挨打」一目了然;未命中点画在空格上
 * (那格本就是水)。船轮廓只在「无标记的船格」显现。
 *
 * 纯展示 + 受控:board / enemyShots / pendingInCell 由父级(BattleAct)备好(父级 loadBoard 一次,
 * 同源喂 OwnBoard 与 useAutoRespond,不各读一遍)。**功能版**:静态色块/点,无涟漪/脉冲/抖动(M4)。
 */
import { SHIP_LENGTHS, shipCells, type Board } from '../../lib/boardLogic.ts';
import { formatCoord } from '../../lib/format.ts';
import BoardGrid from './BoardGrid.tsx';
import { cellIdx, ownMarks, type MarkKind, type ShotLike } from './battleMarks.ts';

export type OwnBoardProps = {
  /** 我的棋盘(storage 还原);缺失 → null(不画船轮廓,仍画来袭/命中标记)。 */
  board: Board | null;
  /** 敌方对我的已应答炮击(GameView.enemyShots)。 */
  enemyShots: readonly ShotLike[];
  /** 来袭格序号(我是 defender 的 pending,y*10+x);无则 null。 */
  pendingInCell: number | null;
};

/** 从 Board 算占用格集合(key=y*10+x,行主序,同链上 bit 序)。 */
function occupiedSet(board: Board): Set<number> {
  const occ = new Set<number>();
  board.forEach((ship, id) => {
    for (const c of shipCells(ship, SHIP_LENGTHS[id])) occ.add(c.y * 10 + c.x);
  });
  return occ;
}

/** 标记种类 → 格底色 class(§7.2 锁定调色板:hit=flare、miss=暗、pending-in=flare 描边)。 */
function markClassName(kind: MarkKind | undefined, isShip: boolean): string {
  switch (kind) {
    case 'hit':
      // 命中我:--flare 实心(盖过船底),持续示意火点(动效是 M4)。
      return 'bg-flare/80';
    case 'miss':
      // 未命中:水面上一个 --foam 余晖点(底仍是海)。
      return 'bg-console';
    case 'pending-in':
      // 来袭(待我应答):--flare 描边空心,底视是否船格而定。
      return isShip ? 'bg-phosphor/20 ring-1 ring-inset ring-flare' : 'bg-console ring-1 ring-inset ring-flare';
    default:
      // 无标记:船格暗磷光、水格深海。
      return isShip ? 'bg-phosphor/20' : 'bg-console';
  }
}

export default function OwnBoard({ board, enemyShots, pendingInCell }: OwnBoardProps) {
  const occ = board ? occupiedSet(board) : null;
  const isShip = (x: number, y: number) => occ?.has(cellIdx(x, y)) ?? false;
  const marks = ownMarks(enemyShots, pendingInCell);

  return (
    <BoardGrid
      label="己方海域(被攻击记录)"
      testIdPrefix="own"
      disabled
      renderCell={(x, y) => {
        const kind = marks.get(cellIdx(x, y));
        if (kind === 'hit') {
          return (
            <span aria-hidden className="font-mono text-[11px] leading-none text-abyss" data-mark="hit">
              ✸
            </span>
          );
        }
        if (kind === 'miss') {
          return (
            <span aria-hidden className="text-[10px] leading-none text-foam/70" data-mark="miss">
              ◦
            </span>
          );
        }
        if (kind === 'pending-in') {
          return (
            <span aria-hidden className="font-mono text-[11px] leading-none text-flare" data-mark="pending-in">
              ◎
            </span>
          );
        }
        // 无标记的船格画 ▦(暗磷光),水格空。
        return isShip(x, y) ? (
          <span aria-hidden className="font-mono text-[10px] leading-none text-abyss">
            ▦
          </span>
        ) : null;
      }}
      cellClassName={(x, y) => markClassName(marks.get(cellIdx(x, y)), isShip(x, y))}
      ariaLabel={(x, y) => {
        const coord = formatCoord(x, y);
        const kind = marks.get(cellIdx(x, y));
        if (kind === 'hit') return `${coord} 我方中弹`;
        if (kind === 'miss') return `${coord} 对手未命中`;
        if (kind === 'pending-in') return `${coord} 来袭(待应答)`;
        return `${coord} ${isShip(x, y) ? '我方舰船' : '海域'}`;
      }}
    />
  );
}
