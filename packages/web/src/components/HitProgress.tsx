/**
 * HitProgress —— 双方命中进度刻度条(Design §7.3 对战幕中缝:0–17 刻度条)。
 *
 * 两条 0–17 的刻度条,显示「各方被命中数」(§4:某方累计被命中 17 即对方获胜)。语义沿用 GameView：
 * myHits = 我**被**命中数,opponentHits = 对手**被**命中数。哪条先到 17,哪方先输——故两条都是「战损
 * 进度」,满格 = 该方落败。我方条用 --flare(我在挨打,危险色),对手条用 --phosphor(我在推进,主色)。
 *
 * 数字用等宽(§7.2 font-mono 数据质感)。**功能版**:静态填充条(无动画过渡;M4 可加填充动效)。
 *
 * 纯展示:myHits/opponentHits 由父级喂(observer/null 时父级传 undefined → 显 "—",条空)。
 */
const TOTAL = 17;

export type HitProgressProps = {
  /** 我被命中数(0–17);undefined(旁观)→ 显 "—"。 */
  myHits: number | undefined;
  /** 对手被命中数(0–17);undefined(旁观)→ 显 "—"。 */
  opponentHits: number | undefined;
  /** 旁观视角:标签改用 P0/P1 客观称谓(避免「我方/对手」)。 */
  p0Label?: string;
  p1Label?: string;
};

/** 单条刻度条。filled/total → 宽度百分比;color 决定填充色。 */
function Bar({
  label,
  hits,
  color,
  testid,
}: {
  label: string;
  hits: number | undefined;
  color: 'flare' | 'phosphor';
  testid: string;
}) {
  const n = hits ?? 0;
  const pct = Math.min(100, Math.round((n / TOTAL) * 100));
  const fill = color === 'flare' ? 'bg-flare' : 'bg-phosphor';
  return (
    <div data-testid={testid}>
      <div className="mb-1 flex items-baseline justify-between">
        <span className="text-xs text-mist">{label}</span>
        <span className={`font-mono text-sm font-bold ${color === 'flare' ? 'text-flare' : 'text-phosphor'}`}>
          {hits === undefined ? '—' : `${n} / ${TOTAL}`}
        </span>
      </div>
      {/* 槽 + 填充(1px grid 边框,直角,§7.2)。role=progressbar 报可访问值。 */}
      <div
        className="h-2 w-full border border-grid bg-abyss"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={TOTAL}
        aria-valuenow={hits ?? 0}
        aria-label={label}
      >
        <div className={`h-full ${fill}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

export default function HitProgress({ myHits, opponentHits, p0Label, p1Label }: HitProgressProps) {
  // 旁观:用 P0/P1 标签(父级传入);玩家:我方/对手。
  const observer = p0Label !== undefined && p1Label !== undefined;
  return (
    <div className="space-y-3 border border-grid bg-console px-4 py-3" data-testid="hit-progress">
      <Bar
        label={observer ? `${p0Label} 战损` : '我方战损(被命中)'}
        hits={myHits}
        color="flare"
        testid="hit-progress-me"
      />
      <Bar
        label={observer ? `${p1Label} 战损` : '对手战损(被命中)'}
        hits={opponentHits}
        color="phosphor"
        testid="hit-progress-opp"
      />
    </div>
  );
}
