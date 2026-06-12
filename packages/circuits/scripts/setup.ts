/**
 * setup.ts —— Groth16 trusted setup:zKey.newZKey 直出 final zkey(无 contribute,D6)
 * + exportVerificationKey。
 *
 * 用法:
 *   tsx scripts/setup.ts [电路名...]                 常规 setup(幂等:r1cs hash 未变则跳过)
 *   tsx scripts/setup.ts <电路名> --verify-determinism  双跑 newZKey 比对 sha256(D6 实证)
 *
 * 幂等性:setup-meta.json 旁车记录 r1cs sha256 + ptau power + snarkjs 版本,
 * 三者都未变且 zkey 已存在则 skipped。export.ts 也从该旁车读约束数/power 写 manifest。
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import * as snarkjs from 'snarkjs';
import {
  PKG_ROOT,
  circuitPaths,
  circuitsFromArgv,
  fail,
  hasFlag,
  isDirectRun,
  readR1csStats,
  sha256File,
} from './common.ts';
import { ensurePtau } from './ptau.ts';

// snarkjs 的 exports map 不暴露 ./package.json,只能按文件路径读实际安装版本
export const SNARKJS_VERSION: string = (
  JSON.parse(
    await fs.readFile(path.join(PKG_ROOT, 'node_modules', 'snarkjs', 'package.json'), 'utf8'),
  ) as { version: string }
).version;

export type SetupMeta = {
  r1csSha256: string;
  nConstraints: number;
  ptauPower: number;
  snarkjsVersion: string;
};

async function readMeta(file: string): Promise<SetupMeta | null> {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8')) as SetupMeta;
  } catch {
    return null;
  }
}

/**
 * snarkjs 长任务进度日志:newZKey 在 M1 真电路上要跑很久,不给 logger 就全程静默。
 * 只透传 info/warn/error;debug 是逐约束级噪音,屏蔽。
 */
const snarkjsLogger = {
  info: (msg: string) => console.log(`[snarkjs] ${msg}`),
  warn: (msg: string) => console.warn(`[snarkjs] ${msg}`),
  error: (msg: string) => console.error(`[snarkjs] ${msg}`),
  debug: () => {},
};

export async function setupCircuit(name: string): Promise<SetupMeta> {
  const p = circuitPaths(name);
  const { ptauPath, power } = await ensurePtau(name); // 内部已校验 r1cs 存在
  const stats = await readR1csStats(p.r1cs);
  const r1csSha256 = await sha256File(p.r1cs);
  const meta: SetupMeta = {
    r1csSha256,
    nConstraints: stats.nConstraints,
    ptauPower: power,
    snarkjsVersion: SNARKJS_VERSION,
  };

  const prev = await readMeta(p.setupMeta);
  const zkeyExists = await fs.access(p.zkey).then(() => true, () => false);
  const vkeyExists = await fs.access(p.vkey).then(() => true, () => false);
  if (
    zkeyExists &&
    vkeyExists &&
    prev &&
    prev.r1csSha256 === r1csSha256 &&
    prev.ptauPower === power &&
    prev.snarkjsVersion === SNARKJS_VERSION
  ) {
    console.log(`[setup] ${name}: skipped (r1cs/ptau/snarkjs 均未变,zkey 已存在)`);
    return meta;
  }

  console.log(`[setup] ${name}: newZKey (pot${power}, no contribute per D6) ...`);
  await snarkjs.zKey.newZKey(p.r1cs, ptauPath, p.zkey, snarkjsLogger);
  const vkey = await snarkjs.zKey.exportVerificationKey(p.zkey);
  await fs.writeFile(
    p.vkey,
    JSON.stringify(vkey, (_k, v: unknown) => (typeof v === 'bigint' ? v.toString() : v), 2),
  );
  await fs.writeFile(p.setupMeta, JSON.stringify(meta, null, 2));
  console.log(`[setup] ${name}: zkey -> ${p.zkey}`);
  console.log(`[setup] ${name}: vkey -> ${p.vkey}`);
  return meta;
}

/**
 * D6 确定性实证:同一 r1cs+ptau 跑两次 newZKey,sha256 必须逐字节一致。
 * 不一致 => newZKey 不确定 => D5 的"产物提交 git"策略被推翻,必须 BLOCKED 上报。
 */
export async function verifyDeterminism(name: string): Promise<void> {
  const p = circuitPaths(name);
  const { ptauPath } = await ensurePtau(name);
  const runA = `${p.zkey}.det-a`;
  const runB = `${p.zkey}.det-b`;
  try {
    console.log(`[determinism] ${name}: newZKey run A ...`);
    await snarkjs.zKey.newZKey(p.r1cs, ptauPath, runA, snarkjsLogger);
    console.log(`[determinism] ${name}: newZKey run B ...`);
    await snarkjs.zKey.newZKey(p.r1cs, ptauPath, runB, snarkjsLogger);
    const [ha, hb] = await Promise.all([sha256File(runA), sha256File(runB)]);
    console.log(`[determinism] run A sha256 = ${ha}`);
    console.log(`[determinism] run B sha256 = ${hb}`);
    if (ha !== hb) {
      fail(
        `BLOCKED:zKey.newZKey 双跑 sha256 不一致(${name},snarkjs ${SNARKJS_VERSION})。` +
          `D6 确定性假设不成立,推翻 D5 产物提交策略,停下交主控裁决。`,
      );
    }
    console.log(`[determinism] ${name}: 一致 — D6 成立(snarkjs ${SNARKJS_VERSION})`);
  } finally {
    // 注意:mismatch 路径走 fail() → process.exit(1),finally 不会执行,
    // .det-a/.det-b 会留在盘上——这是有意取证(供人工 diff 两份 zkey 定位不确定性来源),
    // 不是清理遗漏。只有"一致"或 newZKey 自身抛错时才走到这里清理。
    await fs.rm(runA, { force: true });
    await fs.rm(runB, { force: true });
  }
}

if (isDirectRun(import.meta.url)) {
  const names = circuitsFromArgv();
  for (const name of names) {
    if (hasFlag('--verify-determinism')) {
      await verifyDeterminism(name);
    } else {
      await setupCircuit(name);
    }
  }
  process.exit(0);
}
