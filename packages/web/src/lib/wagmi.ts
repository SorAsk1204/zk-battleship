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
  fallback,
  http,
  webSocket,
  type EIP1193RequestFn,
  type Transport,
  type WalletClient,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { anvil } from 'viem/chains';
import { createConfig, createConnector } from 'wagmi';
import { injected } from 'wagmi/connectors';
import type { Address } from './contracts.ts';
import { DEMO_ACCOUNTS, type DemoAccount } from './demoAccounts.ts';

/** demo 链 = viem 内置 anvil(id 31337);其 rpcUrls.default 已含 http+ws 127.0.0.1:8545。 */
const DEMO_CHAIN = anvil;

/** VITE_DEMO==='1' 仅在 pnpm demo 启动的 dev server 注入(见 demo.ts / DECISIONS Task 2.5)。 */
export const IS_DEMO = import.meta.env.VITE_DEMO === '1';

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
 * demo 链的 transport:fallback([webSocket(ws), http(http)])。
 * rpcUrl 取 viem anvil chain 的默认(http://127.0.0.1:8545),ws 由 deriveWsUrl 推导。
 * 这里用 chain 默认而非 deployment.json:配置须静态,且 demo 的 rpcUrl 与 anvil chain 默认恒一致
 * (都是 127.0.0.1:8545);deployment.json 的 rpcUrl 仅供运行时校验/展示,不驱动静态 transport。
 */
const RPC_HTTP = DEMO_CHAIN.rpcUrls.default.http[0];
const RPC_WS = deriveWsUrl(RPC_HTTP);
const demoTransport: Transport = fallback([webSocket(RPC_WS), http(RPC_HTTP)]);

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
type LocalAccountProps = { account: DemoAccount };

function localAccountConnector(acct: DemoAccount) {
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

    let connected = false;

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
          const tx = (params as readonly Record<string, unknown>[])[0];
          return getWallet().sendTransaction({
            ...(tx as Parameters<WalletClient['sendTransaction']>[0]),
            account: getWallet().account!,
            chain: DEMO_CHAIN,
          });
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
        connected = true;
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
        connected = false;
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
        // demo 账户始终授权(无真实登录态),让 reconnect 能恢复。
        return connected;
      },
      onAccountsChanged() {
        // demo 账户固定,不会变;无需处理。
      },
      onChainChanged() {
        // demo 单链,不会变。
      },
      async onDisconnect() {
        connected = false;
        config.emitter.emit('disconnect');
      },
    };
  });
}

/**
 * connectors:
 *   - demo(VITE_DEMO==='1')→ 两个 local-account connector(P0/P1),AccountSwitcher 用
 *     useSwitchAccount 在二者间切。
 *   - 否则 → injected()(MetaMask 等),生产 / 普通 dev 路径(D14)。
 */
const connectors = IS_DEMO
  ? DEMO_ACCOUNTS.map((a) => localAccountConnector(a))
  : [injected()];

/**
 * wagmi 全局配置。multiInjectedProviderDiscovery:false——demo 不需要 EIP-6963 多注入发现
 * (会在有多个钱包扩展时弹一堆),且 demo connector 是自建的。
 */
export const wagmiConfig = createConfig({
  chains: [DEMO_CHAIN],
  connectors,
  transports: { [DEMO_CHAIN.id]: demoTransport },
  multiInjectedProviderDiscovery: false,
});

/** react-query client(wagmi v2 peer);Provider 在 main.tsx 包裹。 */
export const queryClient = new QueryClient();
