/**
 * 棋盘规则真理源的 re-export(DECISIONS D2:web 一律 workspace 引用真理源)。
 *
 * 不在本仓重新实现任何棋盘逻辑——validateBoard / isHit / occupancyGrid / shipCells 与
 * 电路、e2e、合约 fixture 共用 `@zk-battleship/circuits` 的同一份实现,任何分叉都会让
 * 前端预览的合法性判定与链上 board 电路约束产生语义差。
 *
 * 浏览器安全:经由包的 `.` 入口(纯逻辑 + poseidon-lite,无 snarkjs、无 node:*);
 * 严禁从 `./proof` 或 `./node` 引入(那会把 snarkjs / Node 依赖拖进主线程 bundle)。
 */
export {
  validateBoard,
  isHit,
  occupancyGrid,
  shipCells,
  SHIP_LENGTHS,
  TOTAL_SHIP_CELLS,
  type Ship,
  type Board,
  type ValidateResult,
} from '@zk-battleship/circuits';
