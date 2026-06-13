/**
 * useCountdown —— 超时倒计时(Design §4.3 TIMEOUT=300s;§7.3 对战幕回合横幅倒数 + claimTimeout 呼吸)。
 *
 * 合约只有一个计时锚点 `lastActionAt`(每次合法推进刷新);义务方超过 300s 未行动,**非义务方**可
 * claimTimeout 直接获胜(§4.3:claimTimeout 只对非义务方开放,§10 防御性裁决)。本 hook 把「链上当前
 * 时间 vs lastActionAt+300」算成剩余秒数 + 是否已超时,1s tick 驱动重渲染。
 *
 * 纯时间核(computeCountdown)抽出可单测(node vitest 无定时器/DOM 也能断言边界:剩余=0 的临界、
 * 负数夹到 0、未开始锚点);hook 只负责「拿到 now → 调纯核」。
 *
 * **now 取链上块时间(不是纯墙钟)**:合约 claimTimeout 的权威判据是 `block.timestamp > lastActionAt
 * + TIMEOUT`。本地链 auto-mine 时块时间≈墙钟,但测试 / 演示会用 `evm_increaseTime` 把**链时间**跳到
 * 墙钟之前——此时纯墙钟倒计时不会到点,但链上已可 claimTimeout。故本 hook 周期性 `getBlock()` 取链上
 * 最新块时间作锚,两次取数之间用墙钟增量插值平滑 1s 跳动(`now = 链锚 + (Date.now()-取锚墙钟)/1000`)。
 * 如此 `evm_increaseTime` 后下一次取块即把跳变带进来,倒计时与 claim 按钮如实反映链上超时;真正可否
 * 成功仍由合约裁决(NOT_TIMEOUT 经 mapContractError 提示)。即本 hook 决定「按钮何时出现」,合约决定
 * 「点了是否成功」。取块失败(RPC 抖动)回退纯墙钟(degrade,不致整条倒计时卡死)。
 *
 * 谁能 claim(§4.3 + §10):义务方(obligatedIdx)负有行动义务、不能 claim 自己超时;非义务方且是本局
 * 玩家才是 claimant——该判定在调用方(依赖 myIdx/obligatedIdx),本 hook 只管「时间到没到」。
 */
import { useEffect, useRef, useState } from 'react';
import { usePublicClient } from 'wagmi';

/** 合约 TIMEOUT(秒,§4.3 / §6.2 锁定)。 */
export const TIMEOUT_SECONDS = 300;

export type CountdownState = {
  /** 距义务方超时的剩余秒数(夹到 [0, TIMEOUT];lastActionAt 缺失 → TIMEOUT 满值,视为「刚开始」)。 */
  remaining: number;
  /** 是否已超时(nowSec >= lastActionAt + TIMEOUT)——前端近似,见模块注释。 */
  expired: boolean;
};

/**
 * 纯核:给定锚点 lastActionAt(秒)与当前 nowSec(秒),算剩余秒 + 是否超时。
 * lastActionAt<=0(无效 / 未开始)→ remaining=TIMEOUT、expired=false(不会误显「已超时」)。
 */
export function computeCountdown(
  lastActionAt: number,
  nowSec: number,
  timeout = TIMEOUT_SECONDS,
): CountdownState {
  if (!Number.isFinite(lastActionAt) || lastActionAt <= 0) {
    return { remaining: timeout, expired: false };
  }
  const deadline = lastActionAt + timeout;
  const remainingRaw = deadline - nowSec;
  const remaining = Math.max(0, Math.min(timeout, Math.floor(remainingRaw)));
  return { remaining, expired: nowSec >= deadline };
}

/** mm:ss 格式(倒计时展示;remaining 已是非负秒)。 */
export function formatRemaining(remaining: number): string {
  const m = Math.floor(remaining / 60);
  const s = remaining % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export type UseCountdownArgs = {
  /** 链上计时锚点(秒,GameView.lastActionAt)。 */
  lastActionAt: number;
  /** 计时是否激活(仅对战 phase 有义务方时;非对战/已结束传 false → 不 tick、不显倒计时)。 */
  active: boolean;
};

/** 链时间锚:某次 getBlock 取到的块时间(chainSec)+ 取到那一刻的墙钟(wallMs),用于插值。 */
type ChainAnchor = { chainSec: number; wallMs: number };

/** 链锚轮询间隔(ms):每 5s 取一次最新块时间,把 evm_increaseTime 的跳变带进来。 */
const CHAIN_POLL_MS = 5000;

/**
 * useCountdown —— 1s tick 重算剩余/超时,now 取链上块时间(墙钟插值平滑)。active=false 不起定时器
 * (省渲染),返回满值未超时。返回 { remaining, expired, label }(label=mm:ss)。
 */
export function useCountdown({ lastActionAt, active }: UseCountdownArgs): CountdownState & { label: string } {
  const publicClient = usePublicClient();
  // 链时间锚(最近一次 getBlock 的块时间 + 墙钟);null = 尚未取到(回退纯墙钟)。
  const anchorRef = useRef<ChainAnchor | null>(null);
  // tick:每秒 +1 触发重算(纯墙钟驱动 1s 节拍,now 用链锚 + 墙钟增量插值)。
  const [, setTick] = useState(0);

  // 链锚轮询(active 时):立即取一次 + 每 CHAIN_POLL_MS 取一次最新块时间。
  useEffect(() => {
    if (!active || !publicClient) return;
    let alive = true;
    const fetchAnchor = async () => {
      try {
        const block = await publicClient.getBlock({ blockTag: 'latest' });
        if (alive) anchorRef.current = { chainSec: Number(block.timestamp), wallMs: Date.now() };
      } catch {
        // 取块失败:保留旧锚(或无锚回退墙钟);不致整条倒计时卡死。
      }
    };
    void fetchAnchor();
    const poll = setInterval(() => void fetchAnchor(), CHAIN_POLL_MS);
    return () => {
      alive = false;
      clearInterval(poll);
    };
  }, [active, publicClient]);

  // 1s 节拍(active 时):驱动重渲染重算 now。
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => setTick((v) => v + 1), 1000);
    return () => clearInterval(t);
  }, [active]);

  // active=false:不显倒计时(返回满值未超时,调用方据 active 决定是否渲染)。
  if (!active) {
    return { remaining: TIMEOUT_SECONDS, expired: false, label: formatRemaining(TIMEOUT_SECONDS) };
  }

  // now:有链锚 → 链锚 + 墙钟增量插值;无锚(首帧 / 取块失败)→ 纯墙钟。
  const anchor = anchorRef.current;
  const nowSec = anchor
    ? anchor.chainSec + Math.floor((Date.now() - anchor.wallMs) / 1000)
    : Math.floor(Date.now() / 1000);

  const state = computeCountdown(lastActionAt, nowSec);
  return { ...state, label: formatRemaining(state.remaining) };
}
