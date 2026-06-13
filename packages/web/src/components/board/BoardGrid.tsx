/**
 * BoardGrid —— 全站共用的 10×10 棋盘原语(Design §7.2 视觉纪律 + §7.7 质量底线)。
 *
 * **可复用契约**(3.5 布阵 PlacementBoard、3.7 对战 OwnBoard/SonarBoard 都基于它,故刻意保持
 * 纯展示 / 受控,不内置任何业务逻辑):
 *   - 渲染坐标轴(A–J 列 / 1–10 行,等宽字体,字母经 format 的 COLS 同一来源)+ 100 个**真 <button>** 格;
 *   - 每格内容由 renderCell(x,y) 渲染、样式由 cellClassName(x,y) 决定、可达性标签由 ariaLabel(x,y) 给——
 *     全是 props 注入的钩子,棋盘本身不知道「己方/敌方/预览/命中」这些语义(那是各 Board 的事);
 *   - 交互回调 onCellClick/onCellHover/onCellFocus(x,y) + onCellKeyDown(x,y,e)(非方向键转交父级处理,
 *     如布阵幕的 R/Esc/Enter);
 *   - **roving tabindex**(§7.7 键盘可达):整盘只有一个 tabstop,方向键移动焦点(上下左右 / Home/End),
 *     焦点格 tabIndex=0 其余 -1,移动时 .focus() 真实 DOM 聚焦;焦点环用 outline phosphor(可见焦点)。
 *
 * 为什么 roving tabindex 而非 100 个 tabstop:100 格各自可 Tab 会让键盘用户按 100 次才出棋盘,
 * 违反 §7.7;ARIA grid 模式标准解是「容器一个 tabstop,方向键在内部移动」。本组件把焦点格记在内部
 * 状态(focus 是纯 UI 关注点,不属于布阵业务态,故不上提到父 reducer),父级只通过 onCellFocus 得知
 * 焦点落在哪格(布阵幕据此把预览跟到键盘焦点格)。
 *
 * 视觉(§7.2 锁定):1px --grid 边框、4px 基准间距、直角(无圆角);颜色由 cellClassName 决定,
 * 本组件只铺骨架(边框 + 焦点环 + 等宽轴标),不引入调色板外的颜色。
 */
import { useCallback, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';

/** A–J 列字母(与 format.ts 的 COLS 同序;棋盘恒 10 列)。 */
const COLS = 'ABCDEFGHIJ';

export type BoardGridProps = {
  /** 格内容(标记 / 预览 / 命中点等)。返回 null 即空格。 */
  renderCell?: (x: number, y: number) => ReactNode;
  /** 该格的样式 class(背景 / 文字色;决定语义着色)。 */
  cellClassName?: (x: number, y: number) => string;
  /** 该格 aria-label(如 "D-7 未探测" / "D-7 已放置 航母")。§7.7 每格可读。 */
  ariaLabel?: (x: number, y: number) => string;
  /** 点击格(开炮 / 落子 / 拿起)。 */
  onCellClick?: (x: number, y: number) => void;
  /** hover 进入格(预览跟随 / 十字准星)。 */
  onCellHover?: (x: number, y: number) => void;
  /** 焦点进入格(键盘移动焦点时;布阵幕据此把预览跟到焦点格)。 */
  onCellFocus?: (x: number, y: number) => void;
  /** 非方向键的键盘事件转交父级(R/Esc/Enter 等)。方向键已被本组件消费用于移动焦点。 */
  onCellKeyDown?: (x: number, y: number, e: KeyboardEvent) => void;
  /** 鼠标移出整个网格(清预览 / 收准星)。 */
  onLeave?: () => void;
  /** 整盘禁用(锁定后):格 disabled,无 hover/click,焦点环仍可见(只读浏览)。 */
  disabled?: boolean;
  /** 数据测试钩子前缀,默认 "board";格 testid = `${testIdPrefix}-cell-{x}-{y}`。 */
  testIdPrefix?: string;
  /** 无障碍:整盘的 aria-label(如 "布阵棋盘" / "敌方海域")。 */
  label?: string;
};

/**
 * 受控 10×10 棋盘。焦点格内部自管(roving tabindex);其余全部来自 props 钩子。
 */
export default function BoardGrid({
  renderCell,
  cellClassName,
  ariaLabel,
  onCellClick,
  onCellHover,
  onCellFocus,
  onCellKeyDown,
  onLeave,
  disabled = false,
  testIdPrefix = 'board',
  label,
}: BoardGridProps) {
  // 焦点格(roving tabindex 的唯一 tabstop)。初始 (0,0);方向键移动它并 .focus() 真实聚焦。
  const [focus, setFocus] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  // 100 格 button 的 ref,移动焦点时取目标格 .focus()。
  const cellRefs = useRef<(HTMLButtonElement | null)[]>([]);

  const focusTo = useCallback((x: number, y: number) => {
    const nx = Math.max(0, Math.min(9, x));
    const ny = Math.max(0, Math.min(9, y));
    setFocus({ x: nx, y: ny });
    cellRefs.current[ny * 10 + nx]?.focus();
  }, []);

  const handleKeyDown = useCallback(
    (x: number, y: number, e: KeyboardEvent<HTMLButtonElement>) => {
      // 方向键 / Home / End:本组件消费(移动 roving 焦点),阻止页面滚动。
      switch (e.key) {
        case 'ArrowUp':
          e.preventDefault();
          focusTo(x, y - 1);
          return;
        case 'ArrowDown':
          e.preventDefault();
          focusTo(x, y + 1);
          return;
        case 'ArrowLeft':
          e.preventDefault();
          focusTo(x - 1, y);
          return;
        case 'ArrowRight':
          e.preventDefault();
          focusTo(x + 1, y);
          return;
        case 'Home':
          e.preventDefault();
          focusTo(0, y);
          return;
        case 'End':
          e.preventDefault();
          focusTo(9, y);
          return;
        default:
          // 其余键(R/Esc/Enter/Space…)转交父级。Enter/Space 的「激活」由 button 原生 onClick 兜,
          // 这里只把额外语义键(布阵幕 R 旋转 / Esc 取消)交出去。
          onCellKeyDown?.(x, y, e);
      }
    },
    [focusTo, onCellKeyDown],
  );

  return (
    <div
      className="inline-block select-none"
      role="grid"
      aria-label={label}
      data-testid={testIdPrefix}
      onMouseLeave={onLeave}
    >
      {/* 列轴:左上角空 + A–J */}
      <div className="flex" aria-hidden>
        <span className="h-5 w-5" />
        {COLS.split('').map((c) => (
          <span
            key={c}
            className="flex h-5 w-8 items-center justify-center font-mono text-[10px] text-mist"
          >
            {c}
          </span>
        ))}
      </div>

      {/* 10 行:每行 行号 + 10 格 */}
      {Array.from({ length: 10 }, (_, y) => (
        <div className="flex" role="row" key={y}>
          {/* 行号轴(1–10) */}
          <span
            aria-hidden
            className="flex h-8 w-5 items-center justify-center font-mono text-[10px] text-mist"
          >
            {y + 1}
          </span>
          {Array.from({ length: 10 }, (_, x) => {
            const isFocus = focus.x === x && focus.y === y;
            const cls = cellClassName?.(x, y) ?? '';
            return (
              <button
                key={x}
                type="button"
                role="gridcell"
                ref={(el) => {
                  cellRefs.current[y * 10 + x] = el;
                }}
                // roving tabindex:仅焦点格进 Tab 序;方向键在内部移动焦点。
                tabIndex={isFocus ? 0 : -1}
                disabled={disabled}
                aria-label={ariaLabel?.(x, y)}
                data-testid={`${testIdPrefix}-cell-${x}-${y}`}
                onClick={() => onCellClick?.(x, y)}
                onMouseEnter={() => onCellHover?.(x, y)}
                onFocus={() => {
                  setFocus({ x, y });
                  onCellFocus?.(x, y);
                }}
                onKeyDown={(e) => handleKeyDown(x, y, e)}
                className={
                  // 1px --grid 边框、固定 32px 方格(§7.2 直角细边);焦点环 outline phosphor(§7.7 可见焦点)。
                  'relative h-8 w-8 border border-grid p-0 text-center align-middle ' +
                  'focus:z-10 focus:outline focus:outline-2 focus:outline-phosphor focus:outline-offset-[-2px] ' +
                  'disabled:cursor-default ' +
                  cls
                }
              >
                {renderCell?.(x, y)}
              </button>
            );
          })}
        </div>
      ))}
    </div>
  );
}
