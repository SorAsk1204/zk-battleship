/**
 * ptau.ts —— 按 r1cs 约束数自动选 power 并确保 ptau 文件就位。
 *
 * 用法:tsx scripts/ptau.ts [电路名...](也被 setup.ts 程序化调用)
 *
 * D7:唯一下载源 https://storage.googleapis.com/zkevm/ptau/(旧 hermez S3 已死,
 * 不写 fallback);下载失败直接报错交人工。流式写盘,先 .tmp 再 rename 防半截文件。
 */
import { createWriteStream } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import {
  PTAU_DIR,
  circuitPaths,
  circuitsFromArgv,
  fail,
  isDirectRun,
  readR1csStats,
} from './common.ts';

/** 下载上限保险:pot20 已 1GB+,board 止损线 50k 约束按理只需 pot16/17 */
const MAX_POWER = 20;

/**
 * snarkjs zkey_new.js 的硬性要求(实测 0.7.6 源码):
 *   cirPower = floor(log2(nConstraints + nPubInputs + nOutputs)) + 1,ptau power 必须 >= cirPower。
 * 该值恒 >= ceil(log2(nConstraints)),所以直接取 max(12, cirPower)
 * 同时满足计划公式 max(12, ceil(log2(n))) 与 snarkjs 的真实约束(边界:n 恰为 2 的幂时
 * 计划公式会少选 1,导致 newZKey 报 "circuit too big")。
 */
export function choosePower(stats: {
  nConstraints: number;
  nPubInputs: number;
  nOutputs: number;
}): number {
  const total = Math.max(1, stats.nConstraints + stats.nPubInputs + stats.nOutputs);
  const cirPower = 32 - Math.clz32(total); // floor(log2(total)) + 1
  return Math.max(12, cirPower);
}

function ptauPathFor(power: number): string {
  return path.join(PTAU_DIR, `powersOfTau28_hez_final_${power}.ptau`);
}

async function download(power: number, target: string): Promise<void> {
  const url = `https://storage.googleapis.com/zkevm/ptau/powersOfTau28_hez_final_${power}.ptau`;
  console.log(`[ptau] downloading ${url}`);
  const res = await fetch(url);
  if (!res.ok || !res.body) {
    fail(
      `ptau 下载失败:HTTP ${res.status} ${url}\n` +
        `本仓无 fallback 源(D7),请人工检查网络或手动下载到 ${target}`,
    );
  }
  await fs.mkdir(PTAU_DIR, { recursive: true });
  const tmp = `${target}.tmp`;
  try {
    await pipeline(
      Readable.fromWeb(res.body as import('node:stream/web').ReadableStream),
      createWriteStream(tmp),
    );
    await fs.rename(tmp, target);
  } catch (e) {
    await fs.rm(tmp, { force: true });
    fail(`ptau 写盘失败(已清理半截文件):${(e as Error).message}`);
  }
  const { size } = await fs.stat(target);
  console.log(`[ptau] saved ${target} (${(size / 1024 / 1024).toFixed(1)} MB)`);
}

/** 读 <name> 的 r1cs → 选 power → 确保 ptau 在本地;返回路径与 power */
export async function ensurePtau(name: string): Promise<{ ptauPath: string; power: number }> {
  const p = circuitPaths(name);
  try {
    await fs.access(p.r1cs);
  } catch {
    fail(`${p.r1cs} 不存在,先跑 compile:pnpm --filter @zk-battleship/circuits run compile ${name}`);
  }
  const stats = await readR1csStats(p.r1cs);
  const power = choosePower(stats);
  if (power > MAX_POWER) {
    fail(
      `${name} 需要 pot${power}(约束 ${stats.nConstraints}),超出脚本上限 pot${MAX_POWER}。` +
        `电路大得不正常,先回头查电路,不要下载超大 ptau。`,
    );
  }
  const ptauPath = ptauPathFor(power);
  try {
    await fs.access(ptauPath);
    console.log(`[ptau] ${name}: pot${power} cached (${ptauPath})`);
  } catch {
    console.log(`[ptau] ${name}: ${stats.nConstraints} constraints -> pot${power}`);
    await download(power, ptauPath);
  }
  return { ptauPath, power };
}

if (isDirectRun(import.meta.url)) {
  for (const name of circuitsFromArgv()) {
    await ensurePtau(name);
  }
  process.exit(0);
}
