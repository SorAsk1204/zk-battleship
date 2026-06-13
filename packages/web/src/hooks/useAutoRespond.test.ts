/**
 * useAutoRespond 去重键单测 —— 锁住 Task 3.9 §9.4 实测暴露并修复的「同坐标串号」缺陷。
 *
 * 缺陷:旧键 = `chainId:gameId:x,y`(不含应答方地址)。demo 双账户在**同一标签页**对打、共用同一
 * module 作用域时,若 P0 与 P1 先后被打到**同一坐标**(双方都被打 A-1),成功后又按设计不清键
 * (堵 respond 已上链未 refetch 的重发窗口),则后一位应答撞上前一位残留的同坐标键被静默跳过 →
 * 永不应答 → 假超时判负。修复:键加入 address 段,两方各占各键。
 *
 * 本测试只测纯键函数(flightKey/gamePrefix),不渲染 hook(本仓无 testing-library);
 * hook 的去重行为在浏览器 §9.4 手测中已端到端验证(P0/P1 互相被打 A-1 都能各自自动应答)。
 */
import { describe, expect, it } from 'vitest';
import { flightKey, gamePrefix } from './useAutoRespond.ts';

const P0 = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266' as `0x${string}`;
const P1 = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8' as `0x${string}`;

describe('useAutoRespond / flightKey 去重键', () => {
  it('同坐标、不同应答方地址 → 不同键(修复:不再串号)', () => {
    const k0 = flightKey(31337, 1n, P0, 0, 0);
    const k1 = flightKey(31337, 1n, P1, 0, 0);
    expect(k0).not.toBe(k1);
  });

  it('同地址、同坐标、同局 → 同键(幂等去重仍生效)', () => {
    expect(flightKey(31337, 1n, P0, 3, 7)).toBe(flightKey(31337, 1n, P0, 3, 7));
  });

  it('同地址、不同坐标 → 不同键', () => {
    expect(flightKey(31337, 1n, P0, 0, 0)).not.toBe(flightKey(31337, 1n, P0, 1, 0));
  });

  it('不同局(gameId)→ 不同键', () => {
    expect(flightKey(31337, 1n, P0, 0, 0)).not.toBe(flightKey(31337, 2n, P0, 0, 0));
  });

  it('地址大小写归一:同地址不同大小写 → 同键', () => {
    const lower = flightKey(31337, 1n, P0.toLowerCase() as `0x${string}`, 0, 0);
    const mixed = flightKey(31337, 1n, P0, 0, 0);
    expect(lower).toBe(mixed);
  });

  it('gamePrefix 是该局两方地址全部键的公共前缀(clearInFlight 据此清局)', () => {
    const prefix = gamePrefix(31337, 1n);
    expect(flightKey(31337, 1n, P0, 0, 0).startsWith(prefix)).toBe(true);
    expect(flightKey(31337, 1n, P1, 5, 5).startsWith(prefix)).toBe(true);
    // 别的局键不被该前缀命中
    expect(flightKey(31337, 2n, P0, 0, 0).startsWith(prefix)).toBe(false);
  });

  it('键形如 chainId:gameId:address(小写):x,y', () => {
    expect(flightKey(31337, 1n, P0, 4, 8)).toBe(
      `31337:1:${P0.toLowerCase()}:4,8`,
    );
  });
});
