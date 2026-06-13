/**
 * 合约错误码 → 人话中文(Design §7.6:错误码→人话集中此处;文案动词化、与按钮一致、给行动指引)。
 *
 * 合约用 `require(cond, "CODE")` 即 Solidity `Error(string)`,revert 数据里就是这 13 个短码字符串
 * (ABI 里没有自定义 error 条目,见 Battleship.json errors:[])。所以错误解析的本质是:
 * 从 viem 错误层级里把那个 require 字符串抠出来,再查本表。
 *
 * 错误码全集锁定(DECISIONS D12;§10 锁定的 OOB/REPEAT/SELF_JOIN/PROOF_MISMATCH 文案语义不可改):
 *   BAD_PHASE SELF_JOIN NOT_TURN OOB REPEAT NOT_DEFENDER BAD_RESULT
 *   PROOF_MISMATCH BAD_PROOF NOT_TIMEOUT NOT_CLAIMANT NOT_CREATOR JOIN_WINDOW
 */
import { BaseError, ContractFunctionRevertedError } from 'viem';

export type ContractErrorCode =
  | 'BAD_PHASE'
  | 'SELF_JOIN'
  | 'NOT_TURN'
  | 'OOB'
  | 'REPEAT'
  | 'NOT_DEFENDER'
  | 'BAD_RESULT'
  | 'PROOF_MISMATCH'
  | 'BAD_PROOF'
  | 'NOT_TIMEOUT'
  | 'NOT_CLAIMANT'
  | 'NOT_CREATOR'
  | 'JOIN_WINDOW';

/**
 * 13 错误码 → 人话。每条 = 发生了什么 + 怎么办(§7.5/§7.6),与按钮动词一致
 * (「开炮」「加入对局」「认领超时胜利」「锁定舰队」「撤销对局」)。
 */
export const CONTRACT_ERROR_MESSAGES: Record<ContractErrorCode, string> = {
  // 状态机不匹配:多因事件未刷新导致本地相位过期。
  BAD_PHASE: '对局状态已变化,该操作此刻不可用。请等待界面刷新到最新进度后重试。',
  // §10 锁定语义:不开后门,demo 用两个账户对打。
  SELF_JOIN: '不能加入自己创建的对局。请用另一个账户加入,或把对局编号发给对手。',
  NOT_TURN: '还没轮到你开炮。请等待对手行动。',
  // §10 锁定语义。
  OOB: '坐标超出棋盘范围。请在 10×10 海域内选择目标格。',
  // §10 锁定语义。
  REPEAT: '这一格已经打过了。请选择一个还没炮击过的目标。',
  NOT_DEFENDER: '只有被攻击方才能应答这次炮击。',
  BAD_RESULT: '应答结果非法(只能是命中或未命中)。这通常是程序错误,请刷新后重试。',
  // §10 锁定语义 + §7.5 失败文案示例对齐。
  PROOF_MISMATCH:
    '应答证明被合约拒绝:本地棋盘与链上承诺不一致。请检查是否清除过浏览器存储,必要时导入此前导出的部署文件。',
  BAD_PROOF: '证明未通过合约验证。请重新生成证明后重试;若反复失败,请检查本地棋盘数据是否完整。',
  NOT_TIMEOUT: '对手尚未超时,暂不能认领超时胜利。请等待倒计时归零后再试。',
  NOT_CLAIMANT: '当前由你承担行动义务,不能由你认领对手超时。请完成你的回合。',
  NOT_CREATOR: '只有对局创建者才能撤销这一局。',
  JOIN_WINDOW: '加入窗口尚未关闭,暂不能撤销对局。请等待窗口期结束后再撤。',
};

/** 兜底:从原始信息拼一句通用文案,不丢上下文(§7.6:给行动指引,不堆装饰性感叹)。 */
function fallbackMessage(raw: string): string {
  const trimmed = raw.trim();
  return trimmed ? `操作失败:${trimmed}` : '操作失败,请稍后重试。';
}

const ALL_CODES = Object.keys(CONTRACT_ERROR_MESSAGES) as ContractErrorCode[];

/** reason 是否恰为某个已知错误码。 */
function asCode(reason: string | undefined | null): ContractErrorCode | undefined {
  if (!reason) return undefined;
  const r = reason.trim();
  return (ALL_CODES as string[]).includes(r) ? (r as ContractErrorCode) : undefined;
}

/**
 * 在任意字符串里扫已知错误码(兜底路径)。
 * 用全词边界匹配,避免 "OOB" 误中 "FOOOBAR;同长度码各自精确。
 */
function scanForCode(text: string): ContractErrorCode | undefined {
  for (const code of ALL_CODES) {
    if (new RegExp(`\\b${code}\\b`).test(text)) return code;
  }
  return undefined;
}

/**
 * 核心:revert reason 字符串 → 人话。
 *
 * 入参是已经抠出来的 require 字符串(如 "NOT_TURN"),或任意原始错误文本。
 * 命中错误码 → 查表;否则先在文本里扫码(容错 reason 带前后缀),再不行给通用兜底。
 *
 * 本函数纯字符串、零依赖,不碰 viem——viem 错误对象的提取在 mapContractError。
 */
export function mapErrorReason(reason: string | undefined | null): string {
  const exact = asCode(reason);
  if (exact) return CONTRACT_ERROR_MESSAGES[exact];
  if (!reason) return fallbackMessage('');
  const scanned = scanForCode(reason);
  if (scanned) return CONTRACT_ERROR_MESSAGES[scanned];
  return fallbackMessage(reason);
}

/**
 * 从 viem 错误层级提取 require 字符串再查表(UI 直接传 catch 到的 unknown)。
 *
 * 路径:BaseError.walk 找到 ContractFunctionRevertedError → 取其 .reason
 *      (Solidity Error(string) 的解码结果就在 reason)→ mapErrorReason。
 * 走不到该节点时,退化为在 shortMessage / message 全文扫已知码,再退到通用兜底。
 * 完全无法解析的非 viem 错误(Error / 字符串 / 未知)也尽量给可读文案。
 */
export function mapContractError(err: unknown): string {
  if (err instanceof BaseError) {
    const revert = err.walk((e) => e instanceof ContractFunctionRevertedError);
    if (revert instanceof ContractFunctionRevertedError) {
      // reason = Error(string) 解出的字符串;部分情形 viem 把短码放在 data.errorName。
      const reason = revert.reason ?? revert.data?.errorName ?? revert.shortMessage;
      const code = asCode(reason) ?? scanForCode(reason ?? '');
      if (code) return CONTRACT_ERROR_MESSAGES[code];
    }
    // 没拿到结构化 reason:在整个错误文本里兜底扫码。
    const text = `${err.shortMessage}\n${err.message}`;
    const scanned = scanForCode(text);
    if (scanned) return CONTRACT_ERROR_MESSAGES[scanned];
    return fallbackMessage(err.shortMessage || err.message);
  }
  if (err instanceof Error) {
    const scanned = scanForCode(err.message);
    if (scanned) return CONTRACT_ERROR_MESSAGES[scanned];
    return fallbackMessage(err.message);
  }
  if (typeof err === 'string') return mapErrorReason(err);
  return fallbackMessage('');
}
