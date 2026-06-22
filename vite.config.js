import { defineConfig } from 'vite';

// 本地 dev 用根路径；构建部署到 GitHub Pages 子路径时用 /StockClash/。
export default defineConfig(({ command }) => ({
  root: '.',
  base: command === 'build' ? '/StockClash/' : '/',
  // mqtt.js 在浏览器端需要 global 指向 globalThis
  define: { global: 'globalThis' },
  server: { port: 5174, open: true },
  build: { outDir: 'dist', target: 'es2020' },
}));
