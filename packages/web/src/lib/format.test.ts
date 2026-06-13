import { describe, expect, it } from 'vitest';
import { formatCoord, parseCoord, shortAddr, formatLogTime } from './format.ts';

describe('formatCoord', () => {
  it('(3,6) → "D-7"(Design §7.3 示例)', () => {
    expect(formatCoord(3, 6)).toBe('D-7');
  });

  it('四角:左上/右上/左下/右下', () => {
    expect(formatCoord(0, 0)).toBe('A-1');
    expect(formatCoord(9, 0)).toBe('J-1');
    expect(formatCoord(0, 9)).toBe('A-10');
    expect(formatCoord(9, 9)).toBe('J-10');
  });

  it('越界 / 非整数 → throw', () => {
    expect(() => formatCoord(-1, 0)).toThrow();
    expect(() => formatCoord(10, 0)).toThrow();
    expect(() => formatCoord(0, 10)).toThrow();
    expect(() => formatCoord(1.5, 0)).toThrow();
  });
});

describe('parseCoord(formatCoord 的逆)', () => {
  it('"D-7" → {x:3,y:6}', () => {
    expect(parseCoord('D-7')).toEqual({ x: 3, y: 6 });
  });

  it('全 100 格 formatCoord→parseCoord round-trip', () => {
    for (let x = 0; x < 10; x++) {
      for (let y = 0; y < 10; y++) {
        expect(parseCoord(formatCoord(x, y))).toEqual({ x, y });
      }
    }
  });

  it('大小写不敏感、去空白', () => {
    expect(parseCoord('d-7')).toEqual({ x: 3, y: 6 });
    expect(parseCoord('  A-1 ')).toEqual({ x: 0, y: 0 });
  });

  it('非法格式 → null', () => {
    expect(parseCoord('')).toBeNull();
    expect(parseCoord('K-1')).toBeNull(); // 列超 J
    expect(parseCoord('A-0')).toBeNull(); // 行 < 1
    expect(parseCoord('A-11')).toBeNull(); // 行 > 10
    expect(parseCoord('A7')).toBeNull(); // 缺分隔符
    expect(parseCoord('AB-1')).toBeNull();
  });
});

describe('shortAddr', () => {
  it('默认前 6 后 4,中缀省略号', () => {
    expect(shortAddr('0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266')).toBe('0xf39F…2266');
  });

  it('自定义头尾长度', () => {
    expect(shortAddr('0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266', 4, 4)).toBe('0xf3…2266');
  });

  it('短串 / 非地址原样返回', () => {
    expect(shortAddr('0x1234')).toBe('0x1234');
    expect(shortAddr('not-an-addr')).toBe('not-an-addr');
  });
});

describe('formatLogTime', () => {
  it('秒与毫秒都接受,产 HH:MM:SS', () => {
    // 用一个本地时间已知的时刻:构造 Date 取其各分量,避免时区脆弱断言
    const d = new Date(2026, 5, 13, 14, 2, 33);
    const sec = Math.floor(d.getTime() / 1000);
    const expected = '14:02:33';
    expect(formatLogTime(sec)).toBe(expected); // 秒
    expect(formatLogTime(d.getTime())).toBe(expected); // 毫秒
  });

  it('补零', () => {
    const d = new Date(2026, 0, 1, 1, 2, 3);
    expect(formatLogTime(d.getTime())).toBe('01:02:03');
  });
});
