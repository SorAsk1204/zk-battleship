/**
 * useAutoRespond —— 自动应答炮击(Design §7.3 对方回合**自动**生成应答证明并发交易;§8 棋盘丢失 =
 * 必然超时输;§10 浏览器关闭期间轮到自己:重开由 phase+pendingShot 恢复并自动补应答)。
 *
 * 这是对战幕的关键自动化:防守方**无需点击**——一旦链上进入「待我应答」(AwaitingResponse 且我是
 * 防守方),本 hook 自动 (1) 从 storage 还原我的棋盘+salt,(2) worker 出 shot 证明,(3) 发 respond 交易。
 *
 * ── 触发条件(只读链上态,故 §10 重开自动补应答天然成立)──
 *   phase===AwaitingResponse && view.pendingShotIsForMe && 我是防守方玩家(myIdx 0/1)。
 *   触发只依赖 view 的链上派生量,不依赖任何「我刚做了什么」的本地记忆——故关掉页面再开、或换设备
 *   导入棋盘后重开,只要链上仍是「待我应答」,effect 一挂载就自动开跑(§10)。
 *
 * ── inFlight 去重(防 StrictMode 双调用 / 重渲染 / refetch 抖动重复发送)──
 *   module 级 `Set<string>`,键 = `${chainId}:${gameId}:${x},${y}`(同一炮击唯一)。进入应答流程前
 *   先占键(已占 → 直接 return,不重发);**成功后不清键**(成功后链上 phase 翻走、触发条件自然变 false;
 *   保留键是为了堵住「respond 已上链、useGame 尚未 refetch」的窗口里重渲染再次触发 → 重发 respond 必
 *   BAD_PHASE 的噪声)。**仅在终态错误时清键**,让用户/下一次 refetch 能重试(§7.3:允许 retry)。
 *   module 级(非 ref)是因为 StrictMode 会挂载两个组件实例共用同一 module 作用域,ref 各自独立挡不住;
 *   且 worker 请求本身按 id 路由(useProver),module Set 与之同层,语义一致(参考 useProver 的 module 单例)。
 *
 * ── 棋盘缺失 = 大声阻断(§8,**绝不静默跳过** = 静默弃权)──
 *   loadBoard 缺失,或 verifyBoardCommitment(ships,salt,myCommitment) 对不上链上承诺 → status='blocked'
 *   带阻断文案(「本地棋盘缺失,无法应答此炮击,将超时判负。请导入部署文件。」),由 Game.tsx 顶部横幅/
 *   toast 大声呈现。**不**进 prove/respond(没有正确棋盘也证不出),也**不**清 inFlight 之外的恢复路径——
 *   阻断态持续到用户导入正确棋盘(3.8 导入 → loadBoard 成功 → 下次触发自然走通)。
 *
 * 纪律:不 import snarkjs(shot 证明经 useProver 走 worker,主线程 snarkjs-free);错误经 mapContractError
 * 人话化;命令式 await 直线(同 useLockFleet/useAttack)。
 *
 * 错误两类、呈现面不同(Task 3.9 §7.5/§7.6):
 *   - **瞬时 tx/证明错误**(catch 路径,可重试)→ 页内 Toast(error)+ status.error;
 *   - **§8 阻断**(blocked:棋盘缺失 / 承诺不符,**持续**、需导入恢复)→ **不**toast(toast 会自动消失,
 *     而阻断必须一直在),改由 Game.tsx 顶部常驻横幅 + PersistenceBanner(带导入 CTA)呈现。
 *     这是「瞬时→toast、持久阻断→banner」分界的关键:别把需要持续行动指引的阻断态变成会消失的 toast。
 */
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { usePublicClient, useWriteContract } from 'wagmi';
import { battleshipAbi } from '../lib/abi.ts';
import { verifyBoardCommitment, toShotInputs } from '../lib/commitment.ts';
import type { Board } from '../lib/boardLogic.ts';
import { type Address } from '../lib/contracts.ts';
import { mapContractError } from '../lib/errors.ts';
import { toShotProofArg } from '../lib/proofArgs.ts';
import { loadBoard } from '../lib/storage.ts';
import { useToast } from '../components/Toast.tsx';
import type { GameView } from './gameView.ts';
import { Phase } from './gameView.ts';
import { prove } from './useProver.ts';

/**
 * 自动应答的离散状态(供 Game.tsx 渲染 ProofStatus + 阻断横幅)。
 * 形状与 LockFleetStatus 的相位对齐(ProofStatus 复用),但 done 极简(无 mode/gameId)、且多一个
 * 'blocked' 态(§8 棋盘缺失/承诺不符的大声阻断,区别于普通 tx error)。
 */
export type AutoRespondStatus =
  | { phase: 'idle' }
  /** worker 出 shot 证明(ProofStatus 叠 useProverProgress('shot') 显 stage/byte%)。 */
  | { phase: 'proving' }
  /** 交易已构造,本地签名 → 发送。 */
  | { phase: 'sending' }
  /** 已有 hash,等回执。 */
  | { phase: 'confirming'; hash: `0x${string}` }
  /** 应答成功(链上 ShotResolved;useGame refetch 后相位翻走)。 */
  | { phase: 'done' }
  /** 普通错误(证明 / tx 失败);message 人话化,可重试。 */
  | { phase: 'error'; message: string }
  /** 大声阻断(§8:棋盘缺失 / 承诺不符):必须导入正确棋盘,否则超时判负。 */
  | { phase: 'blocked'; message: string };

/** §8 阻断文案(棋盘缺失 / 承诺不符共用,点名后果 + 行动指引)。 */
const MISSING_BOARD_MESSAGE =
  '本地棋盘缺失或与链上承诺不一致,无法应答此炮击,将超时判负。请导入此前导出的部署文件。';

/**
 * 同一炮击的去重键。module 级(跨 StrictMode 实例 / 重渲染)。
 *
 * 键含**应答方地址**(defender),不仅是 chainId:gameId:x,y——关键修复(Task 3.9 §9.4 实测暴露):
 * demo 双账户在**同一标签页**对打时,P0/P1 共用同一 module 作用域;若 P0 与 P1 先后被攻击到**同一坐标**
 * (如双方都被打 A-1),而成功后不清键(设计:堵 respond 已上链未 refetch 的重发窗口),则后一位的
 * 应答会撞上前一位残留的同坐标键被静默跳过 → 永不应答 → 假超时。加入 address 段后两方各占各键,
 * 不再串号(生产环境分标签页本就不同 module 作用域、无此碰撞;但 demo 单标签是 §7.1/§9.4 的一等场景)。
 */
const inFlight = new Set<string>();

/**
 * 同一炮击的去重键(导出供单测,纯函数)。键段:`chainId:gameId:address:x,y`。
 * address 小写归一(地址大小写不一致不应被当成两把键)。
 */
export function flightKey(chainId: number, gameId: bigint, address: Address, x: number, y: number): string {
  return `${chainId}:${gameId.toString()}:${address.toLowerCase()}:${x},${y}`;
}

/** 某局的键前缀(chainId:gameId:),clearInFlight 据此清掉该局所有在途/阻断键(含所有地址段)。导出供单测。 */
export function gamePrefix(chainId: number, gameId: bigint): string {
  return `${chainId}:${gameId.toString()}:`;
}

/**
 * 「释放信号」外部 store(useSyncExternalStore 订阅)—— clearInFlight 的另一半。
 *
 * 为什么光清 inFlight Set 不够(3.7 Rec 1 的真正闭环):自动应答的触发 effect 依赖
 * [shouldRespond, px, py, pcoord, runRespond]。导入棋盘后这些**全不变**(同一 pendingShot、同一 view),
 * 仅 module 级 inFlight Set 内容变了——而 Set 的增删不触发任何 React 重渲染,effect 不会重跑,
 * blocked 态会一直挂着(这正是 3.7「需重载页面」的根因)。
 *
 * 故 clearInFlight 不仅 delete 键,还 bump 一个 module 级版本号并 emit;每个 useAutoRespond 实例用
 * useSyncExternalStore 订阅该版本号,版本一变即重渲染、并把版本号列进触发 effect 依赖 → effect 重评估
 * → shouldRespond 仍 true 且键已释放 → runRespond 重跑 → 无需重载自动 re-fire(§10 + 3.7 Rec 1 闭环)。
 */
let releaseVersion = 0;
const releaseListeners = new Set<() => void>();
function subscribeRelease(cb: () => void): () => void {
  releaseListeners.add(cb);
  return () => releaseListeners.delete(cb);
}
function getReleaseVersion(): number {
  return releaseVersion;
}
function emitRelease(): void {
  releaseVersion += 1;
  for (const cb of releaseListeners) cb();
}

/**
 * 清掉某局的全部 inFlight 键(在途 + 阻断占的键)并 emit 释放信号(供 PersistenceBanner 导入成功后调用,
 * 闭合 3.7 Rec 1:导入棋盘 → 释放 blocked 占的键 + 触发 effect 重评估 → 自动 re-fire,**无需重载**)。
 *
 * 清「该局所有键」(含所有应答方地址段)而非「具体某炮键」:导入时调用方未必知道当前 pending 是哪一炮
 * (blocked 态下 runRespond 早 return,respondingCoord 已被相位收口清空);按 gameId 前缀清是安全的——
 * 前缀 `chainId:gameId:` 覆盖该局两方地址的全部键,清掉即可让欠应答方重评估 re-fire。跨局键(别的
 * gameId)不受影响(前缀不匹配)。
 *
 * @param chainId 链 id(键的第一段)
 * @param gameId  对局 id(键的第二段)
 */
export function clearInFlight(chainId: number, gameId: bigint): void {
  const prefix = gamePrefix(chainId, gameId);
  for (const key of [...inFlight]) {
    if (key.startsWith(prefix)) inFlight.delete(key);
  }
  // 即便没有键被删(理论不达:导入时通常正 blocked、键在),也 emit——让订阅的实例重评估触发条件
  // (导入恢复后棋盘已可读,effect 重跑会走通 prove/respond)。
  emitRelease();
}

export type UseAutoRespondArgs = {
  view: GameView;
  gameId: bigint;
  /** 部署信息(合约地址 + chainId);未就绪 → 不触发(等就绪)。 */
  contract: Address | undefined;
  chainId: number | undefined;
  /** 当前账户地址(loadBoard 的 key 一环;也是签名账户);未连 → 不触发。 */
  address: Address | undefined;
};

export type UseAutoRespondResult = {
  status: AutoRespondStatus;
  /** 当前正在应答的炮击坐标(供 ProofStatus 文案「正在应答 {coord}…」);非应答中为 null。 */
  respondingCoord: string | null;
};

export function useAutoRespond({
  view,
  gameId,
  contract,
  chainId,
  address,
}: UseAutoRespondArgs): UseAutoRespondResult {
  const publicClient = usePublicClient();
  const { writeContractAsync } = useWriteContract();
  const toast = useToast();
  const [status, setStatus] = useState<AutoRespondStatus>({ phase: 'idle' });
  const [respondingCoord, setRespondingCoord] = useState<string | null>(null);

  // 释放信号订阅(clearInFlight emit 时 +1):PersistenceBanner 导入棋盘成功 → clearInFlight → 本值变 →
  // 触发 effect 把它列进依赖 → 重评估触发条件 → 已释放键 + 棋盘已可读 → 自动 re-fire(无需重载,3.7 Rec 1 闭环)。
  const release = useSyncExternalStore(subscribeRelease, getReleaseVersion, getReleaseVersion);

  // 当前已在本组件实例内跑的键(避免同实例重入;module inFlight 是跨实例的总闸)。
  const localRunningRef = useRef<string | null>(null);

  // 触发判定(只读链上派生量;§10 重开自动补应答靠这条)。
  // 依赖 pending 的**坐标基元**(px/py)而非 pendingShot 对象:deriveGameView 每次重算都新建该对象,
  // 若 effect 依赖对象身份会在每次无关 refetch 上重跑;依赖 px/py(数字)则只在「这一炮的格变了」时重跑。
  const pending = view.pendingShot;
  const shouldRespond =
    view.phase === Phase.AwaitingResponse &&
    view.pendingShotIsForMe &&
    (view.myIdx === 0 || view.myIdx === 1) &&
    pending !== null;
  const px = pending?.x ?? -1;
  const py = pending?.y ?? -1;
  const pcoord = pending?.coord ?? '';

  const runRespond = useCallback(
    async (rx: number, ry: number, coord: string) => {
      if (!publicClient || !contract || chainId === undefined || !address) return;
      if (view.myCommitment === undefined) return; // 非玩家不应到此(shouldRespond 已挡)

      const key = flightKey(chainId, gameId, address, rx, ry);
      // module 级去重:已有同炮击在途 / 已阻断(本实例或 StrictMode 兄弟实例) → 不重跑。
      // 阻断态也占键不释放:防「棋盘缺失 → 每次无关 refetch 重跑 loadBoard 再 setStatus」的渲染抖动;
      // 用户导入棋盘的重试路径 = 重新加载页面(module inFlight 随之清空,重开自动补应答,§10)/ 3.8 导入闭环。
      if (inFlight.has(key)) return;
      inFlight.add(key);
      localRunningRef.current = key;

      try {
        // ── §8:还原我的棋盘 + salt;缺失 / 承诺不符 → 大声阻断(绝不静默跳过 = 静默弃权)。──
        const rec = loadBoard(chainId, contract, gameId, address);
        if (!rec) {
          setStatus({ phase: 'blocked', message: MISSING_BOARD_MESSAGE });
          localRunningRef.current = null;
          return; // 占键不释放(见上)
        }
        // 校验本地棋盘对得上链上承诺(防用错局 / 篡改的存档应答,§5.4 PROOF_MISMATCH 前置拦截)。
        const saltHex = `0x${rec.salt.toString(16)}`;
        const commitHex = `0x${view.myCommitment.toString(16)}`;
        if (!verifyBoardCommitment(rec.ships, saltHex, commitHex)) {
          setStatus({ phase: 'blocked', message: MISSING_BOARD_MESSAGE });
          localRunningRef.current = null;
          return; // 占键不释放(见上)
        }

        // ── worker 出 shot 证明(本地计算;calldata 已在 worker formatProofCalldata 好)。──
        setRespondingCoord(coord);
        setStatus({ phase: 'proving' });
        const board = rec.ships as unknown as Board;
        const { publicSignals, calldata } = await prove('shot', toShotInputs(board, rec.salt, rx, ry));
        const result = Number(publicSignals[0]); // shot 电路 publicSignals[0] = result(1 hit / 0 miss)
        const shotProof = toShotProofArg(calldata);

        // ── 发 respond 交易(本地签名 → eth_sendRawTransaction)。──
        setStatus({ phase: 'sending' });
        const hash = await writeContractAsync({
          abi: battleshipAbi,
          address: contract,
          functionName: 'respond',
          args: [gameId, result, shotProof],
        });

        // ── 等回执(链上确认)。──
        setStatus({ phase: 'confirming', hash });
        await publicClient.waitForTransactionReceipt({ hash });

        // 成功:不清 module 键(见模块注释:堵 respond 已上链、refetch 未到的重发窗口);
        // 链上 phase 翻走后 shouldRespond 自然变 false,不再触发。
        setStatus({ phase: 'done' });
        localRunningRef.current = null;
      } catch (err) {
        // 证明 / tx 失败(瞬时,可重试):人话化 + 页内 toast(§7.5/§7.6);清 module 键允许重试
        // (下次 refetch / 重渲染可重跑)。注意:**blocked(§8 棋盘缺失/承诺不符)不走这里、不 toast**
        // ——那是持续阻断,由 Game.tsx 常驻横幅 + PersistenceBanner 承载(见上面 setStatus blocked 分支)。
        const message = mapContractError(err);
        setStatus({ phase: 'error', message });
        toast.show(message, 'error');
        inFlight.delete(key);
        localRunningRef.current = null;
      }
    },
    [publicClient, writeContractAsync, contract, chainId, address, gameId, view.myCommitment, view.myIdx, toast],
  );

  // 触发 effect:满足条件即自动开跑(去重在 runRespond 内)。依赖「这一炮的坐标基元 + 跑函数 + 释放信号」——
  // 不依赖 pendingShot 对象身份(否则每次无关 refetch 都重跑),只在格变(px/py)、函数变、或 clearInFlight
  // 释放信号(release)变时重跑。release 变 = PersistenceBanner 导入了棋盘并清了键 → 此处重评估即 re-fire
  // (此时 shouldRespond 仍 true、键已释放、棋盘已可读,runRespond 一路走通 prove/respond,无需重载)。
  useEffect(() => {
    if (!shouldRespond || px < 0 || py < 0) return;
    void runRespond(px, py, pcoord);
    // eslint-disable-next-line react-hooks/exhaustive-deps —— release 是 clearInFlight 的 re-fire 触发器(故意列入)。
  }, [shouldRespond, px, py, pcoord, runRespond, release]);

  // 相位收口:离开「待我应答」后,把 done/blocked/error 的残留状态条复位为 idle(下一炮重新开始),
  // 但保留 proving/sending/confirming(在途的不打断,等它自己 settle)。
  useEffect(() => {
    if (shouldRespond) return;
    setRespondingCoord(null);
    setStatus((s) =>
      s.phase === 'proving' || s.phase === 'sending' || s.phase === 'confirming' ? s : { phase: 'idle' },
    );
  }, [shouldRespond]);

  return { status, respondingCoord };
}
