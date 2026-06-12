/**
 * 承诺编码唯一实现(协议锁定项,Design.md §5.1;写错全系统承诺对不上)。
 * 承诺 = Poseidon(16 inputs),顺序固定 [x0,y0,d0, x1,y1,d1, ..., x4,y4,d4, salt]。
 * 全系统(电路测试/前端/e2e/合约 fixture)必须经由本模块,禁止自行拼承诺输入数组。
 * 浏览器安全:仅依赖 poseidon-lite 子路径(只引入 16 输入常量表),无 Node API、无 snarkjs。
 */
import { poseidon16 } from 'poseidon-lite/poseidon16';
import type { Board } from './boardLogic.ts';

/**
 * 恰 15 个 bigint:[x0,y0,d0, x1,y1,d1, ..., x4,y4,d4]
 * @internal — 仅供 computeCommitment 与电路测试使用;消费方禁止自行拼 Poseidon 输入。
 */
export function encodeShipsForHash(b: Board): bigint[] {
  const out: bigint[] = [];
  for (let i = 0; i < 5; i++) {
    out.push(BigInt(b[i].x), BigInt(b[i].y), BigInt(b[i].dir));
  }
  return out;
}

/**
 * poseidon16([...encodeShipsForHash(b), salt])
 * 前置条件:调用方必须先通过 validateBoard;本函数不校验
 * (M1 负向测试需要为非法布阵构造输入)。
 */
export function computeCommitment(b: Board, salt: bigint): bigint {
  return poseidon16([...encodeShipsForHash(b), salt]);
}

/** circom board 电路输入:ships[5][3] = [[x,y,dir], ...] 十进制字符串 */
export function toBoardInputs(b: Board, salt: bigint): { ships: string[][]; salt: string } {
  return {
    ships: b.map((s) => [String(s.x), String(s.y), String(s.dir)]),
    salt: salt.toString(10),
  };
}

/**
 * circom shot 电路输入:board 输入 + 公开 commitment/tx/ty。
 * 前置条件:调用方必须先通过 validateBoard;本函数不校验布阵
 * (M1 负向测试需要为非法布阵构造输入)。
 * tx/ty 必须是 0–9 整数(与 isHit 同域),违反则 throw——
 * 本函数产出的是 circom 输入,坏值会变成难懂的 witness 错误。
 */
export function toShotInputs(
  b: Board,
  salt: bigint,
  tx: number,
  ty: number,
): { ships: string[][]; salt: string; commitment: string; tx: string; ty: string } {
  if (
    !Number.isInteger(tx) || tx < 0 || tx > 9 ||
    !Number.isInteger(ty) || ty < 0 || ty > 9
  ) {
    throw new Error(`toShotInputs: tx/ty 必须是 0–9 整数,got tx=${tx}, ty=${ty}`);
  }
  return {
    ...toBoardInputs(b, salt),
    commitment: computeCommitment(b, salt).toString(10),
    tx: String(tx),
    ty: String(ty),
  };
}
