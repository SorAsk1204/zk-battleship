/**
 * 布阵幕的纯几何 + 状态机(Design §7.3 布阵幕;§4.1 规则)。
 *
 * 这一层是「怎么得到一个合法 board」的全部业务逻辑,与 React/DOM 无关——可在 node 环境单测
 * (本仓 vitest 无 testing-library,纯函数是唯一能钉死的层)。PlacementBoard/FleetDock 只把
 * 用户手势翻成这里的 action、把这里的派生量(预览格/合法性/每格态)渲染出来。
 *
 * 合法性判定**复用 boardLogic 真理源**(Design §0.3 锁定规则 + DECISIONS D2:web 一律引真理源):
 *   - 船占格几何 = boardLogic.shipCells(同一份,电路/e2e/合约 fixture 共用);
 *   - 界内 = 船尾 ≤ 9(§4.1,与 validateBoard 的 tail 检查同式);
 *   - 无重叠 = 候选船任一格落在「其它已放置船」的占用集 ⇒ 非法(§4.1 不做间隔要求,贴边相邻合法)。
 * **不重新实现 overlap/bounds 的另一套循环**:canPlaceShip 走 shipCells + 占用集,与 validateBoard
 * 在「全部就位」时同义(见 placement.test.ts 的等价断言:任意全 5 船布局,canPlaceShip 增量判定
 * 的接受集 === validateBoard.ok)。锁定前最终再过一次 validateBoard(toBoard(...))做总闸(双保险)。
 *
 * 为什么状态机用 useReducer 而非 zustand(任务留给实现者的选择,记 DECISIONS):布阵态是
 * **组件作用域、瞬时**(刷新即弃,锁定前不持久——§8 只在锁定成功后落盘),无跨组件/跨路由共享需求。
 * 引全局 store 是 YAGNI;useReducer 把 8 个互斥转换(carry/hover/rotate/place/pickup/cancel/reset)
 * 收成一个可单测的纯 reducer,action 显式、转换可读,正是这种「一处临时交互状态」的标准解。
 */
import { shipCells as boardLogicShipCells, validateBoard, SHIP_LENGTHS } from '../../lib/boardLogic.ts';
import type { Board, Ship } from '../../lib/boardLogic.ts';

/** 一艘船的落点(与 boardLogic.Ship 同形,dir 0=水平 1=垂直)。 */
export type ShipPlacement = Ship;

/** 朝向。0=水平(占 x..x+len-1),1=垂直(占 y..y+len-1)。 */
export type Dir = 0 | 1;

/** 棋盘格坐标。 */
export type Cell = { x: number; y: number };

/**
 * 5 个槽位的舰队定义(Design §4.1:长度 [5,4,3,3,2],顺序即 shipId 0–4)。
 * 名称是纯展示(§7.3 船坞列举舰名),不参与协议;长度是规则锁定项,取自 SHIP_LENGTHS 真理源。
 */
export type FleetShip = { id: number; name: string; len: number };

export const FLEET: readonly FleetShip[] = SHIP_LENGTHS.map((len, id) => ({
  id,
  len,
  name: ['航空母舰', '战列舰', '巡洋舰', '驱逐舰', '潜艇'][id],
}));

/**
 * 布阵状态(组件作用域,瞬时)。
 *   placed   —— 长度 5,placed[id] 是该舰落点或 null(未放置);索引即 shipId。
 *   carrying —— 当前「手持」的 shipId(随鼠标预览),无则 null。
 *   dir      —— 手持船的朝向(R 切换);仅 carrying 时有意义。
 *   hover    —— 棋盘上鼠标/键盘焦点所在格(驱动预览位置),无则 null。
 */
export type PlacementState = {
  placed: (ShipPlacement | null)[];
  carrying: number | null;
  dir: Dir;
  hover: Cell | null;
};

/** 初始态:空棋盘、未手持、默认水平。 */
export function initialPlacement(): PlacementState {
  return { placed: [null, null, null, null, null], carrying: null, dir: 0, hover: null };
}

/** 某格是否在界内(0–9 整数)。 */
function inBounds(c: Cell): boolean {
  return Number.isInteger(c.x) && Number.isInteger(c.y) && c.x >= 0 && c.x <= 9 && c.y >= 0 && c.y <= 9;
}

/**
 * 一艘船(船头 + 朝向)占用的格子序列。直接转交 boardLogic.shipCells(几何真理源),
 * 本层不另写一套——朝向/长度语义任何分叉都会让预览与链上 board 电路约束产生语义差。
 */
export function shipCellsAt(head: Cell, len: number, dir: Dir): Cell[] {
  return boardLogicShipCells({ x: head.x, y: head.y, dir }, len);
}

/**
 * 已放置船(排除某 shipId)的占用集,key = y*10+x(行主序,与链上 bit、occupancyGrid 同序)。
 * excludeId 用于「重新放置同一艘船」:把它自己从占用里摘掉,否则它会和自己的旧位置判重叠。
 */
function occupiedByPlaced(placed: (ShipPlacement | null)[], excludeId: number | null): Set<number> {
  const occ = new Set<number>();
  for (let id = 0; id < placed.length; id++) {
    if (id === excludeId) continue;
    const p = placed[id];
    if (!p) continue;
    for (const c of shipCellsAt(p, SHIP_LENGTHS[id], p.dir)) occ.add(c.y * 10 + c.x);
  }
  return occ;
}

/**
 * 候选落点是否可放(增量判定,复用 boardLogic 几何 + §4.1 规则):
 *   1. 界内:候选船每格 ∈ [0,9]²(等价 validateBoard 的「船尾 ≤ 9」,这里逐格判更直观);
 *   2. 无重叠:候选船无一格落在「其它已放置船」的占用集(贴边相邻合法,§4.1 不做间隔)。
 * shipId 用于排除自身旧位置(重新放置场景)。返回 true = 可落子。
 *
 * 与 validateBoard 的关系:validateBoard 要 5 船全给(全局总校验);布阵途中往往不足 5 船,
 * 故增量判定只看「候选 vs 已放置」。placement.test.ts 证明二者在全 5 船时同义。
 */
export function canPlaceShip(
  placed: (ShipPlacement | null)[],
  shipId: number,
  candidate: ShipPlacement,
): boolean {
  const len = SHIP_LENGTHS[shipId];
  const cells = shipCellsAt(candidate, len, candidate.dir);
  for (const c of cells) {
    if (!inBounds(c)) return false;
  }
  const occ = occupiedByPlaced(placed, shipId);
  for (const c of cells) {
    if (occ.has(c.y * 10 + c.x)) return false;
  }
  return true;
}

/**
 * 当前手持船在 hover 处的预览格(供棋盘渲染半透明预览)。
 * 无手持 / 无 hover → 空数组(不渲染预览)。
 */
export function previewCells(state: PlacementState): Cell[] {
  if (state.carrying === null || !state.hover) return [];
  const len = SHIP_LENGTHS[state.carrying];
  return shipCellsAt(state.hover, len, state.dir);
}

/**
 * 预览格里**只在界内**的那部分(供棋盘渲染索引)。出界格(x>9 / y>9)在棋盘上没有对应格,
 * 且若用 y*10+x 索引会折到下一行的真实格(例:水平船头 (7,0) 长 5 → (10,0) 折成 idx10 = 格 (0,1)),
 * 把无关格染色(实测发现的渲染 bug)。渲染层用本函数取在界子集;出界船的在界部分照常染红
 * (legal=false 时整段 --flare),出界部分无格可染(预期)。合法性判定仍走 previewLegal(出界即非法),
 * 与渲染解耦。
 */
export function inBoundsPreviewCells(state: PlacementState): Cell[] {
  return previewCells(state).filter((c) => inBounds(c));
}

/** 当前预览是否合法(决定预览染色:合法=磷光半透明 / 非法=--flare 整船)。无预览时为 false。 */
export function previewLegal(state: PlacementState): boolean {
  if (state.carrying === null || !state.hover) return false;
  return canPlaceShip(state.placed, state.carrying, { x: state.hover.x, y: state.hover.y, dir: state.dir });
}

/** 是否 5 船全部就位(锁定舰队按钮的出现条件)。 */
export function allPlaced(state: PlacementState): boolean {
  return state.placed.every((p) => p !== null);
}

/**
 * 已放置数(船坞进度展示用)。
 */
export function placedCount(state: PlacementState): number {
  return state.placed.reduce((n, p) => n + (p ? 1 : 0), 0);
}

/**
 * 把 5 个已放置槽收成 boardLogic.Board(5-tuple),供 computeCommitment / validateBoard / useLockFleet。
 * 调用方须先 allPlaced();有 null 槽时抛(早失败,不把半成品喂给证明管线)。
 */
export function toBoard(placed: (ShipPlacement | null)[]): Board {
  if (placed.some((p) => p === null)) {
    throw new Error('toBoard: 仍有未放置的舰船,无法构造完整 board。');
  }
  return placed as Board;
}

/**
 * 锁定前的最终总校验(双保险):把全 5 船过一遍 validateBoard 真理源。
 * 增量 canPlaceShip 已逐步保证合法,这里再总闸一次——证明/上链前的最后一道,与电路同一判据。
 */
export function validateFinal(placed: (ShipPlacement | null)[]): ReturnType<typeof validateBoard> {
  return validateBoard(toBoard(placed));
}

// ─────────────────────────── reducer ───────────────────────────

export type PlacementAction =
  /** 从船坞拿起一艘船(进入手持);已手持别的则换成这艘。保留当前 dir。 */
  | { type: 'carry'; shipId: number }
  /** 鼠标/焦点移到某格(更新预览位置)。 */
  | { type: 'hover'; cell: Cell | null }
  /** 旋转手持船朝向(仅手持时生效;R 键)。 */
  | { type: 'rotate' }
  /** 在 hover 处落子(仅当 previewLegal;非法是 no-op)。落子后清手持。 */
  | { type: 'place' }
  /** 取消手持(Esc):放回船坞,不落子。 */
  | { type: 'cancel' }
  /** 拿起一艘已放置的船(点已放置船):清其槽位 + 进入手持(承接其原 dir)。 */
  | { type: 'pickup'; shipId: number }
  /** 全部重置(锁定失败后用户重排时调,或换账户)。 */
  | { type: 'reset' };

/**
 * 布阵 reducer(纯函数,单测覆盖每条转换)。非法 place 是 no-op(返回原 state),
 * 由调用方在 UI 上已禁掉点击,这里再防一道(键盘 Enter 路径也经此)。
 */
export function placementReducer(state: PlacementState, action: PlacementAction): PlacementState {
  switch (action.type) {
    case 'carry': {
      // 拿起一艘(未放置或已放置都可经此「选中」);若该船已放置,等价 pickup(摘出旧位置)。
      const wasPlaced = state.placed[action.shipId];
      if (wasPlaced) {
        const placed = state.placed.slice();
        placed[action.shipId] = null;
        return { ...state, placed, carrying: action.shipId, dir: wasPlaced.dir };
      }
      return { ...state, carrying: action.shipId };
    }
    case 'pickup': {
      const p = state.placed[action.shipId];
      if (!p) return state; // 没放置过,无可拿起
      const placed = state.placed.slice();
      placed[action.shipId] = null;
      return { ...state, placed, carrying: action.shipId, dir: p.dir };
    }
    case 'hover':
      return { ...state, hover: action.cell };
    case 'rotate':
      if (state.carrying === null) return state; // 仅手持时旋转
      return { ...state, dir: state.dir === 0 ? 1 : 0 };
    case 'place': {
      if (state.carrying === null || !state.hover) return state;
      const candidate: ShipPlacement = { x: state.hover.x, y: state.hover.y, dir: state.dir };
      if (!canPlaceShip(state.placed, state.carrying, candidate)) return state; // 非法 no-op
      const placed = state.placed.slice();
      placed[state.carrying] = candidate;
      return { ...state, placed, carrying: null };
    }
    case 'cancel':
      if (state.carrying === null) return state;
      return { ...state, carrying: null };
    case 'reset':
      return initialPlacement();
    default:
      return state;
  }
}
