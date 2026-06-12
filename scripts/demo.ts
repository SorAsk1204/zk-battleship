/**
 * pnpm demo —— 一键本地演示链:anvil(8545) + viem 程序化部署 + web dev server。
 *
 * 长驻进程,正常退出路径是 Ctrl+C。退出时按序清理并真正 await 完成:
 *   1. tree-kill web dev 子进程树(shell→pnpm→node→vite 多级;Windows 无进程组,
 *      kill 顶层带不走孙进程,必须 tree-kill)
 *   2. anvil.stop()(内部 tree-kill + await 进程退出、端口释放)
 *
 * SIGINT 注册顺序陷阱:startAnvil 默认自带 SIGINT 兜底(hardKill + process.exit(130)),
 * 监听器按注册顺序同步执行,exit 立即生效——demo 在 startAnvil 之后注册的清理逻辑会被
 * 跳过,之前注册的异步清理也来不及 await。故这里传 { registerSigint: false } 关掉它,
 * demo 全权接管 SIGINT(e2e 脚本不传该选项,行为不变——对共享库的最小侵入)。
 * anvil.ts 的 'exit' 同步兜底仍然在,崩溃路径不残留 anvil。
 *
 * Windows .cmd shim 陷阱(同 e2e/run-all.ts):Node ≥22 + execa 裸 spawn `pnpm`
 * (实为 pnpm.cmd)会 EINVAL(CVE-2024-27980 防护),起 web dev 走 { shell: true }。
 * anvil.exe 是真 exe,不受影响。
 */
import { existsSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execa } from 'execa';
import treeKill from 'tree-kill';
import { ANVIL_KEYS, makeClients } from '../packages/e2e/src/lib/accounts.ts';
import { startAnvil, type AnvilHandle } from '../packages/e2e/src/lib/anvil.ts';
import { deployAll } from '../packages/e2e/src/lib/deploy.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ANVIL_PORT = 8545; // demo 链惯用 8545;e2e 用 8546,互不冲突
const RPC_URL = `http://127.0.0.1:${ANVIL_PORT}`;
const WEB_URL = 'http://127.0.0.1:5173'; // vite 默认端口
const DEPLOYMENT_JSON = path.join(ROOT, 'packages', 'web', 'public', 'deployment.json');

// ===== 前置检查:缺产物给出精确修复命令后退出,不自动代跑(职责单一,同 deploy.ts 约定) =====
const PRECHECKS = [
  {
    file: path.join(ROOT, 'packages', 'contracts', 'out', 'Battleship.sol', 'Battleship.json'),
    fix: 'pnpm --filter @zk-battleship/contracts run build',
  },
  {
    file: path.join(ROOT, 'packages', 'circuits', 'artifacts', 'board', 'board.zkey'),
    fix: 'pnpm --filter @zk-battleship/circuits run build',
  },
] as const;
{
  const missing = PRECHECKS.filter((c) => !existsSync(c.file));
  if (missing.length > 0) {
    for (const m of missing) {
      console.error(`[demo] 缺少产物:${m.file}\n[demo]   先构建:${m.fix}`);
    }
    process.exit(1);
  }
}

// ===== web dev 子进程 =====
function spawnWebDev() {
  return execa('pnpm', ['--filter', '@zk-battleship/web', 'dev'], {
    cwd: ROOT,
    shell: true, // .cmd shim 陷阱,见头注释
    env: { VITE_DEMO: '1' },
    stdin: 'ignore', // vite 输出透传但不接管终端按键,Ctrl+C 留给 demo 统一处理
    stdout: 'inherit',
    stderr: 'inherit',
    buffer: false,
    reject: false,
  } as const);
}

// ===== 清理(SIGINT / 启动失败 / web dev 意外退出 共用) =====
let anvil: AnvilHandle | undefined;
let webDev: ReturnType<typeof spawnWebDev> | undefined;
let webDevExited = false;
let cleaning = false;

async function killWebDev(): Promise<void> {
  if (webDev === undefined || webDev.pid === undefined || webDevExited) return;
  // tree-kill 异步回调,promisify 后 await;错误(树已死)一律忽略
  await new Promise<void>((resolve) => treeKill(webDev!.pid!, 'SIGKILL', () => resolve()));
  await webDev; // reject:false → 必然 resolve;等子进程真正退出、5173 释放
}

async function cleanup(): Promise<void> {
  if (cleaning) return;
  cleaning = true;
  console.log('\n[demo] 清理中:web dev 子进程树 → anvil …');
  await killWebDev();
  if (anvil) await anvil.stop();
  console.log('[demo] 清理完成');
}

// 在 startAnvil 之前注册:demo 是唯一的 SIGINT 处理方,清理 await 完成后才退出
process.on('SIGINT', () => {
  if (cleaning) return; // 二次 Ctrl+C:清理已在途,忽略(taskkill /F 不会卡)
  void cleanup().then(() => process.exit(130));
});

// ===== 主流程 =====
async function main(): Promise<void> {
  console.log(`[demo] 启动 anvil(${RPC_URL})…`);
  anvil = await startAnvil(ANVIL_PORT, { registerSigint: false });

  console.log('[demo] anvil 就绪,部署合约(deployer = anvil #0)…');
  const deployed = await deployAll(anvil.rpcUrl, ANVIL_KEYS[0]);
  console.log(`[demo]   BoardVerifier ${deployed.boardVerifier.address}`);
  console.log(`[demo]   ShotVerifier  ${deployed.shotVerifier.address}`);
  console.log(`[demo]   Battleship    ${deployed.battleship.address}`);

  // D10 schema + rpcUrl;web 的 public/ 静态服务,前端 fetch('/deployment.json')
  const deployment = {
    chainId: 31337,
    battleship: deployed.battleship.address,
    boardVerifier: deployed.boardVerifier.address,
    shotVerifier: deployed.shotVerifier.address,
    deployBlock: Number(deployed.deployBlock),
    rpcUrl: RPC_URL,
  };
  writeFileSync(DEPLOYMENT_JSON, `${JSON.stringify(deployment, null, 2)}\n`);
  console.log(`[demo] 已写 ${DEPLOYMENT_JSON}`);

  // anvil 公知测试私钥(助记词 "test test ... junk"),仅本地链,不构成泄密
  const [p0, p1] = ANVIL_KEYS.map((k) => makeClients(anvil!.rpcUrl, k).account.address);
  console.log('\n========================================================');
  console.log('测试账户(anvil 公知测试私钥,仅本地链):');
  console.log(`  P0(anvil #0)地址  ${p0}`);
  console.log(`             私钥  ${ANVIL_KEYS[0]}`);
  console.log(`  P1(anvil #1)地址  ${p1}`);
  console.log(`             私钥  ${ANVIL_KEYS[1]}`);
  console.log(`RPC: ${RPC_URL}    Web: ${WEB_URL}`);
  console.log('Ctrl+C 退出(将清理 anvil 与 dev server)');
  console.log('========================================================\n');

  console.log('[demo] 启动 web dev server(VITE_DEMO=1)…');
  webDev = spawnWebDev();
  void webDev.then((r) => {
    webDevExited = true;
    if (!cleaning) {
      console.error(`[demo] web dev server 意外退出(exitCode=${r.exitCode}),清理 anvil 后退出`);
      void cleanup().then(() => process.exit(1));
    }
  });
  // 不 process.exit(0):长驻进程,webDev 子进程把事件循环撑住,退出只发生在清理路径
}

main().catch(async (err) => {
  console.error('[demo] 启动失败:', err);
  await cleanup();
  process.exit(1);
});
