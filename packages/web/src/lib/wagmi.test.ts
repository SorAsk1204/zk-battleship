/**
 * wagmi.ts 纯逻辑单测(Task 3.3 DoD)。
 *
 * 只测不依赖浏览器/wagmi 运行期的部分:deriveWsUrl(http→ws 推导)。
 * connector / createConfig 涉及 viem 运行期与 EIP-1193,真验收在浏览器(pnpm demo + playwright);
 * 此处不 mock 一整套 wagmi 来做浅断言(那是假测试)。
 *
 * 注意:import wagmi.ts 会触发 createConfig(模块级副作用)。vitest node 环境无 import.meta.env.VITE_DEMO,
 * 故 IS_DEMO=false 走 injected() 分支——injected 在 node 下惰性,createConfig 不抛。
 */
import { describe, expect, it } from 'vitest';
import { deriveWsUrl } from './wagmi.ts';

describe('deriveWsUrl', () => {
  it('http → ws(同主机端口)', () => {
    expect(deriveWsUrl('http://127.0.0.1:8545')).toBe('ws://127.0.0.1:8545');
  });

  it('https → wss', () => {
    expect(deriveWsUrl('https://example.com:443/rpc')).toBe('wss://example.com:443/rpc');
  });

  it('anvil 默认 rpcUrl(demo.ts 写入的形态)→ ws://127.0.0.1:8545', () => {
    // demo.ts 的 RPC_URL = `http://127.0.0.1:${ANVIL_PORT}`(8545),与 viem anvil chain 默认一致。
    expect(deriveWsUrl('http://127.0.0.1:8545')).toBe('ws://127.0.0.1:8545');
  });

  it('非 http(s) 前缀原样返回(不编造)', () => {
    expect(deriveWsUrl('ws://already-ws:8545')).toBe('ws://already-ws:8545');
    expect(deriveWsUrl('127.0.0.1:8545')).toBe('127.0.0.1:8545');
  });
});
