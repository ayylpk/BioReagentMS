// L2 人审队列（B 线：解析层）—— 三个端点是全部出口
//
//   GET    /review/pending        待审列表（含 flags 与理由；不含 blocks 全文）
//   GET    /review/:docId         单条详情（**含 blocks**：人审要改的就是它）
//   POST   /review/:docId/confirm 确认入库：可用 body.blocks 覆盖解析结果 → 重新切块 → 真入库 → 存档修正样本
//   POST   /review/:docId/reject  驳回：清向量 + 台账留痕（不删盘上原文件，用户可能想改后重传）
//
// 三条纪律（都是踩过的坑）：
//   ① **确认不是"改个标记"**：人工修正后的 blocks 必须重新走 bySection + upsertChunks，
//      否则队列里写着"已确认"、库里却没有内容 —— 那是比空壳更坏的假绿。
//   ② **审核人只从 JWT 取**（service/auth.ts 的 reviewerIdOf），body 里传的 reviewedBy 一律忽略。
//   ③ 修正后的 blocks 存档进 edited_blocks：这批"人改过的对照样本"是解析层回归评估集的原料，
//      丢掉它等于每次人审都白干。
import { Hono } from 'hono'
import { bySection } from '../../rag/chunk/bySection'
import { upsertChunks, logIngest, deleteDoc } from '../../rag/store/upsert'
import { gate } from '../../rag/gate/quality'
import { getReviewItem, listReviewItems, markReviewed, countPending } from '../../rag/store/review'
import { docIdOf } from '../../rag/inspect/identity'
import { validateBlocks } from '../../rag/parse/fromPy'
import { reviewerIdOf, requirePermission } from '../auth'
import type { Block } from '../../rag/inspect/profile'

export const reviewRoutes = new Hono()

/** 人审页用的解析结果形状校验：复用 py 契约那套严格校验（人改的块也一样不许缺 type/markdown） */
function parseBodyBlocks(raw: unknown): { ok: true; blocks: Block[] } | { ok: false; error: string } {
	const v = validateBlocks(raw)
	if (!v.ok) return { ok: false, error: `blocks 结构非法：${v.issues.slice(0, 3).map(i => `${i.field} ${i.message}（实际: ${i.actual}）`).join('；')}` }
	if (!v.blocks.length) return { ok: false, error: 'blocks 为空：确认入库至少要有一个块' }
	return { ok: true, blocks: v.blocks }
}

// 待审列表：status 默认 pending（人审页默认只看待办），可传 confirmed/rejected 回看已裁决的
reviewRoutes.get('/pending', async (c) => {
	const auth = await requirePermission(c, 'ragReview:query')
	if (!auth.ok) return auth.response!
	try {
		const { records, total } = await listReviewItems({
			status: c.req.query('status') ?? 'pending',
			keyword: c.req.query('keyword') ?? '',
			page: Number(c.req.query('page')) || 1,
			pageSize: Number(c.req.query('pageSize')) || 10,
		})
		return c.json({ records, total, ...(c.req.query('status') ? {} : { pending: await countPending() }) })
	} catch (e) {
		// 表没建（04 没跑）是最常见的一种：如实说清，别让人对着空数组猜
		return c.json({ error: `人审队列不可读：${(e as Error).message.slice(0, 150)}`, hint: '确认已执行 deploy/sql/04_rag_review_queue.sql' }, 500)
	}
})

const DB_HINT = '确认已执行 deploy/sql/04_rag_review_queue.sql，且 MySQL 可达'

reviewRoutes.get('/:docId', async (c) => {
	const auth = await requirePermission(c, 'ragReview:query')
	if (!auth.ok) return auth.response!
	try {
		const item = await getReviewItem(c.req.param('docId'))
		if (!item) return c.json({ error: `人审队列无此文档: ${c.req.param('docId')}` }, 404)
		return c.json(item)
	} catch (e) {
		return c.json({ error: `人审队列不可读：${(e as Error).message.slice(0, 150)}`, hint: DB_HINT }, 500)
	}
})

reviewRoutes.post('/:docId/confirm', async (c) => {
	const auth = await requirePermission(c, 'ragReview:audit')
	if (!auth.ok) return auth.response!
	const docId = c.req.param('docId')
	let reviewedBy: number
	try {
		reviewedBy = reviewerIdOf(auth.payload!)
	} catch (e) {
		return c.json({ error: (e as Error).message }, 403)
	}

	// 整个流程一个 try：取队列、校验、切块、入库、落账 —— 任何一步炸了都要给人话，不许漏成未捕获异常
	try {
		const body = (await c.req.json().catch(() => null)) as { blocks?: unknown; note?: string } | null
		const item = await getReviewItem(docId)
		if (!item) return c.json({ error: `人审队列无此文档: ${docId}` }, 404)

		// blocks 优先级：人工改的（body）> 之前存过的人工版 > 解析原文
		let blocks: Block[]
		if (body?.blocks !== undefined) {
			const parsed = parseBodyBlocks(body.blocks)
			if (!parsed.ok) return c.json({ error: parsed.error }, 400)
			blocks = parsed.blocks
		} else {
			blocks = item.editedBlocks ?? item.blocks
		}
		if (!blocks.length) return c.json({ error: '该条目没有可入库的解析结果（前门就判死的文档需先补 blocks 再确认）' }, 400)

		// 口径：docId 的唯一来源是 identity.ts —— 从盘上路径重算并断言，防队列里那条与文件对不上号
		const recomputed = docIdOf(item.file)
		if (recomputed !== docId)
			return c.json({ error: `doc_id 口径不一致：队列=${docId} 盘上路径重算=${recomputed}（拒绝入库，免得挂到别的文档身上）` }, 409)

		const chunks = bySection(item.file, blocks)
		if (!chunks.length) return c.json({ error: '重新切块得到 0 个切片（blocks 内容可能全是空块）' }, 400)
		// 人工已确认，这里**不再用 gate 判死**（人比闸门可信）；但仍跑一遍把 flags 记进台账，可观测不控制
		const verdict = gate(item.profile ?? ({ file: item.file, family: 'unknown', magic: 'review', strategy: 'L0-py', reason: '人审确认' }), blocks, undefined)
		await upsertChunks({ file: item.file, family: item.profile?.family ?? 'unknown', magic: item.profile?.magic ?? 'review', strategy: item.profile?.strategy ?? 'L0-py', reason: '人工确认入库' }, chunks)
		await logIngest({
			docId, file: item.file, status: 'done', chunks: chunks.length,
			flags: [`[人审] 由 uid=${reviewedBy} 确认入库${body?.note ? `（备注：${body.note}）` : ''}`, ...verdict.flags],
		})
		// 修正样本存档：body 给的才算"人改过的"；直接用原文确认的就把 edited_blocks 留空（别污染对照样本）
		await markReviewed(docId, { status: 'confirmed', reviewedBy, chunks: chunks.length, editedBlocks: body?.blocks !== undefined ? blocks : null })
		return c.json({ ok: true, docId, chunks: chunks.length, reviewedBy, flags: verdict.flags })
	} catch (e) {
		return c.json({ error: `确认入库失败：${(e as Error).message.slice(0, 200)}`, hint: DB_HINT }, 500)
	}
})

reviewRoutes.post('/:docId/reject', async (c) => {
	const auth = await requirePermission(c, 'ragReview:audit')
	if (!auth.ok) return auth.response!
	const docId = c.req.param('docId')
	let reviewedBy: number
	try {
		reviewedBy = reviewerIdOf(auth.payload!)
	} catch (e) {
		return c.json({ error: (e as Error).message }, 403)
	}
	try {
		const body = (await c.req.json().catch(() => null)) as { note?: string } | null
		const item = await getReviewItem(docId)
		if (!item) return c.json({ error: `人审队列无此文档: ${docId}` }, 404)

		const problems: string[] = []
		// 向量库：该 doc 可能压根没入过库（前门判死那种），删不到不是错误
		try {
			await deleteDoc(docId)
		} catch (e) {
			problems.push(`向量库清理失败：${(e as Error).message.slice(0, 100)}`)
		}
		await logIngest({
			docId, file: item.file, status: 'rejected', chunks: 0,
			flags: [`[人审] 由 uid=${reviewedBy} 驳回${body?.note ? `（备注：${body.note}）` : ''}`, ...item.flags.slice(0, 10)],
		})
		await markReviewed(docId, { status: 'rejected', reviewedBy })
		return c.json({ ok: true, docId, reviewedBy, problems })
	} catch (e) {
		return c.json({ error: `驳回失败：${(e as Error).message.slice(0, 200)}`, hint: DB_HINT }, 500)
	}
})
