/**
 * useAttack —— 「开炮」交易管线(Design §4.2 attack;§7.3 我方回合点击开炮 + 待应答标记;§7.6 动词「开炮」)。
 *
 * 一次开炮 = 一笔 `attack(gameId, x, y)` 交易(无证明——攻击只报坐标,证明在防守方 respond)。
 * 流程:
 *   REPEAT 前端预检(myFiredCells 命中即拦,省一次必 revert 的往返,§7.3)→ 标记「在飞」格(乐观,
 *   交给调用方 onFired 立即落空心待应答标记)→ writeContractAsync(本地签名 → eth_sendRawTransaction)→
 *   waitForTransactionReceipt(链上确认)→ 成功:useGame 的 ShotFired/ShotResolved watch 已在并行捕获,
 *   会 refetch 把 phase 推进、把该格从乐观态转为链上 pending/resolved。
 *
 * 为什么不在本 hook 持有「待应答标记」状态:那是 SonarBoard 的渲染态(乐观格集合),由 SonarBoard 本地
 * state 管(链上 ShotResolved 到达即清);本 hook 只负责「发交易 + 报相位」,把 just-fired 格通过回调
 * 交给调用方,职责单一(同 useLockFleet 不持有棋盘渲染态)。
 *
 * 错误:经 mapContractError 成人话(NOT_TURN=没轮到你开炮 / REPEAT=这格打过了 / OOB=越界 / BAD_PHASE=
 * 相位过期)。REPEAT 已在前端预检挡掉绝大多数,但链上仍是权威(并发 / 本地位图过期时兜底)。
 *
 * 纪律:不 import snarkjs(attack 无证明);命令式 await(同 useLockFleet,一次性命令序列直线最清);
 * 防重入(runningRef:在途拒绝再次发起,防连点双发)。
 */
import { useCallback, useRef, useState } from 'react';
import { usePublicClient, useWriteContract } from 'wagmi';
import { battleshipAbi } from '../lib/abi.ts';
import { type Address } from '../lib/contracts.ts';
import { mapContractError } from '../lib/errors.ts';

/** 开炮管线离散状态。 */
export type AttackStatus =
  | { phase: 'idle' }
  /** 交易已构造,本地签名 → 发送,等节点返回 hash。 */
  | { phase: 'sending' }
  /** 已有 hash,等回执(链上确认)。 */
  | { phase: 'confirming'; hash: `0x${string}` }
  /** 失败;message 已人话化。 */
  | { phase: 'error'; message: string };

export type FireParams = {
  gameId: bigint;
  contract: Address;
  x: number;
  y: number;
};

export type UseAttackResult = {
  status: AttackStatus;
  /**
   * 开炮。返回是否「已发起交易」(true=已签名发送;false=被前端预检/重入/缺前置条件挡下,未发交易)。
   * onFired(x,y) 在交易发起前一刻(预检通过后)同步回调,供调用方立即落乐观待应答标记。
   */
  fire: (params: FireParams, onFired?: (x: number, y: number) => void) => Promise<boolean>;
  reset: () => void;
};

/**
 * @param alreadyFired 当前「我已开炮的格」判定(myFiredCells ∪ 在飞 pending),用于 REPEAT 前端预检。
 *        传一个**纯查询函数**(idx → boolean)而非 Set:让调用方决定预检口径(SonarBoard 用禁点集),
 *        本 hook 不复制集合、不与 GameView 派生耦合。
 */
export function useAttack(alreadyFired: (cellIdx: number) => boolean): UseAttackResult {
  const publicClient = usePublicClient();
  const { writeContractAsync } = useWriteContract();
  const [status, setStatus] = useState<AttackStatus>({ phase: 'idle' });
  const runningRef = useRef(false);

  const reset = useCallback(() => {
    if (runningRef.current) return;
    setStatus({ phase: 'idle' });
  }, []);

  const fire = useCallback(
    async ({ gameId, contract, x, y }: FireParams, onFired?: (x: number, y: number) => void): Promise<boolean> => {
      if (runningRef.current) return false; // 重入保护(防连点双发)
      // REPEAT 前端预检(§7.3):已开炮的格(含在飞 pending)直接拦,不发必 revert 的交易。
      if (alreadyFired(y * 10 + x)) {
        setStatus({ phase: 'error', message: '这一格已经打过了。请选择一个还没炮击过的目标。' });
        return false;
      }
      if (!publicClient) {
        setStatus({ phase: 'error', message: '链客户端未就绪,请稍后重试。' });
        return false;
      }
      runningRef.current = true;
      // 乐观:预检通过、即将发交易,先回调让 SonarBoard 落空心待应答标记(交易确认前就有反馈,§7.3)。
      onFired?.(x, y);
      try {
        setStatus({ phase: 'sending' });
        const hash = await writeContractAsync({
          abi: battleshipAbi,
          address: contract,
          functionName: 'attack',
          args: [gameId, x, y],
        });
        setStatus({ phase: 'confirming', hash });
        await publicClient.waitForTransactionReceipt({ hash });
        // 成功:不在此推进相位(useGame 的 ShotFired watch 会 refetch);回 idle 收口状态条。
        setStatus({ phase: 'idle' });
        return true;
      } catch (err) {
        // tx 失败(NOT_TURN/REPEAT/相位过期/用户层错误):人话化;乐观标记由调用方在失败回调里清。
        setStatus({ phase: 'error', message: mapContractError(err) });
        return false;
      } finally {
        runningRef.current = false;
      }
    },
    [alreadyFired, publicClient, writeContractAsync],
  );

  return { status, fire, reset };
}
