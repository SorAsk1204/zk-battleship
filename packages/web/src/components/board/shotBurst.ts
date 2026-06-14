/**
 * shotBurst —— 棋盘「炮击事件反馈」的**纯增量核**(Design §7.3 命中/落空一次性动效 + §7.4 动效预算)。
 *
 * §7.3(verbatim):对方应答到达(事件):miss → 白色涟漪扩散一次后留磷光点;hit → --flare 脉冲 +
 * 棋盘容器 120ms 横向 2px 抖动 + 留下持续低频闪烁的火点。
 *
 * 这层只解决一件**会静默毁掉整个特性**的事:**只有本会话新出现的标记才放一次性动效**。
 * 标记来自链上事件(ShotResolved),刷新/换页重进时 GameView 会把整局历史 hit/miss **重放**进
 * marks——若这些在挂载时全部 ripple/pulse,每次刷新就是一片乱闪。正确语义是:维护一个「已见格」
 * 集合,**挂载首帧用当时的 marks 播种**(历史标记直接进 seen,不触发);此后每渲染算「当前 marks −
 * seen」得到真正的新格,只为它们放一次性动效,再并入 seen。
 *
 * 把这个增量判定抽成无 React / 无 DOM 的纯函数,理由同 sonarPhase / battleMarks:本仓 vitest 是 node
 * 环境,WAAPI/ripple 视觉无法单测、留浏览器验收;但「哪些是新格、刷新时是否零触发、hit/miss 分类」是
 * 这特性的承重逻辑,必须在不依赖浏览器的层钉死。渲染层(ShotBurst.tsx)只是这个纯核的薄壳:
 * seen ref + 每渲染调用 newlyResolved + 为返回项各放一个自卸载的 WAAPI 元件。
 *
 * 坐标↔格序沿用 battleMarks:cell idx = y*10+x(行主序)。
 */
import { type MarkKind } from './battleMarks.ts';

/**
 * 能触发事件反馈的标记种类:只有**已应答**的 hit/miss。
 * pending-out/pending-in 是「在飞/待应答」的瞬态空心,不是「应答到达」事件,不放动效(§7.3 只点名
 * hit/miss;空心标记本身已由 BoardGrid 静态着色表达)。
 */
export type BurstKind = 'hit' | 'miss';

/** 一个待触发的一次性动效:落在 cell(=y*10+x)的 hit 脉冲 或 miss 涟漪。 */
export type Burst = { cell: number; kind: BurstKind };

/** marks 里能触发反馈的种类(收窄到 hit/miss)。 */
export function isBurstKind(kind: MarkKind): kind is BurstKind {
  return kind === 'hit' || kind === 'miss';
}

/**
 * 计算「本次渲染相对 seen 新出现的、可触发反馈的格」。
 *
 * 纯函数,**不 mutate** 入参(既不动 seen 也不动 marks):调用方拿到返回的新格后,自行把它们并入 seen
 * (见 ShotBurst.tsx 的 ref 推进)。分离「算」与「并入」让本函数可反复测、可在 effect 里安全调用。
 *
 * 语义:
 *   - 遍历 marks,取**未在 seen 里**且 isBurstKind 的格,作为新 burst 返回;
 *   - 已在 seen 的格(无论 hit/miss)→ 跳过(历史标记或上一帧已触发过的,绝不重放);
 *   - pending-out / pending-in → 跳过(非应答事件);
 *   - 返回顺序按 cell 升序(稳定,便于测试与可预期的多格同帧到达表现)。
 *
 * **刷新不重放**的保证由调用方负责:挂载首帧把当时的 marks 全部播种进 seen(用本函数返回集并入,
 * 或直接灌 marks 的 hit/miss 键),使首帧 newlyResolved 之后 seen 已含全部历史 → 此后只有真正的新
 * 应答事件落入返回集。本函数只提供「当前 − seen」这一步,不持有状态。
 *
 * @param seen 已见(已触发过 / 挂载播种)的格集合,只读
 * @param marks 当前逐格标记(battleMarks 的 sonarMarks/ownMarks 产物)
 * @returns 新出现的可触发格,按 cell 升序;无则空数组
 */
export function newlyResolved(
  seen: ReadonlySet<number>,
  marks: ReadonlyMap<number, MarkKind>,
): Burst[] {
  const out: Burst[] = [];
  for (const [cell, kind] of marks) {
    if (seen.has(cell)) continue;
    if (!isBurstKind(kind)) continue;
    out.push({ cell, kind });
  }
  out.sort((a, b) => a.cell - b.cell);
  return out;
}

/**
 * 取 marks 里所有「可触发反馈」格的 cell 集合(hit/miss 的键)。
 * 供调用方在**挂载首帧播种 seen**:把历史 hit/miss 一次性灌进 seen,使它们永不触发一次性动效
 * (刷新重放的历史标记安静地留在棋盘上,只有此后的新应答才弹)。pending 不入(它们本就不该触发,
 * 且后续 resolve 成 hit/miss 时才算「新事件」该弹——故不能在 pending 阶段就提前播种掉)。
 */
export function burstableCells(marks: ReadonlyMap<number, MarkKind>): Set<number> {
  const s = new Set<number>();
  for (const [cell, kind] of marks) {
    if (isBurstKind(kind)) s.add(cell);
  }
  return s;
}
