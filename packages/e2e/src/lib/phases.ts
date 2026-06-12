/**
 * Battleship.sol `enum Phase` 的 TS 对照(顺序锁定,Design §6)。
 * getGame().phase 返回 uint8,场景脚本断言一律引用这里,不写裸数字。
 */
export const Phase = {
  None: 0,
  Created: 1,
  AwaitingAttack: 2,
  AwaitingResponse: 3,
  Finished: 4,
  Cancelled: 5,
} as const;
