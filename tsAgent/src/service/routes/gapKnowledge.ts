// 缺口知识（MySQL）—— 本地库没查到时的"AI 生成 + 人工确认"闭环的出口
//
//   GET  /gap/list     分页列表（默认 pending；带待办角标数）
//   GET  /gap/:id      单条详情（含完整的模型回答与弱命中线索）
//   POST /gap/:id/done 完成：可带修正后的 answer（修正后的内容就是"人写的"，这是这张表最值钱的产出）
//   POST /gap/:id/ignore 忽略：人工看过判定没价值 → 之后不再复用（不是删除，留痕）
//
// 为什么只进 MySQL 不进向量库见 tools/gapAnswer.ts 顶部：生成内容混进文献证据是不许的。
// 完成后的价值来自"同问题复用"（store/gap.ts 的 findReusable），而不是检索。
import { Hono } from 'hono'
import type { Context } from 'hono'
import { countPendingGaps, getGap, listGaps, markGap } from '../../rag/store/gap'
import { reviewerIdOf, requirePermission } from '../auth'

export const gapRoutes = new Hono()

const DB_HINT = '确认已执行 deploy/sql/05_rag_gap_knowledge.sql，且 MySQL 可达'

gapRoutes.get('/list', async (c) => {
	const auth = await requirePermission(c, 'gapKnowledge:query')
	if (!auth.ok) return auth.response!
	try {
		const { records, total } = await listGaps({
			status: c.req.query('status') ?? 'pending',
			keyword: c.req.query('keyword') ?? '',
			page: Number(c.req.query('page')) || 1,
			pageSize: Number(c.req.query('pageSize')) || 10,
		})
		return c.json({ records, total, pending: await countPendingGaps() })
	} catch (e) {
		return c.json({ error: `缺口表不可读：${(e as Error).message.slice(0, 150)}`, hint: DB_HINT }, 500)
	}
})

gapRoutes.get('/:id', async (c) => {
	const auth = await requirePermission(c, 'gapKnowledge:query')
	if (!auth.ok) return auth.response!
	const id = Number(c.req.param('id'))
	if (!Number.isInteger(id) || id <= 0) return c.json({ error: 'id 必须是正整数' }, 400)
	try {
		const row = await getGap(id)
		if (!row) return c.json({ error: `缺口记录不存在: ${id}` }, 404)
		return c.json(row)
	} catch (e) {
		return c.json({ error: `缺口表不可读：${(e as Error).message.slice(0, 150)}`, hint: DB_HINT }, 500)
	}
})

/** 裁决（完成/忽略）：审核人只从 JWT 取；完成的记录之后会被同问题复用 */
const decide = (status: 'done' | 'ignored') => async (c: Context) => {
	const auth = await requirePermission(c, 'gapKnowledge:audit')
	if (!auth.ok) return auth.response!
	let reviewedBy: number
	try {
		reviewedBy = reviewerIdOf(auth.payload!)
	} catch (e) {
		return c.json({ error: (e as Error).message }, 403)
	}
	const id = Number(c.req.param('id'))
	if (!Number.isInteger(id) || id <= 0) return c.json({ error: 'id 必须是正整数' }, 400)
	try {
		const body = (await c.req.json().catch(() => ({}))) as { answer?: string }
		const row = await getGap(id)
		if (!row) return c.json({ error: `缺口记录不存在: ${id}` }, 404)
		await markGap(id, { status, reviewedBy, ...(body.answer !== undefined ? { answer: body.answer } : {}) })
		return c.json({
			ok: true, id, status, reviewedBy,
			note: status === 'done'
				? '已完成：之后同样的问题会直接复用这条内容（不再重新生成）'
				: '已忽略：之后同样的问题会重新生成一条待办',
		})
	} catch (e) {
		return c.json({ error: `裁决失败：${(e as Error).message.slice(0, 150)}`, hint: DB_HINT }, 500)
	}
}
gapRoutes.post('/:id/done', decide('done'))
gapRoutes.post('/:id/ignore', decide('ignored'))
