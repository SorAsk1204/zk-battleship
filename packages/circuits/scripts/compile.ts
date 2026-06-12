/**
 * compile.ts —— circom 编译(Windows 全管线第一关)。
 *
 * 用法:tsx scripts/compile.ts [电路名...](默认 board shot;smoke 需显式传)
 * 产物布局(circom_tester 同款,M1 板电路测试直接吃):
 *   build/<name>/<name>.r1cs / <name>.sym / <name>_js/<name>.wasm
 *
 * 守门:
 * - circom --version 必须是 2.1.9(防工具链漂移导致 zkey/verifier 不可复现);
 * - board 电路约束数 >50000 直接报错停下(Design §2 止损线)。
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import {
  CIRCOM_VERSION,
  PKG_ROOT,
  circuitPaths,
  circuitsFromArgv,
  execFile,
  fail,
  isDirectRun,
  readR1csStats,
} from './common.ts';

/** board 电路约束数止损线(Design §2) */
const BOARD_CONSTRAINT_LIMIT = 50_000;

async function assertCircomVersion(): Promise<void> {
  let stdout: string;
  try {
    ({ stdout } = await execFile('circom', ['--version']));
  } catch (e) {
    fail(`找不到 circom,请确认已装 ${CIRCOM_VERSION} 并在 PATH:${(e as Error).message}`);
  }
  if (!stdout.includes(CIRCOM_VERSION)) {
    fail(`circom 版本漂移:期望 ${CIRCOM_VERSION},实际 "${stdout.trim()}"。请安装精确版本。`);
  }
}

export async function compileCircuit(name: string): Promise<{ nConstraints: number }> {
  await assertCircomVersion();
  const p = circuitPaths(name);

  try {
    await fs.access(p.source);
  } catch {
    fail(`电路源文件不存在:${p.source}(M1 之前 board/shot 还没有,smoke 请显式传参)`);
  }

  await fs.mkdir(p.buildDir, { recursive: true });

  // execFile 数组传参绕开 Windows 引号坑;cwd=包根使 -l node_modules 解析 circomlib junction
  try {
    const { stdout, stderr } = await execFile(
      'circom',
      [`${name}.circom`, '--r1cs', '--wasm', '--sym', '-o', path.join('build', name), '-l', 'node_modules'],
      { cwd: PKG_ROOT },
    );
    if (stdout.trim()) console.log(stdout.trim());
    if (stderr.trim()) console.error(stderr.trim());
  } catch (e) {
    const err = e as Error & { stdout?: string; stderr?: string };
    fail(`circom 编译 ${name}.circom 失败:\n${err.stdout ?? ''}\n${err.stderr ?? err.message}`);
  }

  const stats = await readR1csStats(p.r1cs);
  console.log(
    `[compile] ${name}: ${stats.nConstraints} constraints, ` +
      `${stats.nPubInputs} public / ${stats.nPrvInputs} private inputs, ` +
      `${stats.nOutputs} outputs (via ${stats.via})`,
  );

  if (name === 'board' && stats.nConstraints > BOARD_CONSTRAINT_LIMIT) {
    fail(
      `board 电路约束数 ${stats.nConstraints} 超过止损线 ${BOARD_CONSTRAINT_LIMIT}(Design §2)。` +
        `停下,先回 Design 评审电路结构,不要硬上更大的 ptau。`,
    );
  }

  return { nConstraints: stats.nConstraints };
}

if (isDirectRun(import.meta.url)) {
  for (const name of circuitsFromArgv()) {
    await compileCircuit(name);
  }
  // snarkjs/r1csfile 的 bn128 worker 线程会让 Node 挂住,必须显式退出
  process.exit(0);
}
