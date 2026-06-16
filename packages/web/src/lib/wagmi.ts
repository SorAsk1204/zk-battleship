/**
 * wagmi 配置 + demo 双账户 local-account connector(Task 3.3 / D8 / D14)。
 *
 * 三件事:
 *   1. deriveWsUrl —— 从 deployment.json 的 http rpcUrl 推导 ws(anvil 同端口双协议),
 *      纯函数、单独导出供单测。
 *   2. localAccountConnector —— D14 fallback:不依赖 anvil 内置账户 unlocked,用 viem
 *      privateKeyToAccount 在浏览器本地签名(eth_sendRawTransaction),完全确定性。
 *   3. wagmiConfig —— 静态 createConfig(chain=anvil 31337,fallback([ws, http]) transport,
 *      VITE_DEMO 时挂两个 demo connector,否则 injected())。
 *
 * 为什么 transport 用 fallback([webSocket, http]):事件推送(watchContractEvent / 回执轮询)
 * 用 ws 实时更优,但 ws 偶发不可用时要能退到 http 轮询。anvil 8545 同端口同时服务 http 与 ws,
 * fallback 让 viem 优先 ws、失败回落 http,M3 对战幕的事件订阅与本任务的回执等待都受益。
 *
 * 为什么自建 connector 而非 wagmi mock(D14 取舍,本任务实证):mock connector 的 getProvider
 * 把 eth_sendTransaction **原样转发**给节点 HTTP RPC(读源码确认:无本地签名分支,params 透传到
 * rpc.http),依赖 anvil 对内置账户 unlocked 自动签名。那条路在 anvil 上能通,但:(a) from 由
 * 节点解释,P0/P1 切换正确性依赖节点账户解锁状态;(b) 一旦换非 anvil 节点即废。local-account
 * connector 每个实例裹一个私钥,writeContract → 本地钱包 client 签名 → eth_sendRawTransaction,
 * 与节点解锁状态无关,P0/P1 切换 = 切 connector(各自私钥),确定性最高——故本任务直接采用它。
 *
 * 合约地址不进本配置:deployment.json 的 battleship 地址要运行时 fetch(loadDeployment),
 * createConfig 是静态的(chain/transport/connectors),地址在 writeContract 调用点才喂。
 */
import { QueryClient } from '@tanstack/react-query';
import {
  createClient,
  createWalletClient,
  custom,
  defineChain,
  http,
  type EIP1193RequestFn,
  type Hex,
  type Transport,
  type WalletClient,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { createConfig, createConnector } from 'wagmi';
import type { Address } from './contracts.ts';
import { getOrCreateIdentity } from './identity.ts';

/**
 * 联盟链 = GoQuorum QBFT(chainId 1204)。RPC 同源 `/rpc`(nginx 反代到本机节点),
 * 故无论经公网 IP 还是 SSH 隧道访问都对得上、零 CORS。VITE_RPC_URL 可显式覆盖;
 * 非浏览器(vitest)回落到本地默认,仅为让 import 不崩(测试不发真实请求)。
 */
const RPC_HTTP =
  (import.meta.env.VITE_RPC_URL as string | undefined) ??
  (typeof window !== 'undefined' ? `${window.location.origin}/rpc` : 'http://127.0.0.1:8545');
const DEMO_CHAIN = defineChain({
  id: 1204,
  name: 'BSConsortium',
  nativeCurrency: { name: 'BSC', symbol: 'BSC', decimals: 18 },
  rpcUrls: { default: { http: [RPC_HTTP] } },
});

/** VITE_DEMO==='1' 仅在 pnpm demo 启动的 dev server 注入(见 demo.ts / DECISIONS Task 2.5)。 */
export const IS_DEMO = import.meta.env.VITE_DEMO === '1';

/**
 * P0 connector 的 id —— DEMO_ACCOUNTS[0].label='P0' → connector id `demo-p0`(见下 connect 的
 * id 模板 `demo-${label.toLowerCase()}`)。AccountSwitcher 据此定位「全新会话默认账户 = P0」的目标。
 */
export const P0_CONNECTOR_ID = 'demo-p0'; // 残留:demo 切换器已移除,仅留给 wagmi.test.ts 断言

/** wagmi 默认 storage 前缀('wagmi'),recentConnectorId 落在 localStorage 键 `wagmi.recentConnectorId`。 */
export const WAGMI_RECENT_CONNECTOR_KEY = 'wagmi.recentConnectorId';

/**
 * 本会话是否「全新」(无上个会话持久化的账户选择)。判据:wagmi 的 recentConnectorId 不存在。
 *
 * 用途(Task 3.3 review issue 2,配合 issue 1 的 isAuthorized 恒 true):reconnectOnMount 下
 * wagmi reconnect() 会按 recentConnectorId 把上次激活账户恢复为 current;AccountSwitcher 仅在
 * 「全新会话」时才强制默认到 P0,**绝不**覆盖 reload 恢复的选择。故需一个不被本会话后续 connect()
 * 写入污染的判据——recentConnectorId 的「存在与否」正是:存在 = 上个会话选过(reload 恢复),
 * 不存在 = 全新。只判存在(非空串),不解析 wagmi 序列化格式,对其格式变更稳健。
 *
 * 纯函数、显式传 storage(默认 globalThis.localStorage),供单测注入内存 storage;读抛(隐私模式 /
 * 禁 cookie)按「非全新」(false)处理:不强制 P0 也安全,reconnect 会把数组首位 P0 设为 current。
 */
export function isFreshDemoSession(storage: Storage | null | undefined = globalThis.localStorage): boolean {
  try {
    return !storage?.getItem(WAGMI_RECENT_CONNECTOR_KEY);
  } catch {
    return false;
  }
}

/**
 * http(s) rpcUrl → ws(s) url(anvil 同端口双协议)。
 * http→ws、https→wss;其余前缀原样返回(不编造)。纯函数,单独导出供单测。
 */
export function deriveWsUrl(rpcUrl: string): string {
  if (rpcUrl.startsWith('https://')) return `wss://${rpcUrl.slice('https://'.length)}`;
  if (rpcUrl.startsWith('http://')) return `ws://${rpcUrl.slice('http://'.length)}`;
  return rpcUrl;
}

/**
 * transport:http 直连(GoQuorum http RPC,经 nginx /rpc 反代)。GoQuorum 的 ws 在另一个端口、
 * 反代复杂,这里只走 http;事件订阅由 viem 在 http 上轮询(见下 wagmiConfig.pollingInterval)。
 */
const demoTransport: Transport = http(RPC_HTTP);

/**
 * D14 local-account connector:一个实例绑定一个 demo 账户私钥,在浏览器本地签名。
 *
 * getProvider 返回一个最小 EIP-1193 provider(custom(...) 包装),request 分流:
 *   - eth_accounts / eth_requestAccounts → 返回本账户地址(连接即授权,无弹窗);
 *   - eth_chainId → 本链 id(hex);
 *   - eth_sendTransaction → 交给 viem 钱包 client(account=本私钥)本地签名并发
 *     eth_sendRawTransaction;wagmi 的 writeContract 默认就调 eth_sendTransaction,故透明工作;
 *   - 其余(eth_call / eth_getTransactionReceipt / eth_getLogs / eth_estimateGas …)→ 透传给
 *     anvil 的 http transport(读链 + 回执 + 日志)。
 *
 * wagmi getConnectorClient:本 connector 不实现 getClient,wagmi 走默认路径——用 connection
 * 账户 + custom(provider) 造 client。该账户是 json-rpc 型(地址),viem writeContract 因此走
 * eth_sendTransaction,正好被本 provider 截获本地签名。
 */
/** 本地账户(身份)最小信息;取代原 DemoAccount(其 label 收紧为 'P0'|'P1',这里放开为 string)。 */
type LocalAcct = { address: Address; privateKey: Hex; label: string };
type LocalAccountProps = { account: LocalAcct };

function localAccountConnector(acct: LocalAcct) {
  return createConnector<unknown, LocalAccountProps>((config) => {
    // 本账户的本地签名钱包 client(account=私钥);transport 用 http 直连 anvil(发 raw tx 用)。
    let wallet: WalletClient | undefined;
    function getWallet(): WalletClient {
      if (!wallet) {
        wallet = createWalletClient({
          account: privateKeyToAccount(acct.privateKey),
          chain: DEMO_CHAIN,
          transport: http(RPC_HTTP),
        });
      }
      return wallet;
    }

    // 只读透传用的轻 client(eth_call / 回执 / 日志等非签名方法)。
    let reader: ReturnType<typeof createClient> | undefined;
    function getReader() {
      if (!reader) {
        reader = createClient({ chain: DEMO_CHAIN, transport: http(RPC_HTTP) });
      }
      return reader;
    }

    // EIP-1193 request:签名方法走本地钱包,其余透传只读 client。
    const request: EIP1193RequestFn = (async ({ method, params }) => {
      switch (method) {
        case 'eth_accounts':
        case 'eth_requestAccounts':
          return [acct.address];
        case 'eth_chainId':
          return `0x${DEMO_CHAIN.id.toString(16)}`;
        case 'eth_sendTransaction': {
          // params[0] 是 viem 组好的 tx request(from/to/data/gas/…)。本地签名 + 发 raw tx。
          // GoQuorum 免 gas(--miner.gasprice 0):强制 legacy gasPrice:0、剥掉 1559 字段,
          // 避开 viem 在该链上的 EIP-1559 费用估算(与 de-risk/deploy 脚本同法,已实证可用)。
          const tx = (params as readonly Record<string, unknown>[])[0];
          const req = {
            ...tx,
            maxFeePerGas: undefined,
            maxPriorityFeePerGas: undefined,
            type: undefined,
            gasPrice: 0n,
            account: getWallet().account!,
            chain: DEMO_CHAIN,
          } as unknown as Parameters<WalletClient['sendTransaction']>[0];
          return getWallet().sendTransaction(req);
        }
        default:
          // 其余方法透传给 anvil(只读 client 的底层 EIP-1193 request)。
          return getReader().request({ method, params } as Parameters<
            ReturnType<typeof createClient>['request']
          >[0]);
      }
    }) as EIP1193RequestFn;

    const provider = custom({ request })({ retryCount: 0 });

    return {
      id: `demo-${acct.label.toLowerCase()}`,
      name: `Demo ${acct.label}`,
      type: 'demoLocalAccount',
      account: acct,
      async setup() {
        // 无需 setup;占位以满足类型(connect 即返回固定账户)。
      },
      async connect<withCapabilities extends boolean = false>(params?: {
        chainId?: number;
        isReconnecting?: boolean;
        withCapabilities?: withCapabilities | boolean;
      }) {
        // accounts 随 withCapabilities 取两种形状(对齐 CreateConnectorFn 的条件类型),demo 固定单账户。
        // 与 mock connector 同法:用 as 收口 TS 无法从运行期 ternary 反推的条件类型。
        const accounts = (
          params?.withCapabilities
            ? [{ address: acct.address, capabilities: {} }]
            : [acct.address]
        ) as unknown as withCapabilities extends true
          ? readonly { address: Address; capabilities: Record<string, unknown> }[]
          : readonly Address[];
        return { accounts, chainId: DEMO_CHAIN.id as number };
      },
      async disconnect() {
        // demo 无真实连接态可拆;占位以满足 Connector 接口(切账户走 switchAccount,不 disconnect)。
      },
      async getAccounts() {
        return [acct.address] as readonly Address[];
      },
      async getChainId() {
        return DEMO_CHAIN.id;
      },
      async getProvider() {
        return provider;
      },
      async isAuthorized() {
        // demo 账户始终授权:无真实登录态可失效,私钥已在 bundle 内,connect 必然成功。
        // 必须恒 true(而非内存 connected 标志)——reconnect() 用 isAuthorized 作门:返 false 会
        // 跳过该 connector,于是 reload 后 wagmi 什么都不恢复、persisted recentConnectorId/current 作废,
        // AccountSwitcher 只能从零重连(闪一下 + 丢上次选的账户)。恒 true 让 reconnect 按
        // recentConnectorId 把上次激活的那个账户(P0 或切过的 P1)确定性地恢复回来(见 @wagmi/core
        // reconnect.js:recentConnectorId 排到首位、首个 isAuthorized 成功者成为 current)。
        return true;
      },
      onAccountsChanged() {
        // demo 账户固定,不会变;无需处理。
      },
      onChainChanged() {
        // demo 单链,不会变。
      },
      async onDisconnect() {
        config.emitter.emit('disconnect');
      },
    };
  });
}

/**
 * connectors:单一**本地身份**连接器——每个浏览器一把自己的 key(getOrCreateIdentity,见 identity.ts)。
 * 取代原 demo 双账户:浏览器只握自己这把 key、只能签自己的交易,对手无法替你出招(合约按 msg.sender 鉴权)。
 * label 用「我」(顶栏 IdentityChip 只显地址,不显这个 label)。
 */
const connectors = [localAccountConnector({ ...getOrCreateIdentity(), label: '我' })];

/**
 * wagmi 全局配置。multiInjectedProviderDiscovery:false——demo 不需要 EIP-6963 多注入发现
 * (会在有多个钱包扩展时弹一堆),且 demo connector 是自建的。
 */
export const wagmiConfig = createConfig({
  chains: [DEMO_CHAIN],
  connectors,
  transports: { [DEMO_CHAIN.id]: demoTransport },
  multiInjectedProviderDiscovery: false,
  pollingInterval: 1500,
});

/** react-query client(wagmi v2 peer);Provider 在 main.tsx 包裹。 */
export const queryClient = new QueryClient();
