/**
 * 合约交易公共件(自 a-full-game.ts 提取,评审遗留项):
 * - makeSender:估 gas(加缓冲)+ 发交易 + 等收据 + 断言成功;
 * - expectRevert:simulateContract 期望 revert,错误码精确比对(require 字符串)。
 *
 * eth_estimateGas 的坑(实测 flake,gasUsed==gasLimit 的 OOG revert):
 * 估算在 pending 块上下文跑,其时间戳常与上一块同秒,此时 `lastActionAt = block.timestamp`
 * 的 SSTORE 被当"同值写"(100 gas)估入;真实交易若落到下一秒,同一写变"变值写"(~2900 gas),
 * 估算值差 ~2.8k → 刚好 OOG。显式估算 + 加缓冲根治(估算这步同时把 revert 原因提前暴露)。
 * evm_increaseTime 跨大时间步后同理(估算与真实落块的时间戳差只会更悬殊),B/C 场景必须走同一 send。
 */
import { BaseError, ContractFunctionRevertedError, type Abi, type Address } from 'viem';
import type { makeClients } from './accounts.ts';
import * as assert from './assert.ts';

type Clients = ReturnType<typeof makeClients>;

export const GAS_BUFFER = 50_000n;

/** 沿 cause 链拼接错误消息,失败诊断用(viem 错误是多层包装,根因常在深处) */
function causeChainText(err: unknown): string {
  const parts: string[] = [];
  let cur: unknown = err;
  for (let depth = 0; depth < 10 && cur instanceof Error; depth++) {
    parts.push(cur.message);
    cur = cur.cause;
  }
  return parts.join('\n--- cause ---\n');
}

/**
 * 绑定 publicClient + 合约地址/abi + 场景标签(如 "[A]"),返回 send / expectRevert。
 * label 只描述动作(如 "round3 P0 attack"),tag 由这里统一拼进断言与日志。
 */
export function makeSender(opts: {
  publicClient: Clients['publicClient'];
  address: Address;
  abi: Abi;
  tag: string;
}) {
  const { publicClient, address, abi, tag } = opts;

  /** 估 gas(加缓冲)+ 发交易 + 等收据 + 断言成功;label 进断言上下文 */
  const send = async (
    label: string,
    wallet: Clients['wallet'],
    functionName: string,
    args: readonly unknown[],
  ) => {
    let estimated: bigint;
    try {
      estimated = await publicClient.estimateContractGas({
        address,
        abi,
        functionName,
        args,
        account: wallet.account,
      });
    } catch (err) {
      // 估算失败 ≈ 交易必 revert:把 label 带进重抛错误,根因(revert 原因)保留在 cause 链
      const short = err instanceof BaseError ? err.shortMessage : String(err);
      throw new Error(`${tag} ${label} gas 估算失败(交易将 revert):${short}`, { cause: err });
    }
    const hash = await wallet.writeContract({
      address,
      abi,
      functionName,
      args,
      gas: estimated + GAS_BUFFER,
    });
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    assert.equal(receipt.status, 'success', `${tag} ${label} 交易状态`);
    return receipt;
  };

  /**
   * 期望 revert 且错误码精确等于 code(合约 require 的 reason 字符串)。
   * 走 simulateContract:不耗 nonce、不在链上留失败交易;revert 原因由 viem 解码成
   * ContractFunctionRevertedError.reason(在错误 cause 链里,用 BaseError.walk 取)。
   */
  const expectRevert = async (
    label: string,
    account: Clients['account'],
    functionName: string,
    args: readonly unknown[],
    code: string,
  ): Promise<void> => {
    try {
      await publicClient.simulateContract({ address, abi, functionName, args, account });
    } catch (err) {
      if (err instanceof BaseError) {
        const revert = err.walk((e) => e instanceof ContractFunctionRevertedError);
        if (revert instanceof ContractFunctionRevertedError) {
          assert.equal(revert.reason, code, `${tag} ${label} revert 错误码`);
          console.log(`${tag} ${label}:按预期 revert ${code} ✓`);
          return;
        }
      }
      assert.fail(`${tag} ${label} 应 revert ${code},但错误不可解码:${causeChainText(err)}`);
    }
    assert.fail(`${tag} ${label} 应 revert ${code},却执行成功`);
  };

  return { send, expectRevert };
}
