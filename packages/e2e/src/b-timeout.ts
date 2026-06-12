/**
 * 脚本 B:超时判负 —— 真 anvil + 真部署 + 现场证明的活局,中途一方拒不应答。
 *
 * 剧本:开局后先打 2 个完整回合(P0 命中 B 船格 ×2,P1 落 A 水格 ×2,全程现场 proveShot)
 * 证明对局活性;第 3 回合 P0 开炮后 P1 拒不应答。窗口内(<= lastActionAt+300)P0 提前
 * claimTimeout 必须 revert NOT_TIMEOUT(严格大于语义);evm_increaseTime(301)+mine 后
 * claimTimeout 成功:phase=Finished、winner=P0、GameFinished(gameId, P0, "timeout")。
 *
 * snarkjs fullProve 后有残留线程挂住进程 —— 结束必须 process.exit;
 * 但 anvil 清理(tree-kill 异步)必须 await 完成后才 exit,否则进程残留占 8546。
 */
import { parseEventLogs, type Address } from 'viem';
import { isHit } from '@zk-battleship/circuits';
import { proveBoard, proveShot } from '@zk-battleship/circuits/node';
import { formatProofCalldata } from '@zk-battleship/circuits/proof';
import { ANVIL_KEYS, makeClients, makeTestClient } from './lib/accounts.ts';
import { startAnvil, type AnvilHandle } from './lib/anvil.ts';
import * as assert from './lib/assert.ts';
import {
  aWaterCells,
  boardA,
  boardB,
  bShipCells,
  commitmentA,
  commitmentB,
  saltA,
  saltB,
} from './lib/boards.ts';
import { deployAll } from './lib/deploy.ts';
import { Phase } from './lib/phases.ts';
import { makeSender } from './lib/tx.ts';

const TIMEOUT_S = 300; // Battleship.sol TIMEOUT,义务方超时窗口(秒)
const FULL_ROUNDS = 2; // 现场打满的完整回合数

const t0 = Date.now();
const elapsed = (): string => `${((Date.now() - t0) / 1000).toFixed(1)}s`;

let anvil: AnvilHandle | undefined;
try {
  console.log('[B] 启动 anvil :8546 ...');
  anvil = await startAnvil(8546);
  const { rpcUrl } = anvil;

  const deployed = await deployAll(rpcUrl, ANVIL_KEYS[0]);
  const { address, abi } = deployed.battleship;
  console.log(`[B] 部署完成 battleship=${address}`);

  const p0 = makeClients(rpcUrl, ANVIL_KEYS[0]);
  const p1 = makeClients(rpcUrl, ANVIL_KEYS[1]);
  const publicClient = p0.publicClient;
  const testClient = makeTestClient(rpcUrl);
  const { send, expectRevert } = makeSender({ publicClient, address, abi, tag: '[B]' });

  const getGame = async () =>
    (await publicClient.readContract({ address, abi, functionName: 'getGame', args: [gameId] })) as {
      phase: number;
      hits: readonly [number, number];
      winner: Address;
    };

  // ===== 开局:两份 board 证明 + createGame / joinGame =====
  console.log('[B] 生成 board 证明 A ...');
  const boardProofA = await proveBoard(boardA, saltA);
  const cdBoardA = await formatProofCalldata(boardProofA.proof, boardProofA.publicSignals);
  console.log('[B] 生成 board 证明 B ...');
  const boardProofB = await proveBoard(boardB, saltB);
  const cdBoardB = await formatProofCalldata(boardProofB.proof, boardProofB.publicSignals);

  const rcCreate = await send('createGame', p0.wallet, 'createGame', [commitmentA, cdBoardA]);
  const createdLogs = parseEventLogs({ abi, logs: rcCreate.logs, eventName: 'GameCreated' });
  assert.equal(createdLogs.length, 1, '[B] createGame 收据应恰有 1 条 GameCreated');
  const gameId = (createdLogs[0] as unknown as { args: { gameId: bigint } }).args.gameId;
  await send('joinGame', p1.wallet, 'joinGame', [gameId, commitmentB, cdBoardB]);
  console.log(`[B] 开局完成 gameId=${gameId},P0 先攻(${elapsed()})`);

  // ===== 2 个完整回合(现场证明,证明这是个真活局而非摆拍) =====
  for (let i = 0; i < FULL_ROUNDS; i++) {
    const hitCell = bShipCells[i];
    assert.equal(isHit(boardB, hitCell.x, hitCell.y), 1, `[B] round${i + 1} bShipCells 应命中`);
    await send(`round${i + 1} P0 attack`, p0.wallet, 'attack', [gameId, hitCell.x, hitCell.y]);
    const shotB = await proveShot(boardB, saltB, hitCell.x, hitCell.y);
    const cdShotB = await formatProofCalldata(shotB.proof, shotB.publicSignals);
    await send(`round${i + 1} P1 respond`, p1.wallet, 'respond', [gameId, 1, cdShotB]);

    const missCell = aWaterCells[i];
    assert.equal(isHit(boardA, missCell.x, missCell.y), 0, `[B] round${i + 1} aWaterCells 应 miss`);
    await send(`round${i + 1} P1 attack`, p1.wallet, 'attack', [gameId, missCell.x, missCell.y]);
    const shotA = await proveShot(boardA, saltA, missCell.x, missCell.y);
    const cdShotA = await formatProofCalldata(shotA.proof, shotA.publicSignals);
    await send(`round${i + 1} P0 respond`, p0.wallet, 'respond', [gameId, 0, cdShotA]);
    console.log(
      `[B] round ${i + 1}/${FULL_ROUNDS}:P0 (${hitCell.x},${hitCell.y})→hit,` +
        `P1 (${missCell.x},${missCell.y})→miss(${elapsed()})`,
    );
  }

  // ===== 第 3 回合:P0 开炮,P1 拒不应答(义务方=P1,AwaitingResponse 起算超时) =====
  const cell3 = bShipCells[FULL_ROUNDS];
  await send('round3 P0 attack', p0.wallet, 'attack', [gameId, cell3.x, cell3.y]);
  assert.equal(
    (await getGame()).phase,
    Phase.AwaitingResponse,
    '[B] round3 开炮后 phase 应为 AwaitingResponse(P1 应答义务计时中)',
  );
  console.log(`[B] round3 P0 开炮 (${cell3.x},${cell3.y}),P1 拒不应答(${elapsed()})`);

  // ===== 窗口内提前 claim:必须 revert NOT_TIMEOUT(严格 > lastActionAt+300) =====
  await expectRevert('窗口内提前 claimTimeout', p0.account, 'claimTimeout', [gameId], 'NOT_TIMEOUT');

  // ===== 快进 301s(严格大于语义:+300 还不行,+301 才行)+ 挖一块落实时间戳 =====
  await testClient.increaseTime({ seconds: TIMEOUT_S + 1 });
  await testClient.mine({ blocks: 1 });
  console.log(`[B] evm_increaseTime +${TIMEOUT_S + 1}s + mine ✓`);

  // ===== 超时后 claim 成功:P0(非义务方)判胜 =====
  const rcClaim = await send('claimTimeout', p0.wallet, 'claimTimeout', [gameId]);
  const finishedLogs = parseEventLogs({ abi, logs: rcClaim.logs, eventName: 'GameFinished' });
  assert.equal(finishedLogs.length, 1, '[B] claimTimeout 收据应恰有 1 条 GameFinished');
  const fin = (finishedLogs[0] as unknown as {
    args: { gameId: bigint; winner: Address; reason: string };
  }).args;
  assert.equal(fin.gameId, gameId, '[B] GameFinished.gameId');
  assert.equal(fin.winner.toLowerCase(), p0.account.address.toLowerCase(), '[B] GameFinished.winner 应为 P0');
  assert.equal(fin.reason, 'timeout', '[B] GameFinished.reason');

  const game = await getGame();
  assert.equal(game.phase, Phase.Finished, '[B] 终局 phase 应为 Finished(4)');
  assert.equal(game.winner.toLowerCase(), p0.account.address.toLowerCase(), '[B] winner 应为 P0');
  assert.deepEqual([...game.hits], [0, FULL_ROUNDS], `[B] hits 应为 [0,${FULL_ROUNDS}](round3 未应答不计)`);
  console.log('[B] 终局状态:phase=Finished winner=P0 reason=timeout hits=[0,2] ✓');

  await anvil.stop();
  console.log(`[B] PASS(总耗时 ${elapsed()})`);
  process.exit(0); // snarkjs 残留线程挂进程,必须显式 exit(anvil 已清理完)
} catch (err) {
  console.error('[B] FAIL:', err);
  if (anvil) {
    await anvil.stop().catch(() => {
      /* stop 实际不会 reject(treeKill 错误已忽略),保险写法:清理异常也必须退出 */
    });
  }
  process.exit(1);
}
