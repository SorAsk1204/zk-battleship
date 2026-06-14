/**
 * useBoardShake —— 命中时棋盘容器的一次性横向抖动(Design §7.3 + §7.4 动效预算)。
 *
 * §7.3(verbatim):hit → --flare 脉冲 + **棋盘容器 120ms 横向 2px 抖动** + 留下持续低频闪烁的火点。
 *
 * 职责单一:给定一个容器 ref,返回一个 `shake()` 触发器;调用即对该容器跑一记 120ms、横向 ±2px 的
 * WAAPI translateX 抖动(一次,不循环)。**谁来判定「新命中」不归本 hook**——由 ShotBurst 的增量核
 * (newlyResolved,唯一真相源)在新 hit 到达时经 onHit 调用本 shake,避免两套各自的「已见格」分叉。
 * 本 hook 只管「抖这一下」与 reduced-motion gate。
 *
 * 为什么抖**容器**而非格:§7.3 明写「棋盘容器抖动」——命中的物理反馈是整盘一震,不是单格位移。
 * 故父级(SonarBoard/OwnBoard)把 ref 挂在**包住 BoardGrid 的 wrapper div** 上(不改 BoardGrid 通用
 * 契约),抖 wrapper 即抖整盘(轴标随之一起,视觉是整块作战屏一震)。
 *
 * reduced-motion(§7.4「抖动取消」):useReducedMotion() 为真时 shake() 直接 no-op(不创建动画)。
 * 颜色反馈(命中 --flare 格)与脉冲层无关、照常;只有这记位移被取消。live 切换:shake 闭包每次调用都
 * 读最新 reduced(经 ref),无需重建。
 *
 * 只动 transform(translateX)——合成层友好(§7.4)。同一容器上连续命中:新动画 replace 旧的
 * (WAAPI 默认 'replace' composite),不叠加抖幅;在飞动画在组件卸载时由本 hook cancel。
 *
 * 传入什么 / 返回什么:入参 = 容器 ref(HTMLElement);返回 = 稳定的 shake 函数(引用恒定,可安全
 * 作 prop 传给 ShotBurst 而不触发其 effect 重跑)。
 */
import { useCallback, useEffect, useRef, type RefObject } from 'react';
import { useReducedMotion } from './useReducedMotion.ts';

/** 抖动时长(ms)与幅度(px):§7.3 verbatim「120ms 横向 2px」。 */
const SHAKE_MS = 120;
const SHAKE_PX = 2;

/**
 * 横向抖动关键帧:0 → +2 → -2 → +1 → 0,一记快速回正的左右晃(末态回原位,不留位移)。
 * 只动 transform(translateX)。两端归零保证抖完精确回位,不影响布局。
 */
const SHAKE_KEYFRAMES: Keyframe[] = [
  { offset: 0, transform: 'translateX(0)' },
  { offset: 0.25, transform: `translateX(${SHAKE_PX}px)` },
  { offset: 0.5, transform: `translateX(-${SHAKE_PX}px)` },
  { offset: 0.75, transform: `translateX(${SHAKE_PX / 2}px)` },
  { offset: 1, transform: 'translateX(0)' },
];

/**
 * 返回一个 shake() 触发器:对 ref 容器跑一次 120ms ±2px 横向抖动(reduced-motion 时 no-op)。
 * @param ref 要抖动的容器(父级挂在包住 BoardGrid 的 wrapper 上)
 */
export function useBoardShake(ref: RefObject<HTMLElement | null>): () => void {
  const reduced = useReducedMotion();
  // reduced 与在飞动画以 ref 持有,使 shake 闭包引用恒定(可安全作 prop),内部读最新值。
  const reducedRef = useRef(reduced);
  reducedRef.current = reduced;
  const animRef = useRef<Animation | null>(null);

  const shake = useCallback(() => {
    if (reducedRef.current) return; // §7.4:reduced 取消抖动(颜色反馈不依赖此,照常)
    const el = ref.current;
    if (!el) return;
    // 取消在飞的上一记(连续命中不叠加抖幅;WAAPI replace 也会处理,这里显式更稳)。
    animRef.current?.cancel();
    animRef.current = el.animate(SHAKE_KEYFRAMES, {
      duration: SHAKE_MS,
      easing: 'ease-in-out',
    });
  }, [ref]);

  // 卸载:取消在飞抖动,杜绝泄漏。
  useEffect(() => {
    return () => {
      animRef.current?.cancel();
    };
  }, []);

  return shake;
}
