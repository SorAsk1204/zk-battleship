/**
 * salt 生成真理源的 re-export(Design §5.1:CSPRNG ≥128 bit,承诺隐藏性完全依赖 salt 熵)。
 *
 * randomSalt 用 globalThis.crypto(浏览器与 Node ≥20 都有),浏览器安全,不引 node:crypto。
 * 每局必须新 salt(Design §5.5:跨局重用同一布船+salt 会泄露上一局棋盘),由调用方保证。
 */
export { randomSalt } from '@zk-battleship/circuits';
