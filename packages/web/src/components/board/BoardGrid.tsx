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
 * **两类视觉钩子,别混用**(3.7 复用要点):
 *   - 逐格静态标记(船 ▦、命中/未命中点、预览底色)走 renderCell / cellClassName(每格各自渲染);
 *   - **跨格的整体视觉**(SonarBoard §7.3 的「整行 + 整列」十字准星、M4 旋转声呐扫描)走 overlay——
 *     一层绝对定位、pointer-events:none 的覆盖层,对齐到 100 格区域原点(不含轴标 gutter),
 *     由调用方画一条贯穿的线/一束扫描,而不是给每格塞 border hack。
 *
 * **跳禁用格**(3.7 SonarBoard 要点):isCellDisabled(x,y) 为真的格 disabled + aria-disabled
 * (不可点、SR 播报禁用),且 roving 走子**跳过**它(方向键沿travel方向找下一个可用格,该方向无则原地;
 * Home/End 取当前行首/尾可用格;初始 tabstop 落行主序第一个可用格)。走子规则是纯函数,见 boardFocus.ts
 * + boardFocus.test.ts。**isCellDisabled 省略时(布阵幕情形)走子与抽取前逐位等价**,行为零变更。
 *
 * 视觉(§7.2 锁定):1px --grid 边框、4px 基准间距、直角(无圆角);颜色由 cellClassName 决定,
 * 本组件只铺骨架(边框 + 焦点环 + 等宽轴标),不引入调色板外的颜色。
 */
import { useCallback, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import {
  BOARD_SIZE,
  STEP_DOWN,
  STEP_LEFT,
  STEP_RIGHT,
  STEP_UP,
  firstEnabledInRow,
  lastEnabledInRow,
  nextEnabledInDirection,
  seedFocus,
  type FocusTarget,
} from './boardFocus.ts';

/** A–J 列字母(与 format.ts 的 COLS 同序;棋盘恒 10 列)。 */
const COLS = 'ABCDEFGHIJ';

export type BoardGridProps = {
  /** 格内容(标记 / 预览 / 命中点等)。返回 null 即空格。逐格静态标记走这里(对比 overlay)。 */
  renderCell?: (x: number, y: number) => ReactNode;
  /** 该格的样式 class(背景 / 文字色;决定语义着色)。 */
  cellClassName?: (x: number, y: number) => string;
  /** 该格 aria-label(如 "D-7 未探测" / "D-7 已放置 航母")。§7.7 每格可读。 */
  ariaLabel?: (x: number, y: number) => string;
  /**
   * 该格是否禁用(如 SonarBoard 已开炮的格:不可再开炮)。为真:button disabled + aria-disabled,
   * 且方向键 roving 走子**跳过**它(不会停在禁用格)。省略 = 无格禁用(布阵幕情形,走子行为不变)。
   * 注意与整盘 disabled 的区别:isCellDisabled 影响走子可达性(跳过);整盘 disabled 只读浏览、走子照常停每格。
   */
  isCellDisabled?: (x: number, y: number) => boolean;
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
  /**
   * 初始 roving 焦点(唯一 tabstop)的落点。省略则取行主序第一个可用格(若 (0,0) 可用即 (0,0))。
   * 给定但该格禁用/越界 → 回退到第一个可用格。仅决定首个 tabstop,不强制后续走子。
   */
  initialFocus?: FocusTarget;
  /**
   * 跨格覆盖层(十字准星 / 声呐扫描等):绝对定位、pointer-events:none,对齐到 100 格区域原点
   * (不含轴标 gutter)。省略时不渲染(DOM 仅多一个不影响布局的 relative 包裹)。逐格标记请用 renderCell。
   */
  overlay?: ReactNode;
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
  isCellDisabled,
  onCellClick,
  onCellHover,
  onCellFocus,
  onCellKeyDown,
  onLeave,
  disabled = false,
  initialFocus,
  overlay,
  testIdPrefix = 'board',
  label,
}: BoardGridProps) {
  // 焦点格(roving tabindex 的唯一 tabstop)。初始落「行主序第一个可用格」(无禁用谓词时即 (0,0),
  // 与抽取前一致);方向键移动它并 .focus() 真实聚焦,跳过禁用格(见 boardFocus.ts)。
  // 惰性初始化:seedFocus 在首挂时算一次落点(后续禁用谓词变化由父级保证不破坏单 tabstop 不变量;
  // 本组件不监听谓词变化重置焦点——SonarBoard 的禁用集是「已开炮格」单调增,当前焦点格被开炮后
  // 父级会重渲染,但焦点环仍在该格只读不可点,符合预期)。
  const [focus, setFocus] = useState<FocusTarget>(() => seedFocus(isCellDisabled, initialFocus));
  // 100 格 button 的 ref,移动焦点时取目标格 .focus()。
  const cellRefs = useRef<(HTMLButtonElement | null)[]>([]);

  // 把走子结果落地:更新 roving 焦点 state + 真实 DOM .focus()(目标格 tabIndex 将转 0)。
  const applyFocus = useCallback((target: FocusTarget) => {
    setFocus(target);
    cellRefs.current[target.y * BOARD_SIZE + target.x]?.focus();
  }, []);

  const handleKeyDown = useCallback(
    (x: number, y: number, e: KeyboardEvent<HTMLButtonElement>) => {
      const from: FocusTarget = { x, y };
      // 方向键 / Home / End:本组件消费(移动 roving 焦点,跳过禁用格),阻止页面滚动。
      switch (e.key) {
        case 'ArrowUp':
          e.preventDefault();
          applyFocus(nextEnabledInDirection(isCellDisabled, from, STEP_UP));
          return;
        case 'ArrowDown':
          e.preventDefault();
          applyFocus(nextEnabledInDirection(isCellDisabled, from, STEP_DOWN));
          return;
        case 'ArrowLeft':
          e.preventDefault();
          applyFocus(nextEnabledInDirection(isCellDisabled, from, STEP_LEFT));
          return;
        case 'ArrowRight':
          e.preventDefault();
          applyFocus(nextEnabledInDirection(isCellDisabled, from, STEP_RIGHT));
          return;
        case 'Home': {
          e.preventDefault();
          // 当前行第一个可用格;整行全禁用则不动(null)。
          const t = firstEnabledInRow(isCellDisabled, y);
          if (t) applyFocus(t);
          return;
        }
        case 'End': {
          e.preventDefault();
          const t = lastEnabledInRow(isCellDisabled, y);
          if (t) applyFocus(t);
          return;
        }
        default:
          // 其余键(R/Esc/Enter/Space…)转交父级。Enter/Space 的「激活」由 button 原生 onClick 兜,
          // 这里只把额外语义键(布阵幕 R 旋转 / Esc 取消)交出去。
          onCellKeyDown?.(x, y, e);
      }
    },
    [applyFocus, isCellDisabled, onCellKeyDown],
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

      {/* 行号轴(左列) + 100 格区域(右块)。拆成两列,使 100 格区域可作 overlay 的对齐原点
          (不含轴标 gutter):覆盖层 inset-0 即贴合格阵左上角。 */}
      <div className="flex">
        {/* 行号轴(1–10):独立左列,与右侧每行格等高(h-8)逐行对齐。 */}
        <div className="flex flex-col" aria-hidden>
          {Array.from({ length: BOARD_SIZE }, (_, y) => (
            <span
              key={y}
              className="flex h-8 w-5 items-center justify-center font-mono text-[10px] text-mist"
            >
              {y + 1}
            </span>
          ))}
        </div>

        {/* 100 格区域:position:relative,作 overlay 的定位上下文(原点 = 第一格左上角)。 */}
        <div className="relative">
          {Array.from({ length: BOARD_SIZE }, (_, y) => (
            <div className="flex" role="row" key={y}>
              {Array.from({ length: BOARD_SIZE }, (_, x) => {
                const isFocus = focus.x === x && focus.y === y;
                // 逐格禁用(SonarBoard 已开炮格):走 aria-disabled + 走子跳过。
                const cellDisabled = isCellDisabled?.(x, y) ?? false;
                // 原生 disabled 同时受整盘 disabled(锁定只读)与逐格禁用驱动;整盘禁用不加 aria-disabled
                // (保持锁定后布阵格与抽取前逐位一致——彼时只有原生 disabled,无 aria-disabled)。
                const nativeDisabled = disabled || cellDisabled;
                const cls = cellClassName?.(x, y) ?? '';
                return (
                  <button
                    key={x}
                    type="button"
                    role="gridcell"
                    ref={(el) => {
                      cellRefs.current[y * BOARD_SIZE + x] = el;
                    }}
                    // roving tabindex:仅焦点格进 Tab 序;方向键在内部移动焦点(跳禁用格)。
                    tabIndex={isFocus ? 0 : -1}
                    disabled={nativeDisabled}
                    aria-disabled={cellDisabled || undefined}
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

          {/* 跨格覆盖层(十字准星 / 声呐扫描):绝对定位贴满格阵、不拦指针。省略时不渲染。 */}
          {overlay != null && (
            <div className="pointer-events-none absolute inset-0" data-testid={`${testIdPrefix}-overlay`}>
              {overlay}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
