/**
 * demo 双账户 —— anvil 默认助记词("test test … junk")前两个账户(Task 3.3 / D14)。
 *
 * ⚠️ DEMO-ONLY,绝不用于生产:这两个私钥是 anvil / hardhat 全网公知的测试私钥(任何人都知道),
 * 仅用于本地 demo 链(31337)的双账户对打演示。生产钱包接 injected connector(MetaMask 等),
 * 前端永不持有私钥。把私钥写进前端 bundle 在真实链上等于把钱拱手让人——本文件仅因 demo 需要
 * 「无需用户装钱包即可两个账户对打」而存在,且只在 VITE_DEMO==='1'(pnpm demo 注入)时被 wagmi 引用。
 *
 * 私钥/地址与 packages/e2e/src/lib/accounts.ts 的 ANVIL_KEYS 同源(anvil 公知测试私钥):
 *   #0 = 0xf39F…2266(P0,demo 里也是合约 deployer)
 *   #1 = 0x7099…79C8(P1)
 * 不从 e2e 包 import:那是 Node 测试工具(带 createTestClient 等),拖进前端不合适;此处只取
 * 两个账户最小信息(地址 + 私钥 + 标签),用 viem privateKeyToAccount 在浏览器本地签名(D14 fallback)。
 */
import type { Address } from './contracts.ts';

/** 私钥用 viem 的 0x-hex 模板类型,直接喂 privateKeyToAccount 而不再断言。 */
export type Hex = `0x${string}`;

export type DemoAccount = {
  /** 账户地址(EIP-55 大小写无关;wagmi/viem 内部会 checksum 归一)。 */
  address: Address;
  /** 私钥(anvil 公知测试私钥,见模块头注释的 DEMO-ONLY 警告)。 */
  privateKey: Hex;
  /** UI 标签:P0=创建者惯用账户(也是 deployer),P1=加入者。 */
  label: 'P0' | 'P1';
};

/**
 * anvil #0 / #1。顺序固定:[0]=P0,[1]=P1。AccountSwitcher 据 label 渲染切换按钮,
 * wagmi.ts 据此为每个账户造一个 local-account connector。
 */
export const DEMO_ACCOUNTS = [
  {
    address: '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266',
    privateKey: '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80',
    label: 'P0',
  },
  {
    address: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8',
    privateKey: '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d',
    label: 'P1',
  },
] as const satisfies readonly DemoAccount[];
