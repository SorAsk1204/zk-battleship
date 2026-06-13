/**
 * AccountSwitcher —— demo 双账户(P0/P1)切换器(Task 3.3,仅 VITE_DEMO==='1' 渲染)。
 *
 * 行为:
 *   - 挂载时把两个 demo connector 都 connect(useConnect),让切换瞬时(无需现连)。
 *   - useSwitchAccount 在已连接 connector 间切;当前账户用 useAccount 读,短地址展示。
 *   - 非 demo 构建:本组件根本不渲染(Layout 处 IS_DEMO 守卫 + 这里再防一道)。
 *
 * 为什么 connect 两个 connector:wagmi 同一时刻只有一个 active connection,但 useSwitchAccount
 * 只能在**已建立连接**的 connector 间切。挂载即把 P0/P1 都连上,之后切换是纯本地状态翻转,
 * 不再触发连接握手(local-account connector 的 connect 也无网络,见 wagmi.ts)。
 */
import { useEffect } from 'react';
import { useAccount, useConnect, useConnectors, useSwitchAccount } from 'wagmi';
import { IS_DEMO } from '../lib/wagmi.ts';

/** 短地址:0x1234…5678(头 6 尾 4)。 */
function shortAddr(addr: string): string {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

export default function AccountSwitcher() {
  const connectors = useConnectors();
  const { connect } = useConnect();
  const { connectors: activeConnectors, switchAccount } = useSwitchAccount();
  const { address, connector: current } = useAccount();

  // demo connectors(自建 type='demoLocalAccount');非 demo 时为空 → 不渲染。
  const demoConnectors = connectors.filter((c) => c.type === 'demoLocalAccount');

  // 挂载时连接所有 demo connector(只连尚未连接的),让切换瞬时。
  useEffect(() => {
    if (!IS_DEMO) return;
    const connectedIds = new Set(activeConnectors.map((c) => c.uid));
    for (const c of demoConnectors) {
      if (!connectedIds.has(c.uid)) connect({ connector: c });
    }
    // 仅依赖 connector 列表长度与已连数量变化触发;connect/switchAccount 引用稳定(wagmi)。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [demoConnectors.length, activeConnectors.length]);

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
          return (
            <button
              key={c.uid}
              type="button"
              data-testid={`switch-${c.id}`}
              onClick={() => switchAccount({ connector: c })}
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
