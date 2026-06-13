/**
 * useReducedMotion —— 读取并订阅 `prefers-reduced-motion: reduce`(Design §7.4 动效预算)。
 *
 * §7.4 要求:`prefers-reduced-motion` 时扫描线停转、抖动取消、**保留颜色反馈**。本项目绝大多数动效
 * 属 M4(声呐扫描 / 命中涟漪 / 脉冲 / 抖动 / 结算扫屏),M3 只建**基线 + 脚手架**:
 *   - 现有的 CSS **过渡**(transition)由 index.css 的全局 `@media (prefers-reduced-motion: reduce)`
 *     基线即时完成(无需本 hook);
 *   - **本 hook** 给 M4 用:任何由 JS 条件渲染 / 条件挂载的动效(scanline/ripple/pulse/shake)必须
 *     `useReducedMotion()` 为真时退化为静态(只留颜色反馈)。M3 先把这个判定口径建好、单测好,M4 直接用。
 *
 * 实现:`window.matchMedia('(prefers-reduced-motion: reduce)')` + useSyncExternalStore 订阅其 change
 * (用户在系统设置里实时切 reduced-motion,组件即时跟随,无需刷新)。SSR / 无 matchMedia(node 单测)
 * 环境安全降级为 false(默认「允许动效」——基线不打折扣,只在明确 reduce 时退化)。
 *
 * 传入什么 / 返回什么:无入参;返回 boolean(true = 用户要求减少动态效果)。内部不持有业务状态。
 */
import { useSyncExternalStore } from 'react';

/** 媒体查询串(单一来源,hook 与潜在的其它读取点共用)。 */
export const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';

/**
 * 当前是否处于 reduced-motion(纯读取,可在非 React 处 / 单测调用)。
 * 无 window / 无 matchMedia(node、老环境)→ false(安全降级:默认允许动效,不误伤正常用户)。
 */
export function getReducedMotionSnapshot(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return false;
  }
  return window.matchMedia(REDUCED_MOTION_QUERY).matches;
}

/** SSR / node 快照:恒 false(服务端无「用户偏好」,客户端 hydrate 后由真实 mql 接管)。 */
function getServerSnapshot(): boolean {
  return false;
}

/**
 * 订阅 reduced-motion 偏好变化。返回取消订阅函数。无 matchMedia → no-op(快照恒 false,无变化可订)。
 * 兼容老 Safari(addListener/removeListener)与现代浏览器(addEventListener('change'))。
 */
function subscribe(onChange: () => void): () => void {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return () => {};
  }
  const mql = window.matchMedia(REDUCED_MOTION_QUERY);
  if (typeof mql.addEventListener === 'function') {
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }
  // 老 Safari 回退(addListener 已弃用但部分旧环境仍只有它)。
  mql.addListener(onChange);
  return () => mql.removeListener(onChange);
}

/**
 * useReducedMotion —— 订阅式读取用户的 reduced-motion 偏好。
 * @returns true 表示用户要求减少动态效果(组件应退化为静态 + 保留颜色反馈,§7.4)。
 */
export function useReducedMotion(): boolean {
  return useSyncExternalStore(subscribe, getReducedMotionSnapshot, getServerSnapshot);
}
