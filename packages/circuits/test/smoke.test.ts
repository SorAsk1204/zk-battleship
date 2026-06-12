/**
 * Task 0.3 — 管线常驻冒烟测试。
 *
 * 验证三件事:
 * 1. 仓库路径无空格(circom_tester 内部 exec 不加引号,Windows 纪律 #1);
 * 2. circom_tester 以 recompile:false 直接吃 scripts/compile.ts 的产物布局
 *    (<output>/<name>_js/<name>.wasm + .sym + .r1cs)—— M1 板电路测试依赖同一路径;
 * 3. witness 通过约束,且 Poseidon(2) 输出与 poseidon-lite 三方对拍一致。
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import circomTester, { type WasmTester } from 'circom_tester';
import { poseidon2 } from 'poseidon-lite/poseidon2';

const PKG_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SMOKE_BUILD = path.join(PKG_ROOT, 'build', 'smoke');

describe('smoke circuit(证明管线冒烟)', function () {
  // 首次走 recompile 时 circom 编译可能慢
  this.timeout(120_000);

  before(function () {
    for (const p of [PKG_ROOT, process.cwd()]) {
      assert.ok(
        !p.includes(' '),
        `路径含空格:"${p}"。circom_tester 内部用字符串拼接 exec circom 且不加引号,` +
          `仓库必须放在无空格路径下(DECISIONS.md Windows 纪律 #1)。`,
      );
    }
  });

  let circuit: WasmTester;

  before(async function () {
    const compiled = fs.existsSync(path.join(SMOKE_BUILD, 'smoke_js', 'smoke.wasm'));
    if (compiled) {
      // 主路径:直接吃 compile.ts 产物,验证 M1 真电路测试要走的布局
      circuit = await circomTester.wasm(path.join(PKG_ROOT, 'smoke.circom'), {
        output: SMOKE_BUILD,
        recompile: false,
      });
    } else {
      // 兜底:clean checkout 直接跑 test 时自行编译(等价 compile.ts 的 -l node_modules)
      circuit = await circomTester.wasm(path.join(PKG_ROOT, 'smoke.circom'), {
        output: SMOKE_BUILD,
        recompile: true,
        include: path.join(PKG_ROOT, 'node_modules'),
      });
    }
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
    const b = 21888242871839275222246405745257275088548364400416034343698204186575808495616n; // p-1
    const witness = await circuit.calculateWitness({ a, b }, true);
    await circuit.checkConstraints(witness);
    await circuit.assertOut(witness, { h: poseidon2([a, b]) });
  });
});
