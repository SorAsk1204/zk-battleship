/**
 * sonarPhase —— 声呐扫描线 / 相位锁定余辉的**纯相位数学**(Design §7.2 签名元素 + §7.4 动效预算)。
 *
 * 这是 M4 Task 4.1「敌方海域=活的声呐屏」的几何内核,刻意抽成无 React / 无 DOM 的纯模块:
 * 本仓 vitest 是 node 环境(无 jsdom),`element.animate` / `document.timeline` 在测试里不可用且无意义;
 * 唯一能单测、也必须钉死的,是「格中心方位角 θ」与「θ → 余辉动画 startTime」这套映射——一旦角度约定
 * 错了,余辉会在错误的时刻提亮(扫描线扫到 A 格时却是 B 格在亮),在浏览器里一眼可见。把它隔离 + 单测,
 * 就把「相位锁定」的正确性钉死在不依赖浏览器的层。
 *
 * ──────────────────────────────────────────────────────────────────────────────
 * 角度约定(全模块、扫描线、余辉**必须**共用同一零点 + 同一方向,否则相位对不上):
 *
 *   0° = 正上方(12 点钟方向),角度顺时针增大。
 *
 * 为什么是这个约定:扫描层是一个 CSS `conic-gradient`,经 WAAPI `transform: rotate(deg)` 旋转。
 * CSS conic-gradient 的角度零点天然在 12 点钟、顺时针增大;我们把扫描线的**前沿(leading edge,
 * 扫过时最亮的那条边)**放在该 conic 的 0° 刻度处。于是当扫描层被 `rotate(R)` 旋转时,前沿在屏幕上
 * 指向「顺时针-自上」角度 = R。格的方位角 θ 必须用**同一零点同一方向**测量,才能让
 * 「时刻 t 的前沿角度」== 「该格方位角」恰好在余辉峰值时成立。
 *
 * 屏幕坐标系:+x 向右,**+y 向下**(DOM 惯例,与覆盖层 px 定位一致)。在该系下,顺时针-自上 的
 * 方位角公式是 `θ = atan2(dx, -dy)`(dy 取负把「屏幕 y 向下」翻成「数学上方为正」):
 *   - 正上 (dx=0, dy=-1) → atan2(0, 1)   = 0°
 *   - 正右 (dx=1, dy=0)  → atan2(1, 0)   = 90°
 *   - 正下 (dx=0, dy=1)  → atan2(0, -1)  = 180°
 *   - 正左 (dx=-1, dy=0) → atan2(-1, 0)  = -90° → 归一化 270°
 * 与「顺时针、上为零」逐一吻合。
 * ──────────────────────────────────────────────────────────────────────────────
 *
 * 相位锁定(零漂移、晚挂载自动入相)的原理:
 *   扫描层以 SWEEP_PERIOD_MS(8000ms)旋转 360°,且 `anim.startTime = 0`(钉到 document.timeline 原点)。
 *   于是任意时刻前沿角度 R(t) = (t mod 8000) / 8000 * 360,是 wall-clock 的确定函数,对时间轴上每个元素都一样。
 *   前沿扫过方位角 θ 的时刻满足 R(t) = θ,即 t ≡ (θ/360)*8000 (mod 8000)。
 *   每个 hit/miss 标记给一条**同周期(8000ms)**的余辉动画,其关键帧把**峰值放在本地时间 0**(也即 1.0,循环),
 *   并设 `startTime = (θ/360)*8000`。因为 startTime 是共享时间轴上的**绝对**值,该动画的峰值就恰好落在
 *   前沿扫到 θ 的时刻;一个晚挂载的标记(刚 resolve 的命中)也因偏移是对绝对时间轴算的、而非对挂载时刻算的,
 *   自动落到正确相位。全程零 per-frame JS、零 setInterval、零漂移。
 */

/** 扫描线旋转周期(ms):8s/圈(§7.2 verbatim「8s/圈匀速旋转」)。余辉动画同周期,相位才能锁住。 */
export const SWEEP_PERIOD_MS = 8000;

/** 每格边长(px),与 BoardGrid 的 h-8/w-8(32px)、Crosshair 的 CELL 同一来源。 */
export const CELL = 32;

/** 棋盘格数(10×10)。 */
export const N = 10;

/** 格阵总边长(px)= N*CELL = 320。覆盖层(及 conic 扫描层)就是这个尺寸的正方形。 */
export const BOARD_PX = N * CELL;

/** 板心(px):格阵正中 = (160, 160)。扫描层绕此旋转,方位角以此为原点。 */
export const CENTER_PX = BOARD_PX / 2;

/**
 * 格 (x,y) 中心相对板心的方位角 θ(度,[0,360)),约定:**0°=正上,顺时针增大**(见模块注释)。
 *
 * 板心格(理论上不存在——偶数边长 10 没有正中格,板心落在四格交点)若恰好传入 dx=dy=0,
 * atan2(0,0)=0,返回 0°(无害兜底:这种格不会有标记,即便有也只是相位定在 0°)。
 *
 * @param x 列(0..9)
 * @param y 行(0..9)
 * @returns 方位角(度),[0,360)
 */
export function cellAzimuthDeg(x: number, y: number): number {
  const cx = x * CELL + CELL / 2; // 格中心 x(px)
  const cy = y * CELL + CELL / 2; // 格中心 y(px)
  const dx = cx - CENTER_PX; // 相对板心 +x 向右
  const dy = cy - CENTER_PX; // 相对板心 +y 向下
  // atan2(dx, -dy):把「屏幕 y 向下」翻成「上为正」,得「顺时针、上为零」的角(弧度)。
  const rad = Math.atan2(dx, -dy);
  let deg = (rad * 180) / Math.PI; // (-180, 180]
  if (deg < 0) deg += 360; // 归一化到 [0,360)
  return deg;
}

/**
 * 方位角 θ → 余辉动画的 `startTime`(ms,document.timeline 绝对时间)。
 *
 * = (θ/360) * SWEEP_PERIOD_MS。把 [0,360) 的角线性映到 [0,8000) 的相位偏移:扫描前沿扫到 θ 的时刻
 * 即此值(模周期)。余辉动画把峰值放在本地时间 0,设 startTime 为此 → 峰值与「前沿扫到该格」对齐。
 *
 * @param azimuthDeg 方位角(度),约定 [0,360)
 * @returns startTime(ms),[0, SWEEP_PERIOD_MS)
 */
export function azimuthToStartTimeMs(azimuthDeg: number): number {
  return (azimuthDeg / 360) * SWEEP_PERIOD_MS;
}

/**
 * 便捷复合:格 (x,y) → 余辉动画 startTime(ms)。= azimuthToStartTimeMs(cellAzimuthDeg(x,y))。
 * 余辉覆盖层逐标记调用一次(挂载时定相),之后零 JS。
 */
export function cellStartTimeMs(x: number, y: number): number {
  return azimuthToStartTimeMs(cellAzimuthDeg(x, y));
}
