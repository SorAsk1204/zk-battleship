/**
 * demoAccounts.ts 单测(Task 3.3 DoD)。
 *
 * 关键正确性:每个账户的 address 必须是其 privateKey 经 privateKeyToAccount 派生的地址
 * (大小写无关比较)。若哪天有人改错某个私钥/地址(复制粘贴串行),这条会立刻红——
 * demo connector 用 privateKey 签名,但 UI / savePending 用 address,二者必须指向同一账户,
 * 否则签名者与展示地址不符(链上 from 与界面对不上)。
 */
import { describe, expect, it } from 'vitest';
import { privateKeyToAccount } from 'viem/accounts';
import { DEMO_ACCOUNTS } from './demoAccounts.ts';

describe('DEMO_ACCOUNTS', () => {
  it('恰两个账户,标签 P0 / P1', () => {
    expect(DEMO_ACCOUNTS).toHaveLength(2);
    expect(DEMO_ACCOUNTS.map((a) => a.label)).toEqual(['P0', 'P1']);
  });

  it('每个账户的 address 与其 privateKey 派生地址一致(大小写无关)', () => {
    for (const acct of DEMO_ACCOUNTS) {
      const derived = privateKeyToAccount(acct.privateKey).address;
      expect(acct.address.toLowerCase()).toBe(derived.toLowerCase());
    }
  });

  it('地址正是 anvil #0 / #1(公知)', () => {
    expect(DEMO_ACCOUNTS[0].address.toLowerCase()).toBe(
      '0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266',
    );
    expect(DEMO_ACCOUNTS[1].address.toLowerCase()).toBe(
      '0x70997970c51812dc3a010c7d01b50e0d17dc79c8',
    );
  });
});
