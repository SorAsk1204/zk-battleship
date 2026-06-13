/**
 * battleMarks —— 对战幕「炮击标记 / 禁点集」的纯派生(Design §7.3 对战幕标记语义)。
 *
 * 从 GameView 投影出的 ShotMark[] / Set<number> + pending 信息,推导出两块棋盘逐格要画什么、
 * 哪些格不可点。抽成纯函数(无 React)的理由同 gameView.ts:本仓 vitest 是 node 环境、无
 * testing-library,纯函数是唯一能单测的层;且这些判定(命中/未命中/待应答 优先级、SonarBoard 的
 * 「已开炮 ∪ 在飞 pending」禁点集 = D11 真理)是 gameplay 正确性的关键,必须钉死。
 *
 * 坐标↔格序:cell idx = y*10+x(行主序,与链上 shotMap bit、storage 占用格同序)。
 */

/**
 * 单格标记种类(决定着色,§7.2 锁定调色板)。
 *   hit          —— 命中(--flare):我打中敌 / 敌打中我;
 *   miss         —— 未命中(--phosphor 点 / --foam):我打空 / 敌打空;
 *   pending-out  —— 我已开炮、对手尚未应答的「待应答」空心标记(SonarBoard 乐观态,链上 ShotResolved
 *                   到达即转 hit/miss;来源:链上 pendingShot 我是 attacker,或本地乐观 just-fired);
 *   pending-in   —— 对手已开炮、待我应答的「来袭」标记(OwnBoard;来源:链上 pendingShot 我是 defender)。
 */
export type MarkKind = 'hit' | 'miss' | 'pending-out' | 'pending-in';

/** 单格炮击标记最小形状(取自 GameView.ShotMark / enemyShots;只用 x/y/result)。 */
export type ShotLike = { x: number; y: number; result: 0 | 1 };

/** (x,y) → cell idx(y*10+x)。 */
export function cellIdx(x: number, y: number): number {
  return y * 10 + x;
}

/**
 * 把一批已应答炮击(result 0/1)落成 `Map<cellIdx, 'hit'|'miss'>`。
 * 同格多次出现(理论不会——一格只打一次)以最后一条为准(无害,结果确定)。
 */
export function resolvedMarks(shots: readonly ShotLike[]): Map<number, MarkKind> {
  const m = new Map<number, MarkKind>();
  for (const s of shots) {
    m.set(cellIdx(s.x, s.y), s.result === 1 ? 'hit' : 'miss');
  }
  return m;
}

/**
 * 敌方声呐屏(SonarBoard)逐格标记:已应答的 myShots(hit/miss)+ 一个「待应答」空心标记。
 *
 * 待应答格的来源有二,合并取并(去重,同格不重画):
 *   (a) 链上 pendingShot:我是 attacker 且对手尚未 respond(view.pendingShot,phase AwaitingResponse);
 *   (b) 本地乐观 just-fired:我刚点击开炮、attack tx 已发但 ShotFired/ShotResolved 尚未回来
 *       (SonarBoard 本地 state)。两者可能指同一格(tx 已上链、watch 刚把 phase 推到 AwaitingResponse),
 *       此时 (a)(b) 同格,只画一个 pending-out。
 *
 * 优先级:已在 resolved 里的格(ShotResolved 已到)**不再**画 pending-out(结果已定,避免空心盖实心)。
 * 这对应 D11:ShotResolved 到达即 myShots 出现该格、phase 离开 AwaitingResponse、本地乐观标记也该清——
 * 即便清理有一帧延迟,这里也用 resolved 优先兜住(不会出现「已 hit 的格还顶着空心待应答」)。
 *
 * @param myShots 已应答的我方炮击(GameView.myShots)
 * @param pendingOutCells 待应答的我方出炮格序号集合(链上 pending + 本地乐观,调用方合并好传入)
 */
export function sonarMarks(
  myShots: readonly ShotLike[],
  pendingOutCells: Iterable<number>,
): Map<number, MarkKind> {
  const m = resolvedMarks(myShots);
  for (const idx of pendingOutCells) {
    if (!m.has(idx)) m.set(idx, 'pending-out');
  }
  return m;
}

/**
 * 己方海域(OwnBoard)逐格标记:敌方对我的已应答炮击(enemyShots,hit/miss)+ 一个「来袭」标记。
 * 来袭格 = 链上 pendingShot 我是 defender 的那格(对手已 attack、待我应答);已在 resolved 里则不覆盖
 * (我应答完即转 hit/miss,pending 消失)。
 *
 * @param enemyShots 敌方对我的已应答炮击(GameView.enemyShots)
 * @param pendingInCell 来袭格序号(我是 defender 的 pending);无则 null
 */
export function ownMarks(
  enemyShots: readonly ShotLike[],
  pendingInCell: number | null,
): Map<number, MarkKind> {
  const m = resolvedMarks(enemyShots);
  if (pendingInCell !== null && !m.has(pendingInCell)) {
    m.set(pendingInCell, 'pending-in');
  }
  return m;
}

/**
 * SonarBoard 的禁点集(D11 真理:`myFiredCells ∪ 在飞的 pending 出炮格`)。
 *
 * - myFiredCells = 链上 shotMap[对手索引](respond 成功才置位)→ 已应答的格;
 * - pendingOutCells = 待应答的我方出炮格(链上 pending 我是 attacker + 本地乐观 just-fired)——这些格
 *   尚不在 shotMap(D11:respond 才置位),但**绝不能再点**(合约 attack 在 AwaitingResponse 阶段会
 *   BAD_PHASE,且语义上一格只打一次)。故并进禁点集,REPEAT/相位错误在点击前就被挡住(省一次必 revert)。
 *
 * 返回新 Set(不 mutate 入参 myFiredCells——它是 GameView 的派生物,组件其它地方仍读原集)。
 */
export function sonarDisabledSet(
  myFiredCells: ReadonlySet<number>,
  pendingOutCells: Iterable<number>,
): Set<number> {
  const s = new Set<number>(myFiredCells);
  for (const idx of pendingOutCells) s.add(idx);
  return s;
}
