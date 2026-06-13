/**
 * vitest 配置 —— lib 层纯逻辑单测(Task 3.1)。
 *
 * environment: 'node' —— 被测的全是纯逻辑(re-export 真理源 / 存储序列化 / 错误映射 / 格式化),
 * 不依赖 DOM;node 环境最快。storage 用例需要 localStorage,故在 setup 里注入一个内存 polyfill
 * (不引 jsdom,避免为单测拖一整套 DOM 实现)。
 *
 * 单独配置文件而非并入 vite.config.ts:vite 构建只跑 react+tailwind 插件,与测试无关;
 * 分开避免测试配置渗进生产构建。
 */
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    setupFiles: ['./src/lib/__test-setup__.ts'],
  },
});
