/**
 * anvil 默认助记词("test test ... junk")前两个账户 + viem client 工厂。
 * 私钥是 anvil 公知测试私钥,仅本地链使用,不构成泄密。
 */
import { createPublicClient, createTestClient, createWalletClient, http, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { anvil } from 'viem/chains';

/** [0]=anvil #0(0xf39F...2266),[1]=anvil #1(0x7099...79C8) */
export const ANVIL_KEYS = [
  '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80',
  '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d',
] as const satisfies readonly Hex[];

/** viem 内置 anvil chain(id 31337);默认 rpc 不用,transport 一律显式传 rpcUrl */
export const anvilChain = anvil;

export function makeClients(rpcUrl: string, key: Hex) {
  const account = privateKeyToAccount(key);
  const transport = http(rpcUrl);
  return {
    account,
    wallet: createWalletClient({ account, chain: anvilChain, transport }),
    publicClient: createPublicClient({ chain: anvilChain, transport }),
  };
}

/** 测试链操控(evm_increaseTime 等)——脚本 B/C(超时/取消)用 */
export function makeTestClient(rpcUrl: string) {
  return createTestClient({ mode: 'anvil', chain: anvilChain, transport: http(rpcUrl) });
}
