/**
 * 承诺编码真理源的 re-export(协议锁定项,Design §5.1;写错全系统承诺对不上)。
 *
 * computeCommitment / toBoardInputs / toShotInputs 是布船 → Poseidon(16) 承诺与
 * circom 电路输入的唯一编码实现;前端布阵幕算承诺、对战幕校验 localStorage 重算承诺、
 * Worker 生成证明的输入,全部经由此处,禁止自行拼承诺输入数组(D2)。
 *
 * encodeShipsForHash 标 @internal:这是给 JSDoc 工具的提示信号(advisory),不是访问控制——
 * JS 没有真正的包级私有,导出仍可被 import。保留导出仅因 commitment.test 与承诺自检需要它;
 * 消费方校验"本地棋盘 vs 链上承诺"请用 verifyBoardCommitment / computeCommitment,
 * 永远不要自行拿 encodeShipsForHash 去拼 Poseidon 输入(D2)。
 *
 * 浏览器安全:同 boardLogic,走包 `.` 入口(poseidon-lite,无 snarkjs / node:*)。
 */
import { computeCommitment } from '@zk-battleship/circuits';
import type { Ship } from '@zk-battleship/circuits';

export {
  computeCommitment,
  /** @internal 仅供承诺自检;勿用于自拼 Poseidon 输入(advisory,非访问控制) */
  encodeShipsForHash,
  toBoardInputs,
  toShotInputs,
} from '@zk-battleship/circuits';

/**
 * 校验"本地棋盘 vs 链上承诺"是否一致(I1/M5:3.7 useAutoRespond、3.8 PersistenceBanner 的单一入口)。
 *
 * 重算 computeCommitment(ships, BigInt(salt)) 与 BigInt(commitment) 比较。两者皆按 bigint 比较,
 * 故承诺/salt 既可传十进制串也可传 '0x…' hex 串(BigInt 都认),消费方不必先归一进制。
 *
 * 注意:本函数只校验"承诺是否对得上",不校验布阵是否合法——非法布阵也可能恰好重算出某承诺。
 * importBoardJSON 会先 validateBoard 再调本函数,两道关卡各管一段(布局非法 vs 承诺不一致)。
 *
 * 入参 salt/commitment 必须是 BigInt() 可解析的串;非法串(空、缺 0x、含非法字符)会让 BigInt 抛,
 * 由调用方(importBoardJSON 已先过 isStoredBoard 的 hex 正则)保证不会走到这里。
 *
 * @param ships 5 条船(调用方保证 length===5;非 5 条时 computeCommitment 越界读必抛)
 * @param salt salt 的字符串形态('0x…' 或十进制)
 * @param commitment 待比对承诺的字符串形态('0x…' 或十进制)
 * @returns 重算承诺 === 给定承诺 时为 true
 */
export function verifyBoardCommitment(
  ships: Ship[],
  salt: string,
  commitment: string,
): boolean {
  // ships 经调用方保证恰 5 条;computeCommitment 入参类型是 Board(5-tuple),此处按结构等价传入。
  const recomputed = computeCommitment(ships as unknown as Parameters<typeof computeCommitment>[0], BigInt(salt));
  return recomputed === BigInt(commitment);
}
