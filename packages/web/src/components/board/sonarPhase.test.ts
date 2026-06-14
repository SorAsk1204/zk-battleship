/**
 * sonarPhase 单测(Task 4.1)。
 *
 * 钉死声呐扫描线 / 相位锁定余辉的角度约定与相位映射——这是 M4 签名元素的几何内核,也是唯一能在 node
 * 环境单测的部分(WAAPI / document.timeline 在测试里不可用,留浏览器验收)。一旦约定错位,浏览器里
 * 余辉会在错误时刻提亮,故在此把「0°=正上、顺时针增大」「θ→startTime 线性映射」逐位测死。
 */
import { describe, expect, it } from 'vitest';
import {
  BOARD_PX,
  CELL,
  CENTER_PX,
  N,
  SWEEP_PERIOD_MS,
  azimuthToStartTimeMs,
  cellAzimuthDeg,
  cellStartTimeMs,
} from './sonarPhase.ts';

describe('常量 — 与 BoardGrid/Crosshair 同一坐标系', () => {
  it('CELL=32, N=10, BOARD_PX=320, CENTER_PX=160, SWEEP_PERIOD_MS=8000', () => {
    expect(CELL).toBe(32);
    expect(N).toBe(10);
    expect(BOARD_PX).toBe(320);
    expect(CENTER_PX).toBe(160);
    expect(SWEEP_PERIOD_MS).toBe(8000);
  });
});

describe('cellAzimuthDeg — 约定:0°=正上,顺时针增大(屏幕 +y 向下)', () => {
  // 板心在 (160,160) = 四格交点 (x=4|5, y=4|5) 之间。取「明确在某主方向上」的格验证四个基本方位。
  // 正上方:列居中(x=4 或 5,中心 x 接近 160)、行在最上(y=0,中心 y=16 << 160)→ θ≈0。
  // 用 x=5(中心 176)会带一点东偏;用「同时关于板心对称、纯轴向」的格最干净:见下逐方向取格。

  it('正上方向(板心正上的格)→ θ≈0°', () => {
    // x=4: 中心 x=144(板心左 16);x=5: 中心 x=176(板心右 16)。两者对称,取其一带 ±对称偏角。
    // 要纯 0°,需 dx=0:没有这样的整数格(板心在格交点)。改用「最接近正上且对称」的判定:
    // 取 y=0 行,x=4 与 x=5 的方位角应关于 0° 对称(一个略负归一化到接近 360,一个略正接近 0)。
    const left = cellAzimuthDeg(4, 0); // dx=-16, dy=-160 → 略偏左(西北),归一化后接近 360
    const right = cellAzimuthDeg(5, 0); // dx=+16, dy=-160 → 略偏右(东北),接近 0
    expect(right).toBeGreaterThan(0);
    expect(right).toBeLessThan(15); // 接近正上(略向东)
    expect(left).toBeGreaterThan(345); // 接近正上(略向西,归一化到 ~354)
    expect(left).toBeLessThan(360);
    // 关于 0°(=360°)对称:right 与 (360-left) 应相等。
    expect(right).toBeCloseTo(360 - left, 6);
  });

  it('正右方向(板心正右的格)→ θ≈90°', () => {
    // y=4 与 y=5 对称跨板心;x=9(最右,中心 304,dx=+144)。两行方位角关于 90° 对称。
    const upper = cellAzimuthDeg(9, 4); // dx=+144, dy=-16 → 略偏上(东北上),<90
    const lower = cellAzimuthDeg(9, 5); // dx=+144, dy=+16 → 略偏下(东南下),>90
    expect(upper).toBeLessThan(90);
    expect(upper).toBeGreaterThan(75);
    expect(lower).toBeGreaterThan(90);
    expect(lower).toBeLessThan(105);
    expect(upper).toBeCloseTo(180 - lower, 6); // 关于 90° 对称
  });

  it('正下方向(板心正下的格)→ θ≈180°', () => {
    const right = cellAzimuthDeg(5, 9); // dx=+16, dy=+144 → 略偏右(东南),<180
    const left = cellAzimuthDeg(4, 9); // dx=-16, dy=+144 → 略偏左(西南),>180
    expect(right).toBeLessThan(180);
    expect(right).toBeGreaterThan(165);
    expect(left).toBeGreaterThan(180);
    expect(left).toBeLessThan(195);
    expect(right).toBeCloseTo(360 - left, 6); // 关于 180° 对称
  });

  it('正左方向(板心正左的格)→ θ≈270°', () => {
    const lower = cellAzimuthDeg(0, 5); // dx=-144, dy=+16 → 略偏下(西南下),<270
    const upper = cellAzimuthDeg(0, 4); // dx=-144, dy=-16 → 略偏上(西北上),>270
    expect(lower).toBeLessThan(270);
    expect(lower).toBeGreaterThan(255);
    expect(upper).toBeGreaterThan(270);
    expect(upper).toBeLessThan(285);
    expect(lower).toBeCloseTo(540 - upper, 6); // 关于 270° 对称
  });

  it('精确对角:角落格落在 45/135/225/315° 附近(顺时针)', () => {
    // 左上角 (0,0):dx=dy=-144 → 正西北 = 315°(自上顺时针:上→右→下→左→上,西北是 315)。
    expect(cellAzimuthDeg(0, 0)).toBeCloseTo(315, 6);
    // 右上角 (9,0):dx=+144, dy=-144 → 东北 = 45°。
    expect(cellAzimuthDeg(9, 0)).toBeCloseTo(45, 6);
    // 右下角 (9,9):dx=+144, dy=+144 → 东南 = 135°。
    expect(cellAzimuthDeg(9, 9)).toBeCloseTo(135, 6);
    // 左下角 (0,9):dx=-144, dy=+144 → 西南 = 225°。
    expect(cellAzimuthDeg(0, 9)).toBeCloseTo(225, 6);
  });

  it('顺时针单调:右上角(45)< 右下角(135)< 左下角(225)< 左上角(315)', () => {
    const ne = cellAzimuthDeg(9, 0);
    const se = cellAzimuthDeg(9, 9);
    const sw = cellAzimuthDeg(0, 9);
    const nw = cellAzimuthDeg(0, 0);
    expect(ne).toBeLessThan(se);
    expect(se).toBeLessThan(sw);
    expect(sw).toBeLessThan(nw);
  });

  it('值域恒在 [0,360)', () => {
    for (let y = 0; y < N; y++) {
      for (let x = 0; x < N; x++) {
        const a = cellAzimuthDeg(x, y);
        expect(a).toBeGreaterThanOrEqual(0);
        expect(a).toBeLessThan(360);
      }
    }
  });
});

describe('azimuthToStartTimeMs — θ 线性映到 [0, 8000)', () => {
  it('0°→0, 90°→2000, 180°→4000, 270°→6000', () => {
    expect(azimuthToStartTimeMs(0)).toBe(0);
    expect(azimuthToStartTimeMs(90)).toBe(2000);
    expect(azimuthToStartTimeMs(180)).toBe(4000);
    expect(azimuthToStartTimeMs(270)).toBe(6000);
  });

  it('360° 边界 → 8000(= 一整周期;实际方位角恒 <360,此为映射连续性检查)', () => {
    expect(azimuthToStartTimeMs(360)).toBe(SWEEP_PERIOD_MS);
  });

  it('单调递增:θ 越大 startTime 越大(相位偏移随角度线性增)', () => {
    expect(azimuthToStartTimeMs(10)).toBeLessThan(azimuthToStartTimeMs(20));
    expect(azimuthToStartTimeMs(100)).toBeLessThan(azimuthToStartTimeMs(200));
  });

  it('任意有效方位角的 startTime 落在 [0, 8000)', () => {
    for (let y = 0; y < N; y++) {
      for (let x = 0; x < N; x++) {
        const st = cellStartTimeMs(x, y);
        expect(st).toBeGreaterThanOrEqual(0);
        expect(st).toBeLessThan(SWEEP_PERIOD_MS);
      }
    }
  });
});

describe('cellStartTimeMs — 复合 = azimuthToStartTimeMs∘cellAzimuthDeg', () => {
  it('角落格 startTime 对应其 45/135/225/315° 相位', () => {
    expect(cellStartTimeMs(9, 0)).toBeCloseTo((45 / 360) * 8000, 6); // 1000
    expect(cellStartTimeMs(9, 9)).toBeCloseTo((135 / 360) * 8000, 6); // 3000
    expect(cellStartTimeMs(0, 9)).toBeCloseTo((225 / 360) * 8000, 6); // 5000
    expect(cellStartTimeMs(0, 0)).toBeCloseTo((315 / 360) * 8000, 6); // 7000
  });

  it('等价于显式复合', () => {
    for (const [x, y] of [
      [0, 0],
      [3, 7],
      [9, 2],
      [5, 5],
    ] as const) {
      expect(cellStartTimeMs(x, y)).toBe(azimuthToStartTimeMs(cellAzimuthDeg(x, y)));
    }
  });
});
