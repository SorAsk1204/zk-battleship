/**
 * ShotBurst —— 棋盘「炮击事件反馈」的一次性动效层(Design §7.3 命中/落空 + §7.4 动效预算)。
 *
 * §7.3(verbatim):对方应答到达(事件):miss → 白色涟漪扩散一次后留磷光点;hit → --flare 脉冲 +
 * 棋盘容器 120ms 横向 2px 抖动 + 留下持续低频闪烁的火点。
 *
 * 经 BoardGrid 的 `overlay` 槽渲染(绝对定位、pointer-events:none,对齐到 100 格区域原点),与 SonarBoard
 * 上的 SonarSweep / SonarAfterglow / Crosshair 作**同级兄弟**叠放;OwnBoard 此前无 overlay,本组件即其
 * 唯一 overlay。本层**只**画「应答到达」的一次性爆发:
 *   - miss → 一圈 --foam 涟漪从格心扩散一次后淡出(§7.3「白色涟漪」;白不在 7 色锁定调色板,涟漪是瞬态
 *     无色冲击波,用最浅的 --foam #C8D8DC 既达「白」的观感又守「全站只允许这些颜色」§7.2);
 *   - hit → 一记 --flare 脉冲(格心一团橙光放大+提亮再落回);**抖动不在此层**——hit 到达时本组件经
 *     onHit 回调通知父级(SonarBoard/OwnBoard)去抖它自己的棋盘容器(见各 Board 的 useBoardShake)。
 *
 * 「留下的标记 / 持续火点」**不归本层**:miss 留下的磷光点、hit 的实心 --flare 格,都是 BoardGrid 的
 * 静态着色(cellClassName/renderCell);声呐屏上 hit「持续低频闪烁的火点」是 M4.1 的 SonarAfterglow
 * (每 8s 扫过提亮一次=低频闪烁),已存在。本层与 afterglow **共存且互补**:afterglow = 常驻的扫过余辉,
 * 本层 = 应答**到达瞬间**的一次性爆发。叠放次序由 SonarBoard 决定(本层在 afterglow 之上、Crosshair 之下)。
 *
 * ── 承重不变量:刷新不重放(见 shotBurst.ts)──
 * 标记来自链上事件,刷新重进时整局历史 hit/miss 会被重放进 marks。**只有本会话新出现的格才放一次性
 * 动效**:seenRef 在**首渲染惰性播种**为当时 marks 的全部可触发格(历史标记直接进 seen,永不触发);
 * 此后每渲染用 newlyResolved(seen, marks) 取真正的新格,为其各起一个自卸载的 WAAPI 元件,并把它们并入
 * seen。纯增量在 shotBurst.ts 单测钉死;本组件是其薄壳(ref + effect + WAAPI)。
 *
 * 实现细节:
 *   - 活动爆发存 React state(各带唯一自增 id + cell + kind),渲染成带 ref 的元件;
 *   - 一个 effect(deps = marks 的稳定签名 markKey + reduced)算增量、推 state、并入 seen;
 *   - 每个爆发元件自己一个 effect 跑 WAAPI 关键帧,onfinish/卸载时把自己从 state 摘除(自卸载,无泄漏);
 *   - reduced-motion(§7.4「保留颜色反馈」):**仍把新格并入 seen**(避免攒着,等开启动效时一次性补爆),
 *     但**不**推任何爆发元件、不放动画。颜色反馈是 BoardGrid 静态着色,与本层无关,天然保留。
 *
 * 只动 transform/opacity(§7.4):涟漪 scale+opacity,脉冲 scale+opacity+drop-shadow(同 SonarAfterglow
 * 的 drop-shadow 余辉手段)。抖动(translateX)在父级容器,亦 transform。WAAPI 在卸载/依赖变化时 cancel。
 */
import { useEffect, useRef, useState } from 'react';
import { useReducedMotion } from '../../hooks/useReducedMotion.ts';
import { type MarkKind } from './battleMarks.ts';
import { CELL, N } from './sonarPhase.ts';
import { type BurstKind, burstableCells, newlyResolved } from './shotBurst.ts';

export type ShotBurstProps = {
  /** 该棋盘已算好的逐格标记(sonarMarks / ownMarks 产物)。只取新出现的 hit/miss 放一次性动效。 */
  marks: Map<number, MarkKind>;
  /**
   * 新 hit 到达时回调(供父级抖动其棋盘容器,§7.3「棋盘容器 120ms 横向 2px 抖动」)。
   * 一帧内多个新 hit 到达只回调一次(抖动是整盘事件,不按格叠加)。reduced-motion 时**不**回调
   * (抖动取消,§7.4),由父级 useBoardShake 同样 gate 兜底。省略则只放格内爆发、不抖。
   */
  onHit?: () => void;
};

/** 一个活动中的一次性爆发元件(自增 id 作 React key;每格受 seen 门控至多爆一次,id 只保证 key 唯一稳定)。 */
type ActiveBurst = { id: number; cell: number; kind: BurstKind };

/** 涟漪 / 脉冲时长(ms):一次性、短促。涟漪略长于脉冲(扩散需要被看清),都远短于 8s 扫描周期。 */
const RIPPLE_MS = 600;
const PULSE_MS = 460;

/**
 * miss 涟漪关键帧:格心一圈 --foam 描边环,从小放大到 ~2.4×、透明度从中亮淡出到 0(扩散一次即散)。
 * 只动 transform(scale)+ opacity。起始略带可见度,末态全透明 → onfinish 摘除。
 */
const RIPPLE_KEYFRAMES: Keyframe[] = [
  { offset: 0, transform: 'scale(0.35)', opacity: 0.85 },
  { offset: 0.6, opacity: 0.45 },
  { offset: 1, transform: 'scale(2.4)', opacity: 0 },
];

/**
 * hit 脉冲关键帧:格心一团 --flare,瞬间放大+提亮(drop-shadow 浓)再回落淡出。
 * scale + opacity + filter(drop-shadow 染 --flare,同 SonarAfterglow 的余辉手段)。
 */
const PULSE_KEYFRAMES: Keyframe[] = [
  { offset: 0, transform: 'scale(0.6)', opacity: 0.95, filter: 'drop-shadow(0 0 2px rgba(255,122,69,0.9))' },
  { offset: 0.35, transform: 'scale(1.5)', opacity: 1, filter: 'drop-shadow(0 0 8px rgba(255,122,69,0.95))' },
  { offset: 1, transform: 'scale(2.1)', opacity: 0, filter: 'drop-shadow(0 0 0 rgba(255,122,69,0))' },
];

/** 单个爆发元件:挂载即跑一次 WAAPI 动画,结束/卸载时回调父级把自己摘除(自卸载)。 */
function BurstSprite({ burst, onDone }: { burst: ActiveBurst; onDone: (id: number) => void }) {
  const ref = useRef<HTMLSpanElement | null>(null);
  // onDone 以 ref 持有,避免把它放进 effect deps(父级每渲染新函数会触发重跑/重播)。
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;

  useEffect(() => {
    const el = ref.current;
    if (!el) {
      // 理论不达(挂载即有 ref);兜底:无元件直接摘除,不卡在 state 里。
      onDoneRef.current(burst.id);
      return;
    }
    const isHit = burst.kind === 'hit';
    const anim = el.animate(isHit ? PULSE_KEYFRAMES : RIPPLE_KEYFRAMES, {
      duration: isHit ? PULSE_MS : RIPPLE_MS,
      easing: isHit ? 'cubic-bezier(0.2, 0.7, 0.3, 1)' : 'cubic-bezier(0.1, 0.6, 0.3, 1)',
      fill: 'forwards', // 停在末态(全透明)直到摘除,避免最后一帧闪回起始
    });
    anim.onfinish = () => onDoneRef.current(burst.id);
    // 卸载(依赖变化 / HMR / 父级清场):取消动画并摘除(幂等:onDone 摘不存在的 id 无害)。
    return () => {
      anim.cancel();
    };
    // 只在挂载时起一次(id 恒定;burst 内容随 id 唯一)。WAAPI 自己推进,无需 React 重渲染。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [burst.id]);

  const cx = (burst.cell % N) * CELL + CELL / 2;
  const cy = Math.floor(burst.cell / N) * CELL + CELL / 2;
  const isHit = burst.kind === 'hit';
  // 元件尺寸:脉冲是实心团(略小,靠 scale 放大),涟漪是描边环(略大,描边可见)。
  const size = isHit ? 16 : 20;

  return (
    <span
      ref={ref}
      aria-hidden
      data-burst={burst.kind}
      className="absolute block"
      style={{
        left: cx,
        top: cy,
        width: size,
        height: size,
        marginLeft: -size / 2,
        marginTop: -size / 2,
        borderRadius: '9999px', // 圆形冲击波/光团:圆角上限(§7.2 ≤4px)针对方角 UI,此为纯圆 sprite,非卡片直角
        // miss:--foam 描边圆环(中空,像水面涟漪);hit:--flare 实心光团。
        ...(isHit
          ? { background: 'var(--color-flare)' }
          : { border: '1.5px solid var(--color-foam)', background: 'transparent' }),
        opacity: 0, // 初值透明;WAAPI 第一帧即接管为可见,避免起始闪
        willChange: 'transform, opacity, filter',
      }}
    />
  );
}

export default function ShotBurst({ marks, onHit }: ShotBurstProps) {
  const reduced = useReducedMotion();
  // 已见格:首渲染惰性播种为当时 marks 的全部可触发格(历史标记直接进 seen,永不触发一次性动效)。
  // 这是「刷新不重放」的承重点——挂载时一块满是历史 hit/miss 的盘不会齐刷刷乱闪。
  const seenRef = useRef<Set<number> | null>(null);
  if (seenRef.current === null) seenRef.current = burstableCells(marks);

  const [active, setActive] = useState<ActiveBurst[]>([]);
  // 自增 id:给每个爆发一个唯一稳定的 React key。每格受 seen 门控、至多爆一次(newlyResolved 不会再吐已见格),
  // 故无需「同格复用 key」的考量;id 单调递增即可,跨 perspective remount 重置为 0 也无碍(旧实例 key 已随之销毁)。
  const nextIdRef = useRef(0);
  // onHit 以 ref 持有,避免进 effect deps(父级每渲染新函数)。
  const onHitRef = useRef(onHit);
  onHitRef.current = onHit;

  // marks 的稳定签名:仅 hit/miss 的 cell 升序拼接。pending 不入(不触发、且 resolve 后才算新事件)。
  // 用它作 effect 依赖而非 marks 本身(每渲染新引用),仅在「可触发标记集真的变了」时跑增量。
  const markKey = [...burstableCells(marks)].sort((a, b) => a - b).join(',');

  useEffect(() => {
    const seen = seenRef.current!;
    const fresh = newlyResolved(seen, marks);
    if (fresh.length === 0) return;
    // 无论是否 reduced,都并入 seen:reduced 时不爆但也不能攒着(否则开启动效那刻历史一次性补爆=乱闪)。
    for (const b of fresh) seen.add(b.cell);

    if (reduced) return; // §7.4:reduced 不放任何一次性动效(颜色反馈由静态着色保留)

    // 推入活动爆发(各配唯一 id)。
    setActive((prev) => [
      ...prev,
      ...fresh.map((b) => ({ id: nextIdRef.current++, cell: b.cell, kind: b.kind })),
    ]);
    // 本帧有任一新 hit → 通知父级抖一次盘(整盘事件,不按格叠加)。
    if (fresh.some((b) => b.kind === 'hit')) onHitRef.current?.();
    // markKey 变(新 hit/miss 落格)或 reduced 切换时跑;marks 在闭包读最新值(同 SonarAfterglow 模式)。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [markKey, reduced]);

  // 切到 reduced:清掉所有在飞爆发元件(立即静止;它们各自的 cleanup 会 cancel 动画)。
  useEffect(() => {
    if (reduced) setActive([]);
  }, [reduced]);

  const removeBurst = (id: number) => {
    setActive((prev) => prev.filter((b) => b.id !== id));
  };

  if (reduced || active.length === 0) {
    // reduced 或无在飞爆发:不渲染容器(DOM 干净)。seen 仍在 ref 里持续推进。
    return null;
  }

  return (
    <div data-testid="shot-burst" aria-hidden>
      {active.map((b) => (
        <BurstSprite key={b.id} burst={b} onDone={removeBurst} />
      ))}
    </div>
  );
}
