/**
 * eventLogLines 单测(Task 3.7)。
 *
 * 钉死「同一事件按 myIdx 说成『我方 / 对方』」的措辞翻面(demo 视角翻转的体现):
 *   - fired 的 side=attacker;resolved 的 side=**defender**(主语要翻面:defender===我 → 对方炮击我方);
 *   - observer/null:用 P0/P1 客观称谓,无「我方/对方」;
 *   - reason 短码 → 人话;命中行 hit=true(渲染层据此染色)。
 */
import { describe, expect, it } from 'vitest';
import type { Address } from '../lib/contracts.ts';
import type { GameLogEntry } from '../hooks/useGame.ts';
import { logEntryText, toLogLines } from './eventLogLines.ts';

const P1 = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8' as Address;
const WINNER = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266' as Address;

const pos = (n: number) => ({ blockNumber: BigInt(n), logIndex: 0 });

describe('logEntryText — joined', () => {
  it('用加入者短地址', () => {
    const e: GameLogEntry = { kind: 'joined', pos: pos(1), p1: P1 };
    expect(logEntryText(e, 0).text).toMatch(/加入对局/);
    expect(logEntryText(e, 0).text).toContain('0x7099');
  });
});

describe('logEntryText — fired(side=attacker)', () => {
  const fired = (attacker: 0 | 1): GameLogEntry => ({ kind: 'fired', pos: pos(2), side: attacker, x: 3, y: 6 });

  it('P0 视角:attacker=0 → 我方开炮 D-7', () => {
    expect(logEntryText(fired(0), 0).text).toBe('我方开炮 D-7');
  });
  it('P0 视角:attacker=1 → 对方开炮 D-7', () => {
    expect(logEntryText(fired(1), 0).text).toBe('对方开炮 D-7');
  });
  it('P1 视角:同一 attacker=0 → 对方开炮(翻面)', () => {
    expect(logEntryText(fired(0), 1).text).toBe('对方开炮 D-7');
  });
  it('observer:attacker=0 → P0 开炮(客观称谓)', () => {
    expect(logEntryText(fired(0), 'observer').text).toBe('P0开炮 D-7');
  });
});

describe('logEntryText — resolved(side=defender,主语翻面)', () => {
  const resolved = (defender: 0 | 1, result: 0 | 1): GameLogEntry => ({
    kind: 'resolved',
    pos: pos(3),
    side: defender,
    x: 3,
    y: 6,
    result,
    totalHits: 1,
  });

  it('P0 视角:defender=1(我打中对手)→ 我方炮击 D-7 … 命中,hit=true', () => {
    const r = logEntryText(resolved(1, 1), 0);
    expect(r.text).toBe('我方炮击 D-7 … 命中');
    expect(r.hit).toBe(true);
  });

  it('P0 视角:defender=0(对手打中我)→ 对方炮击我方 D-7 … 命中', () => {
    expect(logEntryText(resolved(0, 1), 0).text).toBe('对方炮击我方 D-7 … 命中');
  });

  it('P1 视角:defender=1(对手打中我)→ 对方炮击我方 D-7(翻面)', () => {
    expect(logEntryText(resolved(1, 1), 1).text).toBe('对方炮击我方 D-7 … 命中');
  });

  it('miss → 未命中,hit=false', () => {
    const r = logEntryText(resolved(1, 0), 0);
    expect(r.text).toBe('我方炮击 D-7 … 未命中');
    expect(r.hit).toBe(false);
  });

  it('observer:defender=0 → P1 炮击 P0 海域 D-7 …(攻击方=1-defender)', () => {
    expect(logEntryText(resolved(0, 1), 'observer').text).toBe('P1 炮击 P0 海域 D-7 … 命中');
  });
});

describe('logEntryText — finished(reason 人话)', () => {
  it('17hits → 17 格命中', () => {
    const e: GameLogEntry = { kind: 'finished', pos: pos(4), winner: WINNER, reason: '17hits' };
    expect(logEntryText(e, 0).text).toMatch(/17 格命中/);
    expect(logEntryText(e, 0).text).toContain('0xf39F');
  });
  it('timeout → 超时判负', () => {
    const e: GameLogEntry = { kind: 'finished', pos: pos(4), winner: WINNER, reason: 'timeout' };
    expect(logEntryText(e, 0).text).toMatch(/超时判负/);
  });
  it('cancelled → 对局取消', () => {
    const e: GameLogEntry = { kind: 'finished', pos: pos(4), winner: WINNER, reason: 'cancelled' };
    expect(logEntryText(e, 0).text).toMatch(/对局取消/);
  });
});

describe('toLogLines — 保序 + key + ts 透传', () => {
  it('映射每条 + key=blk:idx + ts 透传 + hit 旗', () => {
    const entries: GameLogEntry[] = [
      { kind: 'joined', pos: { blockNumber: 5n, logIndex: 2 }, p1: P1, ts: 1700000000 },
      { kind: 'resolved', pos: { blockNumber: 6n, logIndex: 0 }, side: 1, x: 0, y: 0, result: 1, totalHits: 1 },
    ];
    const lines = toLogLines(entries, 0);
    expect(lines).toHaveLength(2);
    expect(lines[0].key).toBe('5:2');
    expect(lines[0].ts).toBe(1700000000);
    expect(lines[1].key).toBe('6:0');
    expect(lines[1].hit).toBe(true);
  });
});
