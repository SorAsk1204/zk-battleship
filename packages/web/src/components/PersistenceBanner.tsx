/**
 * PersistenceBanner —— 持久化完整性守卫(Design §8:进对战幕校验 localStorage 能重算链上承诺,
 * 不一致立即顶部横幅警告并提供导入入口;§9.4 手测「清空 localStorage 后的警告与导入恢复」)。
 *
 * 这是 §8 闭环里「丢了棋盘怎么救」的那一环:
 *   - 玩家(myIdx 0/1)在需要本地棋盘的幕(对战必需;p0-waiting / finish 展示己方盘时也需)——
 *     loadBoard(chainId, contract, gameId, address)。**缺失** 或 **verifyBoardCommitment 与链上承诺不符**
 *     → 顶部 role="alert"(--flare)横幅,点名后果(无法生成应答证明 = 将超时判负)+ 给一个 import 入口。
 *   - 棋盘在且对得上 → 横幅隐藏(返回 null),不打扰。
 *
 * 导入闭环(§8 + 3.7 Rec 1):
 *   <input type=file> 选 JSON → importBoardJSON(**入口即校验**形状 + validateBoard + verifyBoardCommitment,
 *   不匹配直接抛,绝不存非匹配棋盘)→ 成功 saveBoard 落正式键 + clearInFlight(chainId, gameId)(释放
 *   useAutoRespond 的 blocked 占键并 emit re-fire 信号,让欠的应答**无需重载**自动补发)+ onImported()
 *   通知父级重读棋盘(OwnBoard 立刻显出布局)+ 自检通过后横幅自隐;失败 → toast「该文件与本对局承诺不符」
 *   (§7.5/7.6 页内 toast,非原生 alert),横幅留着、不写盘。
 *
 * 纯检查抽成 checkBoardIntegrity(可单测);组件只管「读 storage + 渲染 + 导入副作用」。
 * 不取链上数据:myCommitment 由父级从 GameView 传入(它已是链上承诺投影);本组件只读 localStorage。
 */
import { useCallback, useRef, useState, type ChangeEvent } from 'react';
import { verifyBoardCommitment } from '../lib/commitment.ts';
import type { Address } from '../lib/contracts.ts';
import { importBoardJSON, loadBoard, saveBoard } from '../lib/storage.ts';
import { clearInFlight } from '../hooks/useAutoRespond.ts';
import { useToast } from './Toast.tsx';

/** 完整性自检结果。ok=true → 棋盘在且对得上(横幅隐藏);否则带 reason 区分(文案/诊断用)。 */
export type IntegrityResult =
  | { ok: true }
  | { ok: false; reason: 'missing' }
  | { ok: false; reason: 'mismatch' };

/**
 * 纯检查:本地棋盘是否存在且对得上链上承诺(可单测,无 React)。
 *   - myCommitment === undefined(非玩家 / 承诺未知):视为「无需守卫」→ ok(横幅不该对旁观/未连显示)。
 *   - loadBoard 缺失 → {ok:false, missing}。
 *   - verifyBoardCommitment(ships, salt, commitment) 不符 → {ok:false, mismatch}。
 *   - 对得上 → ok。
 * salt/commitment 以 hex 串喂 verifyBoardCommitment(它 BigInt() 双解析,hex/十进制皆可)。
 *
 * @param load 注入的取盘函数(默认 loadBoard;测试可传 stub 免 localStorage)
 */
export function checkBoardIntegrity(
  chainId: number,
  contract: string,
  gameId: number | bigint,
  address: string,
  myCommitment: bigint | undefined,
  load: typeof loadBoard = loadBoard,
): IntegrityResult {
  // 无承诺(observer/未连)→ 不守卫。调用方一般已在玩家分支才挂本组件,这里再兜一层。
  if (myCommitment === undefined) return { ok: true };
  const rec = load(chainId, contract, gameId, address);
  if (!rec) return { ok: false, reason: 'missing' };
  const saltHex = `0x${rec.salt.toString(16)}`;
  const commitHex = `0x${myCommitment.toString(16)}`;
  if (!verifyBoardCommitment(rec.ships, saltHex, commitHex)) {
    return { ok: false, reason: 'mismatch' };
  }
  return { ok: true };
}

export type PersistenceBannerProps = {
  chainId: number;
  contract: Address;
  gameId: bigint;
  /** 当前账户(loadBoard / saveBoard 的 key 一环)。 */
  address: Address;
  /** 我的链上承诺(GameView.myCommitment);undefined → 不守卫(横幅隐藏)。 */
  myCommitment: bigint | undefined;
  /**
   * 导入成功后回调(父级据此重读棋盘,让 OwnBoard 立刻显布局)。可选——不传也能工作
   * (横幅自隐 + clearInFlight 让自动应答 re-fire),传了能让父级同帧刷新己方盘。
   */
  onImported?: () => void;
};

/** 缺失 / 不符的横幅文案(§8 点名后果 + 行动指引)。两者后果相同(无法应答),措辞略分诊断。 */
const COPY: Record<'missing' | 'mismatch', string> = {
  missing:
    '本地棋盘缺失,无法生成应答证明(将超时判负)。请导入此对局的部署文件以恢复。',
  mismatch:
    '本地棋盘与链上承诺不一致,无法生成应答证明(将超时判负)。请导入此对局的部署文件以恢复。',
};

export default function PersistenceBanner({
  chainId,
  contract,
  gameId,
  address,
  myCommitment,
  onImported,
}: PersistenceBannerProps) {
  const toast = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  // 自检版本:导入成功后 +1 触发重算(loadBoard 重读),让横幅在棋盘恢复后自隐。
  const [checkVersion, setCheckVersion] = useState(0);

  // 每渲染重算(checkVersion 变即重读 storage)。纯同步读 localStorage,无需 effect/state 缓存。
  void checkVersion; // 显式标注:checkVersion 仅作重算触发器(其值不直接用)。
  const result = checkBoardIntegrity(chainId, contract, gameId, address, myCommitment);

  const onPickFile = useCallback(() => fileRef.current?.click(), []);

  const onFile = useCallback(
    async (ev: ChangeEvent<HTMLInputElement>) => {
      const file = ev.target.files?.[0];
      // 选完即清 input value:同一文件二次选择也能再次触发 change(否则浏览器去重不触发)。
      ev.target.value = '';
      if (!file) return;
      let text: string;
      try {
        text = await file.text();
      } catch {
        toast.show('读取文件失败,请重试。');
        return;
      }
      try {
        // importBoardJSON 入口即校验形状 + validateBoard + verifyBoardCommitment——不匹配直接抛,
        // 故到下一行说明三关全过,saveBoard 落的一定是「布局合法且对得上某承诺」的棋盘。
        const rec = importBoardJSON(text);
        // 再核一层:导入文件的承诺必须 === 本对局我的链上承诺(importBoardJSON 只保证「ships/salt 自洽于
        // 文件里的 commitment」,不保证那 commitment 就是本局的)。挡掉「导入了别局的合法部署文件」。
        if (myCommitment !== undefined && rec.commitment !== myCommitment) {
          toast.show('该文件与本对局承诺不符(可能是其它对局的部署文件)。');
          return;
        }
        saveBoard(chainId, contract, gameId, address, rec);
        // 释放 useAutoRespond 对本局的 inFlight 占键 + emit re-fire(欠的应答无需重载自动补发,3.7 Rec 1 闭环)。
        clearInFlight(chainId, gameId);
        onImported?.();
        setCheckVersion((v) => v + 1); // 重算自检 → 棋盘已在且对得上 → 横幅自隐。
        toast.show('部署文件已导入,棋盘已恢复。', 'info');
      } catch (e) {
        // importBoardJSON 的三关任一失败(坏 JSON / 布局非法 / 承诺不符):页内 toast 报具体诊断,不写盘。
        toast.show(e instanceof Error ? e.message : '导入失败:文件无效。');
      }
    },
    [chainId, contract, gameId, address, myCommitment, onImported, toast],
  );

  // 棋盘在且对得上(或无需守卫)→ 不渲染横幅。
  if (result.ok) return null;

  return (
    <div
      className="space-y-2 border border-flare bg-abyss px-4 py-3"
      role="alert"
      data-testid="persistence-banner"
      data-reason={result.reason}
    >
      <p className="font-mono text-xs leading-relaxed text-flare">⚠ {COPY[result.reason]}</p>
      <div>
        <button
          type="button"
          onClick={onPickFile}
          className="border border-flare bg-flare/10 px-3 py-1.5 font-display text-xs font-bold text-flare hover:bg-flare/20"
          data-testid="persistence-import"
        >
          导入部署文件
        </button>
        {/* 隐藏的真实 file input(经按钮触发,样式统一);accept JSON。 */}
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          onChange={onFile}
          className="hidden"
          data-testid="persistence-file-input"
          aria-hidden
        />
      </div>
    </div>
  );
}
