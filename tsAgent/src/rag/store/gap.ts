// 缺口知识表（MySQL）：本地知识库没查到时，模型生成的"通用参考"落在这一层等人工确认
//
// 表：rag_gap_knowledge（DDL 见 deploy/sql/05_rag_gap_knowledge.sql）
// 三条设计要点：
//   ① **进 MySQL，不进向量库** —— 生成内容混进文献证据是这个系统最不能犯的错（见 tools/gapAnswer.ts 顶部）；
//      done 之后靠"同问题复用"发挥价值，而不是靠检索。
//   ② **question_hash 唯一** —— 归一化（去空白/标点、小写、折叠同义写法）后算 sha1。
//      没有它，同一个问题会被反复生成、反复插行，表很快变成垃圾场。
//   ③ **旁路化**：表没建/库不可达一律 warn 不抛 —— 缺口记录是"锦上添花"，绝不能把问答主流程拖死。
import { createHash } from 'node:crypto'
import { pool } from '../../db/mysql'

export type GapStatus = 'pending' | 'done' | 'ignored'

export interface GapRow {
	id: number
	question: string
	questionHash: string
	answer: string
	status: GapStatus
	route: string | null
	model: string | null
	nearMisses: string[]
	askCount: number
	reviewedBy: number | null
	reviewedAt: Date | null
	createdAt: Date
	updatedAt: Date
}

/**
 * 问题归一化：小写 + 去全部空白与标点 + 全角折半角。
 * 目的只是"同一句话的不同写法算同一条"，不做同义改写（"怎么急救"与"如何急救"仍是两条）——
 * 语义级归并要么上 embedding 要么上别名表，那是另一个量级的决定，不塞进这一层。
 */
export function normalizeQuestion(q: string): string {
	return q
		.normalize('NFKC')
		.toLowerCase()
		.replace(/[\s\u3000]+/g, '')
		.replace(/[?？!！。.,，、；;：:'"'"()（）【】\[\]{}<>《》~～\-—_/\\|]+/g, '')
}

/** 归一化问题的 sha1（唯一键）：同句不同写法落同一条 */
export function hashQuestion(q: string): string {
	return createHash('sha1').update(normalizeQuestion(q), 'utf8').digest('hex')
}

const COLS = 'id, question, question_hash, answer, status, route, model, near_misses, ask_count, reviewed_by, reviewed_at, created_at, updated_at'

function parseNearMisses(v: unknown): string[] {
	if (Array.isArray(v)) return v.filter((x): x is string => typeof x === 'string')
	if (typeof v === 'string' && v.trim()) {
		try {
			const parsed = JSON.parse(v) as unknown
			return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : []
		} catch {
			return []
		}
	}
	return []
}

function mapRow(r: Record<string, unknown>): GapRow {
	return {
		id: Number(r.id),
		question: String(r.question ?? ''),
		questionHash: String(r.question_hash ?? ''),
		answer: String(r.answer ?? ''),
		status: String(r.status ?? 'pending') as GapStatus,
		route: r.route === null || r.route === undefined ? null : String(r.route),
		model: r.model === null || r.model === undefined ? null : String(r.model),
		nearMisses: parseNearMisses(r.near_misses),
		askCount: Number(r.ask_count ?? 0),
		reviewedBy: r.reviewed_by === null || r.reviewed_by === undefined ? null : Number(r.reviewed_by),
		reviewedAt: (r.reviewed_at as Date | null) ?? null,
		createdAt: r.created_at as Date,
		updatedAt: r.updated_at as Date,
	}
}

/**
 * 已存在就返回（含 done / pending 两种），ignored 的不复用（那是"人工看过、判定没价值"）。
 * 这是"同问题不重复生成"的唯一入口。
 */
export async function findReusable(questionHash: string): Promise<GapRow | null> {
	const [rows] = (await pool.query(
		`SELECT ${COLS} FROM rag_gap_knowledge WHERE question_hash = ? AND status IN ('pending','done') LIMIT 1`,
		[questionHash],
	)) as [Record<string, unknown>[], unknown]
	return rows[0] ? mapRow(rows[0]) : null
}

/**
 * 插入缺口记录。**并发/重试由唯一键兜底**：撞上唯一键说明别人刚插过，
 * 这时不报错、改为把已存在那条的 id 取回来（把"重复"变成"复用"），否则一次并发就会让用户看到失败。
 */
export async function insertGap(input: {
	question: string
	questionHash: string
	answer: string
	model: string | null
	nearMisses: string[]
	route?: string
}): Promise<number | null> {
	try {
		const [res] = (await pool.query(
			`INSERT INTO rag_gap_knowledge (question, question_hash, answer, status, route, model, near_misses, ask_count)
			 VALUES (?, ?, ?, 'pending', ?, ?, ?, 1)
			 ON DUPLICATE KEY UPDATE ask_count = ask_count + 1, id = LAST_INSERT_ID(id)`,
			[input.question, input.questionHash, input.answer, input.route ?? 'knowledge', input.model, JSON.stringify(input.nearMisses)],
		)) as [{ insertId?: number }, unknown]
		return res.insertId ? Number(res.insertId) : null
	} catch (e) {
		console.warn('[gap] 落表跳过（rag_gap_knowledge 缺表或 MySQL 未起）:', (e as Error).message.slice(0, 120))
		return null
	}
}

/** 被问次数 +1（复用时也记）：它同时是"该补哪块资料"的排序依据 */
export async function bumpAskCount(questionHash: string): Promise<void> {
	try {
		await pool.query('UPDATE rag_gap_knowledge SET ask_count = ask_count + 1 WHERE question_hash = ?', [questionHash])
	} catch { /* 旁路化：计数失败不影响回答 */ }
}

export async function listGaps(opts: { status?: string; keyword?: string; page?: number; pageSize?: number } = {}): Promise<{ records: GapRow[]; total: number }> {
	const page = Math.max(opts.page ?? 1, 1)
	const pageSize = Math.min(Math.max(opts.pageSize ?? 10, 1), 100)
	const where: string[] = []
	const params: unknown[] = []
	if (opts.status) { where.push('status = ?'); params.push(opts.status) }
	if (opts.keyword) { where.push('(question LIKE ? OR answer LIKE ?)'); params.push(`%${opts.keyword}%`, `%${opts.keyword}%`) }
	const whereSql = where.length ? ` WHERE ${where.join(' AND ')}` : ''
	const [countRows] = (await pool.query(`SELECT COUNT(*) n FROM rag_gap_knowledge${whereSql}`, params)) as [{ n: number }[], unknown]
	const [rows] = (await pool.query(
		`SELECT ${COLS} FROM rag_gap_knowledge${whereSql} ORDER BY (status='pending') DESC, ask_count DESC, updated_at DESC LIMIT ? OFFSET ?`,
		[...params, pageSize, (page - 1) * pageSize],
	)) as [Record<string, unknown>[], unknown]
	return { records: rows.map(mapRow), total: Number(countRows[0]?.n ?? 0) }
}

export async function getGap(id: number): Promise<GapRow | null> {
	const [rows] = (await pool.query(`SELECT ${COLS} FROM rag_gap_knowledge WHERE id = ? LIMIT 1`, [id])) as [Record<string, unknown>[], unknown]
	return rows[0] ? mapRow(rows[0]) : null
}

/**
 * 人工裁决：done（确认可用，之后同问题直接复用）/ ignored（看过但判定没价值，不再复用）。
 * answer 可在此时被修正 —— 修正后的内容是真正"人写的"，这是这张表最值钱的产出。
 */
export async function markGap(id: number, input: {
	status: Extract<GapStatus, 'done' | 'ignored'>
	reviewedBy: number
	answer?: string
}): Promise<void> {
	await pool.query(
		`UPDATE rag_gap_knowledge SET status = ?, reviewed_by = ?, reviewed_at = NOW(), answer = COALESCE(?, answer) WHERE id = ?`,
		[input.status, input.reviewedBy, input.answer?.trim() ? input.answer.trim() : null, id],
	)
}

/** 待确认条数（页面角标）；缺表返回 null 而不是 0 —— 0 会被当成"没有待办" */
export async function countPendingGaps(): Promise<number | null> {
	try {
		const [rows] = (await pool.query(`SELECT COUNT(*) n FROM rag_gap_knowledge WHERE status = 'pending'`)) as [{ n: number }[], unknown]
		return Number(rows[0]?.n ?? 0)
	} catch {
		return null
	}
}
