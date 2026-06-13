/**
 * EventLog —— 战报流水(Design §7.3 对战幕中缝事件日志:`▸ 14:02:33 我方炮击 D-7 … 命中`)。
 *
 * append-only 等宽流水,数据来自 useGame 的 eventLog(GameLogEntry[],按 pos 升序、ts 为块墙钟)。
 * 措辞(我方/对方,据 myIdx 翻面)走纯函数 toLogLines(见 eventLogLines.ts,已单测);本组件只负责
 * 渲染 + 自动滚到底(新事件到达时滚动条贴底,看最新一条;§7.3 流水质感)。
 *
 * 自动滚底实现:每次行数变化,把滚动容器 scrollTop 设为 scrollHeight。M4 可加「hover 暂停自动滚」,
 * 本任务功能版直接滚底(对战节奏慢,够用)。
 *
 * 纯展示 + 受控:entries / myIdx 由父级喂。空(尚无事件)→ 提示「等待交战…」。
 */
import { useEffect, useRef } from 'react';
import { formatLogTime } from '../lib/format.ts';
import type { GameLogEntry } from '../hooks/useGame.ts';
import type { MyIdx } from '../hooks/gameView.ts';
import { toLogLines } from './eventLogLines.ts';

export type EventLogProps = {
  entries: readonly GameLogEntry[];
  myIdx: MyIdx;
};

export default function EventLog({ entries, myIdx }: EventLogProps) {
  const lines = toLogLines(entries, myIdx);
  const scrollRef = useRef<HTMLDivElement>(null);

  // 新事件到达 → 滚到底(看最新)。依赖行数:行数变即滚(同一帧 DOM 已更新后置 scrollTop)。
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [lines.length]);

  return (
    <div className="flex flex-col border border-grid bg-console" data-testid="event-log">
      <div className="border-b border-grid px-3 py-1.5">
        <h2 className="font-mono text-[11px] uppercase tracking-wide text-mist">作战记录</h2>
      </div>
      <div
        ref={scrollRef}
        className="max-h-48 min-h-[6rem] overflow-y-auto px-3 py-2"
        role="log"
        aria-live="polite"
        aria-label="作战记录"
      >
        {lines.length === 0 ? (
          <p className="font-mono text-xs text-mist">等待交战…</p>
        ) : (
          <ul className="space-y-0.5">
            {lines.map((ln) => (
              <li
                key={ln.key}
                className={`font-mono text-[11px] leading-relaxed ${ln.hit ? 'text-flare' : 'text-foam'}`}
                data-hit={ln.hit ? '1' : '0'}
              >
                <span className="text-mist">▸ </span>
                {ln.ts !== undefined && <span className="text-mist">{formatLogTime(ln.ts)} </span>}
                {ln.text}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
