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
 * 同源喂 OwnBoard 与 useAutoRespond,不各读一遍)。
 *
 * ── 事件反馈(§7.3 命中/落空一次性动效,M4 Task 4.2a;与 SonarBoard 对称)──
 * 敌方对我的炮击**应答到达**时,经 overlay 槽的 ShotBurst 放一次性动效:敌打中我(新 hit)→ --flare 脉冲
 * + 整盘 120ms 横向 2px 抖动;敌打空(新 miss)→ --foam 涟漪扩散一次。**只有本会话新出现的标记才弹**——
 * 刷新重进时链上历史 hit/miss 会重放进 marks,ShotBurst 的增量核(首帧播种 seen)保证它们安静留底不乱闪。
 * 留下的火点在此处即静态 --flare 实心格(OwnBoard 无声呐扫描,故无 §7.3 那种「持续低频闪烁」,留静态色块,
 * 守 §7.4「其余静止」)。reduced-motion 时涟漪/脉冲/抖动全停、颜色反馈(格底色 + 字形)照常(§7.4)。
 */
import { useRef } from 'react';
import { SHIP_LENGTHS, shipCells, type Board } from '../../lib/boardLogic.ts';
import { formatCoord } from '../../lib/format.ts';
import { useBoardShake } from '../../hooks/useBoardShake.ts';
import BoardGrid from './BoardGrid.tsx';
import ShotBurst from './ShotBurst.tsx';
import { cellIdx, ownMarks, type MarkKind, type ShotLike } from './battleMarks.ts';

export type OwnBoardProps = {
  /** 我的棋盘(storage 还原);缺失 → null(不画船轮廓,仍画来袭/命中标记)。 */
  board: Board | null;
  /** 敌方对我的已应答炮击(GameView.enemyShots)。 */
  enemyShots: readonly ShotLike[];
  /** 来袭格序号(我是 defender 的 pending,y*10+x);无则 null。 */
  pendingInCell: number | null;
  /**
   * 观者身份键(§7.1 账户切换零 RPC 翻视角)。demo 单标签页 P0↔P1 切换时本盘**不重挂**、只换成对方的
   * enemyShots → ShotBurst 持有的 seenRef 还停在上一视角的格,会把新视角整段被打史误判为「新事件」狂闪。
   * 把它作 ShotBurst 的 React key(见下),切换那刻**只重挂 ShotBurst**:其惰性播种以当前(新视角)
   * marks 重置 seen → 首帧 newlyResolved 为空 → 零虚假爆发;切换后真正的新应答照常弹。用 address(观者
   * 身份)而非 view.myIdx——它是「这套 seen 属于谁」最直接的信号,断连时父级传 'none' 兜底。
   */
  perspectiveKey: string;
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

export default function OwnBoard({ board, enemyShots, pendingInCell, perspectiveKey }: OwnBoardProps) {
  const occ = board ? occupiedSet(board) : null;
  const isShip = (x: number, y: number) => occ?.has(cellIdx(x, y)) ?? false;
  const marks = ownMarks(enemyShots, pendingInCell);

  // 命中抖动:抖包住 BoardGrid 的 wrapper(整盘一震)。新 hit 由 ShotBurst 增量核判定经 onHit 触发。
  const boardRef = useRef<HTMLDivElement | null>(null);
  const shake = useBoardShake(boardRef);

  return (
    // 抖动 wrapper:inline-block 贴合 BoardGrid 宽度,不撑满列、不引发布局位移(只动 transform)。
    <div ref={boardRef} className="inline-block">
    <BoardGrid
      label="己方海域(被攻击记录)"
      testIdPrefix="own"
      disabled
      // key=观者身份:demo 切账户翻视角时只重挂 ShotBurst、以新视角 marks 重播种 seen,消除虚假爆发(见 perspectiveKey)。
      overlay={<ShotBurst key={perspectiveKey} marks={marks} onHit={shake} />}
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
    </div>
  );
}
