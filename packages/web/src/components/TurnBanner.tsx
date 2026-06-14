/**
 * TurnBanner —— 回合横幅(Design §7.3 对战幕中缝:轮到谁 / 做什么;§7.6 动词「开炮」「应答」)。
 *
 * 从 GameView 派生 4(玩家)+ 2(旁观)态文案,aria-live="polite" 让读屏在回合切换时播报。措辞用
 * §7.6 动词,与按钮一致。**功能版**:文字横幅(横幅滑入动画是 M4,§7.4)。
 *
 * 4 态(玩家,§4.2 义务方 × phase):
 *   AwaitingAttack   · isMyTurn   →「轮到你开炮」(主色,我方行动)
 *   AwaitingAttack   · !isMyTurn  →「等待对手开炮」(次色)
 *   AwaitingResponse · 待我应答    →「正在应答对手的炮击 {coord}…」(我方客户端自动应答中,§7.3)
 *   AwaitingResponse · 待对手应答  →「等待对手应答 {coord}」
 * 旁观(observer/null):用 P0/P1 客观称谓,不用「你 / 对手」。
 *
 * 纯展示:只读 view 的 phase/isMyTurn/pendingShot/pendingShotIsForMe/isPlayer/obligatedIdx。
 *
 * 回合横幅滑入(M4.2b,§7.3 battle 回合切换 + §7.4「180ms 滑入」):内层 <p> 用 `key={text}`——回合文案
 * 变化时 React 重挂该 <p>,使 .anim-banner-slide 的 CSS keyframe **重放**(180ms 一次淡入上滑)。仅文案
 * 变才换 key(active 旗变色但文案不变时不重挂),不会在无关重渲染时虚假触发。aria-live="polite" 在外层
 * <div> 不随 <p> 重挂而变,文案变化照常播报(live region 完好)。reduced-motion:.anim-banner-slide 的
 * @keyframes 仅定义在 `(prefers-reduced-motion: no-preference)` 内 → reduce 用户无动画、即时显示文案(§7.4)。
 */
import { Phase, type GameView } from '../hooks/gameView.ts';

export type TurnBannerProps = { view: GameView };

/** 派生横幅文案 + 是否「我方主动行动态」(决定主色 vs 次色)。 */
export function bannerLabel(view: GameView): { text: string; active: boolean } {
  // 旁观 / 未连:客观称谓(无「你」)。
  if (!view.isPlayer) {
    const who = view.obligatedIdx === 1 ? 'P1' : 'P0';
    if (view.phase === Phase.AwaitingResponse) {
      const c = view.pendingShot ? ` ${view.pendingShot.coord}` : '';
      return { text: `等待 ${who} 应答${c}`, active: false };
    }
    return { text: `等待 ${who} 开炮`, active: false };
  }

  if (view.phase === Phase.AwaitingResponse) {
    const c = view.pendingShot ? ` ${view.pendingShot.coord}` : '';
    if (view.pendingShotIsForMe) {
      // 我是防守方:客户端自动生成应答证明并发交易(§7.3),横幅示意进行中。
      return { text: `正在应答对手的炮击${c}…`, active: true };
    }
    return { text: `等待对手应答${c}`, active: false };
  }

  // AwaitingAttack
  return view.isMyTurn ? { text: '轮到你开炮', active: true } : { text: '等待对手开炮', active: false };
}

export default function TurnBanner({ view }: TurnBannerProps) {
  const { text, active } = bannerLabel(view);
  return (
    <div
      className={
        'border px-4 py-3 ' +
        (active ? 'border-phosphor bg-abyss' : 'border-grid bg-console')
      }
      data-testid="turn-banner"
      data-my-turn={view.isMyTurn ? '1' : '0'}
      data-active={active ? '1' : '0'}
      role="status"
      aria-live="polite"
    >
      <p
        key={text}
        className={
          'anim-banner-slide font-display text-base font-bold ' +
          (active ? 'text-phosphor' : 'text-foam')
        }
      >
        {text}
      </p>
    </div>
  );
}
