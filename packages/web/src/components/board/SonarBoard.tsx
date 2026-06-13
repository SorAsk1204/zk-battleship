/**
 * SonarBoard —— 敌方声呐屏(Design §7.3 对战幕右侧:我的炮击记录 + 我方回合开炮),组合 BoardGrid。
 *
 * 渲染敌方棋盘(雾,看不到对手布阵):
 *   - 我的已应答炮击(myShots):命中 = --flare 实心;未命中 = --phosphor 余晖点(§7.3 hit/miss);
 *   - 待应答空心标记(pending-out):我已开炮、对手尚未应答的格。来源有二并取并——
 *       (a) 链上 pendingShot(我是 attacker,chainPendingOutCell),(b) 本地乐观 just-fired(点击即落,
 *       attack tx 未确认前就有反馈)。ShotResolved 到达 → 该格进 myShots/myFiredCells → 自动转 hit/miss。
 *   - 禁点集(D11 真理,battleMarks.sonarDisabledSet):myFiredCells ∪ 在飞 pending(出炮格)。禁点格
 *     不可点(BoardGrid isCellDisabled:disabled + aria-disabled + roving 跳过)。
 *
 * 交互(仅「我方攻击回合」isMyAttackTurn):
 *   - 可点格(非禁点)点击 = 开炮(useAttack.fire,REPEAT 前端预检在 fire 内 + 这里禁点集双保险);
 *   - hover / focus → Crosshair 覆盖层(经 BoardGrid overlay 槽)画十字准星 + 坐标角标;
 *   - 非我方攻击回合(对手回合 / 我在应答 / 已结束)→ 整盘 disabled(只读),无准星、不可点。
 *
 * 乐观 just-fired 生命周期(本地 state):点击即设;清除条件 = 该格已进 myFiredCells(ShotResolved 到)
 * 或链上 pending 已接管该格(chainPendingOutCell===它,避免本地与链上重画同一空心)或开炮失败(fire 返
 * false → 清,让禁点/标记回退)。useEffect 监听这些变化收口,不留「已 resolved 还顶着空心」的脏态。
 *
 * **功能版**:静态标记 + 功能性准星(线 + 角标,无动画);声呐扫描 / 命中余辉 / 抖动是 M4。
 */
import { useCallback, useEffect, useState } from 'react';
import { type Address } from '../../lib/contracts.ts';
import { formatCoord } from '../../lib/format.ts';
import { useAttack } from '../../hooks/useAttack.ts';
import BoardGrid from './BoardGrid.tsx';
import Crosshair from './Crosshair.tsx';
import { cellIdx, sonarDisabledSet, sonarMarks, type MarkKind, type ShotLike } from './battleMarks.ts';

export type SonarBoardProps = {
  gameId: bigint;
  contract: Address;
  /** 我的已应答炮击(GameView.myShots)。 */
  myShots: readonly ShotLike[];
  /** 我已开炮的格(链上 shotMap[对手],GameView.myFiredCells)。 */
  myFiredCells: ReadonlySet<number>;
  /** 链上待应答的我方出炮格(我是 attacker 的 pendingShot,y*10+x);无则 null。 */
  chainPendingOutCell: number | null;
  /** 是否我方攻击回合(phase===AwaitingAttack 且 isMyTurn):决定可点 + 准星。 */
  isMyAttackTurn: boolean;
};

/** 标记种类 → 格底色 class(§7.2 锁定调色板)。 */
function markClassName(kind: MarkKind | undefined, interactive: boolean): string {
  switch (kind) {
    case 'hit':
      return 'bg-flare/80';
    case 'miss':
      return 'bg-console';
    case 'pending-out':
      // 待应答:--phosphor 描边空心(等对手应答),底是雾。
      return 'bg-console ring-1 ring-inset ring-phosphor/70';
    default:
      // 未探测的雾格:可开炮回合 hover 提示极淡磷光;否则纯雾。
      return interactive ? 'bg-console hover:bg-grid/50' : 'bg-console';
  }
}

export default function SonarBoard({
  gameId,
  contract,
  myShots,
  myFiredCells,
  chainPendingOutCell,
  isMyAttackTurn,
}: SonarBoardProps) {
  // 本地乐观 just-fired 格(点击开炮即设;链上接管 / resolved / 失败时清)。
  const [optimisticCell, setOptimisticCell] = useState<number | null>(null);
  // 准星落点(hover / focus 的格);仅我方攻击回合显示。
  const [aim, setAim] = useState<{ x: number; y: number } | null>(null);

  // 在飞 pending 出炮格集合 = 链上 pending(我是 attacker)∪ 本地乐观。
  const pendingOut: number[] = [];
  if (chainPendingOutCell !== null) pendingOut.push(chainPendingOutCell);
  if (optimisticCell !== null && optimisticCell !== chainPendingOutCell) pendingOut.push(optimisticCell);

  const disabledSet = sonarDisabledSet(myFiredCells, pendingOut);
  const marks = sonarMarks(myShots, pendingOut);

  // 乐观格收口:已进 myFiredCells(ShotResolved 到)或链上 pending 已接管 → 清本地乐观(避免重画/陈留)。
  useEffect(() => {
    if (optimisticCell === null) return;
    if (myFiredCells.has(optimisticCell) || chainPendingOutCell === optimisticCell) {
      setOptimisticCell(null);
    }
  }, [optimisticCell, myFiredCells, chainPendingOutCell]);

  // 非我方攻击回合时收起准星(对手回合 / 我在应答 / 结束:整盘只读,无准星)。
  useEffect(() => {
    if (!isMyAttackTurn) setAim(null);
  }, [isMyAttackTurn]);

  const { fire, status: attackStatus } = useAttack((idx) => disabledSet.has(idx));

  const onCellClick = useCallback(
    (x: number, y: number) => {
      if (!isMyAttackTurn) return; // 双保险:非攻击回合整盘 disabled,理论不达此
      void fire({ gameId, contract, x, y }, (fx, fy) => {
        // 乐观落空心待应答标记(交易确认前)。
        setOptimisticCell(cellIdx(fx, fy));
      }).then((sent) => {
        // 被预检/重入挡下或 tx 失败:清乐观格(回退禁点/标记);错误文案由下方 attackStatus 行呈现。
        if (!sent) setOptimisticCell(null);
      });
    },
    [isMyAttackTurn, fire, gameId, contract],
  );

  // 准星仅我方攻击回合渲染(对手回合整盘只读、无 overlay)。
  const overlay = isMyAttackTurn ? <Crosshair cell={aim} /> : undefined;

  return (
    <div className="space-y-2">
    <BoardGrid
      label="敌方海域(声呐屏)"
      testIdPrefix="sonar"
      disabled={!isMyAttackTurn}
      isCellDisabled={(x, y) => disabledSet.has(cellIdx(x, y))}
      overlay={overlay}
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
            <span aria-hidden className="text-[10px] leading-none text-phosphor/80" data-mark="miss">
              ◦
            </span>
          );
        }
        if (kind === 'pending-out') {
          return (
            <span aria-hidden className="font-mono text-[11px] leading-none text-phosphor" data-mark="pending-out">
              ◌
            </span>
          );
        }
        return null;
      }}
      cellClassName={(x, y) => markClassName(marks.get(cellIdx(x, y)), isMyAttackTurn)}
      ariaLabel={(x, y) => {
        const coord = formatCoord(x, y);
        const kind = marks.get(cellIdx(x, y));
        if (kind === 'hit') return `${coord} 命中`;
        if (kind === 'miss') return `${coord} 未命中`;
        if (kind === 'pending-out') return `${coord} 待应答`;
        return isMyAttackTurn ? `${coord} 未探测,点击开炮` : `${coord} 未探测`;
      }}
      onCellClick={onCellClick}
      onCellHover={(x, y) => isMyAttackTurn && setAim({ x, y })}
      onCellFocus={(x, y) => isMyAttackTurn && setAim({ x, y })}
      onLeave={() => setAim(null)}
    />
      {/* 开炮链上状态(§7.5 链上确认段;无假进度,只 spinner 文案)+ 失败文案。证明在 respond 端,
          attack 无证明,故这里只有「提交/确认/失败」三态。 */}
      {(attackStatus.phase === 'sending' || attackStatus.phase === 'confirming') && (
        <p className="font-mono text-[11px] text-phosphor" data-testid="attack-status">
          {attackStatus.phase === 'sending' ? '提交开炮…' : '等待链上确认开炮…'}
        </p>
      )}
      {attackStatus.phase === 'error' && (
        <p className="font-mono text-[11px] text-flare" data-testid="attack-error">
          {attackStatus.message}
        </p>
      )}
    </div>
  );
}
