/**
 * Deploy the full suite to the GoQuorum consortium chain (chainId 1204) and write
 * web/public/deployment.json for the frontend. (Also tops up the legacy anvil demo
 * accounts — vestigial now that the frontend uses per-browser identities.)
 *
 * IMPORTANT — compile contracts for london first (GoQuorum is London-level, no PUSH0):
 *   FOUNDRY_EVM_VERSION=london forge build --root packages/contracts --force
 * Then, via an SSH tunnel to the server RPC (ssh -L 8545:127.0.0.1:8545 root@<server>):
 *   DEPLOYER_KEY=<validator0 accountPrivateKey> \
 *     pnpm --filter @zk-battleship/e2e exec tsx src/deploy-quorum.ts
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createPublicClient,
  createWalletClient,
  defineChain,
  http,
  parseEther,
  type Abi,
  type Address,
  type Hex,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

const RPC = process.env.RPC_URL ?? 'http://127.0.0.1:8545';
const KEY = process.env.DEPLOYER_KEY as Hex | undefined;
if (!KEY) {
  throw new Error(
    '请设置 DEPLOYER_KEY:部署账户私钥(服务器 /opt/bschain/qbft-artifacts/*/validator0/accountPrivateKey)。',
  );
}
const CHAIN_ID = 1204;
// Public RPC the hosted frontend will use (nginx proxy on :8080). Overridden by deploy env if needed.
const PUBLIC_RPC = process.env.PUBLIC_RPC ?? 'http://101.35.224.67:8080/rpc';

// Demo players — well-known anvil test keys, funded below on this chain.
const PLAYER_KEYS = [
  '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80',
  '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d',
] as const;

const bschain = defineChain({
  id: CHAIN_ID,
  name: 'BSConsortium',
  nativeCurrency: { name: 'BSC', symbol: 'BSC', decimals: 18 },
  rpcUrls: { default: { http: [RPC] } },
});

const __dir = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(__dir, '..', '..', 'contracts', 'out');
const DEPLOYMENT_JSON = path.resolve(__dir, '..', '..', 'web', 'public', 'deployment.json');
function artifact(rel: string): { abi: Abi; bytecode: { object: Hex } } {
  return JSON.parse(readFileSync(path.join(OUT, rel), 'utf8'));
}

async function main(): Promise<void> {
  const account = privateKeyToAccount(KEY);
  const wallet = createWalletClient({ account, chain: bschain, transport: http(RPC) });
  const pub = createPublicClient({ chain: bschain, transport: http(RPC) });
  console.log('chainId', await pub.getChainId(), 'deployer', account.address);

  async function deploy(
    name: string,
    rel: string,
    args: readonly unknown[] = [],
  ): Promise<{ address: Address; block: bigint }> {
    const art = artifact(rel);
    const hash = await wallet.deployContract({
      abi: art.abi,
      bytecode: art.bytecode.object,
      args,
      gas: 8_000_000n,
      gasPrice: 0n,
    });
    const r = await pub.waitForTransactionReceipt({ hash });
    if (r.status !== 'success' || !r.contractAddress) throw new Error(`${name} deploy failed: ${r.status}`);
    console.log('  ', name, r.contractAddress, 'block', r.blockNumber.toString());
    return { address: r.contractAddress, block: r.blockNumber };
  }

  console.log('deploying suite...');
  const board = await deploy('BoardVerifier', path.join('BoardVerifier.sol', 'BoardVerifier.json'));
  const shot = await deploy('ShotVerifier', path.join('ShotVerifier.sol', 'ShotVerifier.json'));
  const bs = await deploy('Battleship', path.join('Battleship.sol', 'Battleship.json'), [
    board.address,
    shot.address,
  ]);

  console.log('funding demo players (1000 BSC each)...');
  for (const pk of PLAYER_KEYS) {
    const to = privateKeyToAccount(pk as Hex).address;
    const h = await wallet.sendTransaction({ to, value: parseEther('1000'), gas: 21000n, gasPrice: 0n });
    await pub.waitForTransactionReceipt({ hash: h });
    console.log('   funded', to);
  }

  const deployment = {
    chainId: CHAIN_ID,
    rpcUrl: PUBLIC_RPC,
    battleship: bs.address,
    boardVerifier: board.address,
    shotVerifier: shot.address,
    deployBlock: Number(board.block),
  };
  mkdirSync(path.dirname(DEPLOYMENT_JSON), { recursive: true });
  writeFileSync(DEPLOYMENT_JSON, JSON.stringify(deployment, null, 2));
  console.log('\nwrote', DEPLOYMENT_JSON);
  console.log(JSON.stringify(deployment, null, 2));
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
