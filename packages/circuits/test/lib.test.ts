/**
 * Task 0.2 — lib 真理源单测(TDD:本文件先于实现编写)。
 *
 * 覆盖:boardLogic(合法/贴边/重叠/越界/坏方向/坏坐标/occupancyGrid/isHit 全格)、
 * encoding(15 元素顺序、承诺确定性、与 circomlibjs Poseidon 互证)、salt(范围与随机性)。
 * proof.ts / node.ts 的行为依赖真实证明与 M1 产物,本任务只保证编译,不在此测。
 */
import assert from 'node:assert/strict';
import {
  SHIP_LENGTHS,
  TOTAL_SHIP_CELLS,
  shipCells,
  validateBoard,
  occupancyGrid,
  isHit,
  encodeShipsForHash,
  computeCommitment,
  toBoardInputs,
  toShotInputs,
  randomSalt,
  type Board,
} from '../lib/index.ts';
// circomlibjs 仅作 Poseidon 三方互证(M1 电路对拍前的早期保险)
import { buildPoseidon } from 'circomlibjs';

/** 造 Board 的辅助:故意收 number,便于构造非法值(dir=2、x=-1 等) */
function mkBoard(ships: Array<{ x: number; y: number; dir: number }>): Board {
  return ships as unknown as Board;
}

// 布阵 A:5 行横船,全部上下贴边相邻(协议允许贴边)
const boardA: Board = mkBoard([
  { x: 0, y: 0, dir: 0 }, // len5: (0..4, 0)
  { x: 0, y: 1, dir: 0 }, // len4: (0..3, 1)
  { x: 0, y: 2, dir: 0 }, // len3: (0..2, 2)
  { x: 0, y: 3, dir: 0 }, // len3: (0..2, 3)
  { x: 0, y: 4, dir: 0 }, // len2: (0..1, 4)
]);

// 布阵 B:横竖混合、贴四边(含尾格恰好压 9 的边界用例),坐标各异以测编码顺序
const boardB: Board = mkBoard([
  { x: 9, y: 0, dir: 1 }, // len5: (9, 0..4) 右边贴边
  { x: 0, y: 9, dir: 0 }, // len4: (0..3, 9) 底边贴边
  { x: 5, y: 9, dir: 0 }, // len3: (5..7, 9)
  { x: 0, y: 0, dir: 1 }, // len3: (0, 0..2) 左边贴边
  { x: 8, y: 8, dir: 1 }, // len2: (8, 8..9) 尾格 y=9 恰好界内
]);

/** 用 shipCells 之外的独立逻辑重算占用集合,避免测试与实现同源 */
function expectedCells(b: Board): Set<number> {
  const s = new Set<number>();
  for (let i = 0; i < 5; i++) {
    const { x, y, dir } = b[i];
    for (let k = 0; k < SHIP_LENGTHS[i]; k++) {
      s.add(dir === 0 ? y * 10 + (x + k) : (y + k) * 10 + x);
    }
  }
  return s;
}

describe('boardLogic', () => {
  it('SHIP_LENGTHS 锁定为 [5,4,3,3,2],总格数 17', () => {
    assert.deepEqual([...SHIP_LENGTHS], [5, 4, 3, 3, 2]);
    assert.equal(TOTAL_SHIP_CELLS, 17);
    assert.equal(
      SHIP_LENGTHS.reduce((a, b) => a + b, 0),
      TOTAL_SHIP_CELLS,
    );
  });

  it('shipCells:水平占 (x..x+len-1, y),垂直占 (x, y..y+len-1)', () => {
    assert.deepEqual(shipCells({ x: 2, y: 3, dir: 0 }, 3), [
      { x: 2, y: 3 },
      { x: 3, y: 3 },
      { x: 4, y: 3 },
    ]);
    assert.deepEqual(shipCells({ x: 7, y: 1, dir: 1 }, 4), [
      { x: 7, y: 1 },
      { x: 7, y: 2 },
      { x: 7, y: 3 },
      { x: 7, y: 4 },
    ]);
  });

  it('合法布阵(含全贴边相邻)→ ok', () => {
    assert.deepEqual(validateBoard(boardA), { ok: true });
    assert.deepEqual(validateBoard(boardB), { ok: true });
  });

  it('尾格恰好压边界(len5 x=5 dir=0 → 尾 x=9)→ ok', () => {
    const b = mkBoard([
      { x: 5, y: 0, dir: 0 }, // (5..9, 0)
      { x: 0, y: 1, dir: 0 },
      { x: 0, y: 2, dir: 0 },
      { x: 0, y: 3, dir: 0 },
      { x: 0, y: 4, dir: 0 },
    ]);
    assert.deepEqual(validateBoard(b), { ok: true });
  });

  it('两船同格 → OVERLAP,报后放置的那条船的 shipId', () => {
    const b = mkBoard([
      { x: 0, y: 0, dir: 0 }, // (0..4, 0)
      { x: 0, y: 0, dir: 0 }, // 与 0 号完全重叠 → 报 1
      { x: 0, y: 2, dir: 0 },
      { x: 0, y: 3, dir: 0 },
      { x: 0, y: 4, dir: 0 },
    ]);
    assert.deepEqual(validateBoard(b), { ok: false, code: 'OVERLAP', shipId: 1 });
  });

  it('横竖十字交叉单格重叠 → OVERLAP', () => {
    const b = mkBoard([
      { x: 0, y: 0, dir: 0 }, // (0..4, 0)
      { x: 0, y: 5, dir: 0 },
      { x: 0, y: 7, dir: 0 },
      { x: 2, y: 0, dir: 1 }, // (2, 0..2),(2,0) 与 0 号交叉 → 报 3
      { x: 0, y: 9, dir: 0 },
    ]);
    assert.deepEqual(validateBoard(b), { ok: false, code: 'OVERLAP', shipId: 3 });
  });

  it('水平船尾出界(len5 x=6 → 尾 x=10)→ OOB', () => {
    const b = mkBoard([
      { x: 6, y: 0, dir: 0 },
      { x: 0, y: 1, dir: 0 },
      { x: 0, y: 2, dir: 0 },
      { x: 0, y: 3, dir: 0 },
      { x: 0, y: 4, dir: 0 },
    ]);
    assert.deepEqual(validateBoard(b), { ok: false, code: 'OOB', shipId: 0 });
  });

  it('垂直船尾出界(len4 y=7 → 尾 y=10)→ OOB', () => {
    const b = mkBoard([
      { x: 0, y: 0, dir: 0 },
      { x: 5, y: 7, dir: 1 },
      { x: 0, y: 2, dir: 0 },
      { x: 0, y: 3, dir: 0 },
      { x: 0, y: 4, dir: 0 },
    ]);
    assert.deepEqual(validateBoard(b), { ok: false, code: 'OOB', shipId: 1 });
  });

  it('dir=2 → BAD_DIR', () => {
    const b = mkBoard([
      { x: 0, y: 0, dir: 0 },
      { x: 0, y: 1, dir: 0 },
      { x: 0, y: 2, dir: 2 },
      { x: 0, y: 3, dir: 0 },
      { x: 0, y: 4, dir: 0 },
    ]);
    assert.deepEqual(validateBoard(b), { ok: false, code: 'BAD_DIR', shipId: 2 });
  });

  it('x=-1 / x=10 / y=10 / 非整数 → BAD_COORD', () => {
    const base = [
      { x: 0, y: 0, dir: 0 },
      { x: 0, y: 1, dir: 0 },
      { x: 0, y: 2, dir: 0 },
      { x: 0, y: 3, dir: 0 },
      { x: 0, y: 4, dir: 0 },
    ];
    const cases: Array<[number, { x: number; y: number; dir: number }]> = [
      [0, { x: -1, y: 0, dir: 0 }],
      [4, { x: 10, y: 4, dir: 0 }],
      [1, { x: 0, y: 10, dir: 1 }],
      [3, { x: 1.5, y: 3, dir: 0 }],
    ];
    for (const [shipId, bad] of cases) {
      const ships = base.map((s) => ({ ...s }));
      ships[shipId] = bad;
      assert.deepEqual(validateBoard(mkBoard(ships)), { ok: false, code: 'BAD_COORD', shipId });
    }
  });

  it('结构性错误按 shipId 序报告(同为结构性错误时报 shipId 小者)', () => {
    const b = mkBoard([
      { x: 0, y: 0, dir: 0 },
      { x: 7, y: 1, dir: 0 }, // len4 尾 x=10 → OOB,shipId 1
      { x: 0, y: 2, dir: 0 },
      { x: 0, y: 3, dir: 2 }, // BAD_DIR,但 1 号在前
      { x: 0, y: 4, dir: 0 },
    ]);
    assert.deepEqual(validateBoard(b), { ok: false, code: 'OOB', shipId: 1 });
  });

  it('结构性错误优先于 OVERLAP:0/1 号重叠 + 3 号 dir=2 → 报 shipId 3 的 BAD_DIR', () => {
    const b = mkBoard([
      { x: 0, y: 0, dir: 0 }, // (0..4, 0)
      { x: 0, y: 0, dir: 0 }, // 与 0 号完全重叠(shipId 更小,但重叠检查靠后)
      { x: 0, y: 2, dir: 0 },
      { x: 0, y: 3, dir: 2 }, // BAD_DIR
      { x: 0, y: 4, dir: 0 },
    ]);
    assert.deepEqual(validateBoard(b), { ok: false, code: 'BAD_DIR', shipId: 3 });
  });

  it('同一船内 BAD_COORD 优先于 BAD_DIR:x=10 且 dir=2 → BAD_COORD', () => {
    const b = mkBoard([
      { x: 10, y: 0, dir: 2 }, // x 越界 + 坏方向同时存在
      { x: 0, y: 1, dir: 0 },
      { x: 0, y: 2, dir: 0 },
      { x: 0, y: 3, dir: 0 },
      { x: 0, y: 4, dir: 0 },
    ]);
    assert.deepEqual(validateBoard(b), { ok: false, code: 'BAD_COORD', shipId: 0 });
  });

  it('occupancyGrid:已知布阵逐格断言,总和恒 17', () => {
    for (const b of [boardA, boardB]) {
      const grid = occupancyGrid(b);
      assert.equal(grid.length, 100);
      const expect = expectedCells(b);
      let sum = 0;
      for (let idx = 0; idx < 100; idx++) {
        assert.equal(grid[idx], expect.has(idx) ? 1 : 0, `idx=${idx}`);
        sum += grid[idx];
      }
      assert.equal(sum, TOTAL_SHIP_CELLS);
    }
  });

  it('isHit:全 100 格与 occupancyGrid 一致', () => {
    for (const b of [boardA, boardB]) {
      const grid = occupancyGrid(b);
      for (let y = 0; y < 10; y++) {
        for (let x = 0; x < 10; x++) {
          assert.equal(isHit(b, x, y), grid[y * 10 + x], `(${x},${y})`);
        }
      }
    }
  });

  it('isHit 域外输入(非整数/负数)→ 0,不得给出语义错误的 1', () => {
    // boardA 的 0 号船占 (0..4, 0):x=1.5 落在区间内,无守卫时会误判 1
    assert.equal(isHit(boardA, 1.5, 0), 0);
    assert.equal(isHit(boardA, -1, 0), 0);
    assert.equal(isHit(boardB, 1.5, 0), 0);
    assert.equal(isHit(boardB, -1, 0), 0);
  });
});

describe('encoding', () => {
  it('encodeShipsForHash:恰 15 个,顺序 [x0,y0,d0, x1,y1,d1, ..., x4,y4,d4]', () => {
    const e = encodeShipsForHash(boardB);
    assert.equal(e.length, 15);
    assert.deepEqual(e, [9n, 0n, 1n, 0n, 9n, 0n, 5n, 9n, 0n, 0n, 0n, 1n, 8n, 8n, 1n]);
    assert.ok(e.every((v) => typeof v === 'bigint'));
  });

  it('computeCommitment:确定性;salt 不同/布阵不同 → 承诺不同', () => {
    const salt = 0x0123456789abcdef0123456789abcdefn;
    const c1 = computeCommitment(boardB, salt);
    const c2 = computeCommitment(boardB, salt);
    assert.equal(typeof c1, 'bigint');
    assert.equal(c1, c2);
    assert.notEqual(computeCommitment(boardB, salt + 1n), c1);
    assert.notEqual(computeCommitment(boardA, salt), c1);
  });

  it('computeCommitment 与 circomlibjs Poseidon 互证(同 16 输入同哈希)', async () => {
    const poseidon = await buildPoseidon();
    for (const [b, salt] of [
      [boardA, 1n],
      [boardB, 0xfeedface_00000000_deadbeef_cafebaben],
    ] as Array<[Board, bigint]>) {
      const inputs = [...encodeShipsForHash(b), salt];
      assert.equal(inputs.length, 16);
      const ref = poseidon.F.toObject(poseidon(inputs));
      assert.equal(computeCommitment(b, salt), ref);
    }
  });

  it('toBoardInputs:ships[5][3] 十进制字符串 + salt 字符串', () => {
    const salt = 12345n;
    assert.deepEqual(toBoardInputs(boardB, salt), {
      ships: [
        ['9', '0', '1'],
        ['0', '9', '0'],
        ['5', '9', '0'],
        ['0', '0', '1'],
        ['8', '8', '1'],
      ],
      salt: '12345',
    });
  });

  it('toShotInputs:附 commitment/tx/ty,commitment 与 computeCommitment 一致', () => {
    const salt = 0xdeadbeefn;
    const got = toShotInputs(boardB, salt, 3, 7);
    assert.deepEqual(got, {
      ships: [
        ['9', '0', '1'],
        ['0', '9', '0'],
        ['5', '9', '0'],
        ['0', '0', '1'],
        ['8', '8', '1'],
      ],
      salt: salt.toString(10),
      commitment: computeCommitment(boardB, salt).toString(10),
      tx: '3',
      ty: '7',
    });
  });

  it('toShotInputs:tx/ty 非 0–9 整数 → throw(防坏值流入 circom witness)', () => {
    assert.throws(() => toShotInputs(boardB, 1n, 1.5, 0), /0–9 整数/);
    assert.throws(() => toShotInputs(boardB, 1n, -1, 0), /0–9 整数/);
    assert.throws(() => toShotInputs(boardB, 1n, 0, 10), /0–9 整数/);
  });
});

describe('salt', () => {
  it('randomSalt:< 2^128,样本间互不相同,且(概率上)≥ 2^120', () => {
    const N = 32;
    const samples: bigint[] = [];
    for (let i = 0; i < N; i++) samples.push(randomSalt());
    for (const s of samples) {
      assert.equal(typeof s, 'bigint');
      assert.ok(s >= 0n);
      assert.ok(s < 1n << 128n, `salt ${s} >= 2^128`);
    }
    assert.equal(new Set(samples.map(String)).size, N, '出现重复 salt');
    // 单样本最高字节为 0 的概率 1/256;32 个样本全 < 2^120 的概率 256^-32,可忽略
    assert.ok(
      samples.some((s) => s >= 1n << 120n),
      '32 个样本全部 < 2^120,熵可疑',
    );
  });
});
