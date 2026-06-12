/**
 * salt 生成(Design.md §5.1:CSPRNG ≥128 bit;承诺隐藏性完全依赖 salt 熵)。
 * 用 globalThis.crypto(Node ≥20 与浏览器都有),保持浏览器安全;不 import node:crypto。
 */

/** 128 bit CSPRNG 随机 bigint,范围 [0, 2^128) */
export function randomSalt(): bigint {
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  let v = 0n;
  for (const byte of bytes) {
    v = (v << 8n) | BigInt(byte);
  }
  return v;
}
