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
      '/search': {
        target: 'http://localhost:8123',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/search/, ''),
      },
      // 摄取 API（tsAgent Hono :8123 的 /ingest 路由，路径前后端一致不用 rewrite）
      '/ingest': {
        target: 'http://localhost:8123',
        changeOrigin: true,
      },
    },
  },
})
