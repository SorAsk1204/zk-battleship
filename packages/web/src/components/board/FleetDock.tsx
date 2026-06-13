/**
 * FleetDock —— 船坞(Design §7.3:列出 5 舰,点选→手持预览,已放置可拿回)。
 *
 * 纯展示 + 回调:不持有布阵状态(那在 NewGame 的 useReducer),只把「哪些船已放置 / 当前手持谁」
 * 渲染成可点条目,并把点击翻成 onSelect(shipId)。父级据该 shipId 是否已放置决定 carry vs pickup
 * (reducer 里 carry 对已放置船等价 pickup,故父级一律派 carry 即可,见 placement.ts)。
 *
 * 每艘船显示:舰名 + 长度(等宽,§7.6 数据用 mono)+ 状态(待部署 / 已就位)。
 * 当前手持船高亮(phosphor 边框);已放置船文字转 mist 并标「✓ 已就位」。
 * 条目是真 <button>(§7.7 可达 + 可键盘聚焦)。
 */
import { FLEET } from './placement.ts';

export type FleetDockProps = {
  /** placed[shipId] != null 表示该舰已就位。 */
  placed: readonly (unknown | null)[];
  /** 当前手持的 shipId(高亮),无则 null。 */
  carrying: number | null;
  /** 点选某舰(父级据已放置与否派 carry/pickup;reducer 已统一)。 */
  onSelect: (shipId: number) => void;
  /** 整体禁用(锁定后船坞冻结)。 */
  disabled?: boolean;
};

export default function FleetDock({ placed, carrying, onSelect, disabled = false }: FleetDockProps) {
  return (
    <div className="space-y-2" data-testid="fleet-dock">
      <h2 className="font-display text-sm font-bold tracking-wide text-foam">船坞</h2>
      <ul className="space-y-1.5">
        {FLEET.map((ship) => {
          const isPlaced = placed[ship.id] != null;
          const isCarrying = carrying === ship.id;
          // 状态色:手持=phosphor 边、已就位=mist 文字、待部署=foam 文字。
          const base =
            'flex w-full items-center justify-between border px-3 py-2 text-left transition-colors disabled:opacity-50';
          const tone = isCarrying
            ? 'border-phosphor bg-grid text-phosphor'
            : isPlaced
              ? 'border-grid bg-console text-mist hover:border-phosphor/60'
              : 'border-grid bg-console text-foam hover:border-phosphor/60';
          return (
            <li key={ship.id}>
              <button
                type="button"
                data-testid={`dock-ship-${ship.id}`}
                data-placed={isPlaced ? '1' : '0'}
                data-carrying={isCarrying ? '1' : '0'}
                disabled={disabled}
                aria-pressed={isCarrying}
                onClick={() => onSelect(ship.id)}
                className={`${base} ${tone}`}
              >
                <span className="flex items-center gap-2">
                  {/* 长度方块示意(等宽 len) */}
                  <span className="font-mono text-xs text-mist">{ship.len}格</span>
                  <span className="font-sans text-sm">{ship.name}</span>
                </span>
                <span className="font-mono text-[11px]">
                  {isCarrying ? '手持中' : isPlaced ? '✓ 已就位' : '待部署'}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
