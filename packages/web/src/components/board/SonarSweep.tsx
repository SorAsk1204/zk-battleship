/**
 * SonarSweep —— 敌方声呐屏的「常驻扫描线」(Design §7.2 签名元素 + §7.4 动效预算)。
 *
 * 经 BoardGrid 的 `overlay` 槽渲染(绝对定位、pointer-events:none,对齐到 100 格区域原点,
 * 见 BoardGrid 模块注释「两类视觉钩子」)。本组件**只**画那束旋转扫描线,不画十字准星(那是 Crosshair)、
 * 不画余辉(那是 SonarAfterglow)——三者作为 overlay 的同级兄弟叠放。
 *
 * ── 机制(为什么这样设计,见 sonarPhase.ts 模块注释)──
 * 扫描层 = 一个 `conic-gradient`:它的零点天然在 12 点钟、顺时针增大,我们把**前沿(leading edge,
 * 扫过时最亮的那条边)**放在该锥形渐变的 0° 刻度。半透明 --phosphor 的亮边在约 40° 弧内淡出到透明
 * (低 alpha 的 CRT 余辉,不是频闪)。
 *
 * 旋转 = WAAPI `el.animate({transform: rotate(0deg→360deg)}, {duration:8000, iterations:Infinity})`,
 * 然后 **`anim.startTime = 0`** 把动画钉到 `document.timeline` 原点。于是任意时刻前沿角度
 * R(t) = (t mod 8000)/8000*360,是 wall-clock 的确定函数——与本组件挂载时刻无关,且与每个余辉标记
 * 共用同一相位基准。余辉标记据其方位角 θ 把峰值对齐到「R(t)=θ」的时刻(见 SonarAfterglow),从而
 * 扫描前沿扫过某格的瞬间,该格余辉恰好达峰。**零 per-frame JS、零 setInterval、零漂移。**
 *
 * 只动 `transform`(rotate)——合成层友好(§7.4「所有动画走 CSS transform/opacity」)。
 *
 * reduced-motion(§7.4「prefers-reduced-motion 时扫描线停转」):useReducedMotion() 为真时**不创建**
 * 旋转动画,只渲染静止的 conic 层(保留那束磷光的存在感但不转)。从 false→true 实时切换:
 * effect 的 deps 含 reduced 布尔,重跑时先 cancel 旧动画再按新状态决定是否重建,实时停转/复转。
 * (本仓 index.css 的 reduced-motion 基线只停 CSS transition,不碰 WAAPI 动画——故必须在此 JS 侧 gate。)
 */
import { useEffect, useRef } from 'react';
import { useReducedMotion } from '../../hooks/useReducedMotion.ts';
import { BOARD_PX, SWEEP_PERIOD_MS } from './sonarPhase.ts';

/**
 * 扫描层的 conic-gradient(前沿在 0°=正上,顺时针淡出)。
 * 低 alpha 的 --phosphor 亮边 → 约 40° 弧内衰减到透明 → 其余圆周透明(只有一束扫过的亮边,不是整盘泛光)。
 * 用 --color-phosphor 的 rgb 直写 alpha(Tailwind @theme 调色板外不新增颜色——这是同一 --phosphor 的不同透明度)。
 */
const SWEEP_GRADIENT =
  'conic-gradient(from 0deg, ' +
  'rgba(53, 224, 200, 0.22) 0deg, ' + // 前沿:最亮的一条边(低 alpha)
  'rgba(53, 224, 200, 0.10) 12deg, ' +
  'rgba(53, 224, 200, 0.03) 28deg, ' +
  'rgba(53, 224, 200, 0) 40deg, ' + // 40° 后完全透明
  'rgba(53, 224, 200, 0) 360deg)';

export default function SonarSweep() {
  const reduced = useReducedMotion();
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    // reduced-motion:不创建旋转动画(静止 conic 层已在 JSX 渲染),直接返回(无动画可清理)。
    if (reduced) return;

    const anim = el.animate(
      [{ transform: 'rotate(0deg)' }, { transform: 'rotate(360deg)' }],
      { duration: SWEEP_PERIOD_MS, iterations: Infinity, easing: 'linear' },
    );
    // 钉到 document.timeline 原点:所有扫描线/余辉共用绝对相位基准,与挂载时刻无关(零漂移)。
    // 防御:个别环境 timeline.currentTime 尚为 null 时写 startTime 会抛,吞掉(动画仍按默认相位转,
    // 不影响功能,只是该实例相位基准退化为挂载时刻——实践中 effect 运行时 timeline 已就绪)。
    try {
      anim.startTime = 0;
    } catch {
      /* timeline 未就绪:忽略,动画照常播放 */
    }
    return () => anim.cancel();
  }, [reduced]);

  return (
    <div
      ref={ref}
      data-testid="sonar-sweep"
      aria-hidden
      className="absolute"
      style={{
        left: 0,
        top: 0,
        width: BOARD_PX,
        height: BOARD_PX,
        background: SWEEP_GRADIENT,
        // 旋转绕几何中心(板心 160,160);transform-box 默认 border-box 即此正方形中心。
        transformOrigin: 'center',
        willChange: 'transform',
      }}
    />
  );
}
