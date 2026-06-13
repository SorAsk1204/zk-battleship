/**
 * gen-abi.mjs —— 从 Foundry 产物提取 Battleship ABI,生成 `src/lib/abi.ts`。
 *
 * 取数:packages/contracts/out/Battleship.sol/Battleship.json 的 `.abi`(**按合约名取**,
 * 同目录还有 IBoardVerifier.json / IShotVerifier.json 等接口空产物,绝不能误取)。
 *
 * 产物 abi.ts 写为 `export const battleshipAbi = [...] as const;`——`as const` 是 viem
 * 类型推断的硬要求(没有它 viem 无法从 ABI 静态推出函数/事件的参数与返回类型)。
 *
 * abi.ts 提交 git(接口 §6.3 锁定,不频繁变);本脚本保留供合约改动后重生成。
 * 幂等:内容不变不重写,避免无谓 git diff / 触发下游 watch。
 *
 * 运行:pnpm --filter @zk-battleship/web run gen:abi
 * 前置:需先 `pnpm --filter @zk-battleship/contracts run build`(out/ 是 gitignored 产物)。
 */
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
// scripts/ -> lib/ -> src/ -> web/ -> packages/ -> repo root
const REPO_ROOT = path.resolve(SCRIPT_DIR, '..', '..', '..', '..', '..');
const ARTIFACT = path.join(
  REPO_ROOT,
  'packages',
  'contracts',
  'out',
  'Battleship.sol',
  'Battleship.json',
);
const OUT = path.join(SCRIPT_DIR, '..', 'abi.ts');

const HEADER = `/**
 * 自动生成,请勿手改 —— 由 src/lib/scripts/gen-abi.mjs 从
 * packages/contracts/out/Battleship.sol/Battleship.json 提取。
 * 合约 ABI 变动后重跑:pnpm --filter @zk-battleship/web run gen:abi
 *
 * \`as const\` 供 viem 静态推断函数/事件类型,勿删。
 */`;

async function main() {
  let raw;
  try {
    raw = await readFile(ARTIFACT, 'utf8');
  } catch {
    console.error(
      `[gen-abi] 找不到 ${ARTIFACT}\n` +
        `         out/ 是 gitignored 产物,请先在 contracts 包跑 forge build:\n` +
        `         pnpm --filter @zk-battleship/contracts run build`,
    );
    process.exit(1);
  }

  const json = JSON.parse(raw);
  if (!Array.isArray(json.abi)) {
    console.error(`[gen-abi] ${ARTIFACT} 缺少 .abi 数组(取错文件?须为 Battleship.json)`);
    process.exit(1);
  }

  // 稳定缩进 2 空格;JSON 值即合法 TS 字面量(键名都是合法标识符或带引号字符串)。
  const body = JSON.stringify(json.abi, null, 2);
  const content = `${HEADER}\nexport const battleshipAbi = ${body} as const;\n`;

  // 幂等:内容一致则跳过写入(避免无谓 git diff)。
  let prev = null;
  try {
    prev = await readFile(OUT, 'utf8');
  } catch {
    /* 首次生成,无旧文件 */
  }
  if (prev === content) {
    console.log(`[gen-abi] abi.ts 内容未变,跳过写入。`);
    return;
  }

  await writeFile(OUT, content, 'utf8');
  console.log(`[gen-abi] 写入 ${OUT}（${json.abi.length} 条 ABI 条目）。`);
}

await main();
