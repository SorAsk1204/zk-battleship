/**
 * useProver store-keying + 背压(timeout / messageerror / onerror)单测。
 *
 * 不起真 worker:vitest(node)无 Worker 全局,故在导入被测模块前往 globalThis 装一个 MockWorker,
 * 捕获其 onmessage/onerror/onmessageerror 句柄并记录 postMessage,从而能**手动驱动** worker→main
 * 消息流,断言:
 *   I1 —— progress 按 circuit 分桶(board / shot 互不覆盖)、帧带 circuit、旧 id 迟到帧不覆盖新 id;
 *   I2 —— 单请求超时 reject 可读 Error 并清桶;error 消息、onmessageerror、onerror 各自正确收口。
 *
 * 被测模块是模块级单例(worker/pending/progressByCircuit 跨 test 共享),故:
 *   - 用 vi.resetModules() + 动态 import 让每个 test 拿到全新模块实例(连带全新 mock 单例);
 *   - id 单调自增,跨 test 不复用,无需手动清。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProofCalldataHex, ProveRes } from '../workers/proverProtocol.ts';

/** done 消息的 calldata 占位(Task 3.3:done 现带合约就绪 hex calldata)。形状即合约 ABI(board=1 pubSignal)。 */
const CALLDATA_STUB: ProofCalldataHex = {
  a: ['0x1', '0x2'],
  b: [
    ['0x3', '0x4'],
    ['0x5', '0x6'],
  ],
  c: ['0x7', '0x8'],
  pubSignals: ['0x9'],
};

// ── MockWorker:捕获最近构造的实例,暴露 handlers 与 postMessage 记录 ──────────
class MockWorker {
  static last: MockWorker | null = null;
  onmessage: ((e: MessageEvent<ProveRes>) => void) | null = null;
  onerror: ((e: { message?: string }) => void) | null = null;
  onmessageerror: ((e: unknown) => void) | null = null;
  posted: unknown[] = [];
  terminated = false;
  constructor() {
    MockWorker.last = this;
  }
  postMessage(msg: unknown): void {
    this.posted.push(msg);
  }
  terminate(): void {
    this.terminated = true;
  }
  // 测试驱动:模拟 worker 回一条消息
  emit(msg: ProveRes): void {
    this.onmessage?.({ data: msg } as MessageEvent<ProveRes>);
  }
}

// 动态导入被测模块(每个 test 前 resetModules 后重新取),返回其导出。
type Mod = typeof import('./useProver.ts');
async function freshModule(): Promise<{ mod: Mod; worker: () => MockWorker }> {
  vi.resetModules();
  MockWorker.last = null;
  const mod = await import('./useProver.ts');
  return {
    mod,
    worker: () => {
      if (!MockWorker.last) throw new Error('worker 尚未创建(需先调用 prove/preload)');
      return MockWorker.last;
    },
  };
}

beforeEach(() => {
  vi.stubGlobal('Worker', MockWorker as unknown as typeof Worker);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('I1 progress 按 circuit 分桶', () => {
  it('board 与 shot 进度独立、各帧带 circuit、互不覆盖', async () => {
    const { mod, worker } = await freshModule();
    // 触发 worker 创建:发两条并发 prove(board / shot)
    void mod.prove('board', {});
    void mod.prove('shot', {});
    const w = worker();
    // posted 里能拿到两条请求各自的 id(main 分配的单调 id)
    const reqs = w.posted as Array<{ id: number; circuit: string }>;
    const boardId = reqs.find((r) => r.circuit === 'board')!.id;
    const shotId = reqs.find((r) => r.circuit === 'shot')!.id;

    w.emit({ id: boardId, type: 'progress', circuit: 'board', stage: 'fetch-zkey', loaded: 5, total: 10 });
    w.emit({ id: shotId, type: 'progress', circuit: 'shot', stage: 'witness' });

    const b = mod.peekProgress('board');
    const s = mod.peekProgress('shot');
    expect(b).toEqual({ circuit: 'board', stage: 'fetch-zkey', loaded: 5, total: 10 });
    expect(s).toEqual({ circuit: 'shot', stage: 'witness', loaded: undefined, total: undefined });
    // 关键:shot 进度推进不动 board 桶(回归「max id wins 塌缩」缺陷)
    w.emit({ id: shotId, type: 'progress', circuit: 'shot', stage: 'prove' });
    expect(mod.peekProgress('board')).toEqual({
      circuit: 'board',
      stage: 'fetch-zkey',
      loaded: 5,
      total: 10,
    });
    expect(mod.peekProgress('shot')!.stage).toBe('prove');
  });

  it('旧 id 的迟到 progress 帧不覆盖同电路更新 id 的桶', async () => {
    const { mod, worker } = await freshModule();
    void mod.prove('board', {}); // id = A
    void mod.prove('board', {}); // id = B(更新,同电路)
    const w = worker();
    const ids = (w.posted as Array<{ id: number }>).map((r) => r.id);
    const [a, b] = ids;

    w.emit({ id: b, type: 'progress', circuit: 'board', stage: 'prove' });
    // 旧 id A 的迟到帧应被拒(a < 当前桶 id b)
    w.emit({ id: a, type: 'progress', circuit: 'board', stage: 'fetch-wasm', loaded: 1, total: 9 });
    expect(mod.peekProgress('board')!.stage).toBe('prove');
  });

  it('done 只清掉归属该 id 的电路桶,不误清同电路上更新请求', async () => {
    const { mod, worker } = await freshModule();
    void mod.prove('board', {}); // id = A
    const w = worker();
    const a = (w.posted[0] as { id: number }).id;
    w.emit({ id: a, type: 'progress', circuit: 'board', stage: 'witness' });
    expect(mod.peekProgress('board')).not.toBeNull();

    // 同电路发起更新请求 B 并推进
    void mod.prove('board', {});
    const bId = (w.posted[1] as { id: number }).id;
    w.emit({ id: bId, type: 'progress', circuit: 'board', stage: 'prove' });
    // 旧 A 现在 done:不得清掉 B 占用的桶
    w.emit({ id: a, type: 'done', proof: {} as never, publicSignals: [], calldata: CALLDATA_STUB });
    expect(mod.peekProgress('board')!.stage).toBe('prove');
  });
});

describe('I2 promise 收口', () => {
  it('done → prove resolve,且清掉该电路桶', async () => {
    const { mod, worker } = await freshModule();
    const p = mod.prove('board', {});
    const w = worker();
    const id = (w.posted[0] as { id: number }).id;
    w.emit({ id, type: 'progress', circuit: 'board', stage: 'prove' });
    w.emit({
      id,
      type: 'done',
      proof: { pi_a: ['1'] } as never,
      publicSignals: ['1', '2'],
      calldata: CALLDATA_STUB,
    });
    await expect(p).resolves.toEqual({
      proof: { pi_a: ['1'] },
      publicSignals: ['1', '2'],
      calldata: CALLDATA_STUB,
    });
    expect(mod.peekProgress('board')).toBeNull();
  });

  it('preloaded → preload resolve', async () => {
    const { mod, worker } = await freshModule();
    const p = mod.preload('shot');
    const w = worker();
    const id = (w.posted[0] as { id: number }).id;
    w.emit({ id, type: 'preloaded' });
    await expect(p).resolves.toBeUndefined();
  });

  it('error → reject 带 message 并清桶', async () => {
    const { mod, worker } = await freshModule();
    const p = mod.prove('board', {});
    const w = worker();
    const id = (w.posted[0] as { id: number }).id;
    w.emit({ id, type: 'progress', circuit: 'board', stage: 'witness' });
    w.emit({ id, type: 'error', message: '电路炸了' });
    await expect(p).rejects.toThrow('电路炸了');
    expect(mod.peekProgress('board')).toBeNull();
  });

  it('单请求超时 → reject 可读 Error 并清桶', async () => {
    vi.useFakeTimers();
    const { mod, worker } = await freshModule();
    const p = mod.prove('board', {});
    const w = worker();
    const id = (w.posted[0] as { id: number }).id;
    w.emit({ id, type: 'progress', circuit: 'board', stage: 'fetch-zkey', loaded: 1, total: 9 });
    const assertion = expect(p).rejects.toThrow(/超时.*60s.*worker 加载失败/);
    await vi.advanceTimersByTimeAsync(60_000);
    await assertion;
    expect(mod.peekProgress('board')).toBeNull();
  });

  it('done 之后超时定时器不再触发(已 clearTimeout)', async () => {
    vi.useFakeTimers();
    const { mod, worker } = await freshModule();
    const p = mod.prove('board', {});
    const w = worker();
    const id = (w.posted[0] as { id: number }).id;
    w.emit({ id, type: 'done', proof: {} as never, publicSignals: [], calldata: CALLDATA_STUB });
    await expect(p).resolves.toBeDefined();
    // 推进超过超时:不应有未处理 rejection / 二次结算(promise 已 settle)
    await vi.advanceTimersByTimeAsync(120_000);
    expect(mod.peekProgress('board')).toBeNull();
  });

  it('onmessageerror → 拒掉全部在途并给可读 message', async () => {
    const { mod, worker } = await freshModule();
    const p1 = mod.prove('board', {});
    const p2 = mod.prove('shot', {});
    const w = worker();
    w.onmessageerror?.({});
    await expect(p1).rejects.toThrow(/反序列化失败/);
    await expect(p2).rejects.toThrow(/反序列化失败/);
    expect(mod.peekProgress('board')).toBeNull();
    expect(mod.peekProgress('shot')).toBeNull();
  });

  it('onerror(脚本级)→ 拒掉全部在途', async () => {
    const { mod, worker } = await freshModule();
    const p1 = mod.prove('board', {});
    const p2 = mod.preload('shot');
    const w = worker();
    w.onerror?.({ message: 'module load failed' });
    await expect(p1).rejects.toThrow(/致命错误.*module load failed/);
    await expect(p2).rejects.toThrow(/致命错误/);
    expect(mod.peekProgress('board')).toBeNull();
  });
});
