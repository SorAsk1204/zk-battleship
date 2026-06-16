/**
 * 顶栏身份芯片:显示本浏览器的身份地址 + 导入/重置。取代原 demo P0/P1 切换器
 * (每个浏览器 = 一个人,无切换;两台真机各自一个身份,各守一边)。
 *
 * 挂载时自动连接本地身份连接器:首访显式 connect();回访由 wagmi reconnectOnMount 还原。
 * 导入/重置写完 localStorage 后 reload —— 连接器在模块加载时按当前 key 建好,换 key 必须重建。
 */
import { useEffect, useRef, useState } from 'react';
import { connect as connectAction } from 'wagmi/actions';
import { useAccount, useConfig, useConnectors } from 'wagmi';
import { importIdentity, resetIdentity } from '../lib/identity.ts';

function shortAddr(a: string): string {
  return `${a.slice(0, 6)}…${a.slice(-4)}`;
}

export default function IdentityChip() {
  const config = useConfig();
  const connectors = useConnectors();
  const { address, status } = useAccount();
  const idConnector = connectors.find((c) => c.type === 'demoLocalAccount');
  const settled = status === 'connected' || status === 'disconnected';

  // 首访自动连接本地身份(回访 reconnectOnMount 已恢复)。整段只跑一次。
  const ranRef = useRef(false);
  useEffect(() => {
    if (!settled || ranRef.current || !idConnector) return;
    ranRef.current = true;
    if (!config.state.connections.has(idConnector.uid)) {
      void connectAction(config, { connector: idConnector }).catch(() => {});
    }
  }, [settled, idConnector, config]);

  const [open, setOpen] = useState(false);
  const [pk, setPk] = useState('');
  const [err, setErr] = useState<string | null>(null);

  function doImport(): void {
    try {
      importIdentity(pk);
      location.reload();
    } catch (e) {
      setErr((e as Error).message);
    }
  }

  function doReset(): void {
    resetIdentity();
    location.reload();
  }

  return (
    <div className="relative flex items-center gap-2" data-testid="identity-chip">
      <span className="font-mono text-xs text-mist">{address ? shortAddr(address) : '连接中…'}</span>
      <button
        type="button"
        data-testid="identity-menu-toggle"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="border border-grid px-2 py-1 font-mono text-xs text-mist hover:bg-grid"
      >
        身份
      </button>
      {open && (
        <div className="absolute right-0 top-full z-10 mt-2 w-72 space-y-3 border border-grid bg-console p-3 text-xs">
          <div className="space-y-1">
            <div className="text-mist">你的身份地址(仅本浏览器)</div>
            <div className="break-all font-mono text-foam">{address ?? '—'}</div>
          </div>
          <div className="space-y-1">
            <label className="text-mist" htmlFor="id-import">
              导入私钥(64 位 hex,跨设备复用同一身份时用)
            </label>
            <input
              id="id-import"
              data-testid="identity-import-input"
              value={pk}
              onChange={(e) => {
                setPk(e.target.value);
                setErr(null);
              }}
              placeholder="0x…"
              className="w-full border border-grid bg-abyss px-2 py-1 font-mono text-foam outline-none focus:border-phosphor"
            />
            {err && <div className="text-flare">{err}</div>}
            <button
              type="button"
              data-testid="identity-import-btn"
              onClick={doImport}
              disabled={!pk}
              className="border border-phosphor px-2 py-1 font-mono text-phosphor hover:bg-grid disabled:opacity-50"
            >
              导入并重载
            </button>
          </div>
          <button
            type="button"
            data-testid="identity-reset-btn"
            onClick={doReset}
            className="border border-grid px-2 py-1 font-mono text-mist hover:bg-grid"
          >
            重置身份(换一把新 key)
          </button>
        </div>
      )}
    </div>
  );
}
