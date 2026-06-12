/**
 * "@zk-battleship/circuits/node" 入口 —— Node 专用(snarkjs fullProve + 产物绝对路径)。
 * 浏览器不得 import 本文件。
 *
 * 注意:artifacts/ 由 scripts/export.ts 生成并提交 git(Task 1.5,D5)。
 * artifactPaths 是产物路径的单一真理源:export.ts 直接 import 它作为拷贝目标,
 * 测试也从这里取 vkey 路径——不准在别处重新拼接同一路径。
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
    vkey: path.join(ARTIFACTS_DIR, 'board', 'verification_key.json'),
  },
  shot: {
    wasm: path.join(ARTIFACTS_DIR, 'shot', 'shot.wasm'),
    zkey: path.join(ARTIFACTS_DIR, 'shot', 'shot.zkey'),
    vkey: path.join(ARTIFACTS_DIR, 'shot', 'verification_key.json'),
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
