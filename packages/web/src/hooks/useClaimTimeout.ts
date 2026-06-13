/**
 * useClaimTimeout —— 认领超时胜利(Design §4.3 claimTimeout;§7.6 动词「认领超时胜利」)。
 *
 * 一笔 `claimTimeout(gameId)` 交易:义务方超过 TIMEOUT 未行动时,**非义务方**调用直接获胜。可否成功由
 * 合约裁决(NOT_TIMEOUT=对手尚未超时 / NOT_CLAIMANT=你才是义务方,经 mapContractError 成人话);前端
 * 的 useCountdown 决定「按钮何时出现/可点」,本 hook 只发交易。成功后 useGame 的 GameFinished watch
 * refetch → phase 翻 Finished,对战幕自动切结算幕(§7.1)。
 *
 * 与 useAttack 同构(单 tx、命令式、防重入);无证明、不 import snarkjs。
 * **失败主呈现面 = 页内 Toast(§7.5/§7.6,Task 3.9)**:认领是瞬时动作,NOT_TIMEOUT/NOT_CLAIMANT
 * 这类「点早了 / 不该你认领」用一条可消失的 toast 告知最自然;status.error 仍保留但不再内联红字。
 */
import { useCallback, useRef, useState } from 'react';
import { usePublicClient, useWriteContract } from 'wagmi';
import { battleshipAbi } from '../lib/abi.ts';
import { type Address } from '../lib/contracts.ts';
import { mapContractError } from '../lib/errors.ts';
import { useToast } from '../components/Toast.tsx';

export type ClaimStatus =
  | { phase: 'idle' }
  | { phase: 'sending' }
  | { phase: 'confirming'; hash: `0x${string}` }
  | { phase: 'error'; message: string };

export type UseClaimTimeoutResult = {
  status: ClaimStatus;
  claim: (gameId: bigint, contract: Address) => Promise<void>;
};

export function useClaimTimeout(): UseClaimTimeoutResult {
  const publicClient = usePublicClient();
  const { writeContractAsync } = useWriteContract();
  const toast = useToast();
  const [status, setStatus] = useState<ClaimStatus>({ phase: 'idle' });
  const runningRef = useRef(false);

  // 失败收口:置 error 态 + 推一条页内 toast(§7.5/§7.6 主呈现面);message 已人话化。
  const fail = useCallback(
    (message: string) => {
      setStatus({ phase: 'error', message });
      toast.show(message, 'error');
    },
    [toast],
  );

  const claim = useCallback(
    async (gameId: bigint, contract: Address) => {
      if (runningRef.current) return;
      if (!publicClient) {
        fail('链客户端未就绪,请稍后重试。');
        return;
      }
      runningRef.current = true;
      try {
        setStatus({ phase: 'sending' });
        const hash = await writeContractAsync({
          abi: battleshipAbi,
          address: contract,
          functionName: 'claimTimeout',
          args: [gameId],
        });
        setStatus({ phase: 'confirming', hash });
        await publicClient.waitForTransactionReceipt({ hash });
        // 成功:不留 idle 文案(GameFinished watch 会把页面切到结算幕);保持 confirming→自然卸载。
        setStatus({ phase: 'idle' });
      } catch (err) {
        // NOT_TIMEOUT(点早了)/ NOT_CLAIMANT(该你行动)等:人话化 + toast。
        fail(mapContractError(err));
      } finally {
        runningRef.current = false;
      }
    },
    [publicClient, writeContractAsync, fail],
  );

  return { status, claim };
}
