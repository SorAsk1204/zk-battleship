/**
 * Task 1.4 — shot 电路 S1–S7。
 *
 * 测试纪律(Design §0):禁止为通过测试放宽电路约束;红了先怀疑测试/输入构造。
 * hit/miss 真假一律以 lib 真理源 isHit 为准(§9.1:全 100 格穷举对拍)。
 *
 * 分层:
 * - S1–S4 + 约束守门:witness 层,只要 build/shot 产物(缺失/过期自动 compileCircuit),永远跑;
 * - S5–S7:证明层,依赖 artifacts/shot(wasm+zkey+vkey,Task 1.5 setup+export 产出);
 *   缺失时整组 skip 并打印提示,Task 1.5 之后自动启用。
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import circomTester, { type CircuitInput, type WasmTester } from 'circom_tester';
import * as snarkjs from 'snarkjs';
import {
  TOTAL_SHIP_CELLS,
  computeCommitment,
  isHit,
  toBoardInputs,
  toShotInputs,
  validateBoard,
  type Board,
} from '../lib/index.ts';
import { artifactPaths, proveShot } from '../lib/node.ts';
// compile.ts 有 isDirectRun 守卫,被 import 不会触发编译副作用
import { SHOT_CONSTRAINT_LIMIT, compileCircuit } from '../scripts/compile.ts';
import { circuitPaths, readR1csStatsThrows, sha256File } from '../scripts/common.ts';
import type { SetupMeta } from '../scripts/setup.ts';
import { LEGAL_BOARD, P_MINUS_1, SALT, assertNoSpaceInPaths, mkBoard } from './helpers.ts';

const PKG_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SHOT_BUILD = path.join(PKG_ROOT, 'build', 'shot');

// S3 用的第二合法布阵(与 LEGAL_BOARD 不同 ⇒ 同 salt 下承诺必不同)
const OTHER_BOARD: Board = mkBoard([
  { x: 0, y: 0, dir: 0 }, // len5: (0..4, 0)
  { x: 0, y: 1, dir: 0 }, // len4: (0..3, 1)
  { x: 0, y: 2, dir: 0 }, // len3: (0..2, 2)
  { x: 0, y: 3, dir: 0 }, // len3: (0..2, 3)
  { x: 0, y: 4, dir: 0 }, // len2: (0..1, 4)
]);

/**
 * 绕开 toShotInputs 的 0–9 入参校验,手拼 shot 电路输入(S4 需要构造域外 tx/ty)。
 * commitment 仍按 lib 真理源对 (b, salt) 计算——S4 只想测 tx/ty,承诺必须是对的。
 */
function rawShotInput(b: Board, salt: bigint, tx: string, ty: string): CircuitInput {
  return {
    ...toBoardInputs(b, salt),
    commitment: computeCommitment(b, salt).toString(10),
    tx,
    ty,
  };
}

describe('shot circuit(S1–S4 witness 层)', function () {
  this.timeout(120_000);

  before(function () {
    assertNoSpaceInPaths([PKG_ROOT, process.cwd()]);
    assert.deepEqual(validateBoard(LEGAL_BOARD), { ok: true }, '测试自检:LEGAL_BOARD 必须合法');
    assert.deepEqual(validateBoard(OTHER_BOARD), { ok: true }, '测试自检:OTHER_BOARD 必须合法');
  });

  let circuit: WasmTester;

  before(async function () {
    // 产物缺失或比电路源旧(改了 shot/common.circom 没重编)→ 程序化重建,
    // 防止守门读到陈旧 r1cs、witness 跑在陈旧 wasm 上造成假绿(模式同 board.test)。
    const wasm = path.join(SHOT_BUILD, 'shot_js', 'shot.wasm');
    const sources = [path.join(PKG_ROOT, 'shot.circom'), path.join(PKG_ROOT, 'common.circom')];
    const fresh =
      fs.existsSync(wasm) &&
      sources.every((s) => fs.statSync(s).mtimeMs <= fs.statSync(wasm).mtimeMs);
    if (fresh) {
      console.log('[shot.test] 复用已有 build/shot 产物(compile.ts 布局)');
    } else {
      console.log('[shot.test] build/shot 缺失或过期,程序化调用 compileCircuit("shot") 重建');
      await compileCircuit('shot');
    }
    circuit = await circomTester.wasm(path.join(PKG_ROOT, 'shot.circom'), {
      output: SHOT_BUILD,
      recompile: false,
    });
  });

  it('S1 全 100 格穷举:result 与 lib isHit 逐格一致(§9.1)', async function () {
    const t0 = Date.now();
    let hits = 0;
    for (let c = 0; c < 100; c++) {
      const tx = c % 10;
      const ty = Math.floor(c / 10); // 行主序 c = ty*10 + tx,与 occupancyGrid 同序
      const expected = isHit(LEGAL_BOARD, tx, ty); // lib 真理源
      hits += expected;
      const witness = await circuit.calculateWitness(toShotInputs(LEGAL_BOARD, SALT, tx, ty), true);
      await circuit.checkConstraints(witness);
      await circuit.assertOut(witness, { result: BigInt(expected) });
    }
    // 自检:合法布阵命中格恒 17——防"全 miss 也能对上"的退化一致
    assert.equal(hits, TOTAL_SHIP_CELLS, '测试自检:LEGAL_BOARD 命中格数必须是 17');
    console.log(`[shot.test] S1 全 100 格穷举耗时 ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  });

  it('S2 换 salt(witness salt 与 commitment 的 salt 不一致)→ 电路拒绝', async function () {
    // commitment 按 SALT 算,witness 里的 salt 换成 SALT+1 ⇒ Poseidon 对不上
    assert.notEqual(
      computeCommitment(LEGAL_BOARD, SALT),
      computeCommitment(LEGAL_BOARD, SALT + 1n),
      '测试自检:不同 salt 的承诺必须不同',
    );
    const input = toShotInputs(LEGAL_BOARD, SALT, 0, 0);
    input.salt = (SALT + 1n).toString(10);
    await assert.rejects(
      circuit.calculateWitness(input, true),
      /Assert Failed/,
      'S2:换 salt 后承诺绑定必须拒绝',
    );
  });

  it('S3 换 ships(commitment 来自同 salt 的另一布阵)→ 电路拒绝', async function () {
    // "防换棋盘"主攻击路径:用 OTHER_BOARD 的承诺配 LEGAL_BOARD 的 witness
    const input = toShotInputs(LEGAL_BOARD, SALT, 0, 0);
    input.commitment = computeCommitment(OTHER_BOARD, SALT).toString(10);
    await assert.rejects(
      circuit.calculateWitness(input, true),
      /Assert Failed/,
      'S3:换布阵后承诺绑定必须拒绝',
    );
  });

  it('S4a tx/ty ∈ [10,15]:能过 Num2Bits(4),witness 成立且 result=0(与 lib isHit 域外=0 一致)', async function () {
    // 推演(电路语义,非疏漏):shot 只做 <16 健全性检查,≤9 由合约 attack 入口管
    // (Design §5.4)。tx∈[10,15] 时五舰 InShip 全 0:
    //   水平支:leX 要求 cx ≤ x+len-1 ≤ 9 < 10 ⇒ 0;垂直支:eqX 要求 cx == x ≤ 9 ⇒ 0。
    // 所以 result=0 的 witness 可满足——语义与 lib isHit 域外返回 0 精确一致。
    const cases: Array<[string, number, number]> = [
      ['tx=10', 10, 0],
      ['tx=15', 15, 9],
      ['ty=10', 0, 10],
      ['ty=15', 9, 15],
    ];
    for (const [label, tx, ty] of cases) {
      assert.equal(isHit(LEGAL_BOARD, tx, ty), 0, `测试自检:lib isHit 域外必须返回 0(${label})`);
      const witness = await circuit.calculateWitness(
        rawShotInput(LEGAL_BOARD, SALT, String(tx), String(ty)),
        true,
      );
      await circuit.checkConstraints(witness);
      await circuit.assertOut(witness, { result: 0n });
    }
    // lib 入口侧的防线:toShotInputs 对 10..15 直接 throw,正常调用方根本造不出这种输入
    assert.throws(() => toShotInputs(LEGAL_BOARD, SALT, 10, 0), /0–9/);
  });

  it('S4b tx=p-1 / ty=p-1(域回绕,Num2Bits(4) 挡)→ 电路拒绝(比较器健全性专测)', async function () {
    // p-1 ≡ -1 (mod p),≥ 2^4 ⇒ Num2Bits(4) 不可满足。若没有这两条防御性约束,
    // InShip 的 4bit 比较器对 ~2^254 的输入取位是垃圾值,结论不可信。
    for (const [label, tx, ty] of [
      ['tx=p-1', P_MINUS_1.toString(10), '0'],
      ['ty=p-1', '0', P_MINUS_1.toString(10)],
    ] as const) {
      await assert.rejects(
        circuit.calculateWitness(rawShotInput(LEGAL_BOARD, SALT, tx, ty), true),
        /Assert Failed/,
        `S4b ${label}:电路应拒绝域回绕坐标`,
      );
    }
  });

  it('约束数守门:nConstraints ≤ 8000(Design §2 上界)', async function () {
    const stats = await readR1csStatsThrows(circuitPaths('shot').r1cs);
    console.log(`[shot.test] shot 实际约束数:${stats.nConstraints}(via ${stats.via})`);
    assert.ok(
      stats.nConstraints <= SHOT_CONSTRAINT_LIMIT,
      `shot 约束数 ${stats.nConstraints} 超过止损线 ${SHOT_CONSTRAINT_LIMIT},` +
        `停下回 Design 评审电路结构(§2),不要硬上更大的 ptau`,
    );
  });
});

describe('shot circuit(S5–S7 证明层,需 artifacts/shot)', function () {
  this.timeout(120_000);

  // 证明层吃 Task 1.5 提交的正式产物(lib/node.ts artifactPaths 是路径单一真理源,
  // export.ts 的拷贝目标与这里取的是同一份常量)。
  const VKEY_PATH = artifactPaths.shot.vkey;
  const REQUIRED = [artifactPaths.shot.wasm, artifactPaths.shot.zkey, VKEY_PATH];

  // 基线证明:命中格 (9,0)(LEGAL_BOARD ship0 船头),S5/S6 共享,只 fullProve 一次
  const HIT_X = 9;
  const HIT_Y = 0;
  let vkey: unknown;
  let baseline: { proof: unknown; publicSignals: string[] };

  before(async function () {
    const missing = REQUIRED.filter((f) => !fs.existsSync(f));
    if (missing.length > 0) {
      console.log(
        `[shot.test] artifacts/shot 产物缺失,S5–S7 跳过(Task 1.5 setup+export 后自动启用):\n` +
          missing.map((f) => `  - ${f}`).join('\n'),
      );
      this.skip();
    }
    // 陈旧性断言:setup-meta.json 记录的是 zkey 来源 r1cs 的 sha256。若当前
    // build/shot/shot.r1cs 已变(改了电路只重编译、没重跑 setup+export),
    // S5–S7 会在陈旧 zkey 上跑出误导结论——直接 fail 而不是带病通过。
    // build/ 不存在(纯 clone 只有 artifacts/)时无从比对,跳过该检查。
    const sp = circuitPaths('shot');
    if (fs.existsSync(sp.setupMeta) && fs.existsSync(sp.r1cs)) {
      const meta = JSON.parse(fs.readFileSync(sp.setupMeta, 'utf8')) as SetupMeta;
      const current = await sha256File(sp.r1cs);
      assert.equal(
        current,
        meta.r1csSha256,
        `build/shot/shot.r1cs 已与 setup-meta.json 记录不一致(电路改了没重跑 setup)。` +
          `artifacts/shot 已陈旧,先重跑:pnpm --filter @zk-battleship/circuits run build shot`,
      );
    }
    vkey = JSON.parse(fs.readFileSync(VKEY_PATH, 'utf8'));
    assert.equal(isHit(LEGAL_BOARD, HIT_X, HIT_Y), 1, '测试自检:(9,0) 必须是命中格');
    baseline = await proveShot(LEGAL_BOARD, SALT, HIT_X, HIT_Y);
  });

  it('S5 证明层篡改:翻转 result / 篡改 tx → verify false(基线必须先 verify true)', async function () {
    const { proof, publicSignals } = baseline;
    assert.equal(
      await snarkjs.groth16.verify(vkey, publicSignals, proof),
      true,
      'S5 基线:未篡改的证明必须 verify 通过',
    );
    // 篡改 1:翻转 result(防守方对命中谎报 miss 的链下形态)
    const flippedResult = [...publicSignals];
    flippedResult[0] = publicSignals[0] === '1' ? '0' : '1';
    assert.equal(
      await snarkjs.groth16.verify(vkey, flippedResult, proof),
      false,
      'S5:翻转 result 后 verify 必须失败',
    );
    // 篡改 2:换 tx(拿 (9,0) 的证明应答别的格子)
    const tamperedTx = [...publicSignals];
    tamperedTx[2] = String((HIT_X + 1) % 10);
    assert.equal(
      await snarkjs.groth16.verify(vkey, tamperedTx, proof),
      false,
      'S5:篡改 tx 后 verify 必须失败',
    );
  });

  it('S6 publicSignals 顺序契约:恰 [result, commitment, tx, ty](合约接口,不得调整)', async function () {
    const { publicSignals } = baseline;
    console.log(`[shot.test] S6 publicSignals = [${publicSignals.join(', ')}]`);
    assert.equal(publicSignals.length, 4, 'publicSignals 必须恰 4 项');
    // 逐项钉死:输出在前,公开输入按 shot.circom 声明顺序。这里 result 是 '1'
    // (命中格),能区分"位置 0 是 result"与"默认全 0 恰好对上"。
    assert.deepEqual(publicSignals, [
      String(isHit(LEGAL_BOARD, HIT_X, HIT_Y)),
      computeCommitment(LEGAL_BOARD, SALT).toString(10),
      String(HIT_X),
      String(HIT_Y),
    ]);
  });

  it('S7 prove → verify 冒烟(miss 格独立证明,顺带覆盖 result=0 的证明层)', async function () {
    const MISS_X = 4;
    const MISS_Y = 4;
    assert.equal(isHit(LEGAL_BOARD, MISS_X, MISS_Y), 0, '测试自检:(4,4) 必须是 miss 格');
    const { proof, publicSignals } = await proveShot(LEGAL_BOARD, SALT, MISS_X, MISS_Y);
    assert.equal(publicSignals[0], '0', 'miss 格的 result 必须是 0');
    assert.equal(
      await snarkjs.groth16.verify(vkey, publicSignals, proof),
      true,
      'S7:miss 证明必须 verify 通过',
    );
  });
});
