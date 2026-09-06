// 周边 HTTP 服务（9/6 起 = agent 侧唯一进程）：摄取 API + L2 人审 + webSearch 确认 + 聊天流式端点
// :8123 承接 vite 三条代理：/ingest、/search→webSearch、/agent→runs/stream（自写线协议最小子集，替代 langgraph dev :2024）
import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { config } from '../config/env'
import { reviewRoutes } from './routes/review'
import { ingestRoutes } from './routes/ingest'
import { webSearchRoutes } from './routes/webSearch'
import { streamRoutes } from './routes/stream'

const app = new Hono()

app.get('/healthz', (c) => c.json({ ok: true, port: config.SERVICE_PORT }))
app.route('/review', reviewRoutes)
app.route('/ingest', ingestRoutes)
app.route('/webSearch', webSearchRoutes) // WebSearch.vue 走 /search 代理（rewrite 掉前缀后正好是 /webSearch/confirm）
app.route('/agent', streamRoutes) // Chat.vue 走 /agent 代理 → :8123（不再依赖 langgraph dev :2024）

console.log(`[service] http://127.0.0.1:${config.SERVICE_PORT}`)
serve({ fetch: app.fetch, port: config.SERVICE_PORT })
