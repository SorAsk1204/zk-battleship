/**
 * battleReport —— 结算幕「战报」的纯派生核(Design §7.3:展示总回合、命中率、用时)。
 *
 * 这是「事件日志(GameLogEntry[],useGame 回放 ShotResolved/GameFinished 等)+ 当前视角(GameView)
 * → 战报数字」的唯一映射,与 React/网络全无关——抽成纯函数,在 node 环境单测钉死(同 gameView/
 * eventLogLines/battleMarks 的治理:本仓 vitest 无 testing-library,纯函数是唯一可单测层)。
 *
 * 为何战报全部从 eventLog 派生、不引入新链上读 / 新乐观态(任务纪律 + §7.1 决策):
 *   对局的全部「过程量」都在事件里——ShotResolved 给出每一炮的 (defender, x, y, result),
 *   按 defender 分组即可重建「谁打了谁、命中没」;GameFinished 给出 winner+reason;块时间(ts)给出
 *   墙钟。最终命中数(myHits/opponentHits)直接取 view(链上 hits 快照,真理源),不从事件累加
 *   (事件累加与 view 应当一致,但 view 是 struct 真值,优先用它,避免回放不全时少算)。
 *
 * 视角相对(§7.1):defender===myIdx 的 ShotResolved = 对手打我(我是被打方);defender===对手 = 我打
 * 对手。故「我方炮击数 / 命中数」= 统计 defender===对手 的事件;对手侧对称。observer/未连(myIdx 非
 * 0/1)时无「我方」立场——myHitRate/opponentHitRate 给 null(渲染层显「—」),其余客观量(rounds/
 * duration/双方命中数若 view 给得出)照常。
 */
import type { GameLogEntry } from '../hooks/useGame.ts';
import type { GameView, MyIdx } from '../hooks/gameView.ts';

/** 一方的炮击统计(发炮数 / 命中数 / 命中率)。命中率在 fired===0 时为 null(无从计算,渲染显「—」)。 */
export type SideShooting = {
  /** 该方已发出的炮数(= 对方棋盘上的 ShotResolved 数)。 */
  fired: number;
  /** 其中命中数(result===1)。 */
  hits: number;
  /** 命中率 hits/fired ∈ [0,1];fired===0 → null。 */
  rate: number | null;
};

export type BattleReport = {
  /**
   * 总回合数 = 已应答炮击数(ShotResolved 事件数)。§4.2:每炮无论 hit/miss 都换边,一次
   * attack→respond 即一个回合,故「已 resolved 的炮数」就是双方合计走过的回合数。pending(已 attack
   * 未 respond)不计入(尚未走完一个回合)。
   */
  rounds: number;
  /** 我方炮击统计(defender===对手 的事件);observer/未连 → fired/hits=0、rate=null。 */
  mine: SideShooting;
  /** 对手炮击统计(defender===我 的事件);observer/未连 → fired/hits=0、rate=null。 */
  opponent: SideShooting;
  /**
   * 用时(秒)= 事件时间跨度(最早 ts → 最晚 ts)。事件日志无 GameCreated 项(useGame 只回放
   * Joined/Fired/Resolved/Finished),故用「日志里最早带 ts 的事件」到「最晚带 ts 的事件」的跨度近似
   * 全局时长——通常最早是 GameJoined(开战)、最晚是 GameFinished(结束),贴合「整局用时」。
   * 无任何带 ts 事件(块时间尚未补全 / 全失败)→ null(渲染显「—」)。
   */
  durationSec: number | null;
  /** 我方最终被命中数(取 view.myHits,链上真值);observer → undefined。 */
  myHits: number | undefined;
  /** 对手最终被命中数(取 view.opponentHits);observer → undefined。 */
  opponentHits: number | undefined;
  /**
   * 结束原因码(取 eventLog 里 kind==='finished' 的 reason:"17hits"/"timeout"/"cancelled");
   * 无 finished 事件(尚未结束 / 回放缺失)→ undefined。渲染层据此出人话 reason 文案。
   */
  finishReason: string | undefined;
};

/** mm:ss 格式化(用时展示)。负数 / NaN 归 0;超 99:59 仍按真实分钟显示(不截断)。 */
export function formatDuration(totalSec: number | null): string {
  if (totalSec === null || !Number.isFinite(totalSec) || totalSec < 0) return '--:--';
  const s = Math.floor(totalSec);
  const mm = Math.floor(s / 60);
  const ss = s % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(mm)}:${pad(ss)}`;
}

/** 命中率 → 百分比串(如 0.6 → "60%");null → "—"。四舍五入到整数百分点。 */
export function formatRate(rate: number | null): string {
  if (rate === null) return '—';
  return `${Math.round(rate * 100)}%`;
}

/**
 * 从事件日志 + 视图派生战报(纯函数)。
 *
 * @param eventLog useGame 的事件日志(按 pos 升序、ts 为块墙钟;本函数不依赖顺序,只分组/取极值)
 * @param view     当前 GameView(取 myIdx 定立场、myHits/opponentHits 取链上最终命中)
 */
export function computeBattleReport(
  eventLog: readonly GameLogEntry[],
  view: GameView,
): BattleReport {
  const myIdx = view.myIdx;
  const isPlayer = myIdx === 0 || myIdx === 1;
  const me = isPlayer ? (myIdx as 0 | 1) : null;
  const foe = me === null ? null : ((1 - me) as 0 | 1);

  let rounds = 0;
  let minTs: number | undefined;
  let maxTs: number | undefined;
  let finishReason: string | undefined;

  // 双方炮击统计(按 defender 分组:defender 是被打方,故「打 defender 的人」是 1-defender)。
  let myFired = 0;
  let myHitsLanded = 0;
  let oppFired = 0;
  let oppHitsLanded = 0;

  for (const e of eventLog) {
    // 用时跨度:任何带 ts 的事件都参与取极值(min/max)。
    if (e.ts !== undefined) {
      if (minTs === undefined || e.ts < minTs) minTs = e.ts;
      if (maxTs === undefined || e.ts > maxTs) maxTs = e.ts;
    }

    if (e.kind === 'resolved') {
      rounds += 1;
      // side 是 defender(被打方);该炮的攻击方 = 1-defender。统计「攻击方为我 / 为对手」。
      const defender = e.side;
      if (defender === 0 || defender === 1) {
        const attacker = (1 - defender) as 0 | 1;
        const hit = e.result === 1;
        if (me !== null) {
          if (attacker === me) {
            myFired += 1;
            if (hit) myHitsLanded += 1;
          } else if (attacker === foe) {
            oppFired += 1;
            if (hit) oppHitsLanded += 1;
          }
        }
      }
    } else if (e.kind === 'finished') {
      // reason 取最后一条 finished 的(理论只一条;多条则取遍历到的最后一条,按 pos 升序即最新)。
      if (e.reason) finishReason = e.reason;
    }
  }

  const durationSec =
    minTs !== undefined && maxTs !== undefined ? maxTs - minTs : null;

  return {
    rounds,
    mine: makeSide(myFired, myHitsLanded),
    opponent: makeSide(oppFired, oppHitsLanded),
    durationSec,
    myHits: view.myHits,
    opponentHits: view.opponentHits,
    finishReason,
  };
}

/** fired/hits → SideShooting(rate 在 fired===0 时 null)。 */
function makeSide(fired: number, hits: number): SideShooting {
  return { fired, hits, rate: fired === 0 ? null : hits / fired };
}

/**
 * 结束原因码 → 人话(§7.6 文案纪律)。视角相关:同一 reason 对胜方/负方措辞不同
 * (17hits:胜方「命中全灭对手」/ 负方「舰队被全灭」;timeout:胜方「对手超时未应答」/ 负方「超时未应答」)。
 * 由调用方传 iWon 决定措辞;observer 传 undefined → 客观措辞。
 */
export function reasonText(reason: string | undefined, iWon: boolean | undefined): string {
  switch (reason) {
    case '17hits':
      if (iWon === true) return '17 命中 · 全灭对手舰队';
      if (iWon === false) return '舰队被全灭(17 命中)';
      return '17 命中分出胜负';
    case 'timeout':
      if (iWon === true) return '对手超时未应答';
      if (iWon === false) return '你超时未应答';
      return '一方超时未应答';
    case 'cancelled':
      return '对局已取消';
    default:
      return '';
  }
}

/** observer/未连时的空立场判定(供渲染层决定是否显示「我方/对手」命中率)。 */
export function isPlayerIdx(myIdx: MyIdx): myIdx is 0 | 1 {
  return myIdx === 0 || myIdx === 1;
}
