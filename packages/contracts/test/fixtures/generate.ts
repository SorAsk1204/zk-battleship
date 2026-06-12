/**
 * ProofFixtures.sol 生成器(M1 Task 1.7)—— forge 测试套件用的真实 Groth16 证明 fixture。
 *
 * 设计(DECISIONS D4):forge 测试不读 JSON(不用 vm.parseJson)、不开 FFI;
 * 真实证明以 Solidity library 形式按需生成。生成物 ProofFixtures.sol 在 .gitignore,
 * 不入库;contracts 的 test/snapshot script 前置本步,保证测试前存在且新鲜。
 *
 * 运行:pnpm --filter @zk-battleship/contracts run fixtures
 *
 * mtime 缓存:ProofFixtures.sol 比 board.zkey、shot.zkey、本文件都新 ⇒ skipped 直接退出
 * (全量生成 38 个证明约 1 分钟,不缓存的话每次 forge test 都白等)。
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as snarkjs from 'snarkjs';
import {
  SHIP_LENGTHS,
  computeCommitment,
  isHit,
  shipCells,
  validateBoard,
  type Board,
} from '@zk-battleship/circuits';
import { formatProofCalldata, type ProofCalldata } from '@zk-battleship/circuits/proof';
import { artifactPaths, proveBoard, proveShot } from '@zk-battleship/circuits/node';

// ============ 固定素材(fixture 可复现性的根基) ============
// salt 固定是 fixture 可复现性要求:commitment 与全部 pubSignals 跨次生成恒定,
// 测试可以把它们当常量用(注意:Groth16 证明本身含 prover 随机数 r/s,
// a/b/c 各次生成不同,但永远是同一组公开输入的有效证明)。
// 生产严禁固定/复用 salt —— 承诺隐藏性完全依赖 salt 熵(Design §5.1,CSPRNG ≥128 bit),
// salt 一旦可预测,17 格布阵可被字典攻击直接还原。三个值 < 2^128,与 randomSalt 同域。
const SALT_A = 0xa0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0n;
const SALT_B = 0xb1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1n;
const SALT_C = 0xc2c2c2c2c2c2c2c2c2c2c2c2c2c2c2c2n;

// 棋盘 A(玩家 0):五船全横排靠左,右侧 9 列与底部 9 行整片是水 —— 方便取 16 个固定水格。
const BOARD_A: Board = [
  { x: 0, y: 0, dir: 0 }, // len5: (0..4, 0)
  { x: 0, y: 2, dir: 0 }, // len4: (0..3, 2)
  { x: 0, y: 4, dir: 0 }, // len3: (0..2, 4)
  { x: 0, y: 6, dir: 0 }, // len3: (0..2, 6)
  { x: 0, y: 8, dir: 0 }, // len2: (0..1, 8)
];

// 棋盘 B(玩家 1):竖横混排;(0,0)/(1,0) 留作水格 W/W′,(5,0) 是船头(与 P 重合,见下)。
const BOARD_B: Board = [
  { x: 5, y: 0, dir: 1 }, // len5: (5, 0..4)
  { x: 7, y: 0, dir: 1 }, // len4: (7, 0..3)
  { x: 9, y: 0, dir: 1 }, // len3: (9, 0..2)
  { x: 2, y: 5, dir: 0 }, // len3: (2..4, 5)
  { x: 0, y: 7, dir: 1 }, // len2: (0, 7..8)
];

// 棋盘 C(换棋盘攻击素材):刻意让 len3 船占 (5, 0..2),使 P=(5,0) 同时是 C 与 B 的船格。
const BOARD_C: Board = [
  { x: 1, y: 9, dir: 0 }, // len5: (1..5, 9)
  { x: 9, y: 5, dir: 1 }, // len4: (9, 5..8)
  { x: 5, y: 0, dir: 1 }, // len3: (5, 0..2) ← P 在此
  { x: 0, y: 0, dir: 1 }, // len3: (0, 0..2)
  { x: 3, y: 3, dir: 0 }, // len2: (3..4, 3)
];

// A 的 16 个固定水格(与 shotAMiss(i) 索引对齐):第 9 列整列(10 格)+ 第 9 行左 6 格。
// A 的船全在 x∈[0,4]、y∈{0,2,4,6,8},这 16 格必为水;互不重复(REPEAT 守卫要求)。
const A_WATER: ReadonlyArray<{ x: number; y: number }> = [
  ...Array.from({ length: 10 }, (_, i) => ({ x: 9, y: i })), // (9,0)..(9,9)
  ...Array.from({ length: 6 }, (_, i) => ({ x: i, y: 9 })), // (0,9)..(5,9)
];

// ============ 攻击 fixture 坐标(单 pubSignal 偏差纪律,评审要求) ============
// 纪律:每个攻击 fixture 与"活对局状态期望的合法应答"恰好只差一个 pubSignal,
// 否则 PROOF_MISMATCH 可能被错误的绑定拦下,测试就没有钉死它声称要测的那条绑定。
//
// 换格子攻击:链上 pending=W′,提交 B 在 W 的 miss 证明(shotBMissAtW)。
//   合法应答应为 [0, commitmentB, W′x, W′y];本证明是 [0, commitmentB, Wx, Wy]。
//   W/W′ 都是 B 的水格(result 同为 0)、同棋盘(commitment 同)、同 y(ty 同),
//   仅 x 不同 ⇒ 恰好只差 pubSignals[2],PROOF_MISMATCH 精确打在坐标绑定 (2) 上。
const W = { x: 0, y: 0 } as const; // B 的水格(B 在第 0 列只占 y=7..8)
const W_PRIME = { x: 1, y: 0 } as const; // B 的另一水格,与 W 仅差 x
//
// 换棋盘攻击:链上 pending=P(防守方棋盘 B),提交 C 在 P 的 hit 证明(shotCHitAtP)。
//   P 同时是 B 与 C 的船格 ⇒ 合法应答应为 [1, commitmentB, Px, Py],
//   本证明是 [1, commitmentC, Px, Py],恰好只差 pubSignals[1],
//   PROOF_MISMATCH 精确打在承诺绑定 (1) 上(result/tx/ty 全部吻合)。
const P = { x: 5, y: 0 } as const;

// ============ mtime 缓存 ============
const SELF = fileURLToPath(import.meta.url);
const HERE = path.dirname(SELF);
const OUT_PATH = path.join(HERE, 'ProofFixtures.sol');

function isFresh(): boolean {
  if (!fs.existsSync(OUT_PATH)) return false;
  const outMtime = fs.statSync(OUT_PATH).mtimeMs;
  const deps = [artifactPaths.board.zkey, artifactPaths.shot.zkey, SELF];
  return deps.every((d) => fs.statSync(d).mtimeMs < outMtime);
}

// ============ 证明生成 + 内置自检(生成期断言,错了立刻爆) ============

type Generated = { calldata: ProofCalldata; proof: unknown; publicSignals: string[] };

async function genBoard(label: string, b: Board, salt: bigint): Promise<Generated> {
  const { proof, publicSignals } = await proveBoard(b, salt);
  const calldata = await formatProofCalldata(proof, publicSignals);
  assert.equal(calldata.pubSignals.length, 1, `${label}: board pubSignals 应为 [commitment]`);
  assert.equal(
    calldata.pubSignals[0],
    computeCommitment(b, salt),
    `${label}: pubSignals[0] 必须等于 lib 真理源 computeCommitment`,
  );
  return { calldata, proof, publicSignals };
}

async function genShot(
  label: string,
  b: Board,
  salt: bigint,
  tx: number,
  ty: number,
): Promise<Generated> {
  const { proof, publicSignals } = await proveShot(b, salt, tx, ty);
  const calldata = await formatProofCalldata(proof, publicSignals);
  assert.equal(calldata.pubSignals.length, 4, `${label}: shot pubSignals 应为 [result,commitment,tx,ty]`);
  assert.equal(calldata.pubSignals[0], BigInt(isHit(b, tx, ty)), `${label}: result 与 isHit 不符`);
  assert.equal(calldata.pubSignals[1], computeCommitment(b, salt), `${label}: commitment 不符`);
  assert.equal(calldata.pubSignals[2], BigInt(tx), `${label}: tx 不符`);
  assert.equal(calldata.pubSignals[3], BigInt(ty), `${label}: ty 不符`);
  return { calldata, proof, publicSignals };
}

// ============ Solidity 文本生成 ============

const hex = (v: bigint): string => `0x${v.toString(16)}`;

/** [uint256(..), ..] 数组字面量:首元素显式 cast 钉死元素类型,其余十六进制字面量隐式转换 */
function arr2(p: readonly [bigint, bigint]): string {
  return `[uint256(${hex(p[0])}), ${hex(p[1])}]`;
}

function boardProofLit(p: ProofCalldata): string {
  return (
    `BoardProof({a: ${arr2(p.a)}, b: [${arr2(p.b[0])}, ${arr2(p.b[1])}], ` +
    `c: ${arr2(p.c)}, pubSignals: [uint256(${hex(p.pubSignals[0])})]})`
  );
}

function shotProofLit(p: ProofCalldata): string {
  const [r, c, tx, ty] = p.pubSignals;
  return (
    `ShotProof({a: ${arr2(p.a)}, b: [${arr2(p.b[0])}, ${arr2(p.b[1])}], ` +
    `c: ${arr2(p.c)}, pubSignals: [uint256(${r}), ${hex(c)}, ${tx}, ${ty}]})`
  );
}

function boardFn(name: string, doc: string, p: ProofCalldata): string {
  return `    ${doc}
    function ${name}() internal pure returns (BoardProof memory) {
        return ${boardProofLit(p)};
    }`;
}

function shotFn(name: string, doc: string, p: ProofCalldata): string {
  return `    ${doc}
    function ${name}() internal pure returns (ShotProof memory) {
        return ${shotProofLit(p)};
    }`;
}

/** 索引版 shot fixture:if-chain(Solidity 的 memory 结构体数组没有字面量语法,if-chain 最稳) */
function shotFnIndexed(name: string, doc: string, proofs: ProofCalldata[]): string {
  const branches = proofs
    .map((p, i) => `        if (i == ${i}) return ${shotProofLit(p)};`)
    .join('\n');
  return `    ${doc}
    function ${name}(uint256 i) internal pure returns (ShotProof memory) {
${branches}
        revert("ProofFixtures: ${name} index OOB");
    }`;
}

function uint8ArrayFn(name: string, doc: string, values: number[]): string {
  const lit = `[uint8(${values[0]}), ${values.slice(1).join(', ')}]`;
  return `    ${doc}
    function ${name}() internal pure returns (uint8[${values.length}] memory) {
        return ${lit};
    }`;
}

function uintConstFn(name: string, type: 'uint8' | 'uint256', value: string): string {
  return `    function ${name}() internal pure returns (${type}) {
        return ${value};
    }`;
}

// ============ 主流程 ============

async function main(): Promise<void> {
  if (isFresh()) {
    console.log('[fixtures] skipped — ProofFixtures.sol 比 board.zkey/shot.zkey/generate.ts 都新');
    return;
  }

  // ---- 素材自检(先于任何耗时的证明生成) ----
  const boards = [
    ['A', BOARD_A],
    ['B', BOARD_B],
    ['C', BOARD_C],
  ] as const;
  for (const [name, b] of boards) {
    const r = validateBoard(b);
    assert(r.ok, `BOARD_${name} 非法布阵: ${JSON.stringify(r)}`);
  }
  const cA = computeCommitment(BOARD_A, SALT_A);
  const cB = computeCommitment(BOARD_B, SALT_B);
  const cC = computeCommitment(BOARD_C, SALT_C);
  assert(cA !== cB && cB !== cC && cA !== cC, '三块棋盘的 commitment 必须互不相同');

  // B 的 17 个船格(shotBHit 索引序 = 船序 [5,4,3,3,2] 逐船从船头到船尾)
  const bShip = BOARD_B.flatMap((s, i) => shipCells(s, SHIP_LENGTHS[i]));
  assert.equal(bShip.length, 17, 'B 船格总数应为 17');
  assert.equal(new Set(bShip.map((c) => c.y * 10 + c.x)).size, 17, 'B 船格必须互不重复');
  for (const c of bShip) assert.equal(isHit(BOARD_B, c.x, c.y), 1, `B(${c.x},${c.y}) 应为船格`);

  // A 的 16 个固定水格
  assert.equal(A_WATER.length, 16, 'A 水格应取 16 个');
  assert.equal(new Set(A_WATER.map((c) => c.y * 10 + c.x)).size, 16, 'A 水格必须互不重复(REPEAT 守卫)');
  for (const c of A_WATER) assert.equal(isHit(BOARD_A, c.x, c.y), 0, `A(${c.x},${c.y}) 应为水格`);

  // 单 pubSignal 偏差纪律(见文件头注释)
  assert.equal(isHit(BOARD_B, W.x, W.y), 0, 'W 必须是 B 的水格');
  assert.equal(isHit(BOARD_B, W_PRIME.x, W_PRIME.y), 0, 'W′ 必须是 B 的水格(result 同为 0)');
  assert(W.y === W_PRIME.y && W.x !== W_PRIME.x, 'W/W′ 必须仅 x 不同(恰差 pubSignals[2] 一项)');
  assert.equal(isHit(BOARD_C, P.x, P.y), 1, 'P 必须是 C 的船格(本证明 result=1)');
  assert.equal(isHit(BOARD_B, P.x, P.y), 1, 'P 必须同时是 B 的船格(恰差 pubSignals[1] 一项)');

  // ---- 生成 38 个真实证明(串行,可复现;约 1 分钟) ----
  const t0 = Date.now();
  const TOTAL = 3 + bShip.length + A_WATER.length + 2;
  let done = 0;
  const tick = (label: string, t: number): void => {
    done += 1;
    console.log(`  [${done}/${TOTAL}] ${label} (${Date.now() - t}ms)`);
  };
  const timed = async (label: string, gen: () => Promise<Generated>): Promise<Generated> => {
    const t = Date.now();
    const g = await gen();
    tick(label, t);
    return g;
  };

  console.log('[fixtures] 生成真实 Groth16 证明 …');
  const boardA = await timed('boardA', () => genBoard('boardA', BOARD_A, SALT_A));
  const boardB = await timed('boardB', () => genBoard('boardB', BOARD_B, SALT_B));
  const boardC = await timed('boardC', () => genBoard('boardC', BOARD_C, SALT_C));

  const shotBHit: ProofCalldata[] = [];
  for (const [i, c] of bShip.entries()) {
    const g = await timed(`shotBHit(${i}) @ (${c.x},${c.y})`, () =>
      genShot(`shotBHit(${i})`, BOARD_B, SALT_B, c.x, c.y),
    );
    if (i === 0) {
      // groth16.verify 抽查(shot 侧):防"格式化层正确但证明本身坏"的盲区
      const vkey: unknown = JSON.parse(fs.readFileSync(artifactPaths.shot.vkey, 'utf8'));
      assert.equal(
        await snarkjs.groth16.verify(vkey, g.publicSignals, g.proof),
        true,
        'groth16.verify 抽查失败: shotBHit(0)',
      );
      console.log('  [verify] shotBHit(0) groth16.verify=true');
    }
    shotBHit.push(g.calldata);
  }

  const shotAMiss: ProofCalldata[] = [];
  for (const [i, c] of A_WATER.entries()) {
    const g = await timed(`shotAMiss(${i}) @ (${c.x},${c.y})`, () =>
      genShot(`shotAMiss(${i})`, BOARD_A, SALT_A, c.x, c.y),
    );
    shotAMiss.push(g.calldata);
  }

  const shotBMissAtW = await timed(`shotBMissAtW @ (${W.x},${W.y})`, () =>
    genShot('shotBMissAtW', BOARD_B, SALT_B, W.x, W.y),
  );
  const shotCHitAtP = await timed(`shotCHitAtP @ (${P.x},${P.y})`, () =>
    genShot('shotCHitAtP', BOARD_C, SALT_C, P.x, P.y),
  );

  // groth16.verify 抽查(board 侧)
  {
    const vkey: unknown = JSON.parse(fs.readFileSync(artifactPaths.board.vkey, 'utf8'));
    assert.equal(
      await snarkjs.groth16.verify(vkey, boardA.publicSignals, boardA.proof),
      true,
      'groth16.verify 抽查失败: boardA',
    );
    console.log('  [verify] boardA groth16.verify=true');
  }

  // ---- 拼 Solidity library ----
  const sections = [
    boardFn('boardA', '/// 棋盘 A(玩家 0)的布局合法性证明;pubSignals=[commitmentA]。', boardA.calldata),
    boardFn('boardB', '/// 棋盘 B(玩家 1)的布局合法性证明;pubSignals=[commitmentB]。', boardB.calldata),
    boardFn('boardC', '/// 棋盘 C(换棋盘攻击素材)的布局合法性证明;pubSignals=[commitmentC]。', boardC.calldata),
    shotFnIndexed(
      'shotBHit',
      `/// B 的 17 个船格的 hit 应答证明,i∈[0,17);坐标即 (bShipXs()[i], bShipYs()[i])。
    /// 用途:P0 对 B 全局打满 17 hit。pubSignals=[1, commitmentB, x, y]。`,
      shotBHit,
    ),
    shotFnIndexed(
      'shotAMiss',
      `/// A 的 16 个固定水格的 miss 应答证明,i∈[0,16);坐标即 (aWaterXs()[i], aWaterYs()[i])。
    /// 用途:P1 的回合(攻击 A 的水格)。pubSignals=[0, commitmentA, x, y]。`,
      shotAMiss,
    ),
    shotFn(
      'shotBMissAtW',
      `/// 换格子攻击素材:B 在水格 W=(${W.x},${W.y}) 的合法 miss 证明。
    /// 用法:活局对 B 攻击 W′=(${W_PRIME.x},${W_PRIME.y})(也是 B 的水格)后提交本证明。
    /// 纪律:与合法应答 [0, commitmentB, ${W_PRIME.x}, ${W_PRIME.y}] 恰好只差 pubSignals[2](tx)——
    /// result 同为 0、commitment 同、ty 同 ⇒ PROOF_MISMATCH 精确打在坐标绑定 (2) 上。`,
      shotBMissAtW.calldata,
    ),
    shotFn(
      'shotCHitAtP',
      `/// 换棋盘攻击素材:C 在 P=(${P.x},${P.y}) 的 hit 证明(P 是 C 的船格)。
    /// 用法:活局(防守方棋盘 B)pending=P、calldata result=1 时提交本证明。
    /// 纪律:P 同时也是 B 的船格 ⇒ 合法应答 [1, commitmentB, ${P.x}, ${P.y}] 与本证明
    /// [1, commitmentC, ${P.x}, ${P.y}] 恰好只差 pubSignals[1] ⇒ PROOF_MISMATCH 精确打在承诺绑定 (1) 上。`,
      shotCHitAtP.calldata,
    ),
    uintConstFn('commitmentA', 'uint256', hex(cA)),
    uintConstFn('commitmentB', 'uint256', hex(cB)),
    uintConstFn('commitmentC', 'uint256', hex(cC)),
    uint8ArrayFn(
      'bShipXs',
      '/// B 的 17 个船格 x 坐标(船序 [5,4,3,3,2] 逐船从船头到船尾,与 shotBHit(i) 对齐)。',
      bShip.map((c) => c.x),
    ),
    uint8ArrayFn('bShipYs', '/// B 的 17 个船格 y 坐标(与 shotBHit(i) 对齐)。', bShip.map((c) => c.y)),
    uint8ArrayFn(
      'aWaterXs',
      '/// A 的 16 个固定水格 x 坐标(与 shotAMiss(i) 对齐)。',
      A_WATER.map((c) => c.x),
    ),
    uint8ArrayFn('aWaterYs', '/// A 的 16 个固定水格 y 坐标(与 shotAMiss(i) 对齐)。', A_WATER.map((c) => c.y)),
    uintConstFn('wX', 'uint8', String(W.x)),
    uintConstFn('wY', 'uint8', String(W.y)),
    uintConstFn('wPrimeX', 'uint8', String(W_PRIME.x)),
    uintConstFn('wPrimeY', 'uint8', String(W_PRIME.y)),
    uintConstFn('pX', 'uint8', String(P.x)),
    uintConstFn('pY', 'uint8', String(P.y)),
  ];

  const sol = `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

// GENERATED — do not edit. Regenerate: pnpm --filter @zk-battleship/contracts run fixtures
// 由 test/fixtures/generate.ts 生成:固定棋盘 A/B/C + 固定 salt ⇒ commitment 与全部
// pubSignals 跨次生成恒定(证明点 a/b/c 含 prover 随机数,各次不同但恒有效)。
// 本文件在 .gitignore;contracts 的 test/snapshot script 前置 fixtures 步骤保证其存在。

import {BoardProof, ShotProof} from "../../src/Battleship.sol";

/// @notice forge 测试用真实 Groth16 证明 fixture(D4:无 vm.parseJson、无 FFI)。
library ProofFixtures {
${sections.join('\n\n')}
}
`;

  fs.writeFileSync(OUT_PATH, sol);
  const secs = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`[fixtures] 完成:${TOTAL} 个证明(board 3 + shot ${TOTAL - 3}),耗时 ${secs}s`);
  console.log(`[fixtures] 写入 ${OUT_PATH}`);
}

main()
  .then(() => process.exit(0)) // snarkjs 的 worker 线程会挂住进程,必须显式退出
  .catch((e: unknown) => {
    console.error(e);
    process.exit(1);
  });
