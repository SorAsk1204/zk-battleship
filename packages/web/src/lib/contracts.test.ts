import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadDeployment, DeploymentNotFoundError } from './contracts.ts';

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

describe('loadDeployment', () => {
  it('合法 deployment.json → 解析为带类型对象', async () => {
    stubFetch(async () => ({ ok: true, json: async () => VALID }));
    const d = await loadDeployment();
    expect(d).toEqual(VALID);
  });

  it('404 → DeploymentNotFoundError(人话:请先跑 pnpm demo)', async () => {
    stubFetch(async () => ({ ok: false, json: async () => ({}) }));
    await expect(loadDeployment()).rejects.toBeInstanceOf(DeploymentNotFoundError);
    await expect(loadDeployment()).rejects.toThrow(/pnpm demo/);
  });

  it('fetch 抛(dev server 没起)→ DeploymentNotFoundError', async () => {
    stubFetch(async () => {
      throw new TypeError('Failed to fetch');
    });
    await expect(loadDeployment()).rejects.toBeInstanceOf(DeploymentNotFoundError);
  });

  it('非法 JSON → DeploymentNotFoundError', async () => {
    stubFetch(async () => ({
      ok: true,
      json: async () => {
        throw new SyntaxError('bad json');
      },
    }));
    await expect(loadDeployment()).rejects.toBeInstanceOf(DeploymentNotFoundError);
  });

  it('字段缺失/坏地址 → DeploymentNotFoundError 且点名字段', async () => {
    stubFetch(async () => ({ ok: true, json: async () => ({ ...VALID, battleship: '0xzz' }) }));
    await expect(loadDeployment()).rejects.toThrow(/battleship/);
  });

  it('deployBlock 非 number → 拒绝', async () => {
    stubFetch(async () => ({ ok: true, json: async () => ({ ...VALID, deployBlock: '1' }) }));
    await expect(loadDeployment()).rejects.toThrow(/deployBlock/);
  });
});
