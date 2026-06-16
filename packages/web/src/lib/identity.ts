/**
 * 每个浏览器一把本地身份私钥(存 localStorage)。默认进来自动生成;可导入自己的私钥或重置。
 *
 * 取代原 demo 双账户(两把公知私钥打包进前端 = 谁都能签成对方):现在每个浏览器只握自己这一把 key、
 * 只能签自己的交易,合约按 msg.sender 鉴权 → 对手无法替你出招/应答。棋盘保密照旧靠 ZK 承诺,与私钥无关。
 *
 * 这条链免 gas(gasPrice 0),全新 0 余额账户即可发交易,故无需充值/水龙头,进来即玩(已实测)。
 *
 * ⚠️ key 存在 localStorage,非硬件钱包级保管:清缓存即换身份。但足以达成"对手控不了你、看不到你棋盘"。
 */
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import type { Address, Hex } from 'viem';

const LS_KEY = 'bs:identity:pk';
const PK_RE = /^0x[0-9a-fA-F]{64}$/;

export type Identity = { address: Address; privateKey: Hex };

function readKey(): Hex | null {
  try {
    const v = globalThis.localStorage?.getItem(LS_KEY);
    return v && PK_RE.test(v) ? (v as Hex) : null;
  } catch {
    return null;
  }
}

/** 读本地身份;没有就生成一把并存住(零输入分配)。无 localStorage(隐私模式 / 测试环境)→ 临时一把。 */
export function getOrCreateIdentity(): Identity {
  let pk = readKey();
  if (!pk) {
    pk = generatePrivateKey();
    try {
      globalThis.localStorage?.setItem(LS_KEY, pk);
    } catch {
      // 无持久层:用临时 key,本会话有效(刷新即换,但能玩)
    }
  }
  return { address: privateKeyToAccount(pk).address, privateKey: pk };
}

/** 导入自己的私钥(64 位 hex,带不带 0x 都行)。写入后调用方应 reload,让连接器用新 key 重建。 */
export function importIdentity(input: string): Identity {
  const t = input.trim();
  const pk = (t.startsWith('0x') ? t : `0x${t}`) as Hex;
  if (!PK_RE.test(pk)) throw new Error('私钥格式不对:应为 64 位十六进制(可带 0x 前缀)。');
  globalThis.localStorage?.setItem(LS_KEY, pk);
  return { address: privateKeyToAccount(pk).address, privateKey: pk };
}

/** 重置身份(删本地 key);调用方应 reload,让连接器重新生成一把。 */
export function resetIdentity(): void {
  try {
    globalThis.localStorage?.removeItem(LS_KEY);
  } catch {
    // 忽略
  }
}
