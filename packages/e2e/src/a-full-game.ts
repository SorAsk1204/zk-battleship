/**
 * 脚本 A:全局打满 —— 真 anvil + 真部署 + 全程现场证明的完整对局。
 *
 * 剧本:P0 按 bShipCells(B 的 17 船格)17 连中;P1 按 aWaterCells(A 的 16 水格)
 * 16 连 miss。第 17 回合 P0 命中第 17 格,合约同交易判 P0 胜(reason="17hits")。
 * 终局校验 getGame 状态 + 事件全量回放(数量 / GameFinished 参数 / totalHits 流单调)。
 *
 * snarkjs fullProve 后有残留线程挂住进程 —— 结束必须 process.exit;
 * 但 anvil 清理(tree-kill 异步)必须 await 完成后才 exit,否则进程残留占 8546。
 */
import { parseEventLogs, type Address } from 'viem';
import { isHit, TOTAL_SHIP_CELLS } from '@zk-battleship/circuits';
import { proveBoard, proveShot } from '@zk-battleship/circuits/node';
import { formatProofCalldata } from '@zk-battleship/circuits/proof';
import { ANVIL_KEYS, makeClients } from './lib/accounts.ts';
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

const t0 = Date.now();
const elapsed = (): string => `${((Date.now() - t0) / 1000).toFixed(1)}s`;

let anvil: AnvilHandle | undefined;
try {
  console.log('[A] 启动 anvil :8546 ...');
  anvil = await startAnvil(8546);
  const { rpcUrl } = anvil;

  const deployed = await deployAll(rpcUrl, ANVIL_KEYS[0]);
  const { address, abi } = deployed.battleship;
  console.log(`[A] 部署完成 battleship=${address}(deployBlock=${deployed.deployBlock})`);

  const p0 = makeClients(rpcUrl, ANVIL_KEYS[0]);
  const p1 = makeClients(rpcUrl, ANVIL_KEYS[1]);
  const publicClient = p0.publicClient;

  // gas 估算 flake 的 workaround 在 lib/tx.ts(GAS_BUFFER + 根因注释)
  const { send } = makeSender({ publicClient, address, abi, tag: '[A]' });

  // ===== 开局:两份 board 证明 + createGame / joinGame =====
  console.log('[A] 生成 board 证明 A ...');
  const boardProofA = await proveBoard(boardA, saltA);
  const cdBoardA = await formatProofCalldata(boardProofA.proof, boardProofA.publicSignals);
  assert.equal(cdBoardA.pubSignals[0], commitmentA, '[A] board 证明 A 公开承诺应等于 commitmentA');

  console.log('[A] 生成 board 证明 B ...');
  const boardProofB = await proveBoard(boardB, saltB);
  const cdBoardB = await formatProofCalldata(boardProofB.proof, boardProofB.publicSignals);
  assert.equal(cdBoardB.pubSignals[0], commitmentB, '[A] board 证明 B 公开承诺应等于 commitmentB');

  const rcCreate = await send('createGame', p0.wallet, 'createGame', [commitmentA, cdBoardA]);
  const createdLogs = parseEventLogs({ abi, logs: rcCreate.logs, eventName: 'GameCreated' });
  assert.equal(createdLogs.length, 1, '[A] createGame 收据应恰有 1 条 GameCreated');
  const gameId = (createdLogs[0] as unknown as { args: { gameId: bigint } }).args.gameId;
  console.log(`[A] createGame OK,gameId=${gameId}(${elapsed()})`);

  await send('joinGame', p1.wallet, 'joinGame', [gameId, commitmentB, cdBoardB]);
  console.log(`[A] joinGame OK,P0 先攻(${elapsed()})`);

  // ===== 33 回合:17 次 P0 命中 + 16 次 P1 落水,每炮防守方现场 proveShot =====
  for (let i = 0; i < TOTAL_SHIP_CELLS; i++) {
    const hitCell = bShipCells[i];
    const hitResult = isHit(boardB, hitCell.x, hitCell.y);
    assert.equal(hitResult, 1, `[A] round${i + 1} bShipCells(${hitCell.x},${hitCell.y}) 应命中`);
    await send(`round${i + 1} P0 attack`, p0.wallet, 'attack', [gameId, hitCell.x, hitCell.y]);
    const shotB = await proveShot(boardB, saltB, hitCell.x, hitCell.y);
    const cdShotB = await formatProofCalldata(shotB.proof, shotB.publicSignals);
    assert.equal(cdShotB.pubSignals[0], BigInt(hitResult), `[A] round${i + 1} B 侧 shot 证明 result`);
    await send(`round${i + 1} P1 respond`, p1.wallet, 'respond', [gameId, hitResult, cdShotB]);

    if (i < TOTAL_SHIP_CELLS - 1) {
      const missCell = aWaterCells[i];
      const missResult = isHit(boardA, missCell.x, missCell.y);
      assert.equal(missResult, 0, `[A] round${i + 1} aWaterCells(${missCell.x},${missCell.y}) 应 miss`);
      await send(`round${i + 1} P1 attack`, p1.wallet, 'attack', [gameId, missCell.x, missCell.y]);
      const shotA = await proveShot(boardA, saltA, missCell.x, missCell.y);
      const cdShotA = await formatProofCalldata(shotA.proof, shotA.publicSignals);
      assert.equal(cdShotA.pubSignals[0], BigInt(missResult), `[A] round${i + 1} A 侧 shot 证明 result`);
      await send(`round${i + 1} P0 respond`, p0.wallet, 'respond', [gameId, missResult, cdShotA]);
      console.log(
        `[A] round ${i + 1}/17:P0 (${hitCell.x},${hitCell.y})→hit ${i + 1}/17,` +
          `P1 (${missCell.x},${missCell.y})→miss(${elapsed()})`,
      );
    } else {
      console.log(`[A] round ${i + 1}/17:P0 (${hitCell.x},${hitCell.y})→hit 17/17,终局(${elapsed()})`);
    }
  }

  // ===== 终局状态断言 =====
  const game = (await publicClient.readContract({
    address,
    abi,
    functionName: 'getGame',
    args: [gameId],
  })) as {
    p0: Address;
    p1: Address;
    phase: number;
    hits: readonly [number, number];
    winner: Address;
  };
  assert.equal(game.phase, Phase.Finished, '[A] 终局 phase 应为 Finished(4)');
  assert.equal(game.winner.toLowerCase(), p0.account.address.toLowerCase(), '[A] winner 应为 P0');
  assert.deepEqual([...game.hits], [0, TOTAL_SHIP_CELLS], '[A] hits 应为 [0,17]');
  console.log('[A] 终局状态:phase=Finished winner=P0 hits=[0,17] ✓');

  // ===== 事件全量回放 =====
  const logs = await publicClient.getContractEvents({ address, abi, fromBlock: deployed.deployBlock });
  const counts = new Map<string, number>();
  for (const log of logs) counts.set(log.eventName, (counts.get(log.eventName) ?? 0) + 1);
  assert.equal(counts.get('GameCreated') ?? 0, 1, '[A] GameCreated 事件数');
  assert.equal(counts.get('GameJoined') ?? 0, 1, '[A] GameJoined 事件数');
  assert.equal(counts.get('ShotFired') ?? 0, 33, '[A] ShotFired 事件数');
  assert.equal(counts.get('ShotResolved') ?? 0, 33, '[A] ShotResolved 事件数');
  assert.equal(counts.get('GameFinished') ?? 0, 1, '[A] GameFinished 事件数');
  assert.equal(logs.length, 69, '[A] 事件总数应 69(1+1+33+33+1,无未知事件)');

  const finished = logs.find((l) => l.eventName === 'GameFinished') as unknown as {
    args: { gameId: bigint; winner: Address; reason: string };
  };
  assert.equal(finished.args.gameId, gameId, '[A] GameFinished.gameId');
  assert.equal(
    finished.args.winner.toLowerCase(),
    p0.account.address.toLowerCase(),
    '[A] GameFinished.winner 应为 P0',
  );
  assert.equal(finished.args.reason, '17hits', '[A] GameFinished.reason');

  // totalHits 流:逐事件 = 上一值 + result(精确累加,蕴含单调);终值 defender0=0 / defender1=17
  const resolved = logs
    .filter((l) => l.eventName === 'ShotResolved')
    .map((l) => (l as unknown as { args: { defender: number; result: number; totalHits: number } }).args);
  const lastHits: Record<number, number> = { 0: 0, 1: 0 };
  for (const r of resolved) {
    assert.equal(
      r.totalHits,
      lastHits[r.defender] + r.result,
      `[A] ShotResolved totalHits 流单调累加(defender=${r.defender})`,
    );
    lastHits[r.defender] = r.totalHits;
  }
  assert.equal(lastHits[1], TOTAL_SHIP_CELLS, '[A] defender=1(P1)终值 totalHits 应 17');
  assert.equal(lastHits[0], 0, '[A] defender=0(P0)终值 totalHits 应 0');
  console.log('[A] 事件回放:1 GameCreated + 1 GameJoined + 33 ShotFired + 33 ShotResolved + 1 GameFinished ✓');

  await anvil.stop();
  console.log(`[A] PASS(总耗时 ${elapsed()})`);
  process.exit(0); // snarkjs 残留线程挂进程,必须显式 exit(anvil 已清理完)
} catch (err) {
  console.error('[A] FAIL:', err);
  if (anvil) {
    await anvil.stop().catch(() => {
      /* stop 实际不会 reject(treeKill 错误已忽略),保险写法:清理异常也必须退出 */
    });
  }
  process.exit(1);
}
