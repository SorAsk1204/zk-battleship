/**
 * 脚本 C:撤局 —— Created 局无人加入,创建者超 JOIN_WINDOW 后撤局。
 *
 * 剧本:P0 createGame(真 board 证明)后无人 join。窗口内(<= lastActionAt+86400)
 * cancelGame 必须 revert JOIN_WINDOW(严格大于语义,防挂局钓鱼后抢先撤局);
 * evm_increaseTime(86401)+mine 后 cancelGame 成功:phase=Cancelled、
 * GameFinished(gameId, address(0), "cancelled")。
 *
 * snarkjs fullProve(board 证明)同样残留线程挂进程 —— 结束必须 process.exit;
 * anvil 清理(tree-kill 异步)必须 await 完成后才 exit。
 */
import { parseEventLogs, zeroAddress, type Address } from 'viem';
import { proveBoard } from '@zk-battleship/circuits/node';
import { formatProofCalldata } from '@zk-battleship/circuits/proof';
import { ANVIL_KEYS, makeClients, makeTestClient } from './lib/accounts.ts';
import { startAnvil, type AnvilHandle } from './lib/anvil.ts';
import * as assert from './lib/assert.ts';
import { boardA, commitmentA, saltA } from './lib/boards.ts';
import { deployAll } from './lib/deploy.ts';
import { Phase } from './lib/phases.ts';
import { makeSender } from './lib/tx.ts';

const JOIN_WINDOW_S = 86_400; // Battleship.sol JOIN_WINDOW,Created 局撤局等待窗口(秒)

const t0 = Date.now();
const elapsed = (): string => `${((Date.now() - t0) / 1000).toFixed(1)}s`;

let anvil: AnvilHandle | undefined;
try {
  console.log('[C] 启动 anvil :8546 ...');
  anvil = await startAnvil(8546);
  const { rpcUrl } = anvil;

  const deployed = await deployAll(rpcUrl, ANVIL_KEYS[0]);
  const { address, abi } = deployed.battleship;
  console.log(`[C] 部署完成 battleship=${address}`);

  const p0 = makeClients(rpcUrl, ANVIL_KEYS[0]);
  const publicClient = p0.publicClient;
  const testClient = makeTestClient(rpcUrl);
  const { send, expectRevert } = makeSender({ publicClient, address, abi, tag: '[C]' });

  const getGame = async () =>
    (await publicClient.readContract({ address, abi, functionName: 'getGame', args: [gameId] })) as {
      phase: number;
      winner: Address;
    };

  // ===== P0 createGame(真 board 证明),无人 join =====
  console.log('[C] 生成 board 证明 A ...');
  const boardProofA = await proveBoard(boardA, saltA);
  const cdBoardA = await formatProofCalldata(boardProofA.proof, boardProofA.publicSignals);

  const rcCreate = await send('createGame', p0.wallet, 'createGame', [commitmentA, cdBoardA]);
  const createdLogs = parseEventLogs({ abi, logs: rcCreate.logs, eventName: 'GameCreated' });
  assert.equal(createdLogs.length, 1, '[C] createGame 收据应恰有 1 条 GameCreated');
  const gameId = (createdLogs[0] as unknown as { args: { gameId: bigint } }).args.gameId;
  assert.equal((await getGame()).phase, Phase.Created, '[C] 建局后 phase 应为 Created(1)');
  console.log(`[C] createGame OK gameId=${gameId},无人加入(${elapsed()})`);

  // ===== 窗口内提前 cancel:必须 revert JOIN_WINDOW(严格 > lastActionAt+86400) =====
  await expectRevert('窗口内提前 cancelGame', p0.account, 'cancelGame', [gameId], 'JOIN_WINDOW');

  // ===== 快进 86401s(严格大于语义)+ 挖一块落实时间戳 =====
  await testClient.increaseTime({ seconds: JOIN_WINDOW_S + 1 });
  await testClient.mine({ blocks: 1 });
  console.log(`[C] evm_increaseTime +${JOIN_WINDOW_S + 1}s + mine ✓`);

  // ===== 超窗后 cancel 成功:phase=Cancelled,GameFinished(gameId, address(0), "cancelled") =====
  const rcCancel = await send('cancelGame', p0.wallet, 'cancelGame', [gameId]);
  const finishedLogs = parseEventLogs({ abi, logs: rcCancel.logs, eventName: 'GameFinished' });
  assert.equal(finishedLogs.length, 1, '[C] cancelGame 收据应恰有 1 条 GameFinished');
  const fin = (finishedLogs[0] as unknown as {
    args: { gameId: bigint; winner: Address; reason: string };
  }).args;
  assert.equal(fin.gameId, gameId, '[C] GameFinished.gameId');
  assert.equal(fin.winner, zeroAddress, '[C] GameFinished.winner 应为 address(0)');
  assert.equal(fin.reason, 'cancelled', '[C] GameFinished.reason');

  const game = await getGame();
  assert.equal(game.phase, Phase.Cancelled, '[C] 终局 phase 应为 Cancelled(5)');
  assert.equal(game.winner, zeroAddress, '[C] 撤局无 winner(address(0))');
  console.log('[C] 终局状态:phase=Cancelled winner=address(0) reason=cancelled ✓');

  await anvil.stop();
  console.log(`[C] PASS(总耗时 ${elapsed()})`);
  process.exit(0); // snarkjs 残留线程挂进程,必须显式 exit(anvil 已清理完)
} catch (err) {
  console.error('[C] FAIL:', err);
  if (anvil) {
    await anvil.stop().catch(() => {
      /* stop 实际不会 reject(treeKill 错误已忽略),保险写法:清理异常也必须退出 */
    });
  }
  process.exit(1);
}
