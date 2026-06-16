/**
 * DE-RISK: confirm GoQuorum's EVM runs the snarkjs Groth16 verifier (bn254 precompiles
 * 0x06/0x07/0x08). Deploys the london-compiled BoardVerifier onto the consortium chain
 * (chainId 1204) and calls verifyProof with a real board proof, plus a tampered one.
 *
 * Run via SSH tunnel to the server RPC:  ssh -L 8545:127.0.0.1:8545 root@<server>
 *   pnpm --filter @zk-battleship/e2e exec tsx src/derisk-quorum.ts
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createPublicClient,
  createWalletClient,
  defineChain,
  http,
  type Abi,
  type Hex,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { formatProofCalldata } from '@zk-battleship/circuits/proof';
import { proveBoard } from '@zk-battleship/circuits/node';
import { boardA, commitmentA, saltA } from './lib/boards.ts';

const RPC = process.env.RPC_URL ?? 'http://127.0.0.1:8545';
const KEY = process.env.DEPLOYER_KEY as Hex | undefined;
if (!KEY) {
  throw new Error(
    '请设置 DEPLOYER_KEY:部署账户私钥(服务器 /opt/bschain/qbft-artifacts/*/validator0/accountPrivateKey)。',
  );
}

const bschain = defineChain({
  id: 1204,
  name: 'BSConsortium',
  nativeCurrency: { name: 'BSC', symbol: 'BSC', decimals: 18 },
  rpcUrls: { default: { http: [RPC] } },
});

const OUT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  'contracts',
  'out',
);
function artifact(rel: string): { abi: Abi; bytecode: { object: Hex } } {
  return JSON.parse(readFileSync(path.join(OUT, rel), 'utf8'));
}

async function main(): Promise<void> {
  console.log('[1/4] generating a real board proof (snarkjs fullProve)...');
  const { proof, publicSignals } = await proveBoard(boardA, saltA);
  const { a, b, c, pubSignals } = await formatProofCalldata(proof, publicSignals);
  console.log('  pubSignals[0] =', pubSignals[0].toString());
  console.log('  commitmentA   =', commitmentA.toString());
  if (pubSignals[0] !== commitmentA) throw new Error('commitment mismatch — fixture/proof out of sync');

  const account = privateKeyToAccount(KEY);
  const wallet = createWalletClient({ account, chain: bschain, transport: http(RPC) });
  const pub = createPublicClient({ chain: bschain, transport: http(RPC) });
  console.log('[2/4] connected: chainId =', await pub.getChainId(), 'deployer =', account.address);

  console.log('[3/4] deploying london-compiled BoardVerifier...');
  const art = artifact(path.join('BoardVerifier.sol', 'BoardVerifier.json'));
  const hash = await wallet.deployContract({
    abi: art.abi,
    bytecode: art.bytecode.object,
    args: [],
    gas: 6_000_000n,
    gasPrice: 0n,
  });
  const rcpt = await pub.waitForTransactionReceipt({ hash });
  if (rcpt.status !== 'success' || !rcpt.contractAddress)
    throw new Error('deploy failed: status=' + rcpt.status);
  const address = rcpt.contractAddress;
  console.log('  deployed at', address, 'in block', rcpt.blockNumber.toString());

  console.log('[4/4] calling verifyProof on-chain (eth_call exercises bn254 pairing)...');
  const okValid = (await pub.readContract({
    address,
    abi: art.abi,
    functionName: 'verifyProof',
    args: [a, b, c, pubSignals],
  })) as boolean;
  console.log('  verifyProof(valid)    =', okValid, okValid === true ? 'OK' : 'WRONG');

  const tampered = [pubSignals[0] ^ 1n];
  const okTampered = (await pub.readContract({
    address,
    abi: art.abi,
    functionName: 'verifyProof',
    args: [a, b, c, tampered],
  })) as boolean;
  console.log('  verifyProof(tampered) =', okTampered, okTampered === false ? 'OK' : 'WRONG');

  if (okValid === true && okTampered === false) {
    console.log('\n=== DE-RISK PASSED: GoQuorum EVM runs the Groth16 verifier correctly ===');
  } else {
    throw new Error('DE-RISK FAILED: verifyProof gave unexpected result');
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
