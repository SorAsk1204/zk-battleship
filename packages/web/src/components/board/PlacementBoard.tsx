/**
 * PlacementBoard —— 布阵交互层(Design §7.3 布阵幕),组合 BoardGrid + placement 几何/状态。
 *
 * 交互模型(任务定:**不用 HTML5 DnD**,自绘预览;点选→预览→落子):
 *   - 从船坞点一艘船 → 进入「手持」(carrying);鼠标 hover / 键盘焦点移动 → hover 格 → 该船在 hover 处
 *     的占格渲染为半透明预览(previewCells);
 *   - canPlace(= 复用 boardLogic 的 shipCells + §4.1 界内/无重叠,见 placement.canPlaceShip)为假时,
 *     整船预览染 --flare 且点击 no-op(reducer 的 place 对非法位置也是 no-op,双保险);
 *   - canPlace 为真时点击落子;点已放置的船 → 拿起重放(reducer carry 对已放置船等价 pickup);
 *   - R 旋转手持朝向(仅手持时),Esc 取消手持。键盘路径:方向键移动焦点(BoardGrid 的 roving
 *     tabindex)→ 预览跟随焦点格(onCellFocus 派 hover)→ Enter/Space 落子(button 原生 onClick)。
 *
 * R/Esc 走 **window 级 keydown**(仅 carrying && !locked 时挂载),而非棋盘格 keydown:鼠标手持时
 * 焦点通常不在任何格上(hover ≠ focus),若只挂格级 keydown,鼠标用户按 R 不旋转(实测确认)。
 * window 监听让鼠标路径与键盘路径统一可用;格级 keydown 只留给 BoardGrid 处理方向键移动焦点
 * (R/Esc 不再在格级重复处理,避免与 window 监听双触发把旋转抵消)。
 *
 * 本组件是「把手势翻成 action + 把派生量翻成每格样式」的薄层,合法性/几何全在 placement.ts(纯、已单测)。
 * locked 态(锁定成功后):整盘 disabled、占格转暗磷光 + 锁标,只读浏览(§7.3 棋盘上锁)。
 */
import { useEffect, useMemo } from 'react';
import { SHIP_LENGTHS } from '../../lib/boardLogic.ts';
import { formatCoord } from '../../lib/format.ts';
import BoardGrid from './BoardGrid.tsx';
import {
  FLEET,
  inBoundsPreviewCells,
  previewLegal,
  shipCellsAt,
  type PlacementAction,
  type PlacementState,
} from './placement.ts';

export type PlacementBoardProps = {
  state: PlacementState;
  dispatch: (action: PlacementAction) => void;
  /** 锁定成功后只读上锁。 */
  locked?: boolean;
};

/** 每格的布阵语义态(决定着色)。 */
type CellKind = 'empty' | 'placed' | 'preview-ok' | 'preview-illegal' | 'locked';

export default function PlacementBoard({ state, dispatch, locked = false }: PlacementBoardProps) {
  // 占用反查:cell idx(y*10+x)→ 占据它的已放置 shipId。用于点击拿回 + 每格 aria。
  const placedAt = useMemo(() => {
    const map = new Map<number, number>();
    state.placed.forEach((p, id) => {
      if (!p) return;
      for (const c of shipCellsAt(p, SHIP_LENGTHS[id], p.dir)) map.set(c.y * 10 + c.x, id);
    });
    return map;
  }, [state.placed]);

  // 预览格集合(**只含在界格**,见 placement.inBoundsPreviewCells 注释:防出界格折到下一行染错格)
  // + 是否合法(整船同色,§7.3 非法整船染 --flare)。
  const preview = useMemo(() => {
    const set = new Set(inBoundsPreviewCells(state).map((c) => c.y * 10 + c.x));
    return { set, legal: previewLegal(state) };
  }, [state]);

  // R 旋转 / Esc 取消:window 级监听,仅手持且未上锁时挂载(见模块注释:鼠标手持时焦点不在格上,
  // 必须全局监听才能让鼠标用户按 R 旋转)。监听器依赖 carrying 重挂,空闲时不挂(不抢全局按键)。
  const carrying = state.carrying;
  useEffect(() => {
    if (locked || carrying === null) return;
    function onKey(e: globalThis.KeyboardEvent) {
      const k = e.key.toLowerCase();
      if (k === 'r') {
        e.preventDefault();
        dispatch({ type: 'rotate' });
      } else if (e.key === 'Escape') {
        e.preventDefault();
        dispatch({ type: 'cancel' });
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [locked, carrying, dispatch]);

  function kindOf(x: number, y: number): CellKind {
    const idx = y * 10 + x;
    if (locked) return placedAt.has(idx) ? 'locked' : 'empty';
    // 预览优先于已放置展示(预览盖在空格 / 也可能盖在已放置上但那种位置 canPlace 已判非法)。
    if (preview.set.has(idx)) return preview.legal ? 'preview-ok' : 'preview-illegal';
    if (placedAt.has(idx)) return 'placed';
    return 'empty';
  }

  function cellClassName(x: number, y: number): string {
    switch (kindOf(x, y)) {
      case 'locked':
        // 上锁:暗磷光底(降亮度),示意「已部署、冻结」。
        return 'bg-phosphor/20';
      case 'placed':
        // 已就位:实心磷光块。
        return 'bg-phosphor/70 hover:bg-phosphor/60';
      case 'preview-ok':
        // 合法预览:半透明磷光。
        return 'bg-phosphor/40';
      case 'preview-illegal':
        // 非法预览:整船 --flare(§7.3)。
        return 'bg-flare/70';
      default:
        // 空格:深海底,hover 时极淡磷光提示可落子。
        return 'bg-console hover:bg-grid/60';
    }
  }

  function ariaLabel(x: number, y: number): string {
    const coord = formatCoord(x, y);
    const idx = y * 10 + x;
    const placedId = placedAt.get(idx);
    if (placedId !== undefined) {
      return `${coord} 已部署 ${FLEET[placedId].name}${locked ? '(已锁定)' : ''}`;
    }
    if (!locked && preview.set.has(idx)) {
      return `${coord} 预览 ${preview.legal ? '可放置' : '不可放置'}`;
    }
    return `${coord} 空`;
  }

  function onCellClick(x: number, y: number) {
    if (locked) return;
    const idx = y * 10 + x;
    const placedId = placedAt.get(idx);
    // 点已放置船(且当前没在手持别的更优先意图)→ 拿回重放。
    if (placedId !== undefined && state.carrying === null) {
      dispatch({ type: 'carry', shipId: placedId }); // carry 对已放置船等价 pickup
      dispatch({ type: 'hover', cell: { x, y } });
      return;
    }
    // 手持中点格 → 尝试落子(非法时 reducer no-op)。
    if (state.carrying !== null) {
      dispatch({ type: 'hover', cell: { x, y } });
      dispatch({ type: 'place' });
    }
  }

  return (
    <BoardGrid
      label={locked ? '已锁定的布阵棋盘' : '布阵棋盘'}
      testIdPrefix="placement"
      disabled={locked}
      renderCell={(x, y) =>
        locked && placedAt.has(y * 10 + x) ? (
          // 上锁占格中心一个锁形示意(纯字符,无新颜色/无图片依赖)。
          <span aria-hidden className="font-mono text-[10px] leading-none text-abyss">
            ▦
          </span>
        ) : null
      }
      cellClassName={cellClassName}
      ariaLabel={ariaLabel}
      onCellClick={onCellClick}
      onCellHover={(x, y) => !locked && dispatch({ type: 'hover', cell: { x, y } })}
      onCellFocus={(x, y) => !locked && dispatch({ type: 'hover', cell: { x, y } })}
      onLeave={() => !locked && dispatch({ type: 'hover', cell: null })}
    />
  );
}
