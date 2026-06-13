/**
 * useGameList —— 大厅「进行中对局列表」(Design §7.1:扫事件重建 + 全局 watchContractEvent 增量,
 * 用户永不手动刷新;§10 indexer-less:只扫最近 N 万块 / 本地从 deployBlock 起)。
 *
 * 数据流(事件是前端唯一数据源,§6.4):
 *   1. 回填(backfill):部署信息就绪后,publicClient.getLogs 从 deployBlock 起取历史
 *      GameCreated/GameJoined/GameFinished,投影成 GameEvent 灌进事件池。
 *   2. 增量(live):useWatchContractEvent 订阅三类事件,新事件到达即投影入池并触发重算——
 *      这就是「创建第二局,列表无需手动刷新即更新」的机制(§7.1)。
 *   3. 归约:事件池 → buildInProgressList(纯函数,gameListReducer)→ 渲染。
 *
 * 事件池是 ref 持有的 Map<posKey, GameEvent>(posKey=blockNumber:logIndex):
 *   - 去重:回填批与 watch 增量可能重叠同一 log(watch 可能回放确认块),按 posKey 覆盖即幂等;
 *   - 顺序无关:gameListReducer 对到达顺序不敏感(status 单调升级),故池是无序集合即可,
 *     排序只在最终 buildInProgressList 里按 createdPos 做(最新在前)。
 * 重算用一个单调 version state 触发:每次池变动 version++,useMemo(deps:[version]) 重跑归约。
 * (不把 list 直接塞 state——避免在 watch 回调里做归约;池+version+useMemo 把「收集」与「计算」分离。)
 *
 * §10 indexer-less 注记:本地 demo 链区块少,从 deployBlock 全扫无压力。**测试网**(未来 L2)需
 * 改成「只扫最近 N 万块」(fromBlock = max(deployBlock, head-N)),否则 getLogs 范围过大被 RPC 拒。
 * 当前 fromBlock=deployBlock,留此注记;迁测试网时在此处加 head 推算与 N 上限即可,无需改归约层。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { AbiEvent, Log } from 'viem';
import { usePublicClient, useWatchContractEvent } from 'wagmi';
import { battleshipAbi } from '../lib/abi.ts';
import { type Address, type Deployment, loadDeployment, reloadDeployment } from '../lib/contracts.ts';
import {
  buildInProgressList,
  type GameEvent,
  type GameRow,
} from './gameListReducer.ts';

/** 三类列表事件的 AbiEvent 常量(从 abi 取一次,供 getLogs 的 event 参数)。 */
const EVENT_CREATED = battleshipAbi.find(
  (x) => x.type === 'event' && x.name === 'GameCreated',
) as AbiEvent;
const EVENT_JOINED = battleshipAbi.find(
  (x) => x.type === 'event' && x.name === 'GameJoined',
) as AbiEvent;
const EVENT_FINISHED = battleshipAbi.find(
  (x) => x.type === 'event' && x.name === 'GameFinished',
) as AbiEvent;

/** posKey:同一条 log 的唯一键(链上块号:块内序)。watch/回填重叠时据此去重。 */
function posKey(blockNumber: bigint, logIndex: number): string {
  return `${blockNumber.toString()}:${logIndex}`;
}

/**
 * 把一条已解析 log(viem decode 后带 eventName + args)投影成 GameEvent。
 * 仅认 GameCreated/GameJoined/GameFinished;其余(ShotFired/ShotResolved)返回 null 被忽略。
 * blockNumber/logIndex 为 null(pending log,理论不会出现在已确认回填/watch 中)时返回 null。
 */
function toGameEvent(log: DecodedLog): GameEvent | null {
  if (log.blockNumber == null || log.logIndex == null) return null;
  const pos = { blockNumber: log.blockNumber, logIndex: log.logIndex };
  const a = log.args;
  // gameId 是三类事件共有的 indexed 参数;缺失(非本三类事件 / 解码异常)直接忽略。
  if (a.gameId == null) return null;
  switch (log.eventName) {
    case 'GameCreated':
      return a.p0 ? { kind: 'created', gameId: a.gameId, p0: a.p0, pos } : null;
    case 'GameJoined':
      return a.p1 ? { kind: 'joined', gameId: a.gameId, p1: a.p1, pos } : null;
    case 'GameFinished':
      return a.winner != null
        ? { kind: 'finished', gameId: a.gameId, winner: a.winner, reason: a.reason ?? '', pos }
        : null;
    default:
      return null;
  }
}

/** viem decode 后的 log 形状(本 hook 内部用;args 按事件名收窄在 toGameEvent 里靠 eventName 分流)。 */
type DecodedLog = Log & {
  eventName?: string;
  // 三类事件 args 的并集(toGameEvent 按 eventName + 字段在场判定后取对应字段)。
  args: {
    gameId?: bigint;
    p0?: Address;
    p1?: Address;
    winner?: Address;
    reason?: string;
  };
};

/** useGameList 返回。games=进行中列表(最新在前);loading=回填进行中;error=回填失败人话文案。 */
export type UseGameListResult = {
  games: GameRow[];
  loading: boolean;
  error: string | null;
};

export function useGameList(): UseGameListResult {
  const publicClient = usePublicClient();
  const [deployment, setDeployment] = useState<Deployment | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // 事件池(ref:不触发渲染);version:池变动计数,驱动 useMemo 重算。
  const poolRef = useRef<Map<string, GameEvent>>(new Map());
  const [version, setVersion] = useState(0);

  /**
   * 把若干 GameEvent 灌入池(按 posKey 去重);有新增才 bump version 触发重算。
   * useCallback([]) 稳定身份:只闭包 poolRef(ref,身份恒定)与 setVersion(setter,身份恒定),
   * 故空依赖即正确。**身份稳定是必须的**——下面三个 onLogs 包裹本函数喂给 useWatchContractEvent,
   * 而 wagmi v2 的 useWatchContractEvent 把 onLogs 列进 effect 依赖(viem 的 observerId 去重键却
   * 不含 onLogs):若 ingest/onLogs 每次渲染换新身份,每灌一条事件→version++→重渲染→onLogs 换身份
   * →watch effect 拆毁重建(uninstallFilter + 重新 createContractEventFilter),且新 filter 有一个
   * 轮询周期的 initialized=false 空窗可能漏掉落在窗口内的事件。稳定后三个订阅只挂一次、跨事件存活。
   */
  const ingest = useCallback((events: (GameEvent | null)[]): void => {
    let changed = false;
    for (const ev of events) {
      if (!ev) continue;
      const key = posKey(ev.pos.blockNumber, ev.pos.logIndex);
      if (!poolRef.current.has(key)) {
        poolRef.current.set(key, ev);
        changed = true;
      }
    }
    if (changed) setVersion((v) => v + 1);
  }, []);

  // 部署信息(地址 + deployBlock);曾失败(demo 后启)则 reload 重取一次。
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
        if (alive) setError(e instanceof Error ? e.message : '加载部署信息失败。');
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  // 回填:部署 + publicClient 就绪后,getLogs 从 deployBlock 取历史三类事件。
  useEffect(() => {
    if (!deployment || !publicClient) return;
    let alive = true;
    (async () => {
      try {
        // §10:本地从 deployBlock 全扫;测试网改 fromBlock=max(deployBlock, head-N)(见模块注记)。
        const fromBlock = BigInt(deployment.deployBlock);
        const batches = await Promise.all(
          [EVENT_CREATED, EVENT_JOINED, EVENT_FINISHED].map((event) =>
            publicClient.getLogs({
              address: deployment.battleship,
              event,
              fromBlock,
              toBlock: 'latest',
            }),
          ),
        );
        if (!alive) return;
        ingest(batches.flat().map((l) => toGameEvent(l as DecodedLog)));
        setLoading(false);
      } catch (e) {
        if (!alive) return;
        // 回填失败不致命:watch 仍会从此刻起捕获新事件;给非阻断错误提示。
        setError(e instanceof Error ? e.message : '回放历史对局失败。');
        setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
    // ingest 是稳定 useCallback(空依赖),列入仅为诚实表达依赖;实际只在部署/client 变化时回填一次。
  }, [deployment, publicClient, ingest]);

  // ── 增量订阅(§7.1 watchContractEvent:用户永不手动刷新)──
  // 三类事件各一个订阅;onLogs 把新 log 投影入池。enabled 门控等部署就绪。
  const watchEnabled = !!deployment;
  const watchAddress = deployment?.battleship;

  // 三个 onLogs 用 useCallback 钉死身份(依赖只有稳定的 ingest)。理由见 ingest 上方注释:
  // wagmi 的 useWatchContractEvent 把 onLogs 列进 effect 依赖,onLogs 换身份即触发订阅拆毁重建;
  // 稳定后三个订阅各只挂一次、跨事件灌入持续存活(不再每事件 uninstall/重建 filter)。
  const onCreatedLogs = useCallback(
    (logs: Log[]) => ingest(logs.map((l) => toGameEvent(l as DecodedLog))),
    [ingest],
  );
  const onJoinedLogs = useCallback(
    (logs: Log[]) => ingest(logs.map((l) => toGameEvent(l as DecodedLog))),
    [ingest],
  );
  const onFinishedLogs = useCallback(
    (logs: Log[]) => ingest(logs.map((l) => toGameEvent(l as DecodedLog))),
    [ingest],
  );

  useWatchContractEvent({
    abi: battleshipAbi,
    address: watchAddress,
    eventName: 'GameCreated',
    enabled: watchEnabled,
    onLogs: onCreatedLogs,
  });
  useWatchContractEvent({
    abi: battleshipAbi,
    address: watchAddress,
    eventName: 'GameJoined',
    enabled: watchEnabled,
    onLogs: onJoinedLogs,
  });
  useWatchContractEvent({
    abi: battleshipAbi,
    address: watchAddress,
    eventName: 'GameFinished',
    enabled: watchEnabled,
    onLogs: onFinishedLogs,
  });

  // 归约:池 → 进行中列表(version 变即重算)。
  const games = useMemo(
    () => buildInProgressList(poolRef.current.values()),
    // poolRef 内容随 version 变;version 是重算触发器。
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [version],
  );

  return { games, loading, error };
}
