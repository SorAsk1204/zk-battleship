/**
 * finishSweep —— 结算幕「扫屏」的**纯映射核**(Design §7.3 结算 + §7.4 动效预算)。
 *
 * §7.3(verbatim):胜:声呐屏整屏一次 --phosphor 扫亮;负:整屏短暂染 --flare 后熄灭为低亮度。
 * §7.4 把「结算扫屏」列入唯一允许的动画清单。
 *
 * 结算幕没有声呐棋盘,故「整屏」= outcome 面板本身(见 Game.tsx FinishAct)。本模块只解决一件
 * 可单测的承重事:把已派生的 outcome.accent(胜=phosphor / 负=flare / 取消=mist)映成**扫屏种类**:
 *   - phosphor → 'phosphor'(胜:一次磷光提亮扫过后落回稳定亮态);
 *   - flare    → 'flare'(负:整屏短暂染橙后熄灭为低亮度);
 *   - mist     → 'none'(取消:中性,不扫屏)。
 *
 * 为什么以 accent(而非 view.iWon)为输入:accent 是 FinishAct 已经算好的**视觉驱动量**——它已统一了
 * 「玩家胜 / 旁观看到的胜局(winner 已定)」都走 phosphor、「玩家负」走 flare、「取消」走 mist。扫屏是对
 * 这个既定 accent 的视觉强化,故直接读 accent 保证扫屏与边框/标题色三者永远同源一致(旁观看一局已结束的
 * 胜局,accent=phosphor → 同样给一次胜利扫亮,语义正确:这是一场有胜者的对局)。
 *
 * 抽成无 React / 无 DOM 的纯函数,理由同 sonarPhase / shotBurst:本仓 vitest 是 node 环境,WAAPI 扫屏
 * 视觉无法单测、留浏览器验收;但「accent→扫屏种类」这一步是承重映射,在不依赖浏览器的层钉死。
 * 渲染层(FinishAct)只是薄壳:读 accent → finishSweepKind → reduced-motion 为假时跑对应 WAAPI 关键帧。
 */

/** outcome.accent 的取值(与 Game.tsx FinishAct 的 outcome.accent 同一闭集)。 */
export type OutcomeAccent = 'phosphor' | 'flare' | 'mist';

/**
 * 扫屏种类:
 *   - 'phosphor' 胜:磷光提亮扫过一次,落回稳定亮态(end-state 可读、不留在中途);
 *   - 'flare'    负:整屏短暂染 --flare,衰减熄灭为低亮度 end-state;
 *   - 'none'     取消(mist)/ 其它:不扫屏(静态)。
 */
export type FinishSweepKind = 'phosphor' | 'flare' | 'none';

/**
 * accent → 扫屏种类(纯映射,无副作用)。
 *
 * phosphor=胜→提亮扫亮;flare=负→染橙熄灭;mist=取消→不扫(中性静态)。
 * 任何未知值兜底为 'none'(只在明确的胜/负 accent 上放动效,不误扫)。
 */
export function finishSweepKind(accent: OutcomeAccent): FinishSweepKind {
  switch (accent) {
    case 'phosphor':
      return 'phosphor';
    case 'flare':
      return 'flare';
    case 'mist':
    default:
      return 'none';
  }
}
