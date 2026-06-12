/**
 * scripts/ 共用工具 —— 路径约定、circom 名单解析、r1cs 约束数读取、sha256。
 *
 * 约定(全部脚本遵守,见 DECISIONS.md「Windows 专项纪律」):
 * - child_process 一律 execFile + 数组传参,绝不字符串拼接命令;
 * - snarkjs / r1csfile 默认会构建 bn128 曲线(worker 线程),Node 不会自然退出,
 *   因此每个 CLI 入口脚本结尾必须显式 process.exit(0);
 * - 失败走 fail():非零退出 + 人话错误。
 */
import { execFile as execFileCb } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

export const execFile = promisify(execFileCb);

/** packages/circuits 包根(scripts/ 的上一级) */
export const PKG_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
/** 仓库根 */
export const REPO_ROOT = path.resolve(PKG_ROOT, '..', '..');

export const BUILD_DIR = path.join(PKG_ROOT, 'build');
export const PTAU_DIR = path.join(PKG_ROOT, 'ptau');
export const ARTIFACTS_DIR = path.join(PKG_ROOT, 'artifacts');

/** 锁定的工具链版本(漂移即报错,防 zkey/verifier 不可复现) */
export const CIRCOM_VERSION = '2.1.9';

/** 默认电路清单(M1 起为真电路;smoke 只通过显式 argv 传入) */
export const DEFAULT_CIRCUITS = ['board', 'shot'] as const;

/** 只有默认清单里的电路(生产电路)产物允许进 contracts/ 与 artifacts/;其余(如 smoke)只活在 build/ */
export function isProductionCircuit(name: string): boolean {
  return (DEFAULT_CIRCUITS as readonly string[]).includes(name);
}

/** 全部脚本共用的 flag 白名单(目前仅 setup.ts 用到一个) */
const KNOWN_FLAGS = new Set(['--verify-determinism']);

/** argv 中以 - 开头但不在白名单的一律 fail,防 typo 静默忽略 */
export function assertKnownFlags(argv: string[] = process.argv.slice(2)): void {
  for (const a of argv) {
    if (a.startsWith('-') && !KNOWN_FLAGS.has(a)) {
      fail(`未知 flag "${a}"(白名单:${[...KNOWN_FLAGS].join(', ')})`);
    }
  }
}

/** argv 里的非 flag 参数作为电路名;无参数时回落默认清单 */
export function circuitsFromArgv(argv: string[] = process.argv.slice(2)): string[] {
  assertKnownFlags(argv);
  const names = argv.filter((a) => !a.startsWith('-'));
  for (const n of names) {
    if (!/^[a-z][a-zA-Z0-9_]*$/.test(n)) {
      fail(`非法电路名 "${n}"(只允许小写字母开头的标识符)`);
    }
  }
  return names.length > 0 ? names : [...DEFAULT_CIRCUITS];
}

export function hasFlag(flag: string, argv: string[] = process.argv.slice(2)): boolean {
  return argv.includes(flag);
}

/** 单一真理源:每个电路的产物路径布局(circom_tester 期望 <output>/<name>_js/<name>.wasm 同款布局) */
export function circuitPaths(name: string) {
  const buildDir = path.join(BUILD_DIR, name);
  return {
    source: path.join(PKG_ROOT, `${name}.circom`),
    buildDir,
    r1cs: path.join(buildDir, `${name}.r1cs`),
    sym: path.join(buildDir, `${name}.sym`),
    wasm: path.join(buildDir, `${name}_js`, `${name}.wasm`),
    zkey: path.join(buildDir, `${name}.zkey`),
    vkey: path.join(buildDir, 'verification_key.json'),
    /** setup 幂等性旁车文件(r1cs hash + 约束数 + ptau power) */
    setupMeta: path.join(buildDir, 'setup-meta.json'),
  };
}

export function fail(message: string): never {
  console.error(`\n[ERROR] ${message}`);
  process.exit(1);
}

/** 流式 sha256,避免把大 zkey 整个读进内存 */
export function sha256File(file: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    createReadStream(file)
      .on('error', reject)
      .on('data', (chunk) => hash.update(chunk))
      .on('end', () => resolve(hash.digest('hex')));
  });
}

export type R1csStats = {
  nConstraints: number;
  nPubInputs: number;
  nPrvInputs: number;
  nOutputs: number;
  nVars: number;
  /** 实际走通的读取路径(报告用) */
  via: 'snarkjs.r1cs.info' | 'r1csfile.readR1cs';
};

/**
 * 读 r1cs 头部统计(抛错版,测试用)。优先 snarkjs.r1cs.info(实测 0.7.6 返回
 * readR1cs 的完整结构,不只打日志);若返回结构异常,fallback 直接用 r1csfile
 * (snarkjs 的依赖)。两条路都失败时 throw —— mocha 能正常报告失败,而不是
 * 整个进程被 process.exit 掐掉。
 * 注意:两条路默认都会 getCurveFromR 起 bn128 worker,CLI 调用方脚本必须 process.exit。
 */
export async function readR1csStatsThrows(r1csPath: string): Promise<R1csStats> {
  // 五个字段全部校验为有限数:任何一个 NaN/undefined 流入 choosePower 都会算出垃圾 power
  const STAT_FIELDS = ['nConstraints', 'nPubInputs', 'nPrvInputs', 'nOutputs', 'nVars'] as const;
  const pick = (cir: Record<string, unknown>, via: R1csStats['via']): R1csStats | null => {
    for (const f of STAT_FIELDS) {
      const v = cir[f];
      if (typeof v !== 'number' || !Number.isFinite(v)) return null;
    }
    const { nConstraints, nPubInputs, nPrvInputs, nOutputs, nVars } = cir as Record<
      string,
      number
    >;
    return { nConstraints, nPubInputs, nPrvInputs, nOutputs, nVars, via };
  };

  let snarkjsError: string;
  try {
    const snarkjs = await import('snarkjs');
    const info = (await snarkjs.r1cs.info(r1csPath)) as Record<string, unknown>;
    const stats = pick(info, 'snarkjs.r1cs.info');
    if (stats) return stats;
    snarkjsError = `返回结构异常(${STAT_FIELDS.join('/')} 存在缺失或非有限数字段)`;
  } catch (e) {
    snarkjsError = (e as Error).message;
  }

  let r1csfileError: string;
  try {
    const { readR1cs } = await import('r1csfile');
    const cir = (await readR1cs(r1csPath, {
      loadConstraints: false,
      loadMap: false,
    })) as Record<string, unknown>;
    const stats = pick(cir, 'r1csfile.readR1cs');
    if (stats) return stats;
    r1csfileError = `返回结构异常(${STAT_FIELDS.join('/')} 存在缺失或非有限数字段)`;
  } catch (e) {
    r1csfileError = (e as Error).message;
  }

  throw new Error(
    `无法从 ${r1csPath} 读出约束数,两条路都失败:\n` +
      `  - snarkjs.r1cs.info: ${snarkjsError}\n` +
      `  - r1csfile.readR1cs: ${r1csfileError}`,
  );
}

/** 读 r1cs 头部统计(CLI 版):失败走 fail() 非零退出,脚本入口用;测试请用 readR1csStatsThrows */
export async function readR1csStats(r1csPath: string): Promise<R1csStats> {
  try {
    return await readR1csStatsThrows(r1csPath);
  } catch (e) {
    fail((e as Error).message);
  }
}

/** 判断模块是否被直接执行(tsx scripts/x.ts ...),而非被 build.ts import */
export function isDirectRun(moduleUrl: string): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  // Windows 盘符大小写可能不一致,统一小写比较
  return pathToFileURL(path.resolve(entry)).href.toLowerCase() === moduleUrl.toLowerCase();
}
