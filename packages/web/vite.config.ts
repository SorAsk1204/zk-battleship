import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // Plan A:module worker。prover.worker.ts 内 import snarkjs,故 worker chunk 也要 ES 格式
  // (否则 classic worker 不能用 import)。snarkjs/ffjavascript 均有 "browser" 导出条件,
  // Vite 客户端构建默认解析 browser 条件 → 取各自 build/browser.esm.js(实测无 node:* / 无 process.X /
  // 子 worker 走 data-URL 经典 worker + 非 shared WebAssembly.Memory ⇒ 不需 COOP/COEP)。
  worker: {
    format: 'es',
  },
});
