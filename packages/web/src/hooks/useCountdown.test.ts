/**
 * useCountdown 纯核单测(Task 3.7)。
 *
 * 钉死「墙钟 vs 链上锚点 lastActionAt+TIMEOUT → 剩余秒 / 是否超时」的时间数学(computeCountdown)与
 * mm:ss 格式(formatRemaining)。React tick(useCountdown hook 本身)在浏览器验收,这里只测与定时器/
 * DOM 无关的纯核(同 gameView/battleMarks 治理:node vitest 唯一能单测的层)。
 */
import { describe, expect, it } from 'vitest';
import { computeCountdown, formatRemaining, projectNowSec, TIMEOUT_SECONDS } from './useCountdown.ts';

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

describe('projectNowSec — now 估算(墙钟 + 链领先量;空闲冻结链防卡死)', () => {
  it('无链锚(首帧 / 取块失败)→ 纯墙钟秒', () => {
    expect(projectNowSec(null, 1_205_000)).toBe(1205);
  });

  it('非有限 chainSec(坏锚)→ 回退纯墙钟', () => {
    expect(projectNowSec({ chainSec: NaN, wallMs: 1_200_000 }, 1_205_000)).toBe(1205);
  });

  it('空闲链:latest 块时间冻结落后墙钟、刚重锚(wallMs≈now)→ now 取墙钟而非冻结链时', () => {
    // 链块冻结在 1000 秒;锚在墙钟 1200 秒时取到(wallMs=1_200_000、chainSec=1000)。
    // 旧实现 = chainSec+floor((now-wallMs)/1000) = 1000+0 = 1000(卡死);正确应≈墙钟 1200。
    expect(projectNowSec({ chainSec: 1000, wallMs: 1_200_000 }, 1_200_000)).toBe(1200);
  });

  it('空闲链跨多次 5s 重锚:每次重锚后 now 仍随墙钟推进(不被冻结链时拖住)', () => {
    const FROZEN = 1000; // latest 块时间恒冻结在 1000 秒
    // 三次重锚:每次 wallMs=当下墙钟、chainSec 恒为冻结值 → now 必须跟随墙钟、不卡在 ~1000。
    expect(projectNowSec({ chainSec: FROZEN, wallMs: 1_200_000 }, 1_200_000)).toBe(1200);
    expect(projectNowSec({ chainSec: FROZEN, wallMs: 1_230_000 }, 1_230_000)).toBe(1230);
    expect(projectNowSec({ chainSec: FROZEN, wallMs: 1_260_000 }, 1_260_000)).toBe(1260);
  });

  it('链时间领先墙钟(evm_increaseTime 跳进 / 服务器时钟超前)→ now 跟随链时间', () => {
    // 链块时间 1500(领先墙钟 1200 秒共 300 秒)→ now 取领先的链时间 1500。
    expect(projectNowSec({ chainSec: 1500, wallMs: 1_200_000 }, 1_200_000)).toBe(1500);
  });

  it('链领先时仍随墙钟平滑推进(领先量恒定叠加,无 5s 锯齿)', () => {
    const anchor = { chainSec: 1500, wallMs: 1_200_000 }; // 领先 300
    expect(projectNowSec(anchor, 1_205_000)).toBe(1505); // 5s 后 = 1205 + 300
  });

  it('健康链:链时间≈墙钟 → now≈墙钟', () => {
    expect(projectNowSec({ chainSec: 1200, wallMs: 1_200_000 }, 1_205_000)).toBe(1205);
  });
});
