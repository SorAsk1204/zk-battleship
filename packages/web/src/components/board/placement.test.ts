/**
 * 布阵几何 + reducer 单测(Task 3.5)。
 *
 * 钉死与 React/DOM 无关的纯逻辑(本仓 vitest 是 node 环境、无 testing-library):
 *   - shipCellsAt:朝向/长度几何与 boardLogic 同义;
 *   - canPlaceShip:界内 + 无重叠(贴边相邻合法);
 *   - **与 validateBoard 的等价**:任意合法/非法的全 5 船布局,逐船增量 canPlaceShip 的接受性
 *     === validateBoard.ok(证明增量判定没分叉真理源,§4.1 规则一致);
 *   - previewCells/previewLegal/allPlaced/placedCount/toBoard 派生量;
 *   - placementReducer 每条转换(carry/hover/rotate/place/pickup/cancel/reset + 非法 place no-op)。
 */
import { describe, expect, it } from 'vitest';
import { validateBoard, SHIP_LENGTHS } from '../../lib/boardLogic.ts';
import type { Board } from '../../lib/boardLogic.ts';
import {
  FLEET,
  allPlaced,
  canPlaceShip,
  inBoundsPreviewCells,
  initialPlacement,
  placedCount,
  placementReducer,
  previewCells,
  previewLegal,
  shipCellsAt,
  toBoard,
  validateFinal,
  type PlacementState,
  type ShipPlacement,
} from './placement.ts';

/** 合法基准布局(5 船贴左逐行;同 DevProve/NewGame 旧 FIXED_BOARD,validateBoard 必过)。 */
const LEGAL: Board = [
  { x: 0, y: 0, dir: 0 },
  { x: 0, y: 1, dir: 0 },
  { x: 0, y: 2, dir: 0 },
  { x: 0, y: 3, dir: 0 },
  { x: 0, y: 4, dir: 0 },
];

function placedFromBoard(b: Board): (ShipPlacement | null)[] {
  return b.map((s) => ({ ...s }));
}

describe('FLEET', () => {
  it('5 舰,长度取自 SHIP_LENGTHS 真理源,id 即顺序', () => {
    expect(FLEET).toHaveLength(5);
    expect(FLEET.map((f) => f.len)).toEqual([...SHIP_LENGTHS]);
    expect(FLEET.map((f) => f.id)).toEqual([0, 1, 2, 3, 4]);
    for (const f of FLEET) expect(f.name.length).toBeGreaterThan(0);
  });
});

describe('shipCellsAt — 几何', () => {
  it('水平(dir=0)沿 x 展开', () => {
    expect(shipCellsAt({ x: 2, y: 3 }, 3, 0)).toEqual([
      { x: 2, y: 3 },
      { x: 3, y: 3 },
      { x: 4, y: 3 },
    ]);
  });
  it('垂直(dir=1)沿 y 展开', () => {
    expect(shipCellsAt({ x: 2, y: 3 }, 3, 1)).toEqual([
      { x: 2, y: 3 },
      { x: 2, y: 4 },
      { x: 2, y: 5 },
    ]);
  });
});

describe('canPlaceShip — 界内 + 无重叠', () => {
  it('空棋盘上界内落点可放', () => {
    expect(canPlaceShip([null, null, null, null, null], 0, { x: 0, y: 0, dir: 0 })).toBe(true);
    expect(canPlaceShip([null, null, null, null, null], 0, { x: 5, y: 9, dir: 0 })).toBe(true); // 尾 x=9
  });

  it('船尾出界 → 不可放', () => {
    // shipId 0 长 5:水平 x=6 → 尾 x=10 出界
    expect(canPlaceShip([null, null, null, null, null], 0, { x: 6, y: 0, dir: 0 })).toBe(false);
    // 垂直 y=6 → 尾 y=10 出界
    expect(canPlaceShip([null, null, null, null, null], 0, { x: 0, y: 6, dir: 1 })).toBe(false);
  });

  it('负坐标 → 不可放', () => {
    expect(canPlaceShip([null, null, null, null, null], 0, { x: -1, y: 0, dir: 0 })).toBe(false);
  });

  it('与已放置船重叠 → 不可放', () => {
    const placed: (ShipPlacement | null)[] = [{ x: 0, y: 0, dir: 0 }, null, null, null, null]; // 占 (0..4, 0)
    // shipId 1 长 4 水平放 (2,0):覆盖 (2,0) 与 ship0 重叠
    expect(canPlaceShip(placed, 1, { x: 2, y: 0, dir: 0 })).toBe(false);
  });

  it('贴边相邻合法(§4.1 不做间隔要求)', () => {
    const placed: (ShipPlacement | null)[] = [{ x: 0, y: 0, dir: 0 }, null, null, null, null]; // 占 (0..4, 0)
    // ship1 放第二行 (0,1):与 ship0 紧贴但不重叠 → 合法
    expect(canPlaceShip(placed, 1, { x: 0, y: 1, dir: 0 })).toBe(true);
  });

  it('重新放置同一艘:排除自身旧位置(不与自己判重叠)', () => {
    const placed: (ShipPlacement | null)[] = [{ x: 0, y: 0, dir: 0 }, null, null, null, null];
    // 把 ship0 原地（或重叠自身旧位置）重放,应允许(excludeId=0 摘掉自身)
    expect(canPlaceShip(placed, 0, { x: 0, y: 0, dir: 0 })).toBe(true);
    expect(canPlaceShip(placed, 0, { x: 1, y: 0, dir: 0 })).toBe(true); // 平移,仍只和自己重叠 → 允许
  });
});

describe('canPlaceShip ≡ validateBoard(全 5 船增量构造)', () => {
  /**
   * 用「逐船增量放置」复刻 validateBoard 的判据:对一批全 5 船布局,逐 shipId 用 canPlaceShip
   * 判定能否加入(放入则继续),若 5 船全部被接受 ⇒ 增量判定该布局合法。断言它与 validateBoard.ok
   * 完全一致(同义),即增量判定没引入与真理源不同的规则。
   */
  function incrementalOk(board: Board): boolean {
    const placed: (ShipPlacement | null)[] = [null, null, null, null, null];
    for (let id = 0; id < 5; id++) {
      const cand = board[id];
      if (!canPlaceShip(placed, id, cand)) return false;
      placed[id] = { ...cand };
    }
    return true;
  }

  const cases: { name: string; board: Board }[] = [
    { name: '合法贴左逐行', board: LEGAL },
    {
      name: '合法散布',
      board: [
        { x: 0, y: 0, dir: 1 }, // (0,0..4)
        { x: 2, y: 0, dir: 0 }, // (2..5,0)
        { x: 7, y: 7, dir: 1 }, // (7,7..9)
        { x: 4, y: 4, dir: 0 }, // (4..6,4)
        { x: 9, y: 0, dir: 1 }, // (9,0..1)
      ],
    },
    {
      name: '重叠(ship1 压 ship0)',
      board: [
        { x: 0, y: 0, dir: 0 },
        { x: 3, y: 0, dir: 0 }, // (3..6,0) 与 ship0 的 (3,0)(4,0) 重叠
        { x: 0, y: 2, dir: 0 },
        { x: 0, y: 3, dir: 0 },
        { x: 0, y: 4, dir: 0 },
      ],
    },
    {
      name: '出界(ship0 尾越界)',
      board: [
        { x: 6, y: 0, dir: 0 }, // 尾 x=10
        { x: 0, y: 1, dir: 0 },
        { x: 0, y: 2, dir: 0 },
        { x: 0, y: 3, dir: 0 },
        { x: 0, y: 4, dir: 0 },
      ],
    },
  ];

  for (const c of cases) {
    it(`${c.name}:增量接受性 === validateBoard.ok`, () => {
      const expected = validateBoard(c.board).ok;
      expect(incrementalOk(c.board)).toBe(expected);
    });
  }
});

describe('previewCells / previewLegal', () => {
  it('未手持 / 无 hover → 空预览、非法', () => {
    const s = initialPlacement();
    expect(previewCells(s)).toEqual([]);
    expect(previewLegal(s)).toBe(false);
    expect(previewCells({ ...s, carrying: 0 })).toEqual([]); // 有手持但无 hover
  });

  it('手持 + hover → 预览 = 该船在 hover 处的格;合法性随位置', () => {
    const s: PlacementState = { placed: [null, null, null, null, null], carrying: 0, dir: 0, hover: { x: 0, y: 0 } };
    expect(previewCells(s)).toEqual(shipCellsAt({ x: 0, y: 0 }, SHIP_LENGTHS[0], 0));
    expect(previewLegal(s)).toBe(true);
    // 移到出界处 → 非法
    expect(previewLegal({ ...s, hover: { x: 8, y: 0 } })).toBe(false); // 长5 尾=12
  });
});

describe('inBoundsPreviewCells — 渲染只取在界格(回归:出界格勿折到下一行)', () => {
  it('完全在界 → 与 previewCells 相同', () => {
    const s: PlacementState = { placed: [null, null, null, null, null], carrying: 0, dir: 0, hover: { x: 0, y: 0 } };
    expect(inBoundsPreviewCells(s)).toEqual(previewCells(s));
  });

  it('部分出界(水平船头近右缘)→ 只留在界格,丢弃 x>9 的格', () => {
    // shipId 0 长 5 水平,船头 (7,0):几何含 (7,0)(8,0)(9,0)(10,0)(11,0);只 3 格在界。
    const s: PlacementState = { placed: [null, null, null, null, null], carrying: 0, dir: 0, hover: { x: 7, y: 0 } };
    expect(inBoundsPreviewCells(s)).toEqual([
      { x: 7, y: 0 },
      { x: 8, y: 0 },
      { x: 9, y: 0 },
    ]);
    // 关键回归点:绝不包含 x>9 的格(否则 y*10+x 会折成下一行真实格,染错色)。
    expect(inBoundsPreviewCells(s).every((c) => c.x <= 9 && c.y <= 9)).toBe(true);
  });

  it('部分出界(垂直船头近下缘)→ 丢弃 y>9 的格', () => {
    // shipId 0 长 5 垂直,船头 (0,7):几何含 y=7..11;只 (0,7)(0,8)(0,9) 在界。
    const s: PlacementState = { placed: [null, null, null, null, null], carrying: 0, dir: 1, hover: { x: 0, y: 7 } };
    expect(inBoundsPreviewCells(s)).toEqual([
      { x: 0, y: 7 },
      { x: 0, y: 8 },
      { x: 0, y: 9 },
    ]);
  });
});

describe('allPlaced / placedCount / toBoard / validateFinal', () => {
  it('placedCount 计数,allPlaced 仅全 5 船 true', () => {
    const empty = initialPlacement();
    expect(placedCount(empty)).toBe(0);
    expect(allPlaced(empty)).toBe(false);
    const full: PlacementState = { ...empty, placed: placedFromBoard(LEGAL) };
    expect(placedCount(full)).toBe(5);
    expect(allPlaced(full)).toBe(true);
  });

  it('toBoard 在有 null 槽时抛', () => {
    expect(() => toBoard([null, null, null, null, null])).toThrow();
  });

  it('validateFinal 对合法布局 ok=true', () => {
    expect(validateFinal(placedFromBoard(LEGAL))).toEqual({ ok: true });
  });
});

describe('placementReducer', () => {
  const empty = initialPlacement();

  it('carry:拿起未放置船 → 手持,dir 保留', () => {
    const s = placementReducer(empty, { type: 'carry', shipId: 2 });
    expect(s.carrying).toBe(2);
    expect(s.dir).toBe(0);
  });

  it('hover:更新 hover 格', () => {
    const s = placementReducer(empty, { type: 'hover', cell: { x: 3, y: 4 } });
    expect(s.hover).toEqual({ x: 3, y: 4 });
    expect(placementReducer(s, { type: 'hover', cell: null }).hover).toBeNull();
  });

  it('rotate:仅手持时翻转 dir;未手持 no-op', () => {
    expect(placementReducer(empty, { type: 'rotate' }).dir).toBe(0); // 未手持不变
    const carrying = placementReducer(empty, { type: 'carry', shipId: 0 });
    expect(placementReducer(carrying, { type: 'rotate' }).dir).toBe(1);
  });

  it('place:合法落子 → 写入槽位 + 清手持;非法 no-op', () => {
    const carrying: PlacementState = { ...empty, carrying: 0, dir: 0, hover: { x: 0, y: 0 } };
    const placed = placementReducer(carrying, { type: 'place' });
    expect(placed.placed[0]).toEqual({ x: 0, y: 0, dir: 0 });
    expect(placed.carrying).toBeNull();

    // 非法位置(出界)→ 原样返回
    const illegal: PlacementState = { ...empty, carrying: 0, dir: 0, hover: { x: 9, y: 0 } };
    expect(placementReducer(illegal, { type: 'place' })).toBe(illegal);
  });

  it('place:压到已放置船 → no-op', () => {
    const base: PlacementState = { ...empty, placed: [{ x: 0, y: 0, dir: 0 }, null, null, null, null] };
    const carrying: PlacementState = { ...base, carrying: 1, dir: 0, hover: { x: 2, y: 0 } }; // 覆盖 (2,0)
    expect(placementReducer(carrying, { type: 'place' })).toBe(carrying);
  });

  it('pickup:拿起已放置船 → 清槽 + 手持 + 承接其 dir', () => {
    const base: PlacementState = { ...empty, placed: [{ x: 0, y: 0, dir: 1 }, null, null, null, null] };
    const s = placementReducer(base, { type: 'pickup', shipId: 0 });
    expect(s.placed[0]).toBeNull();
    expect(s.carrying).toBe(0);
    expect(s.dir).toBe(1);
    // 未放置的 pickup → no-op
    expect(placementReducer(empty, { type: 'pickup', shipId: 0 })).toBe(empty);
  });

  it('carry:拿起一艘已放置船等价 pickup(摘旧位置 + 承接 dir)', () => {
    const base: PlacementState = { ...empty, placed: [{ x: 3, y: 3, dir: 1 }, null, null, null, null] };
    const s = placementReducer(base, { type: 'carry', shipId: 0 });
    expect(s.placed[0]).toBeNull();
    expect(s.carrying).toBe(0);
    expect(s.dir).toBe(1);
  });

  it('cancel:手持时放回;未手持 no-op', () => {
    const carrying = placementReducer(empty, { type: 'carry', shipId: 0 });
    expect(placementReducer(carrying, { type: 'cancel' }).carrying).toBeNull();
    expect(placementReducer(empty, { type: 'cancel' })).toBe(empty);
  });

  it('reset:回初始态', () => {
    const dirty: PlacementState = { placed: placedFromBoard(LEGAL), carrying: 2, dir: 1, hover: { x: 1, y: 1 } };
    expect(placementReducer(dirty, { type: 'reset' })).toEqual(initialPlacement());
  });

  it('完整走一局:5 船依次放置 → allPlaced + toBoard 合法', () => {
    let s = empty;
    for (let id = 0; id < 5; id++) {
      s = placementReducer(s, { type: 'carry', shipId: id });
      s = placementReducer(s, { type: 'hover', cell: { x: 0, y: id } });
      s = placementReducer(s, { type: 'place' });
    }
    expect(allPlaced(s)).toBe(true);
    expect(validateBoard(toBoard(s.placed))).toEqual({ ok: true });
  });
});
