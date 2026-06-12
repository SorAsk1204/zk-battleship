/**
 * ptau.ts —— 按 r1cs 约束数自动选 power 并确保 ptau 文件就位。
 *
 * 用法:tsx scripts/ptau.ts [电路名...](也被 setup.ts 程序化调用)
 *
 * D7:唯一下载源 https://storage.googleapis.com/zkevm/ptau/(旧 hermez S3 已死,
 * 不写 fallback);下载失败直接报错交人工。流式写盘,先 .tmp 再 rename 防半截文件。
 */
import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { Readable, Transform } from 'node:stream';
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
 * 官方 ptau blake2b-512 哈希,钉死防供应链篡改/下载损坏。
 * 来源:snarkjs README 的 ptau 表(https://github.com/iden3/snarkjs,hash 列即 blake2b-512,
 * 2026-06-12 查证;本地 pot12 用 Node crypto 'blake2b512' 实测与表值逐字符一致)。
 * 仅录 pot12–17(board 止损线 50k 约束封顶 pot17);更大 power 需先从 README 表补录。
 */
const KNOWN_PTAU_BLAKE2B512: Record<number, string> = {
  12: 'ded2694169b7b08e898f736d5de95af87c3f1a64594013351b1a796dbee393bd825f88f9468c84505ddd11eb0b1465ac9b43b9064aa8ec97f2b73e04758b8a4a',
  13: '58efc8bf2834d04768a3d7ffcd8e1e23d461561729beaac4e3e7a47829a1c9066d5320241e124a1a8e8aa6c75be0ba66f65bc8239a0542ed38e11276f6fdb4d9',
  14: 'eeefbcf7c3803b523c94112023c7ff89558f9b8e0cf5d6cdcba3ade60f168af4a181c9c21774b94fbae6c90411995f7d854d02ebd93fb66043dbb06f17a831c1',
  15: '982372c867d229c236091f767e703253249a9b432c1710b4f326306bfa2428a17b06240359606cfe4d580b10a5a1f63fbed499527069c18ae17060472969ae6e',
  16: '6a6277a2f74e1073601b4f9fed6e1e55226917efb0f0db8a07d98ab01df1ccf43eb0e8c3159432acd4960e2f29fe84a4198501fa54c8dad9e43297453efec125',
  17: '6247a3433948b35fbfae414fa5a9355bfb45f56efa7ab4929e669264a0258976741dfbe3288bfb49828e5df02c2e633df38d2245e30162ae7e3bcca5b8b49345',
};

/** 流式 blake2b-512(与 common.ts sha256File 同款,算法对齐 snarkjs README 的 hash 列) */
function blake2b512File(file: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash('blake2b512');
    createReadStream(file)
      .on('error', reject)
      .on('data', (chunk) => hash.update(chunk))
      .on('end', () => resolve(hash.digest('hex')));
  });
}

/** 完整性校验:下载后必校验,缓存命中也校验(防半截/被换文件长期潜伏) */
async function verifyPtau(power: number, file: string, source: '下载' | '缓存'): Promise<void> {
  const expected = KNOWN_PTAU_BLAKE2B512[power];
  if (!expected) {
    fail(
      `pot${power} 没有钉死的官方哈希(目前仅 pot12–17)。` +
        `请从 snarkjs README 的 ptau 表查 blake2b 哈希,补进 scripts/ptau.ts 的 KNOWN_PTAU_BLAKE2B512 后重跑。`,
    );
  }
  const actual = await blake2b512File(file);
  if (actual !== expected) {
    fail(
      `ptau 完整性校验失败(pot${power},${source}文件):\n` +
        `  期望 blake2b-512: ${expected}\n` +
        `  实际 blake2b-512: ${actual}\n` +
        `请删除 ${file} 后重跑以重新下载;若重下后仍不一致,停下查证下载源。`,
    );
  }
  console.log(`[ptau] pot${power} blake2b-512 verified (${source})`);
}

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
  let res: Response;
  try {
    res = await fetch(url);
  } catch (e) {
    // 网络层异常(DNS 解析失败/断网/TLS 握手失败)fetch 直接 throw,不会有 res
    fail(
      `ptau 下载失败:网络层异常(${(e as Error).message})\n` +
        `URL: ${url}\n` +
        `本仓无 fallback 源(D7),请人工检查网络,或手动下载到 ${target} 后重跑`,
    );
  }
  if (!res.ok || !res.body) {
    fail(
      `ptau 下载失败:HTTP ${res.status}\n` +
        `URL: ${url}\n` +
        `本仓无 fallback 源(D7),请人工检查网络,或手动下载到 ${target} 后重跑`,
    );
  }
  await fs.mkdir(PTAU_DIR, { recursive: true });
  const tmp = `${target}.tmp`;
  // 下载进度:每累计 ≥8MB 打一行,总大小取 Content-Length(缺失则只打已下载量)
  const totalMb = Math.round(Number(res.headers.get('content-length') ?? 0) / 1024 / 1024);
  let downloaded = 0;
  let lastLogged = 0;
  const progress = new Transform({
    transform(chunk: Buffer, _enc, cb) {
      downloaded += chunk.length;
      if (downloaded - lastLogged >= 8 * 1024 * 1024) {
        lastLogged = downloaded;
        const mb = Math.round(downloaded / 1024 / 1024);
        console.log(totalMb > 0 ? `[ptau] ${mb}/${totalMb} MB` : `[ptau] ${mb} MB`);
      }
      cb(null, chunk);
    },
  });
  try {
    await pipeline(
      Readable.fromWeb(res.body as import('node:stream/web').ReadableStream),
      progress,
      createWriteStream(tmp),
    );
    await fs.rename(tmp, target);
  } catch (e) {
    await fs.rm(tmp, { force: true });
    fail(`ptau 写盘失败(已清理半截文件):${(e as Error).message}`);
  }
  const { size } = await fs.stat(target);
  console.log(`[ptau] saved ${target} (${(size / 1024 / 1024).toFixed(1)} MB)`);
  await verifyPtau(power, target, '下载');
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
    await verifyPtau(power, ptauPath, '缓存');
  } catch {
    // verifyPtau 失败走 fail() 直接退出,能落到这里的只有 fs.access 的 ENOENT(未缓存)
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
