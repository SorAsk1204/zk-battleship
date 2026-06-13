/**
 * useCountdown 纯核单测(Task 3.7)。
 *
 * 钉死「墙钟 vs 链上锚点 lastActionAt+TIMEOUT → 剩余秒 / 是否超时」的时间数学(computeCountdown)与
 * mm:ss 格式(formatRemaining)。React tick(useCountdown hook 本身)在浏览器验收,这里只测与定时器/
 * DOM 无关的纯核(同 gameView/battleMarks 治理:node vitest 唯一能单测的层)。
 */
import { describe, expect, it } from 'vitest';
import { computeCountdown, formatRemaining, TIMEOUT_SECONDS } from './useCountdown.ts';

describe('computeCountdown — 剩余秒 / 超时判定', () => {
  const anchor = 1_700_000_000; // 任意锚点(秒)

  it('刚开始(now=anchor)→ 剩余 TIMEOUT,未超时', () => {
    expect(computeCountdown(anchor, anchor)).toEqual({ remaining: TIMEOUT_SECONDS, expired: false });
  });

  it('中途(now=anchor+100)→ 剩余 200,未超时', () => {
    expect(computeCountdown(anchor, anchor + 100)).toEqual({ remaining: TIMEOUT_SECONDS - 100, expired: false });
  });

  it('恰好到点(now=anchor+TIMEOUT)→ 剩余 0,已超时(>= deadline)', () => {
    expect(computeCountdown(anchor, anchor + TIMEOUT_SECONDS)).toEqual({ remaining: 0, expired: true });
  });

  it('超过(now=anchor+TIMEOUT+50)→ 剩余夹到 0,已超时', () => {
    expect(computeCountdown(anchor, anchor + TIMEOUT_SECONDS + 50)).toEqual({ remaining: 0, expired: true });
  });

  it('差 1 秒(now=anchor+TIMEOUT-1)→ 剩余 1,未超时(临界)', () => {
    expect(computeCountdown(anchor, anchor + TIMEOUT_SECONDS - 1)).toEqual({ remaining: 1, expired: false });
  });

  it('now 在 anchor 之前(时钟漂移)→ 剩余夹到 TIMEOUT,未超时', () => {
    expect(computeCountdown(anchor, anchor - 50)).toEqual({ remaining: TIMEOUT_SECONDS, expired: false });
  });

  it('lastActionAt<=0(未开始 / 无效)→ 剩余 TIMEOUT,未超时(不误显已超时)', () => {
    expect(computeCountdown(0, anchor)).toEqual({ remaining: TIMEOUT_SECONDS, expired: false });
    expect(computeCountdown(-1, anchor)).toEqual({ remaining: TIMEOUT_SECONDS, expired: false });
  });

  it('非有限 lastActionAt → 同未开始处理', () => {
    expect(computeCountdown(NaN, anchor)).toEqual({ remaining: TIMEOUT_SECONDS, expired: false });
  });

  it('自定义 timeout 生效', () => {
    expect(computeCountdown(anchor, anchor + 5, 10)).toEqual({ remaining: 5, expired: false });
    expect(computeCountdown(anchor, anchor + 10, 10)).toEqual({ remaining: 0, expired: true });
  });

  it('小数 now 向下取整剩余(floor)', () => {
    // anchor+0.4 → remainingRaw=299.6 → floor 299
    expect(computeCountdown(anchor, anchor + 0.4).remaining).toBe(TIMEOUT_SECONDS - 1);
  });
});

describe('formatRemaining — mm:ss', () => {
  it('300 → 5:00', () => expect(formatRemaining(300)).toBe('5:00'));
  it('299 → 4:59', () => expect(formatRemaining(299)).toBe('4:59'));
  it('61 → 1:01', () => expect(formatRemaining(61)).toBe('1:01'));
  it('60 → 1:00', () => expect(formatRemaining(60)).toBe('1:00'));
  it('9 → 0:09(秒补零)', () => expect(formatRemaining(9)).toBe('0:09'));
  it('0 → 0:00', () => expect(formatRemaining(0)).toBe('0:00'));
});
