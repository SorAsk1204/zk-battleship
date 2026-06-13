import { describe, expect, it } from 'vitest';
import { BaseError, ContractFunctionRevertedError } from 'viem';
import {
  CONTRACT_ERROR_MESSAGES,
  mapErrorReason,
  mapContractError,
  type ContractErrorCode,
} from './errors.ts';

const ALL_CODES = Object.keys(CONTRACT_ERROR_MESSAGES) as ContractErrorCode[];

// DECISIONS D12 锁定的 13 码全集 —— 断言一个不少、一个不多。
const EXPECTED_CODES: ContractErrorCode[] = [
  'BAD_PHASE',
  'SELF_JOIN',
  'NOT_TURN',
  'OOB',
  'REPEAT',
  'NOT_DEFENDER',
  'BAD_RESULT',
  'PROOF_MISMATCH',
  'BAD_PROOF',
  'NOT_TIMEOUT',
  'NOT_CLAIMANT',
  'NOT_CREATOR',
  'JOIN_WINDOW',
];

describe('错误码表完整性', () => {
  it('恰 13 个码,与 D12 全集一致', () => {
    expect(new Set(ALL_CODES)).toEqual(new Set(EXPECTED_CODES));
    expect(ALL_CODES).toHaveLength(13);
  });

  it('每条文案非空且非纯标点(给行动指引)', () => {
    for (const code of ALL_CODES) {
      const msg = CONTRACT_ERROR_MESSAGES[code];
      expect(msg.length).toBeGreaterThan(8);
    }
  });
});

describe('mapErrorReason 13 码全覆盖', () => {
  for (const code of EXPECTED_CODES) {
    it(`${code} → 对应人话`, () => {
      expect(mapErrorReason(code)).toBe(CONTRACT_ERROR_MESSAGES[code]);
    });
  }

  it('reason 带前后缀也能扫出码', () => {
    expect(mapErrorReason('execution reverted: NOT_TURN')).toBe(CONTRACT_ERROR_MESSAGES.NOT_TURN);
  });

  it('未知码 → 通用兜底,保留原文', () => {
    expect(mapErrorReason('SOME_OTHER')).toContain('SOME_OTHER');
    expect(mapErrorReason('SOME_OTHER')).toContain('操作失败');
  });

  it('空 / null / undefined → 兜底不崩', () => {
    expect(mapErrorReason('')).toContain('操作失败');
    expect(mapErrorReason(null)).toContain('操作失败');
    expect(mapErrorReason(undefined)).toContain('操作失败');
  });

  it('不把 OOB 误中含 OOB 子串的长词(全词边界)', () => {
    // "FOOOBAR" 不含独立的 OOB 词 → 走兜底,不返回 OOB 文案
    expect(mapErrorReason('FOOOBAR')).not.toBe(CONTRACT_ERROR_MESSAGES.OOB);
  });
});

describe('mapContractError 从 viem 错误层级提取', () => {
  /** 仿真:wagmi/viem 把 reverted error 包在外层 BaseError 的 cause 链里。 */
  function makeReverted(code: string): BaseError {
    const reverted = new ContractFunctionRevertedError({
      abi: [],
      functionName: 'respond',
      message: code,
    });
    return new BaseError('Contract call failed', { cause: reverted });
  }

  it('从嵌套 ContractFunctionRevertedError 抠出 reason 查表', () => {
    expect(mapContractError(makeReverted('PROOF_MISMATCH'))).toBe(
      CONTRACT_ERROR_MESSAGES.PROOF_MISMATCH,
    );
    expect(mapContractError(makeReverted('NOT_TURN'))).toBe(CONTRACT_ERROR_MESSAGES.NOT_TURN);
  });

  it('直接传 ContractFunctionRevertedError(无外层包裹)也能解', () => {
    const reverted = new ContractFunctionRevertedError({
      abi: [],
      functionName: 'attack',
      message: 'REPEAT',
    });
    expect(mapContractError(reverted)).toBe(CONTRACT_ERROR_MESSAGES.REPEAT);
  });

  it('BaseError 但拿不到结构化 reason 时,全文扫码兜底', () => {
    const e = new BaseError('execution reverted: JOIN_WINDOW');
    expect(mapContractError(e)).toBe(CONTRACT_ERROR_MESSAGES.JOIN_WINDOW);
  });

  it('普通 Error:消息含码 → 查表;不含 → 兜底', () => {
    expect(mapContractError(new Error('reverted NOT_DEFENDER'))).toBe(
      CONTRACT_ERROR_MESSAGES.NOT_DEFENDER,
    );
    const generic = mapContractError(new Error('network timeout'));
    expect(generic).toContain('操作失败');
    expect(generic).toContain('network timeout');
  });

  it('字符串 / 未知类型 → 兜底不崩', () => {
    expect(mapContractError('SELF_JOIN')).toBe(CONTRACT_ERROR_MESSAGES.SELF_JOIN);
    expect(mapContractError(undefined)).toContain('操作失败');
    expect(mapContractError(42)).toContain('操作失败');
  });
});
