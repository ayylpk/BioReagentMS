// 周边 HTTP 服务（与 LangGraph Server 分进程：graph dev 只管图协议，自定义路由不归它管）
// :8123 —— 集成期把 vite 的 /search 代理指过来，顺便接管 py 老版 database.py 的 webSearch 确认接口
// 现在的职责：健康检查 + L2 人审队列 API
import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { config } from '../config/env'
import { reviewRoutes } from './routes/review'

const app = new Hono()

app.get('/healthz', (c) => c.json({ ok: true, port: config.SERVICE_PORT }))
app.route('/review', reviewRoutes)
// TODO(集成期): app.route('/webSearch', webSearchRoutes) —— 接管 WebSearch.vue 的暂存/确认流

console.log(`[service] http://127.0.0.1:${config.SERVICE_PORT}`)
serve({ fetch: app.fetch, port: config.SERVICE_PORT })
