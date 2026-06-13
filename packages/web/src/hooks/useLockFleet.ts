/**
 * useLockFleet —— 「锁定舰队」的可复用 create/join 管线(Design §7.3 锁定舰队流程;§8 持久化优先;
 * §7.5 证明 vs 链上确认两阶段)。
 *
 * 这是从 Task 3.3 临时 Lobby createGame 流程**抽出并泛化**(create → create|join)的真实管线:
 *   savePending/saveBoard(§8:棋盘即资产,上链前先落盘)→ worker board 证明(本地计算)→
 *   writeContractAsync(本地签名发 raw tx)→ waitForTransactionReceipt(链上确认)→
 *   解析 GameCreated/GameJoined 取 gameId →(create)promotePending 迁正式键。
 * 3.5 布阵幕拿真实 board 调本 hook(mode:'create'),3.6 join 幕调(mode:'join', gameId)。
 *
 * 为什么管线走**命令式**(writeContractAsync + publicClient.waitForTransactionReceipt),
 * 而非 useWaitForTransactionReceipt 钩子:本流程是「按一次按钮跑一条龙」的一次性命令序列,
 * 钩子是声明式、按渲染驱动的——把「等回执」塞进钩子要把 hash 提升为 state、再用 effect 串下一步,
 * 反而把线性流程拆成隐式状态机,难读且易竞态。命令式 await 一条直线下来,phase 转换显式可读
 * (Task 3.3 已实证此路在 anvil + local-account connector 上通)。两段等待文案仍严格区分
 * (§7.5):proving=本地计算(ProofStatus 叠 useProverProgress('board') 的 stage/byte%),
 * sending/confirming=链上(ProofStatus 显示 inline spinner + 等待链上确认,无假进度)。
 *
 * 存储正确性(create vs join,收口 Task 3.3 留的 pending 槽冲突隐患):
 *   - create:gameId 上链才知道 → 先 savePending(键不含 gameId,见 storage.pendingKey)→ 拿到
 *     gameId 后 promotePending 迁到正式键。
 *   - join:gameId **入参即已知** → 直接 saveBoard(写正式键 bs:{chainId}:{contract}:{gameId}:{addr}),
 *     **完全不碰 pending 槽**。如此 create 的待定布阵与 join 的待定布阵不再争同一个 pending 槽
 *     (3.3 Lobby 注释警示的 last-writer-wins / promote 迁错布阵),§8 键模板各自归位。
 *
 * 纪律:本文件不 import snarkjs(prove 经 useProver 走 worker);错误经 mapContractError 成人话;
 * StorageWriteError(写盘失败 = §8 丢失应答能力)单独成**阻断态**,文案点名后果。
 */
import { useCallback, useRef, useState } from 'react';
import { parseEventLogs, type Log } from 'viem';
import { useAccount, usePublicClient, useWriteContract } from 'wagmi';
import { battleshipAbi } from '../lib/abi.ts';
import type { Board } from '../lib/boardLogic.ts';
import { computeCommitment, toBoardInputs } from '../lib/commitment.ts';
import { type Deployment, loadDeployment, reloadDeployment } from '../lib/contracts.ts';
import { mapContractError } from '../lib/errors.ts';
import { toBoardProofArg } from '../lib/proofArgs.ts';
import { savePending, promotePending, saveBoard, StorageWriteError } from '../lib/storage.ts';
import { prove } from './useProver.ts';

/** 管线模式:create=开新局,join=加入既有局(gameId 必给)。 */
export type LockFleetMode = 'create' | 'join';

/** lockFleet 入参。board/salt 由调用方备好(3.4 临时固定布局;3.5 真实布阵)。 */
export type LockFleetParams = {
  mode: LockFleetMode;
  /** join 必给(要加入的局);create 忽略。 */
  gameId?: bigint;
  board: Board;
  salt: bigint;
};

/**
 * 管线离散状态(供 ProofStatus 渲染 + 调用方导航)。
 *   idle       —— 未开始
 *   proving    —— worker 本地出 board 证明(ProofStatus 叠 useProverProgress('board') 显 stage/byte%)
 *   sending    —— 交易已构造,本地签名 → eth_sendRawTransaction,等节点接收返回 hash
 *   confirming —— 已有 hash,等回执(链上确认)
 *   done       —— 成功;gameId 必有(create 解析自 GameCreated;join 即入参)
 *   error      —— 失败;message 已人话化(含 StorageWriteError 阻断文案)
 */
export type LockFleetStatus =
  | { phase: 'idle' }
  | { phase: 'proving' }
  | { phase: 'sending' }
  | { phase: 'confirming'; hash: `0x${string}` }
  | { phase: 'done'; mode: LockFleetMode; gameId: bigint; hash: `0x${string}` }
  | { phase: 'error'; message: string };

/**
 * 从回执日志解析 GameCreated 的 gameId(纯函数,单测可覆盖)。
 * gameId 是 indexed 参数,parseEventLogs 解出 args.gameId(bigint)。无该事件抛(交易上链但语义异常)。
 */
export function parseCreatedGameId(logs: Log[]): bigint {
  const evs = parseEventLogs({ abi: battleshipAbi, eventName: 'GameCreated', logs });
  const ev = evs[0];
  if (!ev) throw new Error('交易已上链但未解析到 GameCreated 事件。');
  return ev.args.gameId;
}

/**
 * 从回执日志确认 GameJoined 的 gameId(纯函数,单测可覆盖)。
 * join 的 gameId 调用方已知,这里解析仅为「确认这笔交易确实 join 了我们以为的那一局」;
 * 无该事件抛。返回事件里的 gameId(与入参应一致,由调用方核对或直接采信入参)。
 */
export function parseJoinedGameId(logs: Log[]): bigint {
  const evs = parseEventLogs({ abi: battleshipAbi, eventName: 'GameJoined', logs });
  const ev = evs[0];
  if (!ev) throw new Error('交易已上链但未解析到 GameJoined 事件。');
  return ev.args.gameId;
}

/** loadDeployment;曾失败(demo 后启,rejected promise 被缓存)则 reload 重取一次。 */
async function getDeployment(): Promise<Deployment> {
  try {
    return await loadDeployment();
  } catch {
    return await reloadDeployment();
  }
}

/**
 * useLockFleet —— 返回 {status, lockFleet, reset}。
 * lockFleet 跑完整管线并推进 status;reset 回 idle(供「再试一次」)。
 * busy 期间(proving/sending/confirming)重复调用被忽略(防连点重入)。
 */
export function useLockFleet(): {
  status: LockFleetStatus;
  lockFleet: (params: LockFleetParams) => Promise<void>;
  reset: () => void;
} {
  const { address } = useAccount();
  const publicClient = usePublicClient();
  const { writeContractAsync } = useWriteContract();
  const [status, setStatus] = useState<LockFleetStatus>({ phase: 'idle' });
  // 防重入:busy 期间(异步在途)拒绝再次发起。用 ref 而非 status,避免闭包读到过期 status。
  const runningRef = useRef(false);

  const reset = useCallback(() => {
    if (runningRef.current) return; // 在途不重置(避免与正在跑的管线打架)
    setStatus({ phase: 'idle' });
  }, []);

  const lockFleet = useCallback(
    async ({ mode, gameId, board, salt }: LockFleetParams) => {
      if (runningRef.current) return; // 重入保护
      if (!publicClient) {
        setStatus({ phase: 'error', message: '链客户端未就绪,请稍后重试。' });
        return;
      }
      if (!address) {
        setStatus({ phase: 'error', message: '尚未连接账户,无法锁定舰队。' });
        return;
      }
      if (mode === 'join' && gameId === undefined) {
        setStatus({ phase: 'error', message: '缺少要加入的对局编号。' });
        return;
      }
      runningRef.current = true;
      try {
        const deployment = await getDeployment();

        // address 来自 useAccount(当前 active connector 的账户);写盘地址与签名地址同源
        // (writeContract 用同一 active 账户签名),避免「写盘用 A 地址、却用 B 账户上链」的错位。

        // 承诺本地算(= board 证明的 pubSignal[0],也是写盘记录的一部分)。
        const commitment = computeCommitment(board, salt);

        // ── §8 持久化优先:上链前先落盘。create/join 落点不同(见模块注释存储正确性)。 ──
        try {
          if (mode === 'create') {
            // gameId 未知 → 先写 pending 槽(不含 gameId)。
            // M3 注:被放弃的 create(savePending 成功,随后 prove/tx 失败且用户不重试即离开)会在
            // (chainId,contract,address) 键上留一个无 gameId 的陈旧 pending 槽——可安全覆盖(下次
            // create 同键 last-writer-wins)或忽略(无 gameId 映射到它,归约层根本不会读到);主动清理是 3.8 的事。
            savePending(deployment.chainId, deployment.battleship, address, {
              ships: board,
              salt,
              commitment,
            });
          } else {
            // join:gameId 已知 → 直接写正式键,不碰 pending 槽。
            saveBoard(deployment.chainId, deployment.battleship, gameId!, address, {
              ships: board,
              salt,
              commitment,
            });
          }
        } catch (e) {
          if (e instanceof StorageWriteError) {
            // §8:写盘失败 = 必然超时输 → 阻断,不继续上链。文案点名后果。
            setStatus({ phase: 'error', message: e.message });
            return;
          }
          throw e;
        }

        // ── worker 出 board 证明(本地计算;calldata 已在 worker formatProofCalldata 好)。 ──
        setStatus({ phase: 'proving' });
        const { calldata } = await prove('board', toBoardInputs(board, salt));
        const proofArg = toBoardProofArg(calldata);

        // ── 构造并发交易(本地签名 → eth_sendRawTransaction)。 ──
        setStatus({ phase: 'sending' });
        const hash =
          mode === 'create'
            ? await writeContractAsync({
                abi: battleshipAbi,
                address: deployment.battleship,
                functionName: 'createGame',
                args: [commitment, proofArg],
              })
            : await writeContractAsync({
                abi: battleshipAbi,
                address: deployment.battleship,
                functionName: 'joinGame',
                args: [gameId!, commitment, proofArg],
              });

        // ── 等回执(链上确认)。 ──
        setStatus({ phase: 'confirming', hash });
        const receipt = await publicClient.waitForTransactionReceipt({ hash });

        // ── 解析 gameId,收尾存储。 ──
        let resolvedGameId: bigint;
        if (mode === 'create') {
          resolvedGameId = parseCreatedGameId(receipt.logs as Log[]);
          // pending → 正式键(拿到 gameId 后迁移)。
          promotePending(deployment.chainId, deployment.battleship, address, resolvedGameId);
        } else {
          // join:解析事件确认(并采信);布阵已在上面写到正式键,无需 promote。
          resolvedGameId = parseJoinedGameId(receipt.logs as Log[]);
        }

        setStatus({ phase: 'done', mode, gameId: resolvedGameId, hash });
      } catch (err) {
        setStatus({ phase: 'error', message: mapContractError(err) });
      } finally {
        runningRef.current = false;
      }
    },
    [address, publicClient, writeContractAsync],
  );

  return { status, lockFleet, reset };
}
