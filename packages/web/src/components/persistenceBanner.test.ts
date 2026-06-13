/**
 * PersistenceBanner 纯检查单测(Task 3.8)。
 *
 * 钉死 checkBoardIntegrity —— §8 守卫的判定核(loadBoard + verifyBoardCommitment → ok/missing/mismatch):
 *   - 棋盘在且承诺对得上 → ok;
 *   - 缺失 → {ok:false, missing};
 *   - 承诺不符(本地棋盘重算 ≠ 链上承诺)→ {ok:false, mismatch};
 *   - myCommitment undefined(observer/未连)→ ok(不守卫)。
 * 注入 load stub 免依赖 localStorage(verifyBoardCommitment 是真 Poseidon,用 storage.test 同款自洽向量)。
 * 组件渲染 / 导入副作用在浏览器验收(本仓 node 环境无 testing-library)。
 */
import { describe, expect, it } from 'vitest';
import type { Ship } from '@zk-battleship/circuits';
import type { BoardRecord } from '../lib/storage.ts';
import { checkBoardIntegrity } from './PersistenceBanner.tsx';

const CHAIN = 31337;
const CONTRACT = '0x9fe46736679d2d9a65f0992f2272de9f3c7fa6e0';
const ADDR = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266';
const GAME = 1n;

// storage.test 同款自洽向量:这组 ships + salt 对应下面的 commitment(真 Poseidon)。
const SHIPS: Ship[] = [
  { x: 9, y: 0, dir: 1 },
  { x: 0, y: 9, dir: 0 },
  { x: 5, y: 9, dir: 0 },
  { x: 0, y: 0, dir: 1 },
  { x: 8, y: 8, dir: 1 },
];
const SALT = 0xdeadbeefn;
const COMMITMENT =
  10562143633053394694015122280104595996515830983000757199484363156303195434041n;

const REC: BoardRecord = { ships: SHIPS, salt: SALT, commitment: COMMITMENT };

/** load stub 工厂:固定返回某 record(或 null)。 */
function stubLoad(rec: BoardRecord | null): (typeof import('../lib/storage.ts'))['loadBoard'] {
  return () => rec;
}

describe('checkBoardIntegrity', () => {
  it('棋盘在且承诺对得上 → ok', () => {
    const r = checkBoardIntegrity(CHAIN, CONTRACT, GAME, ADDR, COMMITMENT, stubLoad(REC));
    expect(r.ok).toBe(true);
  });

  it('棋盘缺失(load 返回 null)→ {ok:false, missing}', () => {
    const r = checkBoardIntegrity(CHAIN, CONTRACT, GAME, ADDR, COMMITMENT, stubLoad(null));
    expect(r).toEqual({ ok: false, reason: 'missing' });
  });

  it('承诺不符(链上承诺与本地重算不同)→ {ok:false, mismatch}', () => {
    // 给一个不同的链上承诺(本地棋盘重算 ≠ 它)。
    const wrongCommitment = COMMITMENT + 1n;
    const r = checkBoardIntegrity(CHAIN, CONTRACT, GAME, ADDR, wrongCommitment, stubLoad(REC));
    expect(r).toEqual({ ok: false, reason: 'mismatch' });
  });

  it('本地棋盘 salt 被篡改(重算承诺变)→ mismatch', () => {
    const tampered: BoardRecord = { ...REC, salt: SALT + 1n };
    const r = checkBoardIntegrity(CHAIN, CONTRACT, GAME, ADDR, COMMITMENT, stubLoad(tampered));
    expect(r).toEqual({ ok: false, reason: 'mismatch' });
  });

  it('myCommitment undefined(observer/未连)→ ok(不守卫),且不调 load', () => {
    let called = false;
    const load = (() => {
      called = true;
      return null;
    }) as (typeof import('../lib/storage.ts'))['loadBoard'];
    const r = checkBoardIntegrity(CHAIN, CONTRACT, GAME, ADDR, undefined, load);
    expect(r.ok).toBe(true);
    expect(called).toBe(false); // 短路:无承诺直接 ok,不读 storage
  });
});
