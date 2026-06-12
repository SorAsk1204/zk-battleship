/**
 * 读 forge 产物 + viem 部署三件套。
 * 顺序锁定(M1 交接):BoardVerifier → ShotVerifier → Battleship(boardVerifier, shotVerifier)
 * ——board 在前;两 verifier 无构造参数。
 *
 * 注意 out/Battleship.sol/ 下还有 IBoardVerifier.json/IShotVerifier.json 接口空产物,
 * 必须按名取 Battleship.json。
 */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Abi, Address, Hex } from 'viem';
import { makeClients } from './accounts.ts';

const CONTRACTS_OUT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
  'contracts',
  'out',
);

type ForgeArtifact = { abi: Abi; bytecode: { object: Hex } };

/** 预检 + 读产物;fresh clone 无 out/ 时报精确修复命令,不自动代跑(脚本职责单一) */
function loadArtifact(rel: string): ForgeArtifact {
  const p = path.join(CONTRACTS_OUT, rel);
  if (!existsSync(p)) {
    throw new Error(
      `缺少 forge 产物:${p}\n` +
        `fresh clone 时 out/ 不存在,先构建合约再跑 e2e:\n` +
        `  pnpm --filter @zk-battleship/contracts run build`,
    );
  }
  const art = JSON.parse(readFileSync(p, 'utf8')) as ForgeArtifact;
  if (!Array.isArray(art.abi) || typeof art.bytecode?.object !== 'string') {
    throw new Error(`forge 产物缺 abi / bytecode.object(产物损坏?):${p}`);
  }
  return art;
}

export type Deployed = { address: Address; abi: Abi };
export type DeployResult = {
  battleship: Deployed;
  boardVerifier: Deployed;
  shotVerifier: Deployed;
  deployBlock: bigint; // 首笔部署所在块,事件回放的 fromBlock
};

export async function deployAll(rpcUrl: string, deployerKey: Hex): Promise<DeployResult> {
  const boardArt = loadArtifact(path.join('BoardVerifier.sol', 'BoardVerifier.json'));
  const shotArt = loadArtifact(path.join('ShotVerifier.sol', 'ShotVerifier.json'));
  const battleshipArt = loadArtifact(path.join('Battleship.sol', 'Battleship.json'));

  const { wallet, publicClient } = makeClients(rpcUrl, deployerKey);

  async function deployOne(
    name: string,
    art: ForgeArtifact,
    args: readonly unknown[] = [],
  ): Promise<{ address: Address; blockNumber: bigint }> {
    const hash = await wallet.deployContract({ abi: art.abi, bytecode: art.bytecode.object, args });
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    if (receipt.status !== 'success' || !receipt.contractAddress) {
      throw new Error(`${name} 部署失败:status=${receipt.status} tx=${hash}`);
    }
    return { address: receipt.contractAddress, blockNumber: receipt.blockNumber };
  }

  const board = await deployOne('BoardVerifier', boardArt);
  const shot = await deployOne('ShotVerifier', shotArt);
  const battleship = await deployOne('Battleship', battleshipArt, [board.address, shot.address]);

  return {
    battleship: { address: battleship.address, abi: battleshipArt.abi },
    boardVerifier: { address: board.address, abi: boardArt.abi },
    shotVerifier: { address: shot.address, abi: shotArt.abi },
    deployBlock: board.blockNumber,
  };
}
