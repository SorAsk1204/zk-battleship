/**
 * battleReport 单测(Task 3.8)。
 *
 * 钉死「事件日志 + 视图 → 战报数字」的纯派生(computeBattleReport)+ 展示格式化(formatDuration/
 * formatRate/reasonText)。这是结算幕战报的真理源,React 渲染在浏览器验收,这里只测与网络无关的派生核
 * (本仓 vitest node 环境、无 testing-library,同 gameView/eventLogLines/battleMarks 治理)。
 *
 * 覆盖:
 *   - rounds = ShotResolved 事件数(pending 不计);
 *   - 命中率视角相对:defender===我 → 对手打我;defender===对手 → 我打对手;按攻击方(1-defender)归并;
 *   - 用时 = 事件 ts 跨度(min→max);无 ts → null;
 *   - 最终命中取 view(链上真值,非事件累加);
 *   - finishReason 取 finished 事件;
 *   - observer(myIdx 非 0/1):rate=null、myHits/opponentHits=undefined,rounds/duration 照常;
 *   - 边界:空日志、fired=0、格式化负数/null。
 */
import { describe, expect, it } from 'vitest';
import type { GameLogEntry } from '../hooks/useGame.ts';
import type { GameView, MyIdx } from '../hooks/gameView.ts';
import { Phase } from '../hooks/gameView.ts';
import {
  computeBattleReport,
  formatDuration,
  formatRate,
  reasonText,
} from './battleReport.ts';

// ── 事件工厂(只填 computeBattleReport 用到的字段)──
let seq = 0;
function pos() {
  // 唯一 pos(块号递增);computeBattleReport 不依赖顺序,但给真实形状。
  seq += 1;
  return { blockNumber: BigInt(seq), logIndex: 0 };
}
function resolved(defender: 0 | 1, result: 0 | 1, ts?: number): GameLogEntry {
  return { kind: 'resolved', pos: pos(), side: defender, x: 0, y: 0, result, totalHits: 0, ts };
}
function fired(attacker: 0 | 1, ts?: number): GameLogEntry {
  return { kind: 'fired', pos: pos(), side: attacker, x: 0, y: 0, ts };
}
function joined(ts?: number): GameLogEntry {
  return { kind: 'joined', pos: pos(), p1: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8', ts };
}
function finished(reason: string, ts?: number): GameLogEntry {
  return {
    kind: 'finished',
    pos: pos(),
    winner: '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266',
    reason,
    ts,
  };
}

/** 最小 GameView：只填 computeBattleReport 读到的字段(myIdx/myHits/opponentHits),其余给占位。 */
function view(myIdx: MyIdx, myHits: number | undefined, opponentHits: number | undefined): GameView {
  return {
    act: 'finish',
    phase: Phase.Finished,
    myIdx,
    isPlayer: myIdx === 0 || myIdx === 1,
    opponent: undefined,
    isMyTurn: false,
    obligatedIdx: null,
    myShots: [],
    enemyShots: [],
    myFiredCells: new Set(),
    enemyFiredCells: new Set(),
    hits: [myHits ?? 0, opponentHits ?? 0],
    myHits,
    opponentHits,
    myCommitment: undefined,
    opponentCommitment: undefined,
    pendingShot: null,
    pendingShotIsForMe: false,
    winner: undefined,
    iWon: false,
    isCancelled: false,
    lastActionAt: 0,
  };
}

describe('computeBattleReport — rounds', () => {
  it('rounds = ShotResolved 事件数(fired/joined/finished 不计)', () => {
    const log = [
      joined(),
      fired(0),
      resolved(1, 1), // P0 打 P1,命中
      fired(1),
      resolved(0, 0), // P1 打 P0,未命中
      fired(0),
      resolved(1, 1), // P0 打 P1,命中
    ];
    const r = computeBattleReport(log, view(0, 0, 2));
    expect(r.rounds).toBe(3);
  });

  it('pending(已 fired 未 resolved)不计入 rounds', () => {
    const log = [joined(), fired(0), resolved(1, 1), fired(1)]; // 最后一炮未 resolved
    const r = computeBattleReport(log, view(0, 0, 1));
    expect(r.rounds).toBe(1);
  });

  it('空日志 → rounds 0、rate null、duration null', () => {
    const r = computeBattleReport([], view(0, 0, 0));
    expect(r.rounds).toBe(0);
    expect(r.mine.rate).toBeNull();
    expect(r.opponent.rate).toBeNull();
    expect(r.durationSec).toBeNull();
  });
});

describe('computeBattleReport — 命中率视角相对', () => {
  // 一局:P0 打 P1 共 3 炮中 2(defender===1);P1 打 P0 共 2 炮中 1(defender===0)。
  const log = [
    resolved(1, 1), // P0→P1 hit
    resolved(0, 0), // P1→P0 miss
    resolved(1, 1), // P0→P1 hit
    resolved(0, 1), // P1→P0 hit
    resolved(1, 0), // P0→P1 miss
  ];

  it('P0 视角:mine = P0 打 P1(3 炮 2 中 = 2/3),opponent = P1 打 P0(2 炮 1 中 = 1/2)', () => {
    const r = computeBattleReport(log, view(0, 1, 2)); // P0 被命中 1、P1 被命中 2
    expect(r.mine.fired).toBe(3);
    expect(r.mine.hits).toBe(2);
    expect(r.mine.rate).toBeCloseTo(2 / 3, 6);
    expect(r.opponent.fired).toBe(2);
    expect(r.opponent.hits).toBe(1);
    expect(r.opponent.rate).toBeCloseTo(1 / 2, 6);
  });

  it('P1 视角:同一份事件,mine/opponent 对调(P1 打 P0 = 2 炮 1 中;P0 打 P1 = 3 炮 2 中)', () => {
    const r = computeBattleReport(log, view(1, 2, 1)); // P1 被命中 2、P0 被命中 1
    expect(r.mine.fired).toBe(2); // P1 是攻击方(defender===0)
    expect(r.mine.hits).toBe(1);
    expect(r.mine.rate).toBeCloseTo(1 / 2, 6);
    expect(r.opponent.fired).toBe(3); // P0 打 P1(defender===1)
    expect(r.opponent.hits).toBe(2);
    expect(r.opponent.rate).toBeCloseTo(2 / 3, 6);
  });

  it('observer(myIdx=observer):无我方立场 → fired/hits 0、rate null;myHits/opponentHits undefined', () => {
    const r = computeBattleReport(log, view('observer', undefined, undefined));
    expect(r.mine.fired).toBe(0);
    expect(r.mine.rate).toBeNull();
    expect(r.opponent.fired).toBe(0);
    expect(r.opponent.rate).toBeNull();
    expect(r.myHits).toBeUndefined();
    expect(r.opponentHits).toBeUndefined();
    // 但客观量照常:
    expect(r.rounds).toBe(5);
  });

  it('fired=0(我一炮没发,如先手对方先打)→ mine.rate null', () => {
    const log2 = [resolved(0, 1), resolved(0, 0)]; // 全是打 P0 的(P1 攻)
    const r = computeBattleReport(log2, view(0, 1, 0));
    expect(r.mine.fired).toBe(0);
    expect(r.mine.rate).toBeNull();
    expect(r.opponent.fired).toBe(2);
    expect(r.opponent.hits).toBe(1);
  });
});

describe('computeBattleReport — 最终命中取 view(非事件累加)', () => {
  it('myHits/opponentHits 直接取 view(链上真值)', () => {
    // 即便事件回放只有 1 条,view 说 17(打满)——以 view 为准。
    const r = computeBattleReport([resolved(1, 1)], view(0, 5, 17));
    expect(r.myHits).toBe(5);
    expect(r.opponentHits).toBe(17);
  });
});

describe('computeBattleReport — 用时跨度', () => {
  it('durationSec = 最晚 ts − 最早 ts(跨所有带 ts 事件)', () => {
    const log = [joined(1000), fired(0, 1005), resolved(1, 1, 1010), finished('17hits', 1042)];
    const r = computeBattleReport(log, view(0, 0, 17));
    expect(r.durationSec).toBe(42); // 1042 - 1000
  });

  it('部分事件缺 ts(块时间未补全)→ 用现有 ts 的极值', () => {
    const log = [joined(undefined), resolved(1, 1, 1010), finished('17hits', 1030)];
    const r = computeBattleReport(log, view(0, 0, 17));
    expect(r.durationSec).toBe(20); // 1030 - 1010(joined 无 ts 不参与)
  });

  it('全无 ts → durationSec null', () => {
    const log = [joined(), resolved(1, 1), finished('17hits')];
    const r = computeBattleReport(log, view(0, 0, 17));
    expect(r.durationSec).toBeNull();
  });

  it('单个带 ts 事件 → 跨度 0(min===max)', () => {
    const r = computeBattleReport([finished('timeout', 5000)], view(0, 0, 3));
    expect(r.durationSec).toBe(0);
  });
});

describe('computeBattleReport — finishReason', () => {
  it('取 finished 事件的 reason', () => {
    expect(computeBattleReport([finished('17hits')], view(0, 0, 17)).finishReason).toBe('17hits');
    expect(computeBattleReport([finished('timeout')], view(0, 0, 3)).finishReason).toBe('timeout');
    expect(computeBattleReport([finished('cancelled')], view(0, 0, 0)).finishReason).toBe('cancelled');
  });
  it('无 finished 事件 → undefined', () => {
    expect(computeBattleReport([resolved(1, 1)], view(0, 0, 1)).finishReason).toBeUndefined();
  });
});

describe('formatDuration', () => {
  it('mm:ss 补零', () => {
    expect(formatDuration(0)).toBe('00:00');
    expect(formatDuration(5)).toBe('00:05');
    expect(formatDuration(65)).toBe('01:05');
    expect(formatDuration(600)).toBe('10:00');
    expect(formatDuration(3661)).toBe('61:01'); // 超 99:59 不截断,按真实分钟
  });
  it('null/负数/NaN → --:--', () => {
    expect(formatDuration(null)).toBe('--:--');
    expect(formatDuration(-5)).toBe('--:--');
    expect(formatDuration(NaN)).toBe('--:--');
  });
  it('截断小数秒', () => {
    expect(formatDuration(65.9)).toBe('01:05');
  });
});

describe('formatRate', () => {
  it('小数 → 百分比整数', () => {
    expect(formatRate(0)).toBe('0%');
    expect(formatRate(0.6)).toBe('60%');
    expect(formatRate(2 / 3)).toBe('67%'); // 四舍五入
    expect(formatRate(1)).toBe('100%');
  });
  it('null → —', () => {
    expect(formatRate(null)).toBe('—');
  });
});

describe('reasonText — 视角相关措辞', () => {
  it('17hits:胜方/负方/客观', () => {
    expect(reasonText('17hits', true)).toContain('全灭对手');
    expect(reasonText('17hits', false)).toContain('被全灭');
    expect(reasonText('17hits', undefined)).toContain('17 命中');
  });
  it('timeout:胜方/负方/客观', () => {
    expect(reasonText('timeout', true)).toContain('对手超时');
    expect(reasonText('timeout', false)).toContain('你超时');
    expect(reasonText('timeout', undefined)).toContain('超时');
  });
  it('cancelled → 取消;未知 → 空串', () => {
    expect(reasonText('cancelled', undefined)).toContain('取消');
    expect(reasonText('weird', true)).toBe('');
    expect(reasonText(undefined, true)).toBe('');
  });
});
