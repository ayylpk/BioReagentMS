// 禁配/相容性审核 API（A 线：反应规则人审）—— store 层的发动机已经在了，这里补方向盘
//
//   GET    /reaction/candidates              候选列表（审核队列；reviewStatus/sourceState/docId/relationType 过滤）
//   GET    /reaction/candidates/:id          单条候选（含证据原文与来源定位）
//   POST   /reaction/candidates/:id/approve  通过  -> store.reviewCandidate
//   POST   /reaction/candidates/:id/reject   拒绝  -> store.reviewCandidate
//   POST   /reaction/rules/publish           发布正式规则 -> store.publishRule（未审核候选会被它拒掉）
//   GET    /reaction/rules                   已发布规则（?docId= / ?cas=|?name= / ?aCas=&bCas= 三种查法）
//   POST   /reaction/rules/:id/reconfirm     来源复核回 active -> store.reconfirmRuleSource
//
// 三条纪律：
//   ① **审核人只从 JWT 取**（reviewerIdOf）：body 里传的 reviewedBy 一律忽略 —— 审核记录必须能追到真人。
//   ② **发布必须显式 supersede**：同一 rule_key 已有 active 规则时，只有 `supersedeExisting:true` 才能顶掉
//      （store 层已经这么守了，路由层不许替调用方默认成 true）。
//   ③ 只读用 reactionReview:query、写用 reactionReview:audit（权限点见 deploy/sql/02 与 04）。
import { Hono } from 'hono'
import type { Context } from 'hono'
import {
	findRulesByDocId, findRulesByEntityKey, findRulesByPairKeys, getCandidate,
	listCandidates, publishRule, reconfirmRuleSource, reviewCandidate,
} from '../../reaction/store'
import { candidateListQuerySchema, publishRuleInputSchema, reviewDecisionSchema } from '../../reaction/types'
import { entityKeyOf, pairKeyOf } from '../../reaction/keys'
import { reviewerIdOf, requirePermission, type TokenPayload } from '../auth'

export const reactionReviewRoutes = new Hono()

/** 审核人 uid：只认 token（审计要求），拿不到就 403 —— 不许写一条"无人负责"的审核记录 */
function reviewerOrReject(c: Context, payload: TokenPayload | undefined): { ok: true; uid: number } | { ok: false; res: Response } {
	try {
		return { ok: true, uid: reviewerIdOf(payload ?? {}) }
	} catch (e) {
		return { ok: false, res: c.json({ error: (e as Error).message }, 403) }
	}
}

/** 统一异常出口：领域错误（状态机/键规范化/zod）→ 409/400，其余 500 */
function fail(c: Context, e: unknown): Response {
	const msg = (e as Error).message ?? String(e)
	const name = (e as Error).name ?? ''
	if (name === 'ZodError') {
		// zod 的原始报错是 JSON 数组，直接回给前端页面没法看 → 压成一行人话
		const issues = (e as { issues?: { path?: (string | number)[]; message?: string }[] }).issues ?? []
		const brief = issues.slice(0, 3).map(i => `${(i.path ?? []).join('.') || '}'} ${i.message ?? ''}`).join('；')
		return c.json({ error: `参数非法：${brief || msg.slice(0, 120)}` }, 400)
	}
	if (name === 'ReactionStateError') return c.json({ error: msg }, 409)
	if (name === 'ReactionKeyError') return c.json({ error: msg }, 400)
	return c.json({ error: `审核操作失败：${msg.slice(0, 200)}` }, 500)
}

// ── 候选：读 ──
reactionReviewRoutes.get('/candidates', async (c) => {
	const auth = await requirePermission(c, 'reactionReview:query')
	if (!auth.ok) return auth.response!
	try {
		const parsed = candidateListQuerySchema.safeParse({
			reviewStatus: c.req.query('reviewStatus') || undefined,
			sourceState: c.req.query('sourceState') || undefined,
			docId: c.req.query('docId') || undefined,
			relationType: c.req.query('relationType') || undefined,
			limit: c.req.query('limit') || undefined,
			offset: c.req.query('offset') || undefined,
		})
		if (!parsed.success) return c.json({ error: `查询参数非法：${parsed.error.issues[0]?.message ?? ''}` }, 400)
		const records = await listCandidates(parsed.data)
		return c.json({
			records,
			// 审核页打开就该看到待办；sourceState 与 reviewStatus 是两条正交轴，别混成一个过滤条件
			note: 'reviewStatus=pending 是待审；sourceState=stale 是"来源已变、结论待复核"（与审核状态正交）',
		})
	} catch (e) {
		return c.json({ error: `候选列表不可读：${(e as Error).message.slice(0, 150)}`, hint: '确认已执行 deploy/sql/02_reaction_rule.sql' }, 500)
	}
})

reactionReviewRoutes.get('/candidates/:id', async (c) => {
	const auth = await requirePermission(c, 'reactionReview:query')
	if (!auth.ok) return auth.response!
	const id = Number(c.req.param('id'))
	if (!Number.isInteger(id) || id <= 0) return c.json({ error: 'id 必须是正整数' }, 400)
	try {
		const row = await getCandidate(id)
		if (!row) return c.json({ error: `候选不存在: ${id}` }, 404)
		return c.json(row)
	} catch (e) {
		return fail(c, e)
	}
})

// ── 候选：裁决（通过/拒绝走同一条路，只有 decision 不同） ──
const decide = (decision: 'approve' | 'reject') => async (c: Context) => {
	const auth = await requirePermission(c, 'reactionReview:audit')
	if (!auth.ok) return auth.response!
	const r = reviewerOrReject(c, auth.payload)
	if (!r.ok) return r.res
	const id = Number(c.req.param('id'))
	if (!Number.isInteger(id) || id <= 0) return c.json({ error: 'id 必须是正整数' }, 400)
	const body = (await c.req.json().catch(() => ({}))) as { note?: string }
	try {
		const input = reviewDecisionSchema.parse({ decision, reviewedBy: r.uid, note: body.note ?? null })
		return c.json({ ok: true, candidate: await reviewCandidate(id, input) })
	} catch (e) {
		return fail(c, e)
	}
}
reactionReviewRoutes.post('/candidates/:id/approve', decide('approve'))
reactionReviewRoutes.post('/candidates/:id/reject', decide('reject'))

// ── 规则：发布 ──
reactionReviewRoutes.post('/rules/publish', async (c) => {
	const auth = await requirePermission(c, 'reactionReview:audit')
	if (!auth.ok) return auth.response!
	const r = reviewerOrReject(c, auth.payload)
	if (!r.ok) return r.res
	const body = (await c.req.json().catch(() => null)) as { candidateId?: number; note?: string; supersedeExisting?: boolean } | null
	try {
		const input = publishRuleInputSchema.parse({
			candidateId: body?.candidateId,
			reviewedBy: r.uid,
			note: body?.note ?? null,
			// ⚠️ 不给默认 true：顶掉一条已生效规则必须由调用方显式要求（store 层也会拒）
			supersedeExisting: body?.supersedeExisting === true,
		})
		return c.json({ ok: true, rule: await publishRule(input) })
	} catch (e) {
		return fail(c, e)
	}
})

// ── 规则：查询（三种查法，各有用处） ──
reactionReviewRoutes.get('/rules', async (c) => {
	const auth = await requirePermission(c, 'reactionReview:query')
	if (!auth.ok) return auth.response!
	const opts = {
		includeSuperseded: c.req.query('includeSuperseded') === '1',
		limit: Math.min(Math.max(Number(c.req.query('limit')) || 50, 1), 200),
	}
	try {
		const docId = c.req.query('docId')
		if (docId) return c.json({ records: await findRulesByDocId(docId), by: 'docId' })

		// 单实体查：?cas=7664-93-9 或 ?name=硫酸
		const cas = c.req.query('cas')
		const name = c.req.query('name')
		if (cas || name) {
			let key: string
			try {
				key = entityKeyOf({ kind: 'reagent', name: name || cas || '', cas: cas || null })
			} catch (e) {
				return c.json({ error: `实体键无法规范化：${(e as Error).message}` }, 400)
			}
			return c.json({
				records: await findRulesByEntityKey(key, opts), by: 'entity', key,
				note: '按单实体查只回"该实体参与过"的规则；查两个物质之间的关系请用 aCas/bCas 或 aName/bName。注意 name: 与 cas: 是两个键空间，库内以 CAS 为主',
			})
		}

		// 物质对查：aCas/bCas 优先（cas: 键跨命名体系稳定），否则 aName/bName
		const aCas = c.req.query('aCas')
		const bCas = c.req.query('bCas')
		const aName = c.req.query('aName')
		const bName = c.req.query('bName')
		if ((aCas || aName) && (bCas || bName)) {
			let pair: string
			try {
				pair = pairKeyOf(
					entityKeyOf({ kind: 'reagent', name: aName || aCas || '', cas: aCas || null }),
					entityKeyOf({ kind: 'reagent', name: bName || bCas || '', cas: bCas || null }),
				)
			} catch (e) {
				return c.json({ error: `对键无法规范化：${(e as Error).message}` }, 400)
			}
			return c.json({ records: await findRulesByPairKeys([pair], opts), by: 'pair', pairKey: pair })
		}
		return c.json({ error: '请给一种查法：docId / (cas 或 name) / (aCas|aName 与 bCas|bName)' }, 400)
	} catch (e) {
		return fail(c, e)
	}
})

// ── 规则：来源复核（source_state 回 active 只允许人工，store 层拒绝自动流程调用） ──
reactionReviewRoutes.post('/rules/:id/reconfirm', async (c) => {
	const auth = await requirePermission(c, 'reactionReview:audit')
	if (!auth.ok) return auth.response!
	const r = reviewerOrReject(c, auth.payload)
	if (!r.ok) return r.res
	const id = Number(c.req.param('id'))
	if (!Number.isInteger(id) || id <= 0) return c.json({ error: 'id 必须是正整数' }, 400)
	try {
		return c.json({ ok: true, rule: await reconfirmRuleSource(id, r.uid) })
	} catch (e) {
		return fail(c, e)
	}
})
