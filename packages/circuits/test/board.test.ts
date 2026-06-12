/**
 * Task 1.3 — board 电路 B1–B9。
 *
 * 测试纪律(Design §0):禁止为通过测试放宽电路约束;红了先怀疑测试/输入构造。
 * 布阵真假一律以 lib 真理源为准:合法布阵先过 validateBoard 自检,非法布阵
 * 断言 validateBoard 报对应错误码——保证"电路拒绝的确实是规则违例,而不是
 * 测试拼错了输入"。
 *
 * 产物复用模式同 smoke.test.ts:recompile:false 吃 scripts/compile.ts 布局,
 * 缺失/过期(board.circom 或 common.circom 比 wasm 新)时程序化 compileCircuit
 * 重建——fallback 也走 circom 版本断言。board 编译几十秒,before 里只做一次,
 * 全部用例共享同一 tester。
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import circomTester, { type CircuitInput, type WasmTester } from 'circom_tester';
// circomlibjs 仅作 B1 的 Poseidon 三方互证(模式同 lib.test.ts)
import { buildPoseidon } from 'circomlibjs';
import {
  computeCommitment,
  encodeShipsForHash,
  toBoardInputs,
  validateBoard,
  type Board,
  type ValidateResult,
} from '../lib/index.ts';
// compile.ts 有 isDirectRun 守卫,被 import 不会触发编译副作用
import { BOARD_CONSTRAINT_LIMIT, compileCircuit } from '../scripts/compile.ts';
import { circuitPaths, readR1csStatsThrows } from '../scripts/common.ts';
import { LEGAL_BOARD, P_MINUS_1, SALT, assertNoSpaceInPaths, mkBoard } from './helpers.ts';

const PKG_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BOARD_BUILD = path.join(PKG_ROOT, 'build', 'board');

// ── 布阵素材 ────────────────────────────────────────────────────────────────
// 合法主力布阵 LEGAL_BOARD 与 mkBoard/SALT/P_MINUS_1 在 test/helpers.ts(shot 测试共用)。
// B3–B7 负向用例的合法基底(逐行横船,互不重叠、全界内);corrupt() 替换其中一船
const BASE: Array<{ x: number; y: number; dir: number }> = [
  { x: 0, y: 0, dir: 0 }, // len5: (0..4, 0)
  { x: 0, y: 1, dir: 0 }, // len4: (0..3, 1)
  { x: 0, y: 2, dir: 0 }, // len3: (0..2, 2)
  { x: 0, y: 3, dir: 0 }, // len3: (0..2, 3)
  { x: 0, y: 4, dir: 0 }, // len2: (0..1, 4)
];
function corrupt(shipId: number, bad: { x: number; y: number; dir: number }): Board {
  const ships = BASE.map((s) => ({ ...s }));
  ships[shipId] = bad;
  return mkBoard(ships);
}

describe('board circuit(B1–B9 开局合法性)', function () {
  this.timeout(120_000);

  before(function () {
    assertNoSpaceInPaths([PKG_ROOT, process.cwd()]);
  });

  let circuit: WasmTester;

  before(async function () {
    // 产物缺失或比电路源旧(改了 board/common.circom 没重编)→ 程序化重建,
    // 防止 B9 读到陈旧 r1cs、witness 跑在陈旧 wasm 上造成假绿。
    const wasm = path.join(BOARD_BUILD, 'board_js', 'board.wasm');
    const sources = [path.join(PKG_ROOT, 'board.circom'), path.join(PKG_ROOT, 'common.circom')];
    const fresh =
      fs.existsSync(wasm) &&
      sources.every((s) => fs.statSync(s).mtimeMs <= fs.statSync(wasm).mtimeMs);
    if (fresh) {
      console.log('[board.test] 复用已有 build/board 产物(compile.ts 布局)');
    } else {
      console.log('[board.test] build/board 缺失或过期,程序化调用 compileCircuit("board") 重建');
      await compileCircuit('board');
    }
    circuit = await circomTester.wasm(path.join(PKG_ROOT, 'board.circom'), {
      output: BOARD_BUILD,
      recompile: false,
    });
  });

  /** 合法布阵跑 witness:先过 lib 真理源自检,再过电路全部约束 */
  async function witnessFor(b: Board, salt: bigint): Promise<bigint[]> {
    assert.deepEqual(validateBoard(b), { ok: true }, '测试自检:布阵必须先过 validateBoard');
    const witness = await circuit.calculateWitness(toBoardInputs(b, salt), true);
    await circuit.checkConstraints(witness);
    return witness;
  }

  /** 非法布阵断言被电路拒绝;expected 钉死 lib 真理源对该输入的判词(防拼错输入) */
  async function assertRejected(
    b: Board,
    expected: ValidateResult & { ok: false },
    label: string,
  ): Promise<void> {
    assert.deepEqual(validateBoard(b), expected, `测试自检:${label} 的 lib 判词不符`);
    await assert.rejects(
      circuit.calculateWitness(toBoardInputs(b, SALT), true),
      /Assert Failed/,
      `${label}:电路应拒绝该 witness`,
    );
  }

  it('B1 合法布阵:witness 通过,commitment 与 lib(poseidon-lite)+ circomlibjs 三方一致', async function () {
    const witness = await witnessFor(LEGAL_BOARD, SALT);
    const expected = computeCommitment(LEGAL_BOARD, SALT); // poseidon-lite 真理源
    await circuit.assertOut(witness, { commitment: expected });
    // 三方互证:circomlibjs 独立实现同 16 输入(模式照 lib.test.ts)
    const poseidon = await buildPoseidon();
    const inputs = [...encodeShipsForHash(LEGAL_BOARD), SALT];
    assert.equal(inputs.length, 16);
    assert.equal(poseidon.F.toObject(poseidon(inputs)), expected);
  });

  it('B2 贴边极限合法:len5 尾恰压 x=9 / y=9;全船贴边相邻(§4.1 允许)', async function () {
    const cases: Array<[string, Board]> = [
      [
        'len5 x=5 dir=0,尾格 x=9',
        mkBoard([
          { x: 5, y: 0, dir: 0 }, // len5: (5..9, 0)
          { x: 0, y: 1, dir: 0 },
          { x: 0, y: 2, dir: 0 },
          { x: 0, y: 3, dir: 0 },
          { x: 0, y: 4, dir: 0 },
        ]),
      ],
      [
        'len5 y=5 dir=1,尾格 y=9',
        mkBoard([
          { x: 0, y: 5, dir: 1 }, // len5: (0, 5..9)
          { x: 2, y: 0, dir: 0 },
          { x: 2, y: 1, dir: 0 },
          { x: 2, y: 2, dir: 0 },
          { x: 2, y: 3, dir: 0 },
        ]),
      ],
      [
        '5 行横船全部上下贴边相邻',
        mkBoard([
          { x: 0, y: 0, dir: 0 },
          { x: 0, y: 1, dir: 0 },
          { x: 0, y: 2, dir: 0 },
          { x: 0, y: 3, dir: 0 },
          { x: 0, y: 4, dir: 0 },
        ]),
      ],
    ];
    for (const [label, b] of cases) {
      try {
        const witness = await witnessFor(b, SALT);
        await circuit.assertOut(witness, { commitment: computeCommitment(b, SALT) });
      } catch (e) {
        throw new Error(`B2 用例「${label}」失败:${(e as Error).message}`, { cause: e });
      }
    }
  });

  it('B3 重叠(横竖十字交叉同格)→ 电路拒绝', async function () {
    // ship3 垂直 (2, 0..2) 与 ship0 水平 (0..4, 0) 交叉于 (2,0)
    const b = mkBoard([
      { x: 0, y: 0, dir: 0 },
      { x: 0, y: 5, dir: 0 },
      { x: 0, y: 7, dir: 0 },
      { x: 2, y: 0, dir: 1 },
      { x: 0, y: 9, dir: 0 },
    ]);
    await assertRejected(b, { ok: false, code: 'OVERLAP', shipId: 3 }, 'B3 交叉重叠');
  });

  it('B4 水平越界(len5 x=6 dir=0 → 尾 x=10)→ 电路拒绝', async function () {
    await assertRejected(
      corrupt(0, { x: 6, y: 0, dir: 0 }),
      { ok: false, code: 'OOB', shipId: 0 },
      'B4 水平越界',
    );
  });

  it('B5 垂直越界(len4 y=7 dir=1 → 尾 y=10)→ 电路拒绝', async function () {
    await assertRejected(
      corrupt(1, { x: 5, y: 7, dir: 1 }),
      { ok: false, code: 'OOB', shipId: 1 },
      'B5 垂直越界',
    );
  });

  it('B6 域外坐标:x=10 / y=10(LessEqThan 挡)→ 电路拒绝', async function () {
    await assertRejected(
      corrupt(4, { x: 10, y: 4, dir: 0 }),
      { ok: false, code: 'BAD_COORD', shipId: 4 },
      'B6 x=10',
    );
    await assertRejected(
      corrupt(4, { x: 0, y: 10, dir: 0 }),
      { ok: false, code: 'BAD_COORD', shipId: 4 },
      'B6 y=10',
    );
  });

  it('B6 域回绕:x=p-1 / y=p-1(Num2Bits(4) 挡)→ 电路拒绝(比较器健全性专测)', async function () {
    // p-1 ≡ -1 (mod p)。若没有 Num2Bits(4) 先把坐标钉在 [0,16),4bit 比较器对
    // ~2^254 的输入取位是垃圾值,p-1 可能伪装成"≤9"混过去——这是 LessThan 系
    // 不健全的经典攻击面,必须由电路实测挡住,不能只靠注释。
    // p-1 超出 number 安全范围,绕开 toBoardInputs 直接手拼字符串输入。
    const cases: Array<[string, CircuitInput]> = [
      [
        'x0 = p-1',
        {
          ships: [
            [P_MINUS_1.toString(10), '0', '0'],
            ['0', '1', '0'],
            ['0', '2', '0'],
            ['0', '3', '0'],
            ['0', '4', '0'],
          ],
          salt: SALT.toString(10),
        },
      ],
      [
        'y1 = p-1',
        {
          ships: [
            ['0', '0', '0'],
            ['0', P_MINUS_1.toString(10), '0'],
            ['0', '2', '0'],
            ['0', '3', '0'],
            ['0', '4', '0'],
          ],
          salt: SALT.toString(10),
        },
      ],
    ];
    for (const [label, input] of cases) {
      await assert.rejects(
        circuit.calculateWitness(input, true),
        /Assert Failed/,
        `B6 ${label}:电路应拒绝域回绕坐标`,
      );
    }
  });

  it('B7 dir=2 → 电路拒绝', async function () {
    await assertRejected(
      corrupt(2, { x: 0, y: 2, dir: 2 }),
      { ok: false, code: 'BAD_DIR', shipId: 2 },
      'B7 dir=2',
    );
  });

  it('B8 不同 salt → 不同 commitment;同输入两次 → 相同(确定性)', async function () {
    const salt2 = SALT + 1n;
    const w1 = await witnessFor(LEGAL_BOARD, SALT);
    const w2 = await witnessFor(LEGAL_BOARD, salt2);
    const w3 = await witnessFor(LEGAL_BOARD, SALT);
    // 各自钉死到 lib 真理源(顺带证明电路输出确实随 salt 变化、且可复现)
    const c1 = computeCommitment(LEGAL_BOARD, SALT);
    const c2 = computeCommitment(LEGAL_BOARD, salt2);
    await circuit.assertOut(w1, { commitment: c1 });
    await circuit.assertOut(w2, { commitment: c2 });
    await circuit.assertOut(w3, { commitment: c1 });
    assert.notEqual(c1, c2, '不同 salt 的承诺必须不同');
    // witness[0] 恒为 1,witness[1] 是首个输出 commitment —— 直接比电路原始输出
    assert.equal(w1[1], w3[1], '同输入两次 witness 的 commitment 必须相同');
    assert.notEqual(w1[1], w2[1], '不同 salt 的 witness commitment 必须不同');
  });

  it('B9 约束数守门:nConstraints ≤ 50000(Design §2 止损线)', async function () {
    const stats = await readR1csStatsThrows(circuitPaths('board').r1cs);
    console.log(`[board.test] board 实际约束数:${stats.nConstraints}(via ${stats.via})`);
    assert.ok(
      stats.nConstraints <= BOARD_CONSTRAINT_LIMIT,
      `board 约束数 ${stats.nConstraints} 超过止损线 ${BOARD_CONSTRAINT_LIMIT},` +
        `停下回 Design 评审电路结构(§2),不要硬上更大的 ptau`,
    );
  });
});
