/**
 * build.ts —— 串联 compile → setup → export(单进程跑完,避免 npm script && 链
 * 在 pnpm 下只把 argv 透传给最后一段的问题)。
 *
 * 用法:tsx scripts/build.ts [电路名...](默认 board shot)
 */
import { circuitsFromArgv } from './common.ts';
import { compileCircuit } from './compile.ts';
import { exportCircuit } from './export.ts';
import { setupCircuit } from './setup.ts';

const names = circuitsFromArgv();
for (const name of names) {
  await compileCircuit(name);
  await setupCircuit(name); // 内部含 ensurePtau
  await exportCircuit(name);
}
console.log(`[build] done: ${names.join(', ')}`);
process.exit(0);
