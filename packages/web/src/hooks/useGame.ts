/**
 * useGame —— 单局相位驱动数据钩子(Design §4 状态机 + §7.1 三幕同路由 + §7.3 事件日志)。
 *
 * 分层(与 gameView.ts 的纯派生核严格分工):
 *   - 取数(本文件,React/wagmi):
 *       (a) readContract `getGame(gameId)` → 投影成 GameSnapshot(链上真理源 struct);
 *       (b) getLogs `ShotResolved` 从 deployBlock 回放 → ResolvedShot[](坐标级 hit/miss);
 *           顺带回放 GameJoined/GameFinished/ShotFired 进**事件日志池**(§7.3,供 3.7 战报流);
 *       (c) watchContractEvent ×4(ShotFired/ShotResolved/GameJoined/GameFinished)增量:
 *           事件到达 → **触发 refetch**(重取 getGame + ShotResolved)+ 追加事件日志。
 *   - 派生(gameView.ts,纯函数):deriveGameView(snapshot, shots, address) → GameView,渲染层只读它。
 *
 * 「事件当刷新触发器、不做乐观 reducer」(决策,与 gameView.ts 模块注释同源,记 DECISIONS):
 *   真理源是 getGame 的 struct(phase/turn/hits/pending 全在链上)。事件只用于两件事——
 *   (a) ShotResolved 回放出 struct 给不出的坐标级 hit/miss(struct 只有 hits 计数 + shotMap 位图,
 *       位图只标「打过」不标结果;哪格 hit 哪格 miss 只在事件里),(b) 当刷新/动效触发器。
 *   我们**不**用事件去乐观推进 struct(turn/phase),那等于在前端重写一遍合约状态机、易与链上漂移。
 *   本地 anvil 无重组(no-reorg),事件不被回滚,故「事件触发 refetch」这条简化安全(测试网若有
 *   重组需加确认数,届时在 watch 层加;派生层与本取数层都无需改)。
 *
 * 账户切换**零 refetch**(§7.1 killer feature,本钩子的关键不变量):
 *   取数 effect 的依赖是 [gameId, deployment, publicClient, refetchVersion]——**刻意不含 address**。
 *   deriveGameView 对 address 是纯函数:同一份 snapshot+shots 换一个地址进来,myIdx/isMyTurn/
 *   my-enemy shots/hits 全翻转。故 P0↔P1 切换只让 useMemo([snapshot,shots,address]) 重算,
 *   **不触发任何网络**——整页从同一份链上数据翻成对手视角。若把 address 列进取数 effect,
 *   每次切账户会白白重拉一遍 struct + 全部日志,既慢又违背「同一局、不同立场」的本意。
 *
 * 稳定 watch 回调(3.4 useGameList I1 的同款纪律,见该文件注释):
 *   wagmi 的 useWatchContractEvent 把 onLogs 列进 effect 依赖(viem observerId 去重键却不含 onLogs):
 *   onLogs 每渲染换身份 → 订阅拆毁重建(uninstallFilter + 重新 createFilter),新 filter 有一个轮询
 *   周期的空窗可能漏事件。故 bumpRefetch / ingestLog / 四个 onLogs 全用 useCallback 钉死身份,
 *   订阅各只挂一次、跨事件存活。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { AbiEvent, Log } from 'viem';
import { useAccount, usePublicClient, useWatchContractEvent } from 'wagmi';
import { battleshipAbi } from '../lib/abi.ts';
import {
  DeploymentNotFoundError,
  type Address,
  type Deployment,
  loadDeployment,
  reloadDeployment,
} from '../lib/contracts.ts';
import {
  deriveGameView,
  Phase,
  type GameSnapshot,
  type GameView,
  type PhaseValue,
  type ResolvedShot,
} from './gameView.ts';

/** ShotResolved 的 AbiEvent 常量(getLogs 的 event 参数;从 abi 取一次)。 */
const EVENT_SHOT_RESOLVED = battleshipAbi.find(
  (x) => x.type === 'event' && x.name === 'ShotResolved',
) as AbiEvent;

/**
 * 单局事件日志项(§7.3 战报流的最小投影,append-only)。
 * 本任务(3.6)只用到计数与回合驱动,3.7 战报幕据此渲染逐条流水(故 ts/coord 一并留好)。
 */
export type GameLogEntry = {
  /** 事件类型(决定文案)。 */
  kind: 'joined' | 'fired' | 'resolved' | 'finished';
  /** 链上块号:块内序(唯一定位 + 排序键)。 */
  pos: { blockNumber: bigint; logIndex: number };
  /**
   * 该事件所在块的墙钟时间(unix 秒,= block.timestamp)。§7.3 战报流渲染 `▸ HH:MM:SS …`(format.formatLogTime)。
   * 块号 ≠ 墙钟,故必须查块取时间;按块号 memo(同块只查一次)。回填历史与 live 事件统一据此取真实墙钟
   * (用 Date.now() 入池对回填是错的——那是「读到的时刻」不是「上链时刻」)。getBlock 失败时本字段缺省
   * (undefined):条目仍按 pos 出现,渲染层只是不显示 HH:MM:SS(降级而非丢事件)。
   */
  ts?: number;
  /** 攻击/防守方索引(fired=attacker,resolved=defender)。 */
  side?: 0 | 1;
  x?: number;
  y?: number;
  /** resolved:0=未命中 1=命中。 */
  result?: 0 | 1;
  /** resolved:被打方累计命中数。 */
  totalHits?: number;
  /** joined:加入者地址。 */
  p1?: Address;
  /** finished:胜者地址 + 原因("17hits"/"timeout"/"cancelled")。 */
  winner?: Address;
  reason?: string;
};

/** useGame 返回。view=派生视图模型(notfound/loading 时为 null);eventLog=战报流(§7.3,3.7 用)。 */
export type UseGameResult = {
  /** 派生视图模型;加载中 / 未找到 / 出错时为 null(用下面三个布尔区分)。 */
  view: GameView | null;
  /** 首次快照尚未取到(struct 还在路上)。 */
  isLoading: boolean;
  /** 对局不存在(getGame 返回 phase None;无效 gameId / 尚未创建)。 */
  isNotFound: boolean;
  /** 取数错误的人话文案(部署未就绪 / RPC 失败);null 表无错。 */
  error: string | null;
  /** 事件日志(append-only,按 pos 升序;§7.3 战报流,3.7 渲染)。 */
  eventLog: GameLogEntry[];
  /** 手动重取(一般不需要——watch 会自动刷新;留作逃生口)。 */
  refetch: () => void;
};

/** ShotResolved log → ResolvedShot(派生层输入)。坏 log(缺字段)返回 null 被滤掉。 */
export function toResolvedShot(log: ShotResolvedLog): ResolvedShot | null {
  const a = log.args;
  if (a.defender == null || a.x == null || a.y == null || a.result == null) return null;
  return {
    defender: (a.defender === 1 ? 1 : 0) as 0 | 1,
    x: Number(a.x),
    y: Number(a.y),
    result: (a.result === 1 ? 1 : 0) as 0 | 1,
    totalHits: Number(a.totalHits ?? 0),
  };
}

/** 任意已解码 log → GameLogEntry(四类各取所需;非这四类 / 缺 pos 返回 null)。 */
export function toLogEntry(log: DecodedLog): GameLogEntry | null {
  if (log.blockNumber == null || log.logIndex == null) return null;
  const pos = { blockNumber: log.blockNumber, logIndex: log.logIndex };
  const a = log.args;
  switch (log.eventName) {
    case 'GameJoined':
      return a.p1 ? { kind: 'joined', pos, p1: a.p1 } : null;
    case 'ShotFired':
      return a.attacker != null
        ? { kind: 'fired', pos, side: (a.attacker === 1 ? 1 : 0) as 0 | 1, x: Number(a.x), y: Number(a.y) }
        : null;
    case 'ShotResolved':
      return a.defender != null
        ? {
            kind: 'resolved',
            pos,
            side: (a.defender === 1 ? 1 : 0) as 0 | 1,
            x: Number(a.x),
            y: Number(a.y),
            result: (a.result === 1 ? 1 : 0) as 0 | 1,
            totalHits: Number(a.totalHits ?? 0),
          }
        : null;
    case 'GameFinished':
      return a.winner != null
        ? { kind: 'finished', pos, winner: a.winner, reason: a.reason ?? '' }
        : null;
    default:
      return null;
  }
}

/** viem decode 后 ShotResolved 的形状(args 由 abi 推断,这里收窄到本钩子用到的字段)。 */
type ShotResolvedLog = Log & {
  args: { defender?: number; x?: number; y?: number; result?: number; totalHits?: number };
};

/** viem decode 后四类事件 args 的并集(toLogEntry 按 eventName 分流)。 */
type DecodedLog = Log & {
  eventName?: string;
  args: {
    defender?: number;
    attacker?: number;
    x?: number;
    y?: number;
    result?: number;
    totalHits?: number;
    p1?: Address;
    winner?: Address;
    reason?: string;
  };
};

/** posKey:同一条 log 唯一键(块号:块内序);回填批与 watch 增量重叠时据此去重。 */
function posKey(blockNumber: bigint, logIndex: number): string {
  return `${blockNumber.toString()}:${logIndex}`;
}

/** 事件日志池排序(按 pos 升序:块号优先,同块内按 logIndex)——append-only 时间序。 */
export function comparePos(a: GameLogEntry, b: GameLogEntry): number {
  if (a.pos.blockNumber !== b.pos.blockNumber) {
    return a.pos.blockNumber < b.pos.blockNumber ? -1 : 1;
  }
  return a.pos.logIndex - b.pos.logIndex;
}

/** uint8 phase → PhaseValue(越界 / 非 0–5 归 None,保守当不存在;理论不达,enum 固定 6 个)。 */
export function toPhase(raw: number): PhaseValue {
  return raw >= Phase.None && raw <= Phase.Cancelled ? (raw as PhaseValue) : Phase.None;
}

/** 只需「块号是否在内」的最小结构(Set 与 Map 都满足:两者的 has(bigint) 同签名)——避免 enrich 每趟新建 Set。 */
type HasBlock = { has(bn: bigint): boolean };

/**
 * 块时间 memo 的纯核(可单测)——从一批条目里挑出「还没缓存块时间、也不在取数中」的去重块号。
 * 这是「同块只查一次 getBlock」省流的判定:已缓存(timed.has)或正在取(inFlight.has)的块都跳过,
 * 故 33 事件全程对每个**唯一块**只发一次 getBlock(回填一把 + 每条 live 事件 1 块)。
 *
 * @param entries 当前事件池里的条目
 * @param timed   已缓存块时间的块号(传 blockTimeRef Map 即可——只用其 has;Map.has(blockNumber) 命中即已缓存)
 * @param inFlight 正在 getBlock 中的块号集合(防并发重取)
 * @returns 需要发起 getBlock 的去重块号(升序,稳定便于测试)
 */
export function collectUntimedBlocks(
  entries: Iterable<GameLogEntry>,
  timed: HasBlock,
  inFlight: HasBlock,
): bigint[] {
  const need = new Set<bigint>();
  for (const e of entries) {
    const bn = e.pos.blockNumber;
    if (!timed.has(bn) && !inFlight.has(bn)) need.add(bn);
  }
  return [...need].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

/**
 * 块时间 memo 的纯核(可单测)——把已知块时间贴到条目上(读时套用,不改池内条目)。
 * 块号在 timeMap 里 → 写 ts;不在(getBlock 未完成 / 失败)→ ts 缺省(条目仍返回,渲染层降级不显时间)。
 * 返回新对象数组(不 mutate 入参条目),故池内条目恒为「无 ts 的原始投影」,ts 只在输出层附加。
 */
export function applyBlockTimes(
  entries: readonly GameLogEntry[],
  timeMap: ReadonlyMap<bigint, number>,
): GameLogEntry[] {
  return entries.map((e) => {
    const ts = timeMap.get(e.pos.blockNumber);
    return ts === undefined ? e : { ...e, ts };
  });
}

/**
 * getGame 解码出的 struct(viem 对命名 tuple 给对象;字段名与 ABI components 同名)→ GameSnapshot。
 * uint8→number、地址原样(0x 串)、uint256 承诺/shotMap 保持 bigint、turn 收窄 0/1。
 * shotMap[2](位图,uint256[2])原样保 bigint 透出:派生层据此给「已开炮格集合」(3.7 SonarBoard 禁点
 * + §7.3 REPEAT 前端预检)。坐标级 hit/miss 仍走 ShotResolved 事件(位图只标「打过」不标哪格 hit)。
 */
export function projectSnapshot(g: GetGameResult): GameSnapshot {
  return {
    p0: g.p0,
    p1: g.p1,
    commitment0: g.commitment0,
    commitment1: g.commitment1,
    phase: toPhase(Number(g.phase)),
    turn: (Number(g.turn) === 1 ? 1 : 0) as 0 | 1,
    pendingX: Number(g.pendingX),
    pendingY: Number(g.pendingY),
    hits: [Number(g.hits[0]), Number(g.hits[1])] as [number, number],
    shotMap: [BigInt(g.shotMap[0]), BigInt(g.shotMap[1])] as [bigint, bigint],
    winner: g.winner,
    lastActionAt: Number(g.lastActionAt),
  };
}

/** getGame 返回的 Game 结构体形状(viem 据 as-const abi 推断为命名对象;此处显式收窄供投影)。 */
export type GetGameResult = {
  p0: Address;
  p1: Address;
  commitment0: bigint;
  commitment1: bigint;
  phase: number;
  turn: number;
  pendingX: number;
  pendingY: number;
  hits: readonly [number, number];
  shotMap: readonly [bigint, bigint];
  lastActionAt: bigint;
  winner: Address;
};

/**
 * useGame(gameId) —— 取单局 struct + ShotResolved 回放 + 增量订阅,喂 deriveGameView 出视图模型。
 * gameId<=0(无效路由,如 /game/0 或 NaN)直接 notfound(不打网络)。
 */
export function useGame(gameId: number): UseGameResult {
  const publicClient = usePublicClient();
  const { address } = useAccount();

  const [deployment, setDeployment] = useState<Deployment | null>(null);
  const [snapshot, setSnapshot] = useState<GameSnapshot | null>(null);
  const [shots, setShots] = useState<ResolvedShot[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // refetchVersion:watch 收到事件 / 手动 refetch 时 +1,触发取数 effect 重跑(重取 struct+shots)。
  const [refetchVersion, setRefetchVersion] = useState(0);
  // I3:重取去抖定时器(尾触发)。一阵密集事件(WS 重连回放、相邻块 attack→respond)会连发多次 bump,
  // 每次都从 deployBlock 全量重扫一遍 struct+logs;尾触发 debounce 把一阵 bump 并成一次重取。
  const refetchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 事件日志池(ref:不触发渲染);logVersion 驱动 useMemo 重排成有序数组。
  const logPoolRef = useRef<Map<string, GameLogEntry>>(new Map());
  const [logVersion, setLogVersion] = useState(0);

  // 块时间 memo(§7.3):blockNumber → block.timestamp(unix 秒),同块只查一次 getBlock(永不重取);
  // inFlight 防并发重取同块;blockTimeVersion 在缓存填充后 +1,驱动 eventLog memo 重套 ts。
  const blockTimeRef = useRef<Map<bigint, number>>(new Map());
  const inFlightBlocksRef = useRef<Set<bigint>>(new Set());
  const [blockTimeVersion, setBlockTimeVersion] = useState(0);

  const validId = Number.isInteger(gameId) && gameId > 0;

  /**
   * 触发重取(尾触发 debounce,I3)。**身份稳定是必须的**——它被四个 onLogs 闭包,onLogs 又喂给
   * useWatchContractEvent(把 onLogs 列进 effect 依赖),不稳定即每事件触发订阅拆毁重建(3.4 I1 同因)。
   * useCallback([]) + 定时器存 ref → 身份恒定:每次 bump 清掉上一个待触发定时器、重排一个 60ms 的,
   * 一阵密集 bump 收敛成最后一次,60ms 静默后才真正 setRefetchVersion(+1)触发一次重取。
   *
   * 对 stale-guard 无影响:debounce 只降低 bump 频率,每次真正 bump 仍触发恰一次取数 effect、各带自己的
   * alive 旗(见取数 effect);并未改变「新一轮取数作废上一轮」的语义,故不复杂化 stale-guard(任务给的豁免条件不触发)。
   */
  const bumpRefetch = useCallback(() => {
    if (refetchTimerRef.current !== null) clearTimeout(refetchTimerRef.current);
    refetchTimerRef.current = setTimeout(() => {
      refetchTimerRef.current = null;
      setRefetchVersion((v) => v + 1);
    }, 60);
  }, []);

  // 卸载时清掉待触发的重取定时器(防 setState-after-unmount 与定时器泄漏)。
  useEffect(() => {
    return () => {
      if (refetchTimerRef.current !== null) clearTimeout(refetchTimerRef.current);
    };
  }, []);

  /** 把若干日志项灌入池(按 posKey 去重),有新增才 bump logVersion。同 bumpRefetch 稳定身份。 */
  const ingestLog = useCallback((entries: (GameLogEntry | null)[]) => {
    let changed = false;
    for (const e of entries) {
      if (!e) continue;
      const key = posKey(e.pos.blockNumber, e.pos.logIndex);
      if (!logPoolRef.current.has(key)) {
        logPoolRef.current.set(key, e);
        changed = true;
      }
    }
    if (changed) setLogVersion((v) => v + 1);
  }, []);

  // 手动重取走同一条(debounced)路径:逃生口几乎用不到,延后 60ms 无感,不另开一条立即路径。
  const refetch = useCallback(() => bumpRefetch(), [bumpRefetch]);

  // 部署信息(地址 + deployBlock);曾失败(demo 后启)则 reload 重取一次。失败 → DeploymentNotFoundError 文案。
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        let d: Deployment;
        try {
          d = await loadDeployment();
        } catch {
          d = await reloadDeployment();
        }
        if (alive) setDeployment(d);
      } catch (e) {
        if (!alive) return;
        // §3.1:部署未就绪 → 顶层展示「请先跑 pnpm demo」。
        setError(e instanceof DeploymentNotFoundError ? e.message : '加载部署信息失败。');
        setIsLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  // 无效 gameId:不打网络,直接结束 loading(下游据 snapshot===null && !isLoading && validId===false → notfound)。
  useEffect(() => {
    if (!validId) setIsLoading(false);
  }, [validId]);

  // ── 取数:getGame struct + ShotResolved 回放(并日志回填)。──
  // 依赖**刻意不含 address**(见模块注释:账户切换零 refetch)。refetchVersion 变即重取(watch 触发)。
  //
  // I1 关键路径拆分(对齐 useGameList「getLogs 失败非致命」的既定先例):
  //   关键路径 = getGame(真理源 struct)+ ShotResolved 回放(载荷:驱动 myShots/enemyShots 与
  //   firedCells 派生)——这两者任一失败 → 整钩 error(view=null,顶层报错),因为缺了它们视图不成立。
  //   非致命 = GameJoined/ShotFired/GameFinished 三类**装饰性事件日志**回填(§7.3 战报流):
  //   它们只喂事件日志池(逐条流水),缺了不影响对局可玩/可看,且 live watch 仍会从此刻起捕获新事件。
  //   故这三类用 Promise.allSettled 各自独立——任一 reject 只是少一段历史流水,不拖垮一个有效的 getGame。
  //   (此前是 5 个 getLogs 同一 Promise.all:任一 getLogs reject 即整页 error,白丢一个合法 struct。)
  useEffect(() => {
    if (!validId || !deployment || !publicClient) return;
    let alive = true;
    const fromBlock = BigInt(deployment.deployBlock);
    const logsFor = (name: string) =>
      publicClient.getLogs({
        address: deployment.battleship,
        event: battleshipAbi.find((x) => x.type === 'event' && x.name === name) as AbiEvent,
        args: { gameId: BigInt(gameId) },
        fromBlock,
        toBlock: 'latest',
      });
    (async () => {
      try {
        // ── 关键路径:struct + ShotResolved 并发(任一失败即抛 → catch → error)。──
        const [game, resolvedLogs] = await Promise.all([
          publicClient.readContract({
            address: deployment.battleship,
            abi: battleshipAbi,
            functionName: 'getGame',
            args: [BigInt(gameId)],
          }),
          publicClient.getLogs({
            address: deployment.battleship,
            event: EVENT_SHOT_RESOLVED,
            args: { gameId: BigInt(gameId) },
            fromBlock,
            toBlock: 'latest',
          }),
        ]);
        if (!alive) return;
        setSnapshot(projectSnapshot(game as unknown as GetGameResult));
        setShots(
          (resolvedLogs as ShotResolvedLog[])
            .map(toResolvedShot)
            .filter((s): s is ResolvedShot => s !== null),
        );
        // ShotResolved 也进日志池(resolved 流水);它属关键路径,已取到,恒入池。
        ingestLog((resolvedLogs as DecodedLog[]).map(toLogEntry));
        setError(null);
        setIsLoading(false);

        // ── 非致命:三类装饰性事件日志各自独立回填(allSettled:某类失败只是少一段流水,不报错)。──
        const cosmetic = await Promise.allSettled([
          logsFor('GameJoined'),
          logsFor('ShotFired'),
          logsFor('GameFinished'),
        ]);
        if (!alive) return;
        // 取出 fulfilled 各批的 logs(rejected 的那类跳过——少一段历史流水,不报错);viem getLogs 返回型复杂,
        // 沿用本钩既有 `as DecodedLog[]` 投影风格,只在 status 收窄后取 value。
        const cosmeticLogs = cosmetic.flatMap((r) =>
          r.status === 'fulfilled' ? (r.value as unknown as DecodedLog[]) : [],
        );
        ingestLog(cosmeticLogs.map(toLogEntry));
      } catch (e) {
        if (!alive) return;
        // getGame 对不存在的 id 返回零 struct(不 revert),故这里的抛多是 RPC/网络问题,非「不存在」。
        // 注:这里只捕获关键路径(getGame / ShotResolved)的失败;三类装饰日志的失败被 allSettled 吞掉,不到此。
        setError(e instanceof Error ? e.message : '读取对局失败。');
        setIsLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps —— ingestLog/bumpRefetch 稳定;address 故意不列。
  }, [validId, gameId, deployment, publicClient, refetchVersion]);

  // ── 增量订阅(§7.1 watch:用户永不手动刷新)──
  // 四类事件各一个订阅;onLogs 既触发 refetch(重取真理源 struct + shots)又追加日志(§7.3)。
  // enabled 门控:部署就绪 + gameId 有效。args.gameId 让节点只推本局事件(省回调)。
  const watchEnabled = !!deployment && validId;
  const watchAddress = deployment?.battleship;
  const gameIdArg = validId ? BigInt(gameId) : undefined;

  // 收到事件:追加日志 + 触发 refetch。useCallback 钉死身份(依赖只有稳定的 ingestLog/bumpRefetch)。
  const onEventLogs = useCallback(
    (logs: Log[]) => {
      ingestLog((logs as DecodedLog[]).map(toLogEntry));
      bumpRefetch();
    },
    [ingestLog, bumpRefetch],
  );

  useWatchContractEvent({
    abi: battleshipAbi,
    address: watchAddress,
    eventName: 'ShotFired',
    args: { gameId: gameIdArg },
    enabled: watchEnabled,
    onLogs: onEventLogs,
  });
  useWatchContractEvent({
    abi: battleshipAbi,
    address: watchAddress,
    eventName: 'ShotResolved',
    args: { gameId: gameIdArg },
    enabled: watchEnabled,
    onLogs: onEventLogs,
  });
  useWatchContractEvent({
    abi: battleshipAbi,
    address: watchAddress,
    eventName: 'GameJoined',
    args: { gameId: gameIdArg },
    enabled: watchEnabled,
    onLogs: onEventLogs,
  });
  useWatchContractEvent({
    abi: battleshipAbi,
    address: watchAddress,
    eventName: 'GameFinished',
    args: { gameId: gameIdArg },
    enabled: watchEnabled,
    onLogs: onEventLogs,
  });

  // ── 块时间补全(§7.3 战报流的墙钟):池里新出现的块号 → getBlock 取 timestamp,按块号 memo 永不重取。──
  // 触发:logVersion 变(池新增条目 → 可能带来新块)。对每个未缓存且非在取的块发一次 getBlock,
  // 成功即写 blockTimeRef 并 bump blockTimeVersion(驱动 eventLog memo 重套 ts);失败静默(该块 ts 缺省,
  // 条目仍在,渲染层降级不显时间——不让一次 getBlock 失败吞掉事件)。依赖**不含 address**(与取数同纪律,无关视角)。
  useEffect(() => {
    if (!publicClient) return;
    const need = collectUntimedBlocks(
      logPoolRef.current.values(),
      blockTimeRef.current, // Map:只用其 has(blockNumber) 判已缓存
      inFlightBlocksRef.current,
    );
    if (need.length === 0) return;
    let alive = true;
    for (const bn of need) {
      inFlightBlocksRef.current.add(bn);
    }
    void (async () => {
      let filled = false;
      await Promise.all(
        need.map(async (bn) => {
          try {
            const block = await publicClient.getBlock({ blockNumber: bn });
            blockTimeRef.current.set(bn, Number(block.timestamp));
            filled = true;
          } catch {
            // 该块时间取不到:不写缓存(留待下次 logVersion 变时重试);条目 ts 缺省,不阻塞渲染。
          } finally {
            inFlightBlocksRef.current.delete(bn);
          }
        }),
      );
      if (alive && filled) setBlockTimeVersion((v) => v + 1);
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps —— 池随 logVersion 变;blockTimeRef/inFlight 是 ref,address 无关。
  }, [logVersion, publicClient]);

  // 事件日志:池 → 有序数组(logVersion 变即重排)+ 套上已知块时间 ts(blockTimeVersion 变即重套)。
  const eventLog = useMemo(
    () => applyBlockTimes([...logPoolRef.current.values()].sort(comparePos), blockTimeRef.current),
    // eslint-disable-next-line react-hooks/exhaustive-deps —— 池随 logVersion 变、块时间随 blockTimeVersion 变,二者是重算触发器。
    [logVersion, blockTimeVersion],
  );

  // ── 派生(纯函数;**对 address 重算即视角翻转,无网络**)──
  // snapshot===null(未取到)→ view=null(loading / notfound 由布尔区分)。
  const view = useMemo<GameView | null>(() => {
    if (!snapshot) return null;
    return deriveGameView(snapshot, shots, address);
  }, [snapshot, shots, address]);

  // notfound:取到 snapshot 但 phase===None(对局不存在);或 gameId 本身无效。
  const isNotFound =
    (!validId && !isLoading) || (snapshot !== null && snapshot.phase === Phase.None);

  // loading:还没取到 snapshot 且无错、id 有效、仍在加载。一旦 notfound/error 即非 loading。
  const loading = isLoading && !error && !isNotFound;

  return {
    // notfound 时 view 置 null(即便 deriveGameView 给了 act:'notfound' 的对象,渲染层用 isNotFound 走专门分支)。
    view: isNotFound ? null : view,
    isLoading: loading,
    isNotFound,
    error,
    eventLog,
    refetch,
  };
}
