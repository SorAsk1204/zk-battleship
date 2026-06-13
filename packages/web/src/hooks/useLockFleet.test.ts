/**
 * useLockFleet 纯解析助手单测(Task 3.4)。
 *
 * 钉死「从交易回执日志解析 gameId」这一与 React/wagmi 无关的纯逻辑(管线本身的 status 机
 * + 写盘分支在浏览器验收 + gameListReducer 已覆盖列表归约)。用 viem encodeEventTopics 造出
 * 真实形状的 GameCreated/GameJoined log(两参均 indexed,无 data),验证:
 *   - 正确解出 gameId;
 *   - 无对应事件 → 抛(交易上链但语义异常的早失败)。
 *
 * 为什么只测解析助手:本仓 vitest 是 node 环境、无 testing-library,useLockFleet 是依赖
 * usePublicClient/useWriteContract/useAccount 的 React hook,起真组件成本高且本质验收应在浏览器
 * (真 worker + 真 anvil)。解析助手是管线里唯一「纯输入→纯输出」段,单测价值最高、最稳。
 */
import { describe, expect, it } from 'vitest';
import { encodeEventTopics, type Log } from 'viem';
import { battleshipAbi } from '../lib/abi.ts';
import type { Address } from '../lib/contracts.ts';
import { parseCreatedGameId, parseJoinedGameId } from './useLockFleet.ts';

const P0 = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266' as Address;
const P1 = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8' as Address;
const CONTRACT = '0x5FbDB2315678afecb367f032d93F642f64180aa3' as Address;

/** 造一条形状真实的 event log(topics 由 abi 编码,data='0x':两参均 indexed)。 */
function makeLog(
  eventName: 'GameCreated' | 'GameJoined',
  gameId: bigint,
  who: Address,
): Log {
  const topics = encodeEventTopics({
    abi: battleshipAbi,
    eventName,
    args: eventName === 'GameCreated' ? { gameId, p0: who } : { gameId, p1: who },
  });
  return {
    address: CONTRACT,
    topics: topics as [`0x${string}`, ...`0x${string}`[]],
    data: '0x',
    blockNumber: 1n,
    blockHash: '0x'.padEnd(66, '0') as `0x${string}`,
    logIndex: 0,
    transactionHash: '0x'.padEnd(66, '0') as `0x${string}`,
    transactionIndex: 0,
    removed: false,
  };
}

describe('parseCreatedGameId', () => {
  it('从 GameCreated log 解出 gameId', () => {
    expect(parseCreatedGameId([makeLog('GameCreated', 1n, P0)])).toBe(1n);
    expect(parseCreatedGameId([makeLog('GameCreated', 42n, P0)])).toBe(42n);
  });

  it('忽略无关日志,只取 GameCreated', () => {
    const logs = [makeLog('GameJoined', 7n, P1), makeLog('GameCreated', 9n, P0)];
    expect(parseCreatedGameId(logs)).toBe(9n);
  });

  it('无 GameCreated → 抛', () => {
    expect(() => parseCreatedGameId([makeLog('GameJoined', 1n, P1)])).toThrow(/GameCreated/);
    expect(() => parseCreatedGameId([])).toThrow(/GameCreated/);
  });
});

describe('parseJoinedGameId', () => {
  it('从 GameJoined log 解出 gameId', () => {
    expect(parseJoinedGameId([makeLog('GameJoined', 3n, P1)])).toBe(3n);
  });

  it('无 GameJoined → 抛', () => {
    expect(() => parseJoinedGameId([makeLog('GameCreated', 1n, P0)])).toThrow(/GameJoined/);
    expect(() => parseJoinedGameId([])).toThrow(/GameJoined/);
  });
});
