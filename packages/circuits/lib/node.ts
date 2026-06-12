/**
 * "@zk-battleship/circuits/node" 入口 —— Node 专用(snarkjs fullProve + 产物绝对路径)。
 * 浏览器不得 import 本文件。
 *
 * 注意:artifacts/ 由 M1(Task 1.5 export 脚本)生成并提交;Task 0.2 仅保证编译。
 * 约定:scripts/export.ts 拷贝产物时必须落到 artifactPaths 指定的精确路径。
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as snarkjs from 'snarkjs';
import type { Board } from './boardLogic.ts';
import { toBoardInputs, toShotInputs } from './encoding.ts';

const ARTIFACTS_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'artifacts',
);

export const artifactPaths = {
  board: {
    wasm: path.join(ARTIFACTS_DIR, 'board', 'board.wasm'),
    zkey: path.join(ARTIFACTS_DIR, 'board', 'board.zkey'),
  },
  shot: {
    wasm: path.join(ARTIFACTS_DIR, 'shot', 'shot.wasm'),
    zkey: path.join(ARTIFACTS_DIR, 'shot', 'shot.zkey'),
  },
} as const;

export type Groth16Result = { proof: unknown; publicSignals: string[] };

export async function proveBoard(b: Board, salt: bigint): Promise<Groth16Result> {
  return snarkjs.groth16.fullProve(
    toBoardInputs(b, salt),
    artifactPaths.board.wasm,
    artifactPaths.board.zkey,
  );
}

export async function proveShot(
  b: Board,
  salt: bigint,
  tx: number,
  ty: number,
): Promise<Groth16Result> {
  return snarkjs.groth16.fullProve(
    toShotInputs(b, salt, tx, ty),
    artifactPaths.shot.wasm,
    artifactPaths.shot.zkey,
  );
}
