/**
 * 大厅「进行中对局列表」的纯事件归约(Design §7.1:扫事件重建 + watchContractEvent 增量;§10
 * indexer-less:只扫最近 N 万块 / 本地从 deployBlock 起)。
 *
 * 为什么抽成纯函数(不混进 useGameList 的 React/wagmi 代码):列表的真理是「把一串合约事件按
 * gameId 折叠成当前状态」,这一步与 React、wagmi、网络全无关,是可被单测钉死的状态机。把它独立
 * 出来 → useGameList 只负责「取事件(getLogs 回填 + watchContractEvent 增量)→ 喂给本归约 → 渲染」,
 * 归约逻辑本身在 node 环境用普通断言覆盖(本仓 vitest 是 node 环境、无 testing-library,见 vitest.config)。
 *
 * 事件来源(Design §6.4,前端唯一数据源):
 *   GameCreated(gameId, p0)            —— 新局诞生,p0=创建者,此刻 status='waiting'(等对手)
 *   GameJoined(gameId, p1)             —— 对手入局,status 升到 'active'(对战中)
 *   GameFinished(gameId, winner, reason) —— 终局,status='finished'(从「进行中」列表剔除)
 * ShotFired / ShotResolved 不影响列表归类(那是对战幕的事),本归约忽略。
 *
 * 归类(GameStatus):
 *   waiting  —— 已 created、未 joined、未 finished(大厅可加入的目标)
 *   active   —— 已 joined、未 finished(对战进行中)
 *   finished —— 已 finished(cancelled 也走 GameFinished,reason='cancelled')
 *
 * 顺序无关性:事件可能乱序到达(getLogs 批量 + watchContractEvent 增量交错,甚至同块多事件)。
 * 本归约对**到达顺序不敏感**——它只按「是否见过某类事件」单调升级 status(created→joined→finished),
 * 不依赖先后;唯一序信息是 (blockNumber, logIndex) 仅用于**展示排序**(最新在前)与去重,不参与归类。
 */

import type { Address } from '../lib/contracts.ts';

/** 列表条目的归类状态。 */
export type GameStatus = 'waiting' | 'active' | 'finished';

/**
 * 归约所认的最小事件形态(从 viem 解析出的日志投影到这几个字段;useGameList 负责把
 * watchContractEvent / getLogs 的 log 映射成本形态)。pos = (blockNumber, logIndex) 用于
 * 排序与去重,均为链上单调序;同一条 log 的 pos 唯一。
 */
export type GameEvent =
  | { kind: 'created'; gameId: bigint; p0: Address; pos: EventPos }
  | { kind: 'joined'; gameId: bigint; p1: Address; pos: EventPos }
  | { kind: 'finished'; gameId: bigint; winner: Address; reason: string; pos: EventPos };

/** 链上事件位置:用于稳定排序(块号→块内序)与跨批去重。 */
export type EventPos = {
  blockNumber: bigint;
  logIndex: number;
};

/** 折叠后的单局视图(渲染用)。 */
export type GameRow = {
  gameId: bigint;
  p0?: Address;
  p1?: Address;
  status: GameStatus;
  winner?: Address;
  /** 该局「最早可见事件」的位置(= GameCreated 的位置);用于列表排序(最新创建在前)。 */
  createdPos?: EventPos;
};

/** pos 比较:blockNumber 优先,其次 logIndex。a<b 返回负。 */
function cmpPos(a: EventPos, b: EventPos): number {
  if (a.blockNumber !== b.blockNumber) return a.blockNumber < b.blockNumber ? -1 : 1;
  return a.logIndex - b.logIndex;
}

/**
 * 把一条事件折叠进 row(单调升级 status;记录 p0/p1/winner/createdPos)。
 * 返回新 row(不可变更新,便于 React 浅比较)。已是 finished 的局不再被 created/joined 降级
 * (理论不会发生——finished 是终态、晚于其它事件;但防御性保证终态不可逆)。
 */
function applyEvent(prev: GameRow | undefined, ev: GameEvent): GameRow {
  const base: GameRow = prev ?? { gameId: ev.gameId, status: 'waiting' };
  switch (ev.kind) {
    case 'created': {
      // created 携带 p0 与「创建位置」。created 不把已 active/finished 的局拉回 waiting:
      // 只在尚未升级时设 waiting(status 单调,见下方合并优先级)。
      return {
        ...base,
        p0: ev.p0,
        createdPos: base.createdPos ?? ev.pos,
        status: base.status === 'waiting' ? 'waiting' : base.status,
      };
    }
    case 'joined': {
      // joined → active,除非已 finished(终态不可逆)。
      return {
        ...base,
        p1: ev.p1,
        status: base.status === 'finished' ? 'finished' : 'active',
      };
    }
    case 'finished': {
      return {
        ...base,
        status: 'finished',
        winner: ev.winner,
      };
    }
  }
}

/**
 * 纯归约:一串事件 → 按 gameId 折叠的 row 表(Map,gameId→GameRow)。
 *
 * 关键性质:
 *   - 顺序无关:status 只单调升级(waiting→active→finished),applyEvent 不因到达顺序回退;
 *     故无论事件乱序与否,终态一致。
 *   - 幂等:同一条 log 多次喂入结果不变(回填批与 watch 增量可能重叠同一 log)。
 *   - 去重由调用方按 pos 负责(useGameList 用 Set<pos key> 拦重复 log);本函数对重复事件也幂等,
 *     双保险。
 */
export function reduceGameEvents(events: Iterable<GameEvent>): Map<string, GameRow> {
  const byId = new Map<string, GameRow>();
  for (const ev of events) {
    const key = ev.gameId.toString();
    byId.set(key, applyEvent(byId.get(key), ev));
  }
  return byId;
}

/**
 * 「进行中对局列表」最终形态(Design §7.1:进行中 = waiting + active,finished 不展示)。
 * 排序:**最新创建在前**(createdPos 倒序;无 createdPos 的——理论不该有,仅当只见到 joined/finished
 * 而漏了 created——按 gameId 倒序兜底)。
 *
 * @param byId reduceGameEvents 的结果
 * @returns 仅含 waiting/active 的 row,最新在前
 */
export function toInProgressList(byId: Map<string, GameRow>): GameRow[] {
  const rows = [...byId.values()].filter(
    (r) => r.status === 'waiting' || r.status === 'active',
  );
  rows.sort((a, b) => {
    if (a.createdPos && b.createdPos) return -cmpPos(a.createdPos, b.createdPos); // 倒序:新在前
    if (a.createdPos) return -1; // 有创建位的排前
    if (b.createdPos) return 1;
    return a.gameId < b.gameId ? 1 : a.gameId > b.gameId ? -1 : 0; // 兜底:gameId 倒序
  });
  return rows;
}

/** 便捷组合:事件流 → 进行中列表(reduce + 过滤排序一步到位)。 */
export function buildInProgressList(events: Iterable<GameEvent>): GameRow[] {
  return toInProgressList(reduceGameEvents(events));
}
