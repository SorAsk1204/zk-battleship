/**
 * 承诺编码真理源的 re-export(协议锁定项,Design §5.1;写错全系统承诺对不上)。
 *
 * computeCommitment / toBoardInputs / toShotInputs 是布船 → Poseidon(16) 承诺与
 * circom 电路输入的唯一编码实现;前端布阵幕算承诺、对战幕校验 localStorage 重算承诺、
 * Worker 生成证明的输入,全部经由此处,禁止自行拼承诺输入数组(D2)。
 *
 * encodeShipsForHash 标 @internal:仅供 computeCommitment 与承诺自检使用,
 * UI 层不要直接拿它去拼 Poseidon 输入。
 *
 * 浏览器安全:同 boardLogic,走包 `.` 入口(poseidon-lite,无 snarkjs / node:*)。
 */
export {
  computeCommitment,
  /** @internal 仅供承诺自检;勿用于自拼 Poseidon 输入 */
  encodeShipsForHash,
  toBoardInputs,
  toShotInputs,
} from '@zk-battleship/circuits';
