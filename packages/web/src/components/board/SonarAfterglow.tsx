/**
 * SonarAfterglow —— 相位锁定的「磷光余辉」层(Design §7.2 签名元素:扫过有标记的格子时,该标记短暂
 * 提亮再按磷光余辉曲线衰减;hit 用 --flare、miss 用 --phosphor 的衰减)。
 *
 * 经 BoardGrid 的 `overlay` 槽渲染,作 SonarSweep / Crosshair 的同级兄弟叠放。本组件**只**画余辉:
 * 由 SonarBoard 已算好的 marks(`Map<cellIdx, MarkKind>`)驱动,给每个 hit/miss 格在其格中心
 * (x*32+16, y*32+16)放一个余辉元件。**只读 marks、不回查 DOM**——故纯、可控,reduced-motion 时整层
 * 干净地不渲染(标记的静态着色由 BoardGrid 的 cellClassName/renderCell 提供,余辉只是其上的动态高光)。
 *
 * ── 相位锁定(与 SonarSweep 共用 document.timeline 原点,见 sonarPhase.ts)──
 * 每个余辉元件跑一条**同周期(8000ms)**动画,关键帧把**峰值放在本地时间 0**(offset 0 最亮),其后在
 * 周期前段按余辉曲线衰减到 0、剩余周期保持 0(暗,等下一圈)。设 `anim.startTime = cellStartTimeMs(x,y)`
 * = (θ/360)*8000——因 startTime 是共享时间轴上的**绝对**值,峰值恰好落在「扫描前沿 R(t)=θ」的时刻,即
 * 前沿扫过该格的瞬间。两个不同方位角的标记 startTime 不同 → 肉眼可见地在不同时刻达峰。
 *
 * **晚挂载自动入相**:一个刚 resolve 的命中(对战中途出现的新标记)其 startTime 仍按绝对时间轴算、
 * 而非按挂载时刻 → 一挂上就落在正确相位,无需任何校正。
 *
 * 只动 `opacity` + `filter: drop-shadow`(§7.4 合成层友好;drop-shadow 是 §7.2 点名的余辉手段)。
 *
 * reduced-motion(§7.4「保留颜色反馈」):useReducedMotion() 为真时**整层返回 null**(不创建任何动画)。
 * 命中/未命中的**颜色反馈**(bg-flare/80 格底 + ✸/◦ 字形)是 BoardGrid 的静态着色,不依赖本层,天然保留。
 * false↔true 实时切换由父级 overlay 重渲染 + 本组件 effect(deps 含 reduced)收口:切到 reduced 即卸载
 * 所有 glow 动画。
 */
import { useEffect, useRef } from 'react';
import { useReducedMotion } from '../../hooks/useReducedMotion.ts';
import { cellIdx, type MarkKind } from './battleMarks.ts';
import { CELL, N, SWEEP_PERIOD_MS, cellStartTimeMs } from './sonarPhase.ts';

export type SonarAfterglowProps = {
  /** SonarBoard 已算好的逐格标记(只取 hit/miss 做余辉;pending-out 不发光——§7.2 只点名 hit/miss)。 */
  marks: Map<number, MarkKind>;
};

/** 单个余辉元件的描述(由 marks 投影出)。 */
type Glow = { x: number; y: number; kind: 'hit' | 'miss' };

/**
 * 余辉动画关键帧:峰值在 offset 0,随后在周期前段(~16%≈1.28s)按「快起快落 + 短尾」的磷光曲线衰减到 0,
 * 其余周期(offset 0.16→1)保持 0(暗)。hit 与 miss 用不同色 + 不同尾长(hit 的火点收得稍慢、更扎眼)。
 *
 * 为什么峰在 offset 0:扫描前沿扫到该格的瞬间 == 动画本地时间 0(startTime 已对齐到该相位),此刻最亮,
 * 之后才衰减。周期边界(offset 1→0)即「前沿再次扫到」,瞬时回峰是正确的(那一刻确实又被扫到)。
 *
 * 只列 opacity + filter(drop-shadow 染对应色)。baseline(暗)= opacity 0,不占视觉。
 */
function glowKeyframes(kind: 'hit' | 'miss'): Keyframe[] {
  if (kind === 'hit') {
    // hit:--flare 火点。峰更亮、drop-shadow 更浓,尾巴拖到 ~16%(扎眼但仍是一次衰减,不是常亮脉冲)。
    return [
      { offset: 0, opacity: 1, filter: 'drop-shadow(0 0 5px rgba(255,122,69,0.95))' },
      { offset: 0.05, opacity: 0.85, filter: 'drop-shadow(0 0 4px rgba(255,122,69,0.7))' },
      { offset: 0.16, opacity: 0, filter: 'drop-shadow(0 0 0 rgba(255,122,69,0))' },
      { offset: 1, opacity: 0, filter: 'drop-shadow(0 0 0 rgba(255,122,69,0))' },
    ];
  }
  // miss:--phosphor 磷光点。衰减更干脆(尾更短 ~12%),余辉感但不喧宾夺主。
  return [
    { offset: 0, opacity: 0.95, filter: 'drop-shadow(0 0 4px rgba(53,224,200,0.85))' },
    { offset: 0.04, opacity: 0.75, filter: 'drop-shadow(0 0 3px rgba(53,224,200,0.6))' },
    { offset: 0.12, opacity: 0, filter: 'drop-shadow(0 0 0 rgba(53,224,200,0))' },
    { offset: 1, opacity: 0, filter: 'drop-shadow(0 0 0 rgba(53,224,200,0))' },
  ];
}

export default function SonarAfterglow({ marks }: SonarAfterglowProps) {
  const reduced = useReducedMotion();
  // 每个 glow 元件的 ref(按 cellIdx 索引),effect 里逐个 .animate + 钉相位。
  const refs = useRef<Map<number, HTMLSpanElement | null>>(new Map());

  // 从 marks 投影出要发光的格(只 hit/miss)。渲染与 effect 共用,保证 DOM 元件与动画一一对应。
  const glows: Glow[] = [];
  for (const [idx, kind] of marks) {
    if (kind === 'hit' || kind === 'miss') {
      glows.push({ x: idx % N, y: Math.floor(idx / N), kind });
    }
  }
  // glows 的稳定签名(idx:kind 升序拼接):作 effect 依赖,marks 内容变(新命中/未命中落格)才重建动画。
  const glowKey = glows
    .map((g) => `${cellIdx(g.x, g.y)}:${g.kind}`)
    .sort()
    .join(',');

  useEffect(() => {
    // reduced-motion:不创建任何 glow 动画(整层在 JSX 也返回 null,这里是双保险 + 提前返回)。
    if (reduced) return;
    const anims: Animation[] = [];
    for (const g of glows) {
      const el = refs.current.get(cellIdx(g.x, g.y));
      if (!el) continue;
      const anim = el.animate(glowKeyframes(g.kind), {
        duration: SWEEP_PERIOD_MS,
        iterations: Infinity,
        easing: 'linear', // 衰减形状已编码在关键帧 offset 上,timing 保持线性(相位对齐才精确)
      });
      // 钉到该格方位角对应的绝对相位:峰值 == 扫描前沿扫到该格的时刻(零漂移,晚挂载自动入相)。
      try {
        anim.startTime = cellStartTimeMs(g.x, g.y);
      } catch {
        /* timeline 未就绪:忽略,动画按默认相位播放(实践中 effect 运行时已就绪) */
      }
      anims.push(anim);
    }
    // 卸载 / 依赖变化 / HMR:取消全部 glow 动画,杜绝泄漏。
    return () => {
      for (const a of anims) a.cancel();
    };
    // deps 刻意只列 glowKey + reduced:glowKey 是 marks 里 hit/miss 内容的稳定字符串签名,glows 数组
    // 由它唯一决定(同 key 必同内容)。直接把 glows(每渲染新数组引用)放进 deps 会每帧重建动画、打断相位;
    // 用 glowKey 则仅在「命中/未命中集真的变了」或「reduced 切换」时重建,其余渲染零打断。glows 在闭包内读取最新值。
  }, [glowKey, reduced]);

  // reduced-motion:整层不渲染(无 glow 元件、无动画)。颜色反馈由 BoardGrid 静态着色保留。
  if (reduced) return null;

  return (
    <div data-testid="sonar-afterglow" aria-hidden>
      {glows.map((g) => {
        const idx = cellIdx(g.x, g.y);
        return (
          <span
            key={idx}
            ref={(el) => {
              refs.current.set(idx, el);
            }}
            data-glow={g.kind}
            className="absolute block"
            style={{
              // 格中心 (x*32+16, y*32+16);12px 方点用负 margin(半边)居中,不用 transform——transform 留给
              // 不存在的形变,本元件只动 opacity/filter,故定位走 left/top+margin,合成层只跑高光不跑位移。
              left: g.x * CELL + CELL / 2,
              top: g.y * CELL + CELL / 2,
              width: 12,
              height: 12,
              marginLeft: -6,
              marginTop: -6,
              borderRadius: 2, // §7.2 radius ≤ 4px
              background: g.kind === 'hit' ? 'var(--color-flare)' : 'var(--color-phosphor)',
              opacity: 0, // baseline 暗;动画把峰值瞬间提亮再落回 0
              willChange: 'opacity, filter',
            }}
          />
        );
      })}
    </div>
  );
}
