/**
 * TurnBanner.bannerLabel 单测(Task 3.7)。
 *
 * 钉死回合横幅 4(玩家)+ 2(旁观)态文案 + active 旗(主色 vs 次色),与 §4.2 义务方 × phase 一致,
 * 且与 deriveGameView 的 isMyTurn/pendingShotIsForMe 对齐(视角翻转下措辞翻面)。
 */
import { describe, expect, it } from 'vitest';
import type { Address } from '../lib/contracts.ts';
import { Phase, deriveGameView, type GameSnapshot } from '../hooks/gameView.ts';
import { bannerLabel } from './TurnBanner.tsx';

const P0 = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266' as Address;
const P1 = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8' as Address;
const STRANGER = '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC' as Address;
const ZERO = '0x0000000000000000000000000000000000000000' as Address;

function snap(overrides: Partial<GameSnapshot> = {}): GameSnapshot {
  return {
    p0: P0,
    p1: P1,
    commitment0: 111n,
    commitment1: 222n,
    phase: Phase.AwaitingAttack,
    turn: 0,
    pendingX: 0,
    pendingY: 0,
    hits: [0, 0],
    shotMap: [0n, 0n],
    winner: ZERO,
    lastActionAt: 1_700_000_000,
    ...overrides,
  };
}

describe('bannerLabel — AwaitingAttack', () => {
  it('我方攻击回合(P0 视角,turn=0)→ 轮到你开炮 + active', () => {
    const v = deriveGameView(snap({ phase: Phase.AwaitingAttack, turn: 0 }), [], P0);
    expect(bannerLabel(v)).toEqual({ text: '轮到你开炮', active: true });
  });

  it('对手攻击回合(P1 视角,turn=0)→ 等待对手开炮 + 非 active', () => {
    const v = deriveGameView(snap({ phase: Phase.AwaitingAttack, turn: 0 }), [], P1);
    expect(bannerLabel(v)).toEqual({ text: '等待对手开炮', active: false });
  });
});

describe('bannerLabel — AwaitingResponse(防守方义务 = 1-turn)', () => {
  // turn=0 → P0 攻击,P1 防守(待应答)。pending=(3,6)=D-7。
  const responding = snap({ phase: Phase.AwaitingResponse, turn: 0, pendingX: 3, pendingY: 6 });

  it('待我应答(P1 视角)→ 正在应答对手的炮击 D-7… + active', () => {
    const v = deriveGameView(responding, [], P1);
    expect(bannerLabel(v)).toEqual({ text: '正在应答对手的炮击 D-7…', active: true });
  });

  it('待对手应答(P0 视角)→ 等待对手应答 D-7 + 非 active', () => {
    const v = deriveGameView(responding, [], P0);
    expect(bannerLabel(v)).toEqual({ text: '等待对手应答 D-7', active: false });
  });
});

describe('bannerLabel — 旁观(客观称谓,无「你」)', () => {
  it('AwaitingAttack turn=1 → 等待 P1 开炮', () => {
    const v = deriveGameView(snap({ phase: Phase.AwaitingAttack, turn: 1 }), [], STRANGER);
    expect(bannerLabel(v)).toEqual({ text: '等待 P1 开炮', active: false });
  });

  it('AwaitingResponse turn=0(防守方 P1)→ 等待 P1 应答 D-7', () => {
    const v = deriveGameView(
      snap({ phase: Phase.AwaitingResponse, turn: 0, pendingX: 3, pendingY: 6 }),
      [],
      STRANGER,
    );
    expect(bannerLabel(v)).toEqual({ text: '等待 P1 应答 D-7', active: false });
  });

  it('未连接(myIdx=null)→ 同旁观客观称谓', () => {
    const v = deriveGameView(snap({ phase: Phase.AwaitingAttack, turn: 0 }), [], undefined);
    expect(bannerLabel(v)).toEqual({ text: '等待 P0 开炮', active: false });
  });
});
