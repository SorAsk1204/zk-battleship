/**
 * eventLogLines —— 事件日志条目 → 战报流水文案(Design §7.3 对战幕中缝事件日志,§7.6 文案纪律)。
 *
 * 把 useGame 的 GameLogEntry[](typed,按 pos 升序)投影成逐条可渲染的流水行。抽成纯函数的理由同
 * gameView / battleMarks:node vitest 可单测,且「按 myIdx 把同一事件说成『我方 / 对方』」这条措辞逻辑
 * (P0 视角的 attacker=0 是『我方炮击』,P1 视角同一条是『对方炮击』)是 demo 视角翻转的体现,必须钉死。
 *
 * 措辞规则(§7.6 动词化,与按钮一致):
 *   - joined    →「P1 加入对局」(对局开始;无我方/对方之分,用短地址);
 *   - fired     →「{我方/对方}开炮 {coord}」(side=attacker;myIdx===side → 我方);
 *   - resolved  →「{我方/对方}炮击 {coord} … {命中/未命中}」(side=defender,故 result 属于「打在 side 上」:
 *                 defender===myIdx → 是「我方被打」→ 措辞「对方炮击我方 {coord} … 命中/未命中」;
 *                 defender===对手 → 「我方炮击 {coord} … 命中/未命中」)。**注意 resolved 的 side 是 defender**,
 *                 与 fired 的 side(attacker)相反,措辞主语要据此翻面(见下实现)。
 *   - finished  →「对局结束 · {胜者措辞}({reason 人话})」。
 *
 * observer / 未连(myIdx=null/'observer'):无「我方/对方」立场,一律用 P0/P1 客观称谓。
 */
import { formatCoord, shortAddr } from '../lib/format.ts';
import type { GameLogEntry } from '../hooks/useGame.ts';
import type { MyIdx } from '../hooks/gameView.ts';

/** 一条渲染行(供 EventLog 组件画 `▸ {time} {text}`,带 hit 旗用于着色)。 */
export type LogLine = {
  /** 唯一键(块号:块内序)。 */
  key: string;
  /** 该事件墙钟(unix 秒);缺失则渲染层不显时间(降级)。 */
  ts?: number;
  /** 流水正文(不含前缀箭头 / 时间)。 */
  text: string;
  /** 命中事件(resolved result=1):渲染层据此把该行染 --flare。 */
  hit: boolean;
};

/** reason 短码 → 人话(GameFinished.reason:"17hits"/"timeout"/"cancelled")。 */
function reasonText(reason: string | undefined): string {
  switch (reason) {
    case '17hits':
      return '17 格命中';
    case 'timeout':
      return '超时判负';
    case 'cancelled':
      return '对局取消';
    default:
      return reason ? reason : '结束';
  }
}

/** side 是否「我」(玩家视角下);observer/null 永远不是「我」。 */
function isMine(side: 0 | 1 | undefined, myIdx: MyIdx): boolean {
  return (myIdx === 0 || myIdx === 1) && side === myIdx;
}

/** 坐标安全格式化(脏坐标降级 "?-?",不抛——同 gameView.safeCoord)。 */
function coord(x: number | undefined, y: number | undefined): string {
  if (x == null || y == null) return '?-?';
  try {
    return formatCoord(x, y);
  } catch {
    return '?-?';
  }
}

/**
 * 单条 GameLogEntry → 文案(纯函数,可单测)。myIdx 决定「我方/对方」措辞;非玩家用 P0/P1。
 */
export function logEntryText(e: GameLogEntry, myIdx: MyIdx): { text: string; hit: boolean } {
  switch (e.kind) {
    case 'joined':
      return { text: `${e.p1 ? shortAddr(e.p1) : '对手'} 加入对局`, hit: false };
    case 'fired': {
      // side=attacker。我方开炮 vs 对方开炮。
      const who = isPlayer(myIdx) ? (isMine(e.side, myIdx) ? '我方' : '对方') : sideLabel(e.side);
      return { text: `${who}开炮 ${coord(e.x, e.y)}`, hit: false };
    }
    case 'resolved': {
      // side=defender(这一炮打在 side 的棋盘上)。故「攻击方」= 对手(1-defender)。
      const result = e.result === 1 ? '命中' : '未命中';
      const hit = e.result === 1;
      if (isPlayer(myIdx)) {
        // defender===myIdx → 我被打(对方炮击我方);defender===对手 → 我打中/未中(我方炮击)。
        const text = isMine(e.side, myIdx)
          ? `对方炮击我方 ${coord(e.x, e.y)} … ${result}`
          : `我方炮击 ${coord(e.x, e.y)} … ${result}`;
        return { text, hit };
      }
      // observer:用客观称谓「攻击方 P? 炮击 P? 海域」。
      const def = e.side;
      const atk = def === 0 ? 1 : 0;
      return { text: `${sideLabel(atk)} 炮击 ${sideLabel(def)} 海域 ${coord(e.x, e.y)} … ${result}`, hit };
    }
    case 'finished': {
      const w = e.winner ? shortAddr(e.winner) : '';
      const base = w ? `对局结束 · ${w} 获胜` : '对局结束';
      return { text: `${base}(${reasonText(e.reason)})`, hit: false };
    }
    default:
      return { text: '', hit: false };
  }
}

function isPlayer(myIdx: MyIdx): myIdx is 0 | 1 {
  return myIdx === 0 || myIdx === 1;
}

/** 索引 → P0/P1 客观称谓(observer / finished 用)。 */
function sideLabel(side: 0 | 1 | undefined): string {
  return side === 1 ? 'P1' : 'P0';
}

/**
 * GameLogEntry[] → LogLine[](保序;调用方已按 pos 升序)。供 EventLog 组件渲染。
 */
export function toLogLines(entries: readonly GameLogEntry[], myIdx: MyIdx): LogLine[] {
  return entries.map((e) => {
    const { text, hit } = logEntryText(e, myIdx);
    return {
      key: `${e.pos.blockNumber.toString()}:${e.pos.logIndex}`,
      ts: e.ts,
      text,
      hit,
    };
  });
}
