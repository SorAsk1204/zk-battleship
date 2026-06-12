/**
 * e2e 总入口(M0 占位)。
 * M2 实现:lib/{anvil,deploy,boards,assert}.ts + 三个场景脚本按序各起独立子进程
 * (execa 启动、tree-kill 清理 Anvil),任一非零即整体失败。
 *
 * 占位期唯一的真实检查:workspace 跨包 import 烟测——
 * 从 @zk-battleship/circuits(exports 指向 TS 源)拿 validateBoard 跑一个合法布阵。
 * 这验证了 "tsx 下跨包解析 workspace TS 源" 这条 M2 关键依赖路径,
 * 也是风险表里 "Vite 消费 workspace TS 源" 的 Node 侧前哨。
 *
 * M2 实现者注意:execa 9 + Node ≥22 在 Windows 上不能裸 spawn `.cmd` shim
 * (如 `execa('tsx', ...)` 会 EINVAL,CVE-2024-27980 防护);场景子进程用
 * `execaNode(script, {nodeOptions: ['--import', 'tsx']})` 或 `process.execPath`;
 * anvil.exe/forge.exe 等真 exe 不受影响。
 */
import assert from 'node:assert/strict';

import { validateBoard, type Board } from '@zk-battleship/circuits';

console.log('e2e 骨架:场景脚本于 M2 实现(脚本 A 全局打满 / B 超时 / C 取消)');

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

process.exit(0);
