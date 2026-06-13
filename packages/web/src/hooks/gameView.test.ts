/**
 * gameView 单测(Task 3.6)。
 *
 * 钉死「链上快照 + ShotResolved 回放 + 当前视角 → 视图模型」的纯派生(deriveGameView):
 *   - act:phase → 三幕 + notfound;
 *   - myIdx:p0/p1/observer/null;
 *   - isMyTurn:phase-aware 义务方(AwaitingAttack=turn / AwaitingResponse=1-turn),与合约
 *     attack(NOT_TURN)/respond(NOT_DEFENDER)义务方逐位一致;
 *   - myShots/enemyShots:按 defender 分组(打我的 vs 我打的);
 *   - **账户切换视角翻转**(同一 struct+events 换地址,myIdx/isMyTurn/my-enemy shots 全翻)——demo killer feature;
 *   - pendingShot / winner / cancelled。
 * useGame 的 React/wagmi 取数(readContract + getLogs + watchContractEvent)在浏览器验收,
 * 这里只测与网络无关的派生核(本仓 vitest node 环境、无 testing-library,同 gameListReducer 治理)。
 */
import { describe, expect, it } from 'vitest';
import type { Address } from '../lib/contracts.ts';
import {
  Phase,
  type GameSnapshot,
  type ResolvedShot,
  deriveGameView,
  computeMyIdx,
  phaseToAct,
} from './gameView.ts';

const P0 = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266' as Address;
const P1 = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8' as Address;
const STRANGER = '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC' as Address;
const ZERO = '0x0000000000000000000000000000000000000000' as Address;

/** 造快照;默认一局已开战、P0 先攻、各 0 命中。覆盖字段经 overrides 传入。 */
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
    winner: ZERO,
    lastActionAt: 1_700_000_000,
    ...overrides,
  };
}

/** ShotResolved 回放项简写。 */
function shot(defender: 0 | 1, x: number, y: number, result: 0 | 1, totalHits = 0): ResolvedShot {
  return { defender, x, y, result, totalHits };
}

describe('phaseToAct — phase → 幕', () => {
  it('None → notfound', () => expect(phaseToAct(Phase.None)).toBe('notfound'));
  it('Created → placement', () => expect(phaseToAct(Phase.Created)).toBe('placement'));
  it('AwaitingAttack → battle', () => expect(phaseToAct(Phase.AwaitingAttack)).toBe('battle'));
  it('AwaitingResponse → battle', () => expect(phaseToAct(Phase.AwaitingResponse)).toBe('battle'));
  it('Finished → finish', () => expect(phaseToAct(Phase.Finished)).toBe('finish'));
  it('Cancelled → finish', () => expect(phaseToAct(Phase.Cancelled)).toBe('finish'));
});

describe('computeMyIdx — 视角索引', () => {
  it('连 P0 地址 → 0', () => expect(computeMyIdx(P0, P0, P1)).toBe(0));
  it('连 P1 地址 → 1', () => expect(computeMyIdx(P1, P0, P1)).toBe(1));
  it('连陌生地址 → observer', () => expect(computeMyIdx(STRANGER, P0, P1)).toBe('observer'));
  it('未连接 → null', () => expect(computeMyIdx(undefined, P0, P1)).toBeNull());
  it('大小写不敏感(EIP-55 checksum vs 小写)', () => {
    expect(computeMyIdx(P0.toLowerCase() as Address, P0, P1)).toBe(0);
  });
  it('p1 尚为 zero(Created)时连陌生地址 → observer', () => {
    expect(computeMyIdx(STRANGER, P0, ZERO)).toBe('observer');
  });
});

describe('deriveGameView — myIdx / opponent / isPlayer', () => {
  it('P0 视角:myIdx=0,opponent=p1,isPlayer', () => {
    const v = deriveGameView(snap(), [], P0);
    expect(v.myIdx).toBe(0);
    expect(v.opponent).toBe(P1);
    expect(v.isPlayer).toBe(true);
  });
  it('P1 视角:myIdx=1,opponent=p0', () => {
    const v = deriveGameView(snap(), [], P1);
    expect(v.myIdx).toBe(1);
    expect(v.opponent).toBe(P0);
  });
  it('observer:myIdx=observer,无 opponent,非 player', () => {
    const v = deriveGameView(snap(), [], STRANGER);
    expect(v.myIdx).toBe('observer');
    expect(v.opponent).toBeUndefined();
    expect(v.isPlayer).toBe(false);
  });
  it('p1 未加入(zero)时 P0 的 opponent 为 undefined', () => {
    const v = deriveGameView(snap({ phase: Phase.Created, p1: ZERO }), [], P0);
    expect(v.opponent).toBeUndefined();
  });
});

describe('deriveGameView — isMyTurn / obligatedIdx(phase-aware,§4.2)', () => {
  it('AwaitingAttack turn=0:义务方=0,P0 该开炮、P1 不该', () => {
    const s = snap({ phase: Phase.AwaitingAttack, turn: 0 });
    expect(deriveGameView(s, [], P0).isMyTurn).toBe(true);
    expect(deriveGameView(s, [], P0).obligatedIdx).toBe(0);
    expect(deriveGameView(s, [], P1).isMyTurn).toBe(false);
  });

  it('AwaitingAttack turn=1:义务方=1,P1 该开炮、P0 不该', () => {
    const s = snap({ phase: Phase.AwaitingAttack, turn: 1 });
    expect(deriveGameView(s, [], P1).isMyTurn).toBe(true);
    expect(deriveGameView(s, [], P0).isMyTurn).toBe(false);
    expect(deriveGameView(s, [], P0).obligatedIdx).toBe(1);
  });

  it('AwaitingResponse turn=0:攻击方=P0,义务方=防守方 P1 → P1 该应答、P0 不该', () => {
    // turn 仍是攻击方(P0);respond 义务在 defender=1-turn=P1。
    const s = snap({ phase: Phase.AwaitingResponse, turn: 0, pendingX: 3, pendingY: 6 });
    expect(deriveGameView(s, [], P1).isMyTurn).toBe(true);
    expect(deriveGameView(s, [], P1).obligatedIdx).toBe(1);
    expect(deriveGameView(s, [], P0).isMyTurn).toBe(false);
  });

  it('AwaitingResponse turn=1:攻击方=P1,义务方=防守方 P0 → P0 该应答', () => {
    const s = snap({ phase: Phase.AwaitingResponse, turn: 1, pendingX: 2, pendingY: 2 });
    expect(deriveGameView(s, [], P0).isMyTurn).toBe(true);
    expect(deriveGameView(s, [], P0).obligatedIdx).toBe(0);
    expect(deriveGameView(s, [], P1).isMyTurn).toBe(false);
  });

  it('非对战 phase(Created/Finished):obligatedIdx=null,isMyTurn=false', () => {
    expect(deriveGameView(snap({ phase: Phase.Created }), [], P0).obligatedIdx).toBeNull();
    expect(deriveGameView(snap({ phase: Phase.Finished }), [], P0).isMyTurn).toBe(false);
  });

  it('observer 永不 isMyTurn', () => {
    const s = snap({ phase: Phase.AwaitingAttack, turn: 0 });
    expect(deriveGameView(s, [], STRANGER).isMyTurn).toBe(false);
  });
});

describe('deriveGameView — myShots / enemyShots 分组(按 defender)', () => {
  // 三炮:P0 打 P1 命中 D-7(defender=1);P1 打 P0 落空 A-1(defender=0);P0 打 P1 落空 B-2(defender=1)。
  const shots = [shot(1, 3, 6, 1), shot(0, 0, 0, 0), shot(1, 1, 1, 0)];

  it('P0 视角:myShots=打在 P1 上的(2 炮),enemyShots=打在 P0 上的(1 炮)', () => {
    const v = deriveGameView(snap(), shots, P0);
    expect(v.myShots.map((m) => m.coord)).toEqual(['D-7', 'B-2']);
    expect(v.myShots[0].result).toBe(1);
    expect(v.enemyShots.map((m) => m.coord)).toEqual(['A-1']);
    expect(v.enemyShots[0].result).toBe(0);
  });

  it('P1 视角:同一份数据,my/enemy 互换(account-switch 视角翻转)', () => {
    const v = deriveGameView(snap(), shots, P1);
    // P1 的 myShots = 打在 P0 上的(那 1 炮);enemyShots = 打在 P1 上的(那 2 炮)。
    expect(v.myShots.map((m) => m.coord)).toEqual(['A-1']);
    expect(v.enemyShots.map((m) => m.coord)).toEqual(['D-7', 'B-2']);
  });

  it('observer:无「我方」立场,my/enemy 皆空', () => {
    const v = deriveGameView(snap(), shots, STRANGER);
    expect(v.myShots).toEqual([]);
    expect(v.enemyShots).toEqual([]);
  });

  it('坐标级 hit/miss 来自事件 result(非 struct——struct 给不出哪格 hit)', () => {
    const v = deriveGameView(snap(), [shot(1, 5, 5, 1), shot(1, 6, 6, 0)], P0);
    expect(v.myShots).toEqual([
      { x: 5, y: 5, result: 1, coord: 'F-6' },
      { x: 6, y: 6, result: 0, coord: 'G-7' },
    ]);
  });
});

describe('deriveGameView — hits 透出(语义:hits[i]=玩家 i 被命中)', () => {
  it('P0 视角:myHits=hits[0],opponentHits=hits[1]', () => {
    const v = deriveGameView(snap({ hits: [3, 7] }), [], P0);
    expect(v.hits).toEqual([3, 7]);
    expect(v.myHits).toBe(3);
    expect(v.opponentHits).toBe(7);
  });
  it('P1 视角:myHits=hits[1],opponentHits=hits[0](翻转)', () => {
    const v = deriveGameView(snap({ hits: [3, 7] }), [], P1);
    expect(v.myHits).toBe(7);
    expect(v.opponentHits).toBe(3);
  });
  it('observer:myHits/opponentHits 均 undefined,但 hits 原样可读', () => {
    const v = deriveGameView(snap({ hits: [3, 7] }), [], STRANGER);
    expect(v.myHits).toBeUndefined();
    expect(v.hits).toEqual([3, 7]);
  });
});

describe('deriveGameView — pendingShot', () => {
  it('AwaitingResponse:pendingShot 带坐标 + attacker(turn) + defender(1-turn)', () => {
    const v = deriveGameView(snap({ phase: Phase.AwaitingResponse, turn: 0, pendingX: 3, pendingY: 6 }), [], P1);
    expect(v.pendingShot).toEqual({ x: 3, y: 6, coord: 'D-7', attacker: 0, defender: 1 });
  });
  it('AwaitingResponse 且我是防守方 → pendingShotIsForMe(3.7 自动应答触发条件)', () => {
    const s = snap({ phase: Phase.AwaitingResponse, turn: 0, pendingX: 3, pendingY: 6 });
    expect(deriveGameView(s, [], P1).pendingShotIsForMe).toBe(true); // P1 是防守方
    expect(deriveGameView(s, [], P0).pendingShotIsForMe).toBe(false); // P0 是攻击方
  });
  it('非 AwaitingResponse:pendingShot=null', () => {
    expect(deriveGameView(snap({ phase: Phase.AwaitingAttack }), [], P0).pendingShot).toBeNull();
  });
});

describe('deriveGameView — winner / iWon / cancelled', () => {
  it('Finished P0 胜:winner=P0,P0 视角 iWon、P1 视角不 iWon', () => {
    const s = snap({ phase: Phase.Finished, winner: P0 });
    expect(deriveGameView(s, [], P0).winner).toBe(P0);
    expect(deriveGameView(s, [], P0).iWon).toBe(true);
    expect(deriveGameView(s, [], P1).iWon).toBe(false);
  });
  it('Finished P1 胜:P1 视角 iWon', () => {
    const s = snap({ phase: Phase.Finished, winner: P1 });
    expect(deriveGameView(s, [], P1).iWon).toBe(true);
  });
  it('zero winner → winner undefined,无人 iWon', () => {
    const v = deriveGameView(snap({ phase: Phase.Finished, winner: ZERO }), [], P0);
    expect(v.winner).toBeUndefined();
    expect(v.iWon).toBe(false);
  });
  it('Cancelled:isCancelled=true,winner undefined(zero)', () => {
    const v = deriveGameView(snap({ phase: Phase.Cancelled, winner: ZERO }), [], P0);
    expect(v.isCancelled).toBe(true);
    expect(v.act).toBe('finish');
    expect(v.winner).toBeUndefined();
  });
  it('对战中(非终局)isCancelled=false', () => {
    expect(deriveGameView(snap({ phase: Phase.AwaitingAttack }), [], P0).isCancelled).toBe(false);
  });
});

describe('deriveGameView — act 贯穿(三幕路由依据)', () => {
  it('Created → placement', () => expect(deriveGameView(snap({ phase: Phase.Created }), [], P0).act).toBe('placement'));
  it('AwaitingAttack → battle', () => expect(deriveGameView(snap(), [], P0).act).toBe('battle'));
  it('Finished → finish', () => expect(deriveGameView(snap({ phase: Phase.Finished }), [], P0).act).toBe('finish'));
  it('None → notfound', () => expect(deriveGameView(snap({ phase: Phase.None }), [], P0).act).toBe('notfound'));
});
