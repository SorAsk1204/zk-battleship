/**
 * export.ts —— 导出 Solidity verifier(改名)+ 拷贝 wasm/zkey/vkey 到 artifacts/ + manifest。
 *
 * 用法:tsx scripts/export.ts [电路名...]
 *
 * 产物纪律:
 * - 仅 board/shot(生产电路)写 contracts/src/verifiers/ 与 artifacts/;
 *   其余电路(smoke)的 verifier 只写 build/<name>/Verifier.sol,不准污染 contracts/artifacts;
 * - artifacts/<name>/<name>.wasm 与 <name>.zkey 的精确路径必须对齐 lib/node.ts 的 artifactPaths;
 * - manifest.json 记每文件 sha256 + circom/snarkjs 版本 + 约束数 + ptau power(D5:换 zkey
 *   必须与 verifier 同 commit 原子更新)。
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import * as snarkjs from 'snarkjs';
import {
  ARTIFACTS_DIR,
  CIRCOM_VERSION,
  PKG_ROOT,
  REPO_ROOT,
  circuitPaths,
  circuitsFromArgv,
  fail,
  isDirectRun,
  isProductionCircuit,
  sha256File,
} from './common.ts';
import { SNARKJS_VERSION, type SetupMeta } from './setup.ts';

const TEMPLATE_PATH = path.join(
  PKG_ROOT,
  'node_modules',
  'snarkjs',
  'templates',
  'verifier_groth16.sol.ejs',
);
const VERIFIERS_DIR = path.join(REPO_ROOT, 'packages', 'contracts', 'src', 'verifiers');
const MANIFEST_PATH = path.join(ARTIFACTS_DIR, 'manifest.json');

type Manifest = {
  circomVersion: string;
  snarkjsVersion: string;
  circuits: Record<
    string,
    { nConstraints: number; ptauPower: number; files: Record<string, string> }
  >;
};

function pascal(name: string): string {
  return name.charAt(0).toUpperCase() + name.slice(1);
}

export async function exportCircuit(name: string): Promise<void> {
  const p = circuitPaths(name);
  for (const [what, file] of [
    ['zkey(先跑 setup)', p.zkey],
    ['wasm(先跑 compile)', p.wasm],
    ['verification_key(先跑 setup)', p.vkey],
    ['setup-meta(先跑 setup)', p.setupMeta],
  ] as const) {
    try {
      await fs.access(file);
    } catch {
      fail(`${file} 不存在 — 缺 ${what}`);
    }
  }

  // 1) 导出 verifier 并改名
  const template = await fs.readFile(TEMPLATE_PATH, 'utf8');
  let sol = await snarkjs.zKey.exportSolidityVerifier(p.zkey, { groth16: template });
  const contractName = `${pascal(name)}Verifier`;
  // 必须恰好出现 1 次:0 次没法改名,>1 次说明模板结构变了,replace 只改第一处会产出错误源码
  if (sol.split('contract Groth16Verifier').length !== 2) {
    const count = sol.split('contract Groth16Verifier').length - 1;
    fail(
      `verifier 模板输出里 "contract Groth16Verifier" 出现 ${count} 次,期望恰 1 次` +
        `(snarkjs ${SNARKJS_VERSION} 模板变了?),拒绝盲改名,请人工检查 ${TEMPLATE_PATH}`,
    );
  }
  sol = sol.replace('contract Groth16Verifier', `contract ${contractName}`);

  const production = isProductionCircuit(name);
  const verifierPath = production
    ? path.join(VERIFIERS_DIR, `${contractName}.sol`)
    : path.join(p.buildDir, 'Verifier.sol');
  await fs.mkdir(path.dirname(verifierPath), { recursive: true });
  await fs.writeFile(verifierPath, sol);
  console.log(`[export] ${name}: verifier contract ${contractName} -> ${verifierPath}`);

  if (!production) {
    console.log(`[export] ${name}: 非生产电路,跳过 artifacts/ 与 manifest(产物只在 build/)`);
    return;
  }

  // 2) 拷贝 wasm/zkey/vkey 到 artifacts/<name>/(路径对齐 lib/node.ts artifactPaths)
  const outDir = path.join(ARTIFACTS_DIR, name);
  await fs.mkdir(outDir, { recursive: true });
  const copies: Array<[string, string]> = [
    [p.wasm, path.join(outDir, `${name}.wasm`)],
    [p.zkey, path.join(outDir, `${name}.zkey`)],
    [p.vkey, path.join(outDir, 'verification_key.json')],
  ];
  const files: Record<string, string> = {};
  for (const [src, dest] of copies) {
    await fs.copyFile(src, dest);
    files[path.relative(ARTIFACTS_DIR, dest).replaceAll('\\', '/')] = await sha256File(dest);
  }
  console.log(`[export] ${name}: artifacts -> ${outDir}`);

  // 3) manifest.json(合并更新,保留其他电路条目)
  // 读取纪律:仅 ENOENT 视为首次生成;JSON 坏掉或缺 circuits 字段一律 fail 交人工——
  // 静默重置会把其他电路条目丢掉,违反 D5 的 manifest 原子配套纪律。
  const meta = JSON.parse(await fs.readFile(p.setupMeta, 'utf8')) as SetupMeta;
  let manifest: Manifest = {
    circomVersion: CIRCOM_VERSION,
    snarkjsVersion: SNARKJS_VERSION,
    circuits: {},
  };
  let raw: string | null = null;
  try {
    raw = await fs.readFile(MANIFEST_PATH, 'utf8');
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') {
      fail(`读取 ${MANIFEST_PATH} 失败(非 ENOENT):${(e as Error).message},请人工检查`);
    }
    // ENOENT → 首次生成,用上面的空 manifest
  }
  if (raw !== null) {
    let parsed: Manifest;
    try {
      parsed = JSON.parse(raw) as Manifest;
    } catch (e) {
      fail(
        `${MANIFEST_PATH} JSON 解析失败:${(e as Error).message}\n` +
          `拒绝静默重置(会丢其他电路条目),请人工修复;确认无需保留可手动删除后重跑。`,
      );
    }
    if (typeof parsed.circuits !== 'object' || parsed.circuits === null) {
      fail(
        `${MANIFEST_PATH} 缺 circuits 字段(结构损坏)。\n` +
          `拒绝静默重置(会丢其他电路条目),请人工修复;确认无需保留可手动删除后重跑。`,
      );
    }
    manifest = parsed;
  }
  manifest.circomVersion = CIRCOM_VERSION;
  manifest.snarkjsVersion = SNARKJS_VERSION;
  manifest.circuits[name] = {
    nConstraints: meta.nConstraints,
    ptauPower: meta.ptauPower,
    files,
  };
  // 写入原子化:先 tmp 再 rename,防写一半被打断留下损坏 manifest(读取侧会 fail 交人工)
  const manifestTmp = `${MANIFEST_PATH}.tmp`;
  await fs.writeFile(manifestTmp, JSON.stringify(manifest, null, 2));
  await fs.rename(manifestTmp, MANIFEST_PATH);
  console.log(`[export] ${name}: manifest -> ${MANIFEST_PATH}`);
}

if (isDirectRun(import.meta.url)) {
  for (const name of circuitsFromArgv()) {
    await exportCircuit(name);
  }
  process.exit(0);
}
