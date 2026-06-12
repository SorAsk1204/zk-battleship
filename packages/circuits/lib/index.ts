/**
 * "@zk-battleship/circuits" 主入口 —— 浏览器安全(前端主线程直接消费)。
 * 纪律(DECISIONS D2):本入口及其依赖链不得 import snarkjs、不得用任何 Node API。
 * 证明格式化走 "./proof",Node 端证明生成走 "./node"。
 */
export * from './boardLogic.ts';
// 注意:encoding 中 encodeShipsForHash 标 @internal——仅供 computeCommitment 与电路测试使用,
// 消费方禁止自行拼 Poseidon 输入(保留导出仅因测试需要)。
export * from './encoding.ts';
export * from './salt.ts';
