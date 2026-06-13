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
import {
  deriveWsUrl,
  isFreshDemoSession,
  P0_CONNECTOR_ID,
  WAGMI_RECENT_CONNECTOR_KEY,
} from './wagmi.ts';

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

describe('P0_CONNECTOR_ID', () => {
  it('= demo-p0(DEMO_ACCOUNTS[0].label=P0 → connector id 模板 demo-${label})', () => {
    // AccountSwitcher 全新会话兜底用此 id 定位 P0 connector;connector 实例 id 同模板。
    expect(P0_CONNECTOR_ID).toBe('demo-p0');
  });
});

describe('isFreshDemoSession', () => {
  // 注入独立内存 storage(不碰全局 localStorage),逐例显式置态。
  function memStorage(seed?: Record<string, string>): Storage {
    const m = new Map<string, string>(Object.entries(seed ?? {}));
    return {
      get length() {
        return m.size;
      },
      clear: () => m.clear(),
      getItem: (k: string) => (m.has(k) ? (m.get(k) as string) : null),
      key: (i: number) => Array.from(m.keys())[i] ?? null,
      removeItem: (k: string) => void m.delete(k),
      setItem: (k: string, v: string) => void m.set(k, String(v)),
    };
  }

  it('全新会话:无 recentConnectorId → true', () => {
    expect(isFreshDemoSession(memStorage())).toBe(true);
  });

  it('reload 恢复:recentConnectorId 存在(任意非空)→ false(不强制 P0,放手让 reconnect 还原)', () => {
    // 切到 P1 再 reload 的态:wagmi 持久化了 recentConnectorId='"demo-p1"'(序列化串)。
    expect(isFreshDemoSession(memStorage({ [WAGMI_RECENT_CONNECTOR_KEY]: '"demo-p1"' }))).toBe(false);
    // P0 同理:存在即「上个会话选过」。
    expect(isFreshDemoSession(memStorage({ [WAGMI_RECENT_CONNECTOR_KEY]: '"demo-p0"' }))).toBe(false);
  });

  it('storage 为 null/undefined → true(无持久层即视作全新)', () => {
    expect(isFreshDemoSession(null)).toBe(true);
    expect(isFreshDemoSession(undefined)).toBe(true);
  });

  it('读 storage 抛(隐私模式 / 禁 cookie)→ false(不强制 P0 也安全)', () => {
    const throwing = {
      ...memStorage(),
      getItem: () => {
        throw new DOMException('denied', 'SecurityError');
      },
    } as Storage;
    expect(isFreshDemoSession(throwing)).toBe(false);
  });

  it('默认参数读全局 localStorage:存在 recentConnectorId → false,清掉 → true', () => {
    // __test-setup__ 注入了内存 localStorage;此例验证默认参数路径(不显式传 storage)。
    localStorage.setItem(WAGMI_RECENT_CONNECTOR_KEY, '"demo-p1"');
    expect(isFreshDemoSession()).toBe(false);
    localStorage.removeItem(WAGMI_RECENT_CONNECTOR_KEY);
    expect(isFreshDemoSession()).toBe(true);
  });
});
