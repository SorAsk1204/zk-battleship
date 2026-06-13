/**
 * 显示格式化(纯展示决定,无协议影响)。
 *
 * 坐标 → 标签:Design §7.3 唯一具体示例是 "D-7"。§10 裁决清单未覆盖坐标→标签映射,
 * 按 §0.5 选保守方案并记 DECISIONS:
 *   x → 列字母 A–J(x=0→A, x=3→D),y → 行号 1–10(y=0→1, y=6→7),分隔符 "-"。
 *   故 (3,6) → "D-7",与 §7.3 示例自洽(D 是第 4 列、7 是第 7 行)。
 * 该方案只影响人眼显示;协议内坐标始终是 0–9 整数对(x,y),链上 bit = y*10+x,均不经过本模块。
 */

/** A–J 列字母表(x=0→A)。棋盘恒 10 列,索引 0–9。 */
const COLS = 'ABCDEFGHIJ';

/**
 * (x,y) → 显示串,如 (3,6) → "D-7"。
 * 入参须为 0–9 整数;越界/非整数抛错(坏坐标不该走到显示层,早失败便于定位)。
 */
export function formatCoord(x: number, y: number): string {
  if (!Number.isInteger(x) || x < 0 || x > 9 || !Number.isInteger(y) || y < 0 || y > 9) {
    throw new Error(`formatCoord: x/y 必须是 0–9 整数,got (${x}, ${y})`);
  }
  return `${COLS[x]}-${y + 1}`;
}

/**
 * "D-7" → {x:3, y:6},formatCoord 的逆。备用(如解析手输坐标)。
 * 不合法格式返回 null(列字母 A–J、行号 1–10、中间一个 "-"),大小写不敏感。
 */
export function parseCoord(label: string): { x: number; y: number } | null {
  const m = /^([A-Ja-j])-(\d{1,2})$/.exec(label.trim());
  if (!m) return null;
  const x = COLS.indexOf(m[1].toUpperCase());
  const row = Number(m[2]);
  if (x < 0 || row < 1 || row > 10) return null;
  return { x, y: row - 1 };
}

/**
 * 地址缩写,如 0x1234…cdef(默认前 6 后 4)。
 * 非 0x 地址或过短串原样返回(不强行裁,避免把脏值切成误导样子)。
 */
export function shortAddr(addr: string, head = 6, tail = 4): string {
  if (!/^0x[0-9a-fA-F]+$/.test(addr)) return addr;
  if (addr.length <= head + tail) return addr;
  return `${addr.slice(0, head)}…${addr.slice(-tail)}`;
}

/**
 * 时间戳 → "HH:MM:SS"(事件日志流水用,如 §7.3 的 `▸ 14:02:33 …`)。
 * 入参既接受秒(链上 block.timestamp / 事件,< 1e12)也接受毫秒(Date.now());
 * 用本地时区,等宽字体下对齐。
 */
export function formatLogTime(ts: number): string {
  // <1e12 判秒/毫秒的启发式假设是"当代时间戳":链上秒 ~1.7e9、Date.now 毫秒 ~1.7e12,
  // 分界 1e12 落在两者之间(1e12 秒 ≈ 公元 33658 年,远超合理范围)。本系统不会遇到该年代时间戳,故安全。
  const ms = ts < 1e12 ? ts * 1000 : ts;
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}
