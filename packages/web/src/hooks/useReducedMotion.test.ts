/**
 * useReducedMotion 单测 —— 覆盖 getReducedMotionSnapshot 的环境守卫 + 偏好读取(Task 3.9 §7.4 基线)。
 *
 * vitest 跑 node 环境(无 window):验证
 *   (1) 无 window / 无 matchMedia → false(安全降级,不误伤正常用户);
 *   (2) 注入一个 matches=true 的假 matchMedia → true;matches=false → false;
 *   (3) 媒体查询串恒为标准的 '(prefers-reduced-motion: reduce)'(契约:CSS 基线与 hook 同一口径)。
 * 不渲染 React(本仓无 testing-library / jsdom):只测纯读取函数,hook 本体的订阅在浏览器手测验收。
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { REDUCED_MOTION_QUERY, getReducedMotionSnapshot } from './useReducedMotion.ts';

describe('useReducedMotion / getReducedMotionSnapshot', () => {
  afterEach(() => {
    // 清掉本测试注入的 window 桩,避免污染其它用例(node 环境本无 window)。
    vi.unstubAllGlobals();
  });

  it('媒体查询串是标准的 prefers-reduced-motion: reduce(与 CSS 基线同口径)', () => {
    expect(REDUCED_MOTION_QUERY).toBe('(prefers-reduced-motion: reduce)');
  });

  it('无 window(node 环境)→ false(安全降级)', () => {
    // node 环境默认无 window;直接断言。
    expect(typeof window).toBe('undefined');
    expect(getReducedMotionSnapshot()).toBe(false);
  });

  it('有 window 但无 matchMedia → false', () => {
    vi.stubGlobal('window', {} as unknown as Window);
    expect(getReducedMotionSnapshot()).toBe(false);
  });

  it('matchMedia 返回 matches=true → true', () => {
    const matchMedia = vi.fn((q: string) => ({
      matches: true,
      media: q,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }));
    vi.stubGlobal('window', { matchMedia } as unknown as Window);
    expect(getReducedMotionSnapshot()).toBe(true);
    expect(matchMedia).toHaveBeenCalledWith(REDUCED_MOTION_QUERY);
  });

  it('matchMedia 返回 matches=false → false', () => {
    const matchMedia = vi.fn((q: string) => ({
      matches: false,
      media: q,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }));
    vi.stubGlobal('window', { matchMedia } as unknown as Window);
    expect(getReducedMotionSnapshot()).toBe(false);
  });
});
