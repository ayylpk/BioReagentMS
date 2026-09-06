// /agent/runs/stream —— 自写的 LangGraph 线协议最小子集（9/6 拍板：上线不拉 langgraph-api Python 镜像）
// 本地/线上同一个 Hono :8123 一套协议；langgraph dev(:2024) 降级为可选调试工具，前端不再依赖
// 协议（自己两端，够用就行）：
//   入 POST body { input: { question }, config: { configurable: { thread_id } }, mode?: 'public' }
//   出 SSE data 行：{"type":"ai_chunk","text":"…"} 增量 → {"type":"done"} / {"type":"error","message":"…"}
// mode=public（免登录演示通道 /assistant）三件套：
//   ① allowDb=false —— 台账路关闭（提示词二选一 + 条件边双保险，库存数据不给匿名者）
//   ② per-IP 限流 —— 8 条/分钟 + 200 条/天（内存计数器，进程重启即重置，demo 够用）
//   ③ allowWeb —— 联网兜底走全局日预算（100 次/天，防 Tavily 被刷爆），预算尽则该路降级为直接认怂
// 会话记忆：图里 MemorySaver 按 thread_id 分线程（进程内存档，服务重启 = 全员清空，符合"临时会话"定位）
import { Hono, type Context } from 'hono'
import { AIMessageChunk } from '@langchain/core/messages'
import { graph } from '../../agent/graph'

export const streamRoutes = new Hono()

// ── 限流器（固定窗口，进程内存版；升级路径=换 Redis，键语义不变） ──
const MIN_WINDOW = 8
const DAY_WINDOW = 200
const WEB_DAILY_BUDGET = 100
const buckets = new Map<string, { minStart: number; minCount: number; day: string; dayCount: number }>()
let webBudgetDay = ''
let webBudgetLeft = WEB_DAILY_BUDGET

function takeQuota(ip: string): { ok: boolean; msg?: string; allowWeb: boolean } {
	const now = Date.now()
	const day = new Date(now).toISOString().slice(0, 10)
	if (day !== webBudgetDay) {
		webBudgetDay = day
		webBudgetLeft = WEB_DAILY_BUDGET
	}
	const b = buckets.get(ip) ?? { minStart: now, minCount: 0, day, dayCount: 0 }
	if (b.day !== day) Object.assign(b, { day, dayCount: 0 })
	if (now - b.minStart > 60_000) Object.assign(b, { minStart: now, minCount: 0 })
	if (b.minCount >= MIN_WINDOW) {
		buckets.set(ip, b)
		return { ok: false, msg: '演示通道每分钟最多 8 条，歇一会儿再问～', allowWeb: webBudgetLeft > 0 }
	}
	if (b.dayCount >= DAY_WINDOW) {
		buckets.set(ip, b)
		return { ok: false, msg: '今日演示额度已用完，明天再来或登录完整版', allowWeb: webBudgetLeft > 0 }
	}
	b.minCount++
	b.dayCount++
	buckets.set(ip, b)
	const allowWeb = webBudgetLeft > 0
	if (allowWeb) webBudgetLeft-- // 每条公开消息预扣一份联网预算（是否真走到 web 节点由图决定，宁可保守）
	return { ok: true, allowWeb }
}

/** 本地 vite proxy / 线上 nginx：优先 x-forwarded-for 首段；都拿不到归 'local' */
const clientIp = (c: Context): string => {
	const xff = c.req.header('x-forwarded-for')
	return xff?.split(',')[0]?.trim() || c.req.header('x-real-ip') || 'local'
}

streamRoutes.post('/runs/stream', async (c) => {
	const body = (await c.req.json().catch(() => null)) as {
		input?: { question?: string }
		config?: { configurable?: { thread_id?: string } }
		mode?: string
	} | null
	const question = String(body?.input?.question ?? '').trim()
	const threadId = String(body?.config?.configurable?.thread_id ?? 'anon')
	const isPublic = body?.mode === 'public'
	if (!question) return c.json({ error: 'input.question 必填' }, 400)
	if (question.length > 500) return c.json({ error: '问题过长（≤500 字）' }, 400)

	// 公开通道先过闸门，超限时连图都不进（一次 LLM 都不起）
	let allowWeb = true
	if (isPublic) {
		const quota = takeQuota(clientIp(c))
		if (!quota.ok) {
			return new Response(
				`data: ${JSON.stringify({ type: 'ai_chunk', text: quota.msg })}\n\ndata: {"type":"done"}\n\n`,
				{ headers: { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache', 'X-Accel-Buffering': 'no' } },
			)
		}
		allowWeb = quota.allowWeb
	}

	const enc = new TextEncoder()
	const stream = new ReadableStream<Uint8Array>({
		async start(controller) {
			const send = (obj: Record<string, unknown>) =>
				controller.enqueue(enc.encode(`data: ${JSON.stringify(obj)}\n\n`))
			let gotChunk = false
			try {
				const it = await graph.stream(
					{ question, ...(isPublic ? { allowDb: false, allowWeb } : {}) },
					{ configurable: { thread_id: threadId }, streamMode: 'messages' },
				)
				for await (const [msg, meta] of it as unknown as AsyncIterable<[any, any]>) {
					// 三重交集才上屏：result 节点 + 是增量块 + 文本非空
					//   漏任一条都会炸：router/dbQuery 的 isChunk 块 content 为空（结构化输出流）；
					//   末尾还有个 isChunk=false 的聚合态 AIMessage，转它=整句重复一遍（9/6 调试实录）
					//   另注：messages 流里 chunk.getType() 返回 'ai' 而非 'AIMessageChunk'，只能靠 isInstance 判
					if (meta?.langgraph_node !== 'result') continue
					if (!AIMessageChunk.isInstance(msg)) continue
					const text = typeof msg?.content === 'string' ? msg.content : ''
					if (!text) continue
					gotChunk = true
					send({ type: 'ai_chunk', text })
				}
				if (!gotChunk) {
					// 无流式块的结局（result 节点 catch 里手搓的错误消息）：去终态捞最后一条，保证气泡有字
					const st = await graph.getState({ configurable: { thread_id: threadId } })
					const last = st?.values?.messages?.at?.(-1)
					const text = typeof last?.content === 'string' ? last.content : ''
					if (text) send({ type: 'ai_chunk', text })
				}
				send({ type: 'done' })
			} catch (e) {
				send({ type: 'error', message: (e as Error).message.slice(0, 200) })
			}
			controller.close()
		},
	})
	return new Response(stream, {
		headers: {
			'Content-Type': 'text/event-stream; charset=utf-8',
			'Cache-Control': 'no-cache',
			Connection: 'keep-alive',
			'X-Accel-Buffering': 'no', // nginx 侧关缓冲（线上加 this 头防"憋到最后一次吐"）
		},
	})
})
