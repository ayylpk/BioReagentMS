// 解析层人审队列的存取（表 rag_review_queue，DDL 见 deploy/sql/04_rag_review_queue.sql）
//
// 分工线：pipeline 只负责"落料"（write 侧唯一入口 enqueueReview），service /review 只负责"读+裁决"
//         （listReviewItems / getReviewItem / markReviewed）。**重新切块与入库不在这一层**：
//         那是 pipeline 的活（bySection + upsertChunks），这里有且只有"存/取"。
//
// 为什么落料比端点更重要：改前过闸门不过的文档只留下 ingest_log 里的几行 flags ——
//   人看得到"没进去"，但拿不到解析结果本身，于是没法修，只能删了重传。存下 blocks_json 才有"可审的料"。
//
// 旁路化纪律（同 logIngest）：MySQL 没起/表没建都只 warn，绝不挡摄取主流程 ——
//   人审是补救通道，不是关键路径；让它把整批摄取拖死是反向的。
import { pool } from '../../db/mysql'
import type { Block, DocProfile } from '../inspect/profile'

export type ReviewStatus = 'pending' | 'confirmed' | 'rejected'
/** 为什么进队列（写进 origin 列，人审页按它分类） */
export type ReviewOrigin = 'front-door' | 'parser-reject' | 'gate' | 'needs-upgrade'

export interface ReviewItemRow {
	docId: string
	file: string
	status: ReviewStatus
	origin: ReviewOrigin | string
	reason: string | null
	flags: string[]
	profile: DocProfile | null
	blocksCount: number
	chunks: number
	reviewedBy: number | null
	reviewedAt: Date | null
	createdAt: Date
	updatedAt: Date
}

export interface ReviewItemDetail extends ReviewItemRow {
	/** 人工改过的优先（人改的就是最终要入库的），否则是解析原文 */
	blocks: Block[]
	editedBlocks: Block[] | null
}

const COLS = 'doc_id, file, status, origin, reason, flags, profile_json, blocks_json, edited_blocks, blocks_count, chunks, reviewed_by, reviewed_at, created_at, updated_at'

type DbRow = Record<string, unknown>

/** JSON 列读回来可能是字符串（mysql2 对 JSON/MEDIUMTEXT 的返回形态随版本与驱动配置变），两种都吃 */
function parseJson<T>(v: unknown): T | null {
	if (v === null || v === undefined) return null
	if (typeof v === 'object') return v as T
	if (typeof v === 'string') {
		try { return JSON.parse(v) as T } catch { return null }
	}
	return null
}

function mapRow(r: DbRow): ReviewItemRow {
	return {
		docId: String(r.doc_id),
		file: String(r.file ?? ''),
		status: String(r.status) as ReviewStatus,
		origin: String(r.origin ?? ''),
		reason: r.reason === null || r.reason === undefined ? null : String(r.reason),
		flags: String(r.flags ?? '').split('\n').filter(Boolean),
		profile: parseJson<DocProfile>(r.profile_json),
		blocksCount: Number(r.blocks_count ?? 0),
		chunks: Number(r.chunks ?? 0),
		reviewedBy: r.reviewed_by === null || r.reviewed_by === undefined ? null : Number(r.reviewed_by),
		reviewedAt: (r.reviewed_at as Date | null) ?? null,
		createdAt: r.created_at as Date,
		updatedAt: r.updated_at as Date,
	}
}

/**
 * 落料（pipeline 四个非 done 出口调用）。
 * **重复进入只更新理由与解析结果，不覆盖已裁决过的状态**：一份文档被人审驳回后又重传，
 * 应该回到 pending 重新审，而不是停在 rejected 让人以为它没人管 —— 这里的规则是：
 *   已 confirmed/rejected 的行 → 重置为 pending（因为这是**新的一次摄取**，人得重新看一眼）
 */
export async function enqueueReview(entry: {
	docId: string
	file: string
	origin: ReviewOrigin
	reason: string
	flags: string[]
	profile: DocProfile | null
	blocks: Block[]
}): Promise<boolean> {
	try {
		await pool.query(
			`INSERT INTO rag_review_queue (doc_id, file, status, origin, reason, flags, profile_json, blocks_json, blocks_count, chunks, edited_blocks, reviewed_by, reviewed_at)
			 VALUES (?, ?, 'pending', ?, ?, ?, ?, ?, ?, 0, NULL, NULL, NULL)
			 ON DUPLICATE KEY UPDATE
			   file=VALUES(file), status='pending', origin=VALUES(origin), reason=VALUES(reason), flags=VALUES(flags),
			   profile_json=VALUES(profile_json), blocks_json=VALUES(blocks_json), blocks_count=VALUES(blocks_count),
			   chunks=0, edited_blocks=NULL, reviewed_by=NULL, reviewed_at=NULL`,
			[
				entry.docId, entry.file, entry.origin, entry.reason.slice(0, 500),
				entry.flags.join('\n'),
				entry.profile ? JSON.stringify(entry.profile) : null,
				entry.blocks.length ? JSON.stringify(entry.blocks) : null,
				entry.blocks.length,
			],
		)
		return true
	} catch (e) {
		console.warn('[review] 人审落料跳过（rag_review_queue 缺表或 MySQL 未起）:', (e as Error).message.slice(0, 120))
		return false
	}
}

/** 待审/已审列表（不返回 blocks 全文：列表页不需要，几百 KB 的 JSON 会把响应撑爆） */
export async function listReviewItems(opts: { status?: string; keyword?: string; page?: number; pageSize?: number } = {}): Promise<{ records: ReviewItemRow[]; total: number }> {
	const page = Math.max(opts.page ?? 1, 1)
	const pageSize = Math.min(Math.max(opts.pageSize ?? 10, 1), 100)
	const where: string[] = []
	const params: unknown[] = []
	if (opts.status) { where.push('status = ?'); params.push(opts.status) }
	if (opts.keyword) { where.push('(doc_id LIKE ? OR file LIKE ? OR reason LIKE ?)'); params.push(`%${opts.keyword}%`, `%${opts.keyword}%`, `%${opts.keyword}%`) }
	const whereSql = where.length ? ` WHERE ${where.join(' AND ')}` : ''
	const [countRows] = (await pool.query(`SELECT COUNT(*) n FROM rag_review_queue${whereSql}`, params)) as [{ n: number }[], unknown]
	const [rows] = (await pool.query(
		`SELECT ${COLS} FROM rag_review_queue${whereSql} ORDER BY updated_at DESC LIMIT ? OFFSET ?`,
		[...params, pageSize, (page - 1) * pageSize],
	)) as [DbRow[], unknown]
	return { records: rows.map(mapRow), total: Number(countRows[0]?.n ?? 0) }
}

/** 单条详情：带 blocks（人审要改的就是它） */
export async function getReviewItem(docId: string): Promise<ReviewItemDetail | null> {
	const [rows] = (await pool.query(`SELECT ${COLS} FROM rag_review_queue WHERE doc_id = ? LIMIT 1`, [docId])) as [DbRow[], unknown]
	const row = rows[0]
	if (!row) return null
	return {
		...mapRow(row),
		blocks: parseJson<Block[]>(row.blocks_json) ?? [],
		editedBlocks: parseJson<Block[]>(row.edited_blocks),
	}
}

/** 裁决落账：confirmed（已入库）/ rejected（驳回）。reviewedBy 只能来自 JWT，调用方不许传客户端自报值 */
export async function markReviewed(docId: string, input: {
	status: Extract<ReviewStatus, 'confirmed' | 'rejected'>
	reviewedBy: number
	chunks?: number
	editedBlocks?: Block[] | null
}): Promise<void> {
	await pool.query(
		`UPDATE rag_review_queue
		    SET status = ?, reviewed_by = ?, reviewed_at = NOW(), chunks = ?,
		        edited_blocks = COALESCE(?, edited_blocks)
		  WHERE doc_id = ?`,
		[input.status, input.reviewedBy, input.chunks ?? 0, input.editedBlocks ? JSON.stringify(input.editedBlocks) : null, docId],
	)
}

/** 待审条数（健康检查/首页角标用；缺表时返回 null 而不是 0 —— 0 会被当成"审完了"） */
export async function countPending(): Promise<number | null> {
	try {
		const [rows] = (await pool.query(`SELECT COUNT(*) n FROM rag_review_queue WHERE status = 'pending'`)) as [{ n: number }[], unknown]
		return Number(rows[0]?.n ?? 0)
	} catch {
		return null
	}
}
