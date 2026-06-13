/**
 * AccountSwitcher —— demo 双账户(P0/P1)切换器(Task 3.3,仅 VITE_DEMO==='1' 渲染)。
 *
 * 行为:
 *   - 等 wagmi 自己的 reconnect() 落定后,补连任何尚未连接的 demo connector(让切换瞬时)。
 *   - useSwitchAccount 在已连接 connector 间切;当前账户用 useAccount 读,短地址展示。
 *   - 非 demo 构建:本组件根本不渲染(Layout 处 IS_DEMO 守卫 + 这里再防一道)。
 *
 * 为什么两个 connector 都要连:wagmi 同一时刻只有一个 active connection,但 useSwitchAccount
 * 只能在**已建立连接**的 connector 间切。两个都连上后,切换是纯本地状态翻转,不再触发连接握手
 * (local-account connector 的 connect 也无网络,见 wagmi.ts)。reconnectOnMount=true 下 reconnect()
 * 已把两个都连上,故本组件的补连通常一个都不做——只在 reconnect 被关/失败时兜底。
 *
 * 默认账户 = P0(确定性)+ 与 reload 恢复协调(Task 3.3 review issue 1+2,配合 wagmi.ts
 * isAuthorized 恒 true):
 *   - reconnect() 会把两个 demo connector 都连上,并按 persisted recentConnectorId 把 current 设成
 *     上次激活账户:全新会话 → recentConnectorId 不存在 → reconnect 取 connectors 数组首位 P0;
 *     切过 P1 再 reload → recentConnectorId='demo-p1' → 恢复 P1。
 *   - 「连完谁当 current」绝不靠 connect() 的 resolve 顺序(那样 P1 常赢,害得自然首动作是 P0
 *     createGame 的 demo 开局停在 P1)。改为:等 reconnect 落定(status connected/disconnected),
 *     只补连缺失者(**绝不重连已连接者**——connect() 会把 current 改成自己,会覆盖 reload 恢复),
 *     然后仅「全新会话」显式 switchAccount 到 P0 收尾。于是:全新 → P0;reload 后 → 留住恢复结果。
 *
 *   判别「全新 vs reload 恢复」靠 persisted recentConnectorId 是否存在(见 wagmi.ts isFreshDemoSession);
 *   读取时机(关键):recentConnectorId 一旦 connect() 成功就会被(重)写。reconnect() 在 Hydrate
 *   渲染期同步启动,但其首个 await 之前只**读**不写它;本组件首次渲染在那个同步点之后、所有 connect
 *   的微任务写入之前,故在首次渲染同步调 isFreshDemoSession() 并锁进 ref,拿到的是「本会话任何写入
 *   之前」的快照,判别可靠、不被竞态污染。
 */
import { useEffect, useRef } from 'react';
import { connect as connectAction, switchAccount as switchAccountAction } from 'wagmi/actions';
import { useAccount, useConfig, useConnectors, useSwitchAccount } from 'wagmi';
import { IS_DEMO, P0_CONNECTOR_ID, isFreshDemoSession } from '../lib/wagmi.ts';

/** 短地址:0x1234…5678(头 6 尾 4)。 */
function shortAddr(addr: string): string {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

export default function AccountSwitcher() {
  const config = useConfig();
  const connectors = useConnectors();
  const { connectors: activeConnectors, switchAccount } = useSwitchAccount();
  const { address, connector: current, status } = useAccount();

  // demo connectors(自建 type='demoLocalAccount');非 demo 时为空 → 不渲染。
  const demoConnectors = connectors.filter((c) => c.type === 'demoLocalAccount');

  // 「本会话是否全新」只在首次渲染同步定一次(见模块注释的读取时机)。后续渲染不再重读。
  const wasFreshSessionRef = useRef<boolean | null>(null);
  if (wasFreshSessionRef.current === null) {
    wasFreshSessionRef.current = isFreshDemoSession();
  }

  // 整套「补连缺失 + 兜底 P0」只执行一次(StrictMode 双调用 / status 多次变更都只跑一遍)。
  const ranRef = useRef(false);

  // 必须等 wagmi 自己的 reconnect() 落定再动手(status: reconnecting/connecting → connected/disconnected)。
  // 否则会和 reconnect 抢 current:reconnect 已把两个 demo connector 都连上、并按 recentConnectorId 把
  // current 设成上次激活账户(全新 → 数组首位 P0;切过 P1 再 reload → P1)。我们绝不能在它进行中插一脚。
  const settled = status === 'connected' || status === 'disconnected';

  useEffect(() => {
    if (!IS_DEMO) return;
    if (!settled) return; // 等 reconnect 落定
    if (ranRef.current) return;
    if (demoConnectors.length === 0) return;
    ranRef.current = true;

    const wasFreshSession = wasFreshSessionRef.current === true;
    // P0 = DEMO_ACCOUNTS[0] 对应的 connector(id=P0_CONNECTOR_ID,'demo-p0');找不到则不兜底。
    const p0 = demoConnectors.find((c) => c.id === P0_CONNECTOR_ID);

    void (async () => {
      // 1) 只补连**尚未连接**的 demo connector(让切换瞬时)。绝不重连已连接者——connect() 会把
      //    current 改成自己(见 @wagmi/core connect.js),重连已恢复的账户 = 覆盖 reload 恢复结果。
      //    正常路径(reconnectOnMount=true)reconnect 已把两个都连上,这里通常一个都不连;此分支只是
      //    reconnect 被关/失败时的兜底。
      for (const c of demoConnectors) {
        if (config.state.connections.has(c.uid)) continue;
        try {
          await connectAction(config, { connector: c });
        } catch {
          // connect 失败不阻断 UI(demo connect 无网络,实际不达)。
        }
      }

      // 2) 仅「全新会话」才把默认账户**确定性**定到 P0:此刻 reconnect 已落定、两个都已连接,
      //    switchAccount 排在最后执行,确定性地把 current 收到 P0(全新时 reconnect 通常已是 P0,
      //    这里多为 no-op;但不靠那个巧合,显式收口)。reload 恢复(非全新)完全不碰 current——
      //    放手让 reconnect 的还原结果(可能是 P1)留住。
      if (wasFreshSession && p0 && config.state.current !== p0.uid) {
        if (config.state.connections.has(p0.uid)) {
          try {
            await switchAccountAction(config, { connector: p0 });
          } catch {
            // 切换失败不阻断(理论不达:上一步已确保 p0 连接)。
          }
        }
      }
    })();
    // settled 后跑一次(ranRef 守卫);config/connectors 引用在 demo 下稳定。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settled, demoConnectors.length]);

  if (!IS_DEMO || demoConnectors.length === 0) return null;

  return (
    <div className="flex items-center gap-3" data-testid="account-switcher">
      <span className="font-mono text-xs text-mist">
        {address ? shortAddr(address) : '未连接'}
      </span>
      <div className="flex gap-1">
        {demoConnectors.map((c) => {
          const isActive = current?.uid === c.uid;
          // label 取 connector.name 末段(「Demo P0」→「P0」);id 形如 demo-p0。
          const label = c.name.replace(/^Demo\s+/, '');
          // 切换前需该 connector 已在已连接集合内(useSwitchAccount 只在已连接者间切)。
          const canSwitch = activeConnectors.some((a) => a.uid === c.uid);
          return (
            <button
              key={c.uid}
              type="button"
              data-testid={`switch-${c.id}`}
              onClick={() => {
                if (canSwitch) switchAccount({ connector: c });
              }}
              aria-pressed={isActive}
              className={
                isActive
                  ? 'border border-phosphor bg-grid px-3 py-1 font-mono text-xs text-phosphor'
                  : 'border border-grid px-3 py-1 font-mono text-xs text-mist hover:bg-grid'
              }
            >
              {label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
