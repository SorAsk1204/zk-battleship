/**
 * Anvil 进程管理。e2e 默认 8546 端口,避开 demo 链惯用的 8545。
 *
 * - anvil.exe 是真 exe,execa 直接 spawn 不踩 Windows .cmd shim 陷阱(见 run-all.ts 头注释)。
 * - 清理主路径走 tree-kill(全仓约定:Windows 无进程组,kill 顶层带不走孙进程);
 *   tree-kill 是异步回调,promisify 后 await,保证调用方在 process.exit 前真正杀完。
 * - 另挂 process 'exit'/'SIGINT' 兜底('exit' 回调只能同步,用 child.kill 直杀——
 *   anvil 无子进程,直杀顶层即可),防脚本异常退出后 anvil 残留占端口。
 */
import { execa } from 'execa';
import treeKill from 'tree-kill';

export type AnvilHandle = { rpcUrl: string; stop: () => Promise<void> };

const READY_TIMEOUT_MS = 15_000;
const POLL_INTERVAL_MS = 200;
const TAIL_LINES = 20;

export async function startAnvil(port = 8546): Promise<AnvilHandle> {
  const rpcUrl = `http://127.0.0.1:${port}`;
  const child = execa(
    'anvil',
    ['--host', '127.0.0.1', '--port', String(port), '--chain-id', '31337'],
    { buffer: false, reject: false, stdout: 'pipe', stderr: 'pipe' },
  );

  // 输出尾部环形缓冲:启动失败/异常退出时把 anvil 自己的报错带进 Error,可直接诊断
  const tail: string[] = [];
  const keepTail = (chunk: unknown): void => {
    for (const line of String(chunk).split(/\r?\n/)) {
      if (!line.trim()) continue;
      tail.push(line);
      if (tail.length > TAIL_LINES) tail.shift();
    }
  };
  child.stdout?.on('data', keepTail);
  child.stderr?.on('data', keepTail);

  let exited = false;
  let exitCode: number | undefined;
  void child.then((r) => {
    exited = true;
    exitCode = r.exitCode;
  });

  let stopped = false;
  // 'exit' 事件回调必须同步:直杀顶层(anvil 无孙进程,够用);正常路径仍走 tree-kill
  const hardKill = (): void => {
    if (!stopped && !exited) {
      try {
        child.kill('SIGKILL');
      } catch {
        // 进程已不在,忽略
      }
    }
  };
  const onSignal = (): void => {
    hardKill();
    process.exit(130);
  };
  process.on('exit', hardKill);
  process.on('SIGINT', onSignal);

  const stop = async (): Promise<void> => {
    if (stopped) return;
    stopped = true;
    process.removeListener('exit', hardKill);
    process.removeListener('SIGINT', onSignal);
    if (!exited && child.pid !== undefined) {
      await new Promise<void>((resolve) => {
        treeKill(child.pid!, 'SIGKILL', () => resolve()); // 错误(如已退出)一律忽略
      });
    }
    await child; // reject:false → 必然 resolve;等进程真正退出、端口释放
  };

  // 轮询 eth_chainId 直到就绪;期间进程退出/超时都按失败收场并带上输出尾部
  const deadline = Date.now() + READY_TIMEOUT_MS;
  for (;;) {
    if (exited) {
      await stop();
      throw new Error(
        `anvil 启动后即退出(exitCode=${exitCode}),常见原因:端口 ${port} 被占用。` +
          `输出尾部:\n${tail.join('\n')}`,
      );
    }
    try {
      const res = await fetch(rpcUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_chainId', params: [] }),
      });
      const body = (await res.json()) as { result?: string };
      if (body.result) break;
    } catch {
      // 端口未就绪,继续轮询
    }
    if (Date.now() > deadline) {
      await stop();
      throw new Error(
        `anvil ${READY_TIMEOUT_MS}ms 内未就绪(${rpcUrl})。输出尾部:\n${tail.join('\n')}`,
      );
    }
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }

  return { rpcUrl, stop };
}
