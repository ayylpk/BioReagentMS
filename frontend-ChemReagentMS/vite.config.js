import { fileURLToPath, URL } from 'node:url'

import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import vueDevTools from 'vite-plugin-vue-devtools'

export default defineConfig({
  plugins: [
    vue(),
    vueDevTools(),
  ],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    port: 5173,
    host: '0.0.0.0',   // 允许外部浏览器访问
    proxy: {
      '/api': {
        target: 'http://localhost:8080',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ''),
      },
      '/agent': {
        target: 'http://localhost:8123',
        changeOrigin: true,
      },
      // 摄取 API（tsAgent Hono :8123 的 /ingest 路由，路径前后端一致不用 rewrite）
      '/ingest': {
        target: 'http://localhost:8123',
        changeOrigin: true,
      },
      // 两条人审 + 缺口知识（都是 tsAgent :8123；联网搜索 /search 代理已随该功能移除）
      '/review': { target: 'http://localhost:8123', changeOrigin: true },
      '/reaction': { target: 'http://localhost:8123', changeOrigin: true },
      '/gap': { target: 'http://localhost:8123', changeOrigin: true },
    },
  },
})
