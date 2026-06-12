/**
 * e2e 总入口:先跑 workspace 跨包 import 烟测(场景挂掉时先排除环境问题),
 * 再按序跑场景脚本——每个场景独立子进程(隔离 snarkjs 残留线程与 anvil 生命周期),
 * 任一非零即整体非零。
 *
 * Windows 陷阱(保留警告):execa 9 + Node ≥22 不能裸 spawn `.cmd` shim
 * (如 `execa('tsx', ...)` 会 EINVAL,CVE-2024-27980 防护);场景子进程一律
 * `execaNode(script, {nodeOptions: ['--import', 'tsx']})` 走 process.execPath;
 * anvil.exe/forge.exe 等真 exe 不受影响。
 */
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execaNode } from 'execa';
import { validateBoard, type Board } from '@zk-battleship/circuits';

// ===== 烟测:@zk-battleship/circuits workspace TS 源跨包解析 =====
// 合法布阵:5 船 [5,4,3,3,2] 各占一行水平摆放,界内且无重叠
const board: Board = [
  { x: 0, y: 0, dir: 0 },
  { x: 0, y: 2, dir: 0 },
  { x: 0, y: 4, dir: 0 },
  { x: 0, y: 6, dir: 0 },
  { x: 0, y: 8, dir: 0 },
];
const result = validateBoard(board);
assert.deepEqual(result, { ok: true }, `烟测失败:合法布阵被判非法 ${JSON.stringify(result)}`);
console.log('烟测通过:@zk-battleship/circuits workspace TS 源跨包解析 OK(validateBoard → ok)');

// ===== 场景脚本(顺序执行:A 全局打满 / B 超时判负 / C 撤局) =====
const SCENARIOS = ['a-full-game.ts', 'b-timeout.ts', 'c-cancel.ts'];

const here = path.dirname(fileURLToPath(import.meta.url));
for (const name of SCENARIOS) {
  console.log(`\n=== e2e 场景:${name} ===`);
  const r = await execaNode(path.join(here, name), {
    nodeOptions: ['--import', 'tsx'],
    cwd: path.resolve(here, '..'), // --import 的裸说明符从 cwd 解析,钉死在 e2e 包根
    stdio: 'inherit',
    reject: false,
  });
  if (r.exitCode !== 0) {
    console.error(`\n场景 ${name} 失败(exit=${r.exitCode})`);
    process.exit(r.exitCode ?? 1);
  }
}

console.log('\n全部 e2e 场景通过');
process.exit(0);
