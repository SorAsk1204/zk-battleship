import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadDeployment, reloadDeployment, DeploymentNotFoundError } from './contracts.ts';

// 解析/错误路径用 reloadDeployment:它绕开 promise 缓存(I3),每个用例都打自己的 stub,互不串。
// loadDeployment 的去重(缓存)单独在"memoize"用例里验。reloadDeployment 与 loadDeployment 共用
// fetchDeployment,故这些用例仍覆盖完整 fetch→parse→error 链路。

const VALID = {
  chainId: 31337,
  battleship: '0x9fe46736679d2d9a65f0992f2272de9f3c7fa6e0',
  boardVerifier: '0x5fbdb2315678afecb367f032d93f642f64180aa3',
  shotVerifier: '0xe7f1725e7734ce288f8367e1bb143e90bb3f0512',
  deployBlock: 1,
  rpcUrl: 'http://127.0.0.1:8545',
};

/** 用一个最小 Response 替身覆盖 globalThis.fetch。 */
function stubFetch(impl: () => Promise<{ ok: boolean; json: () => Promise<unknown> }>) {
  vi.stubGlobal('fetch', impl as unknown as typeof fetch);
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('loadDeployment(解析/错误路径,经 reloadDeployment 绕缓存)', () => {
  it('合法 deployment.json → 解析为带类型对象', async () => {
    stubFetch(async () => ({ ok: true, json: async () => VALID }));
    const d = await reloadDeployment();
    expect(d).toEqual(VALID);
  });

  it('404 → DeploymentNotFoundError(人话:请先跑 pnpm demo)', async () => {
    stubFetch(async () => ({ ok: false, json: async () => ({}) }));
    await expect(reloadDeployment()).rejects.toBeInstanceOf(DeploymentNotFoundError);
    await expect(reloadDeployment()).rejects.toThrow(/pnpm demo/);
  });

  it('fetch 抛(dev server 没起)→ DeploymentNotFoundError', async () => {
    stubFetch(async () => {
      throw new TypeError('Failed to fetch');
    });
    await expect(reloadDeployment()).rejects.toBeInstanceOf(DeploymentNotFoundError);
  });

  it('非法 JSON → DeploymentNotFoundError', async () => {
    stubFetch(async () => ({
      ok: true,
      json: async () => {
        throw new SyntaxError('bad json');
      },
    }));
    await expect(reloadDeployment()).rejects.toBeInstanceOf(DeploymentNotFoundError);
  });

  it('字段缺失/坏地址 → DeploymentNotFoundError 且点名字段', async () => {
    stubFetch(async () => ({ ok: true, json: async () => ({ ...VALID, battleship: '0xzz' }) }));
    await expect(reloadDeployment()).rejects.toThrow(/battleship/);
  });

  it('deployBlock 非 number → 拒绝', async () => {
    stubFetch(async () => ({ ok: true, json: async () => ({ ...VALID, deployBlock: '1' }) }));
    await expect(reloadDeployment()).rejects.toThrow(/deployBlock/);
  });
});

describe('loadDeployment 缓存(I3:并发去重 + reload 逃生口)', () => {
  it('两个并发 loadDeployment 只触发一次 fetch(共享 promise)', async () => {
    let calls = 0;
    // 先用 reloadDeployment 把缓存清成一个干净的已知态,再并发调 loadDeployment 验去重。
    stubFetch(async () => {
      calls += 1;
      return { ok: true, json: async () => VALID };
    });
    // reload 占用一次 fetch 并把 cache 设成已 resolve 的 promise;复位计数只统计后续 load。
    await reloadDeployment();
    calls = 0;
    const [a, b] = await Promise.all([loadDeployment(), loadDeployment()]);
    expect(calls).toBe(0); // 命中缓存,零新 fetch
    expect(a).toBe(b); // 同一对象引用(同一 promise resolve)
    expect(a).toEqual(VALID);
  });

  it('冷缓存下并发首调只打一次网络(promise 缓存而非结果缓存)', async () => {
    let calls = 0;
    let resolveFetch!: (v: { ok: boolean; json: () => Promise<unknown> }) => void;
    const gate = new Promise<{ ok: boolean; json: () => Promise<unknown> }>((r) => {
      resolveFetch = r;
    });
    stubFetch(() => {
      calls += 1;
      return gate;
    });
    // 用 reload 把 cache 设成"进行中"的 promise(模拟冷启动首调);随后并发的 load 应复用它。
    const first = reloadDeployment();
    const second = loadDeployment();
    const third = loadDeployment();
    expect(calls).toBe(1); // 仅 reload 那次发起 fetch;两个 load 复用未决 promise
    resolveFetch({ ok: true, json: async () => VALID });
    const [a, b, c] = await Promise.all([first, second, third]);
    expect(calls).toBe(1);
    expect(a).toEqual(VALID);
    expect(b).toBe(a);
    expect(c).toBe(a);
  });

  it('reloadDeployment 清缓存并重取(逃生口)', async () => {
    let calls = 0;
    stubFetch(async () => {
      calls += 1;
      return { ok: true, json: async () => VALID };
    });
    await reloadDeployment();
    expect(calls).toBe(1);
    await reloadDeployment(); // 强制重取,不复用
    expect(calls).toBe(2);
    await loadDeployment(); // reload 已把 cache 设为最近一次,load 命中缓存
    expect(calls).toBe(2);
  });
});
