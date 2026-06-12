/**
 * Task 0.3 — 管线常驻冒烟测试。
 *
 * 验证三件事:
 * 1. 仓库路径无空格(circom_tester 内部 exec 不加引号,Windows 纪律 #1);
 * 2. circom_tester 以 recompile:false 直接吃 scripts/compile.ts 的产物布局
 *    (<output>/<name>_js/<name>.wasm + .sym + .r1cs)—— M1 板电路测试依赖同一路径;
 * 3. witness 通过约束,且 Poseidon(2) 输出与 poseidon-lite 三方对拍一致。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import circomTester, { type WasmTester } from 'circom_tester';
import { poseidon2 } from 'poseidon-lite/poseidon2';
// compile.ts 有 isDirectRun 守卫,被 import 不会触发编译副作用,可安全引用
import { compileCircuit } from '../scripts/compile.ts';
import { P_MINUS_1, assertNoSpaceInPaths } from './helpers.ts';

const PKG_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SMOKE_BUILD = path.join(PKG_ROOT, 'build', 'smoke');

describe('smoke circuit(证明管线冒烟)', function () {
  // 首次(产物缺失走 compileCircuit)时 circom 编译可能慢
  this.timeout(120_000);

  before(function () {
    assertNoSpaceInPaths([PKG_ROOT, process.cwd()]);
  });

  let circuit: WasmTester;

  before(async function () {
    // build 产物缺失(clean checkout 直接跑 test)时程序化调 compileCircuit 重建,
    // 而不是 circom_tester 的 recompile:true:这样 fallback 也经过 compile.ts 的
    // circom 版本断言,且下面的 recompile:false 永远在验证"吃 compile.ts 布局"这条契约。
    if (fs.existsSync(path.join(SMOKE_BUILD, 'smoke_js', 'smoke.wasm'))) {
      console.log('[smoke.test] 复用已有 build/smoke 产物(compile.ts 布局)');
    } else {
      console.log('[smoke.test] build/smoke 产物缺失,程序化调用 compileCircuit("smoke") 重建');
      await compileCircuit('smoke');
    }
    circuit = await circomTester.wasm(path.join(PKG_ROOT, 'smoke.circom'), {
      output: SMOKE_BUILD,
      recompile: false,
    });
  });

  it('witness 满足全部约束,输出与 poseidon-lite 对拍一致', async function () {
    const a = 123n;
    const b = 456n;
    const witness = await circuit.calculateWitness({ a, b }, true);
    await circuit.checkConstraints(witness);
    await circuit.assertOut(witness, { h: poseidon2([a, b]) });
  });

  it('换一组输入仍一致(防"恰好撞对"假阳性)', async function () {
    const a = 0n;
    const b = P_MINUS_1;
    const witness = await circuit.calculateWitness({ a, b }, true);
    await circuit.checkConstraints(witness);
    await circuit.assertOut(witness, { h: poseidon2([a, b]) });
  });
});
