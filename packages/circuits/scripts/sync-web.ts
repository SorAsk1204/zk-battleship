/**
 * sync-web.ts —— artifacts/ 整体同步到 web 静态目录(packages/web/public/zk/)。
 *
 * 用法:tsx scripts/sync-web.ts
 * web 包尚不存在时目录自建;artifacts/ 为空(M1 之前)打印提示并正常退出。
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { ARTIFACTS_DIR, REPO_ROOT } from './common.ts';

const DEST = path.join(REPO_ROOT, 'packages', 'web', 'public', 'zk');

const entries = await fs.readdir(ARTIFACTS_DIR).catch(() => [] as string[]);
if (entries.length === 0) {
  console.log(
    `[sync-web] ${ARTIFACTS_DIR} 不存在或为空(M1 跑过 build board/shot 后才有产物),跳过。`,
  );
  process.exit(0);
}

await fs.mkdir(DEST, { recursive: true });
await fs.cp(ARTIFACTS_DIR, DEST, { recursive: true });
console.log(`[sync-web] ${ARTIFACTS_DIR} -> ${DEST} (${entries.join(', ')})`);
process.exit(0);
