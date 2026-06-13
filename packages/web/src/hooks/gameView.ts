/**
 * gameView —— useGame 的纯派生核心(Design §4 状态机/回合流 + §7.1 三幕同路由状态驱动)。
 *
 * 这是「链上快照(getGame struct)+ 炮击历史(ShotResolved 回放)+ 当前视角(connectedAddress)
 * → 视图模型」的唯一映射,与 React/wagmi/网络全无关——故抽成纯函数,在 node 环境用普通断言钉死
 * (本仓 vitest 无 testing-library,纯函数是唯一能单测的层;与 gameListReducer 同治理)。
 * useGame 只负责取数(readContract 快照 + getLogs 回放 + watchContractEvent 触发 refetch),
 * 把取来的 struct + events + 当前地址喂进 deriveGameView 得到视图模型,渲染层(Game.tsx 三幕、
 * 3.7 对战幕、3.8 结算幕)只读这个视图模型。
 *
 * 为什么「事件当刷新触发器、不做乐观 reducer」(plan 决策,记 DECISIONS):
 *   真理源是 getGame 的 struct(phase/turn/hits/pending 全在链上)。ShotResolved 事件用于两件事:
 *   (a) 回放出**坐标级**的 hit/miss 历史(struct 只给 hits 计数与 shotMap 位图,给不出「哪格 hit
 *   哪格 miss」——位图只标「打过」不标结果;坐标+结果只在 ShotResolved 事件里),(b) 当刷新/动效
 *   的触发器(收到事件 → useGame refetch struct)。我们**不**用事件去乐观推进 struct(turn/phase),
 *   因为那等于在前端重写一遍合约状态机,易与链上真值漂移。本地 anvil 无重组(no-reorg),事件不会
 *   被回滚,故「事件触发 refetch」这条简化是安全的(测试网若有重组需加确认数,届时再说,见注记)。
 *
 * 视角反应性(§7.1 demo killer feature):本函数对 connectedAddress 是纯函数——同一份 struct+events
 * 换一个地址进来,myIdx/isMyTurn/myShots/enemyShots 全翻转。故 P0↔P1 账户切换**无需 refetch**,
 * useAccount().address 一变,useGame 重算 deriveGameView 即得对手视角(同一局数据、不同立场)。
 */

import type { Address } from '../lib/contracts.ts';
import { formatCoord } from '../lib/format.ts';

/**
 * 合约 Phase enum(Design §6.1,顺序锁定;getGame 返回 uint8 即此序号)。
 * None=0 表对局不存在(gameId 从 1 起,games[0] 恒 None)。
 */
export const Phase = {
  None: 0,
  Created: 1,
  AwaitingAttack: 2,
  AwaitingResponse: 3,
  Finished: 4,
  Cancelled: 5,
} as const;
export type PhaseValue = (typeof Phase)[keyof typeof Phase];

/**
 * 当前幕(§7.1:同一路由按 phase 自动呈现三幕)。notfound 是 None(对局不存在)的去处。
 *   placement —— Created(等 p1 加入 / p1 布阵)
 *   battle    —— AwaitingAttack / AwaitingResponse(对战)
 *   finish    —— Finished / Cancelled(结算)
 *   notfound  —— None(无效 gameId / 尚未存在)
 */
export type Act = 'placement' | 'battle' | 'finish' | 'notfound';

/** 视角索引:0=我是 P0,1=我是 P1,'observer'=已连接但非本局任何一方,null=未连接。 */
export type MyIdx = 0 | 1 | 'observer' | null;

/** getGame 返回的链上快照(本层只取派生需要的字段;useGame 从合约 struct 投影)。 */
export type GameSnapshot = {
  p0: Address;
  p1: Address;
  commitment0: bigint;
  commitment1: bigint;
  phase: PhaseValue;
  /** 当前攻击方索引 0/1。 */
  turn: 0 | 1;
  pendingX: number;
  pendingY: number;
  /** hits[i] = 玩家 i 被命中数(到 17 即败)。 */
  hits: readonly [number, number];
  /**
   * shotMap[i] = 位图:玩家 i 的棋盘被打过哪些格(bit = y*10+x;合约 Game.shotMap)。
   * 语义(合约 D11,respond 成功时才置位):shotMap[i] 标的是「打在 i 棋盘上」的格子,
   * 故「我对敌开过炮的格」= shotMap[对手索引],「敌对我开过炮的格」= shotMap[我索引]。
   * 合约维持不变量「shotMap 置位数 == ShotResolved 事件数」(置位与 ShotResolved 同在 respond 发生),
   * 故 shotMap 派生的 firedCells 与 ShotResolved 回放出的 shots 覆盖同一批格(无谁领先谁的窗口;
   * 唯一领先两者的是 pendingShot——已 attack 未 respond 的 pending 格尚不在 shotMap/事件里,见 deriveGameView)。
   */
  shotMap: readonly [bigint, bigint];
  /** address(0) 表未决出;Finished/Cancelled 后为胜者(cancelled 为 zero)。 */
  winner: Address;
  /** 超时计时锚点(秒,链上 block.timestamp)。 */
  lastActionAt: number;
};

/**
 * 一次已应答的炮击(ShotResolved 回放的坐标级结果)。
 *   defender —— 被打方索引 0/1(= 这一炮打在谁的棋盘上);
 *   result   —— 0=未命中,1=命中;
 *   totalHits—— 该 ShotResolved 事件携带的「被打方累计命中数」(动效/进度可用)。
 */
export type ResolvedShot = {
  defender: 0 | 1;
  x: number;
  y: number;
  result: 0 | 1;
  totalHits: number;
};

/** 单格炮击标记(供对战幕渲染己方/敌方海域)。coord 是展示串(如 "D-7")。 */
export type ShotMark = {
  x: number;
  y: number;
  result: 0 | 1;
  coord: string;
};

/** 待应答炮击(仅 AwaitingResponse 有;attacker 开炮、defender 待应答)。 */
export type PendingShot = {
  x: number;
  y: number;
  coord: string;
  /** 开炮方索引(= turn)。 */
  attacker: 0 | 1;
  /** 应答义务方索引(= 1-turn)。 */
  defender: 0 | 1;
};

/**
 * useGame 暴露给渲染层的视图模型(3.7 对战 / 3.8 结算的消费契约)。
 * 全部从 snapshot + events + connectedAddress 派生;无任何 React 状态。
 */
export type GameView = {
  /** 当前幕(驱动 Game.tsx 的 switch)。 */
  act: Act;
  /** 原始 phase(渲染层个别处需要精确区分 AwaitingAttack vs AwaitingResponse)。 */
  phase: PhaseValue;
  /** 我的索引(0/1/observer/null)。 */
  myIdx: MyIdx;
  /** 我是否本局玩家(myIdx===0||1)。 */
  isPlayer: boolean;
  /** 对手地址(我是 P0→p1,我是 P1→p0;observer/null 或对手未定→undefined)。 */
  opponent: Address | undefined;
  /**
   * 当前轮到我行动吗(phase-aware,§4.2 回合流):
   *   AwaitingAttack   —— 义务方 = turn(攻击方)→ isMyTurn = (myIdx===turn)
   *   AwaitingResponse —— 义务方 = 1-turn(防守方,带应答义务)→ isMyTurn = (myIdx===1-turn)
   *   其它 phase / 非玩家 —— false
   * 这与合约 attack(NOT_TURN: msg.sender==turn 方)/ respond(NOT_DEFENDER: msg.sender==1-turn 方)
   * 的义务方判定逐位一致。
   */
  isMyTurn: boolean;
  /**
   * 当前行动义务方索引(0/1;非对战 phase 为 null)。= claimTimeout 里的 obligated。
   * AwaitingAttack→turn;AwaitingResponse→1-turn。供回合横幅「轮到 P0/P1」与超时归属用。
   */
  obligatedIdx: 0 | 1 | null;
  /**
   * 我方对敌开炮记录(= 我打在对手棋盘上的格,defender===opponentIdx 的 ShotResolved)。
   * 对战幕右侧「敌方声呐屏」渲染它(我的炮击落点 + hit/miss)。observer/null 时为空。
   */
  myShots: ShotMark[];
  /**
   * 敌方对我开炮记录(= 打在我棋盘上的格,defender===myIdx 的 ShotResolved)。
   * 对战幕左侧「己方海域」渲染它(对手炮击我的落点 + hit/miss)。observer/null 时为空。
   */
  enemyShots: ShotMark[];
  /**
   * 我对敌开过炮的格集合(链上 shotMap[对手索引] 展开,bit=y*10+x → 格序号)。observer/null 时为空集。
   * 用途(3.7 SonarBoard,§7.3):
   *   (a) isCellDisabled 判定 = `myFiredCells.has(y*10+x)`——已开炮的格不可再点(O(1) 查,
   *       比从 myShots 数组 O(n) 扫每格更直;且 shotMap 正是合约 REPEAT 守卫读的同一位图,是该判定的链上权威源)。
   *   (b) §7.3 REPEAT 前端预检:开炮前先 `myFiredCells.has(bit)`,命中即拦,省一次必 revert 的 attack 往返
   *       (合约 attack 的 REPEAT require 读的就是 shotMap[defender])。
   * 注:myFiredCells 与 myShots 覆盖同一批格(合约不变量 shotMap==ShotResolved,见 GameSnapshot.shotMap)。
   * 唯一差异在另一向:**pending 格**(我已 attack、对手未 respond)既不在 shotMap 也不在 myShots——
   * 若 SonarBoard 要连「在飞的 pending 格」也禁点,需在 myFiredCells 之外并上 pendingShot 坐标
   * (phase===AwaitingResponse 且我是 attacker 时,view.pendingShot 给出该坐标)。
   */
  myFiredCells: Set<number>;
  /**
   * 敌对我开过炮的格集合(链上 shotMap[我索引] 展开)。observer/null 时为空集。
   * 对称于 myFiredCells;3.7 己方海域可据此标「对手已探明的格」(与 enemyShots 同批,Set 形态便于 O(1) 命中查)。
   */
  enemyFiredCells: Set<number>;
  /**
   * 双方被命中数 [p0BeingHit, p1BeingHit](= snapshot.hits,原样透出;17 即败)。
   * 注意语义:hits[i] 是「玩家 i **被**命中」数,不是「玩家 i 打中对手」数。
   */
  hits: readonly [number, number];
  /** 我被命中数 / 对手被命中数(从 hits 按 myIdx 取;observer/null 时 undefined)。 */
  myHits: number | undefined;
  opponentHits: number | undefined;
  /**
   * 我的链上承诺(myIdx===0→commitment0,===1→commitment1;observer/null→undefined)。
   * 3.7 useAutoRespond 据此校验 storage 还原的棋盘+salt 是否对得上链上承诺
   * (verifyBoardCommitment(ships, salt, myCommitment));防用错局/错棋盘的存档去应答。
   */
  myCommitment: bigint | undefined;
  /** 对手链上承诺(myIdx===0→commitment1,===1→commitment0;observer/null→undefined)。对称暴露,3.7 备用。 */
  opponentCommitment: bigint | undefined;
  /** 待应答炮击(仅 AwaitingResponse;否则 null)。 */
  pendingShot: PendingShot | null;
  /**
   * 待我应答吗(AwaitingResponse 且我是防守方)。3.7 useAutoRespond 据此触发自动应答。
   * = isMyTurn && phase===AwaitingResponse(义务方在 AwaitingResponse 即防守方)。
   */
  pendingShotIsForMe: boolean;
  /** 胜者地址(Finished/Cancelled;未决出 / cancelled 为 zero address → undefined)。 */
  winner: Address | undefined;
  /** 我是否赢了(winner===我的地址;非玩家 / 未决出 → false)。 */
  iWon: boolean;
  /** 对局是否取消(Cancelled:phase 是 Cancelled,且 winner 为 zero)。 */
  isCancelled: boolean;
  /** 超时锚点(秒);供 3.7/3.8 倒计时(本任务不渲染倒计时)。 */
  lastActionAt: number;
};

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

/** 地址相等(EIP-55 大小写不敏感;链上比较按小写)。 */
function addrEq(a: Address | undefined, b: Address | undefined): boolean {
  if (!a || !b) return false;
  return a.toLowerCase() === b.toLowerCase();
}

/** address 是否非零(决出胜者 / 玩家已就位)。 */
function isNonZero(a: Address | undefined): boolean {
  return !!a && a.toLowerCase() !== ZERO_ADDRESS;
}

/** phase 序号 → 幕。 */
export function phaseToAct(phase: PhaseValue): Act {
  switch (phase) {
    case Phase.None:
      return 'notfound';
    case Phase.Created:
      return 'placement';
    case Phase.AwaitingAttack:
    case Phase.AwaitingResponse:
      return 'battle';
    case Phase.Finished:
    case Phase.Cancelled:
      return 'finish';
    default:
      // 未知 phase 序号(理论不达,合约 enum 固定 6 个)——保守归 notfound。
      return 'notfound';
  }
}

/**
 * 我的索引:连过且 ===p0 → 0;===p1 → 1;已连但都不是且对局有玩家 → 'observer';未连 → null。
 * p1 可能是 zero address(Created 期间还没人加入):此时非 p0 的已连地址既不是玩家、对局也还没满,
 * 归类为 'observer'(在 placement 幕,Game.tsx 据「非 p0 且非 p1」让其进 join 模式,不依赖此 observer 标)。
 */
export function computeMyIdx(
  connectedAddress: Address | undefined,
  p0: Address,
  p1: Address,
): MyIdx {
  if (!connectedAddress) return null;
  if (addrEq(connectedAddress, p0)) return 0;
  if (addrEq(connectedAddress, p1)) return 1;
  return 'observer';
}

/**
 * 派生视图模型(纯函数)。snapshot 为 null 表「struct 尚未取到」——调用方(useGame)在 loading
 * 阶段不会调本函数(返回 loading 态),故本函数只处理「已有 snapshot」的情形;snapshot 一定非 null。
 *
 * @param snapshot getGame 投影出的链上快照
 * @param shots ShotResolved 回放出的坐标级结果(到达顺序无关:本函数只按 defender 分组,不依赖序)
 * @param connectedAddress 当前 wagmi active 账户地址(视角)
 */
export function deriveGameView(
  snapshot: GameSnapshot,
  shots: readonly ResolvedShot[],
  connectedAddress: Address | undefined,
): GameView {
  const { p0, p1, commitment0, commitment1, phase, turn, pendingX, pendingY, hits, shotMap, winner, lastActionAt } =
    snapshot;

  const act = phaseToAct(phase);
  const myIdx = computeMyIdx(connectedAddress, p0, p1);
  const isPlayer = myIdx === 0 || myIdx === 1;

  // 对手:我是 0→p1,我是 1→p0;p1 可能尚为 zero(未加入)→ 视为 undefined。
  let opponent: Address | undefined;
  if (myIdx === 0) opponent = isNonZero(p1) ? p1 : undefined;
  else if (myIdx === 1) opponent = isNonZero(p0) ? p0 : undefined;

  // 行动义务方(§4.2):AwaitingAttack→turn,AwaitingResponse→1-turn;其它 phase 无义务方。
  let obligatedIdx: 0 | 1 | null = null;
  if (phase === Phase.AwaitingAttack) obligatedIdx = turn;
  else if (phase === Phase.AwaitingResponse) obligatedIdx = (1 - turn) as 0 | 1;

  const isMyTurn =
    isPlayer && obligatedIdx !== null && (myIdx as 0 | 1) === obligatedIdx;

  // 炮击历史按「打在谁棋盘上」分组:defender===myIdx → 敌人打我(enemyShots,己方海域);
  // defender===对手 → 我打敌人(myShots,敌方声呐屏)。observer/null 时两者皆空(无「我方」立场)。
  const myShots: ShotMark[] = [];
  const enemyShots: ShotMark[] = [];
  // 已开炮位图 → 格集合(链上 shotMap;见类型注释:shotMap[对手]=我开过炮的格,shotMap[我]=敌开过炮的格)。
  // observer/null 无「我方」立场,两集合皆空(SonarBoard 不会在旁观态拿它做禁点)。
  let myFiredCells = new Set<number>();
  let enemyFiredCells = new Set<number>();
  if (isPlayer) {
    const me = myIdx as 0 | 1;
    const foe = (1 - me) as 0 | 1;
    for (const s of shots) {
      const mark: ShotMark = { x: s.x, y: s.y, result: s.result, coord: safeCoord(s.x, s.y) };
      if (s.defender === foe) myShots.push(mark);
      else if (s.defender === me) enemyShots.push(mark);
    }
    myFiredCells = expandShotMap(shotMap[foe]);
    enemyFiredCells = expandShotMap(shotMap[me]);
  }

  const myHits = isPlayer ? hits[myIdx as 0 | 1] : undefined;
  const opponentHits = isPlayer ? hits[(1 - (myIdx as 0 | 1)) as 0 | 1] : undefined;
  // 承诺按视角取:myIdx 0→commitment0、1→commitment1;observer/null→undefined(无「我的承诺」)。
  const commitments: readonly [bigint, bigint] = [commitment0, commitment1];
  const myCommitment = isPlayer ? commitments[myIdx as 0 | 1] : undefined;
  const opponentCommitment = isPlayer ? commitments[(1 - (myIdx as 0 | 1)) as 0 | 1] : undefined;

  // 待应答炮击(仅 AwaitingResponse):attacker=turn,defender=1-turn。
  let pendingShot: PendingShot | null = null;
  if (phase === Phase.AwaitingResponse) {
    pendingShot = {
      x: pendingX,
      y: pendingY,
      coord: safeCoord(pendingX, pendingY),
      attacker: turn,
      defender: (1 - turn) as 0 | 1,
    };
  }
  const pendingShotIsForMe =
    pendingShot !== null && isPlayer && (myIdx as 0 | 1) === pendingShot.defender;

  const winnerOut = isNonZero(winner) ? winner : undefined;
  const iWon = isPlayer && addrEq(winner, connectedAddress);
  // 取消:phase===Cancelled(winner 为 zero,故不能只看 winner 缺失——Finished 也可能尚未读到 winner)。
  const isCancelled = phase === Phase.Cancelled;

  return {
    act,
    phase,
    myIdx,
    isPlayer,
    opponent,
    isMyTurn,
    obligatedIdx,
    myShots,
    enemyShots,
    myFiredCells,
    enemyFiredCells,
    hits,
    myHits,
    opponentHits,
    myCommitment,
    opponentCommitment,
    pendingShot,
    pendingShotIsForMe,
    winner: winnerOut,
    iWon,
    isCancelled,
    lastActionAt,
  };
}

/**
 * shotMap 位图(bigint)→ 已置位的格序号集合(bit i 置位 → i ∈ 结果,i = y*10+x,范围 0..99)。
 * 纯函数,只扫 100 位(棋盘 10×10 恒 100 格);高于 99 的位理论不会被合约置位(坐标 require x<10&&y<10),
 * 故只扫 0..99 即覆盖全部合法格,越界脏位被忽略(不会污染禁点判定)。
 * 用 BigInt 移位逐位取(>> BigInt(i) & 1n);Set 便于 SonarBoard O(1) 命中查(has(y*10+x))。
 */
export function expandShotMap(bitmap: bigint): Set<number> {
  const cells = new Set<number>();
  for (let i = 0; i < 100; i++) {
    if (((bitmap >> BigInt(i)) & 1n) === 1n) cells.add(i);
  }
  return cells;
}

/**
 * 坐标 → 展示串,越界容错(回放数据理论恒在界,但事件解码异常 / 坏数据不该让整个派生抛——
 * 派生层对脏坐标降级为 "?-?" 而非 throw,保持视图可渲染)。formatCoord 对界内坐标给 "D-7"。
 */
function safeCoord(x: number, y: number): string {
  try {
    return formatCoord(x, y);
  } catch {
    return '?-?';
  }
}
