/**
 * Crosshair —— 敌方声呐屏的十字准星(Design §7.3 对战幕:我方回合 hover/focus 出十字准星)。
 *
 * 经 BoardGrid 的 `overlay` 槽渲染(跨格覆盖层:绝对定位、pointer-events:none,对齐到 100 格区域
 * 原点,见 BoardGrid 模块注释「两类视觉钩子」)。本组件不画逐格标记(那走 renderCell),只画:
 *   - 一条贯穿当前列的竖线(x 列中心)+ 一条贯穿当前行的横线(y 行中心);
 *   - 准星格右上角一个坐标角标(formatCoord,等宽,§7.3「坐标角标」)。
 *
 * 坐标系:BoardGrid 每格 32px(h-8 w-8),无格间距(相邻 button 1px 边框共享),格 (x,y) 的中心
 * 在覆盖层内 = (x*32 + 16, y*32 + 16)px;列竖线 left=x*32+16、行横线 top=y*32+16。用 px 绝对定位
 * 而非百分比:棋盘恒 10×10×32px,像素对齐最准(百分比在 320px 上虽等价,但 px 更直白、无取整漂移)。
 *
 * 视觉(§7.2 锁定):线用 --phosphor(可交互高亮主色),1px,低透明(不盖死标记);角标 --phosphor
 * 等宽小字。**功能版**:静态线 + 角标,无动画(声呐扫描 / 余辉是 M4)。reduced-motion 无关(本就无动)。
 *
 * 纯展示:cell 由调用方(SonarBoard)按当前 hover/focus 格传入;cell===null(未悬停)→ 不渲染
 * (返回 null),BoardGrid 的 overlay 包裹层仍在但空。仅在「我方攻击回合」由 SonarBoard 决定是否挂载。
 */
import type { CSSProperties } from 'react';
import { formatCoord } from '../../lib/format.ts';

/** 每格边长(px),与 BoardGrid 的 h-8/w-8 一致(32px)。 */
const CELL = 32;
/** 棋盘格数(10×10)。 */
const N = 10;

export type CrosshairProps = {
  /** 当前准星落点(hover / focus 的格);null = 不显示。 */
  cell: { x: number; y: number } | null;
};

export default function Crosshair({ cell }: CrosshairProps) {
  if (!cell) return null;
  const { x, y } = cell;
  // 越界保护(理论不达:SonarBoard 只在界内格派 cell):越界则不画,避免负偏移/错位。
  if (x < 0 || x >= N || y < 0 || y >= N) return null;

  const cx = x * CELL + CELL / 2; // 当前列中心 px
  const cy = y * CELL + CELL / 2; // 当前行中心 px
  const full = N * CELL; // 格阵总边长 px

  // 角标默认贴准星格右侧外缘;靠右两列(x>=8)会越过格阵右缘,改贴左侧外缘(右对齐到格左边)。
  const labelRight = x < N - 2;
  const labelStyle: CSSProperties = labelRight
    ? { left: x * CELL + CELL + 1, top: y * CELL + 1 }
    : { right: (N - x) * CELL + 1, top: y * CELL + 1 };

  return (
    <div data-testid="crosshair" data-coord={formatCoord(x, y)}>
      {/* 竖线:贯穿当前列,从顶到底 */}
      <span
        aria-hidden
        className="absolute bg-phosphor/40"
        style={{ left: cx, top: 0, width: 1, height: full }}
      />
      {/* 横线:贯穿当前行,从左到右 */}
      <span
        aria-hidden
        className="absolute bg-phosphor/40"
        style={{ left: 0, top: cy, width: full, height: 1 }}
      />
      {/* 坐标角标:准星格外缘(右/左自适应,避免靠右列越界) */}
      <span
        aria-hidden
        className="absolute font-mono text-[9px] leading-none text-phosphor"
        style={labelStyle}
      >
        {formatCoord(x, y)}
      </span>
    </div>
  );
}
