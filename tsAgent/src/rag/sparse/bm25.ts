// 关键词（BM25 风稀疏向量）的存储与检索 —— 只管稀疏这一路，混合/编排逻辑在调用方（ragNode）
// 分工线：稠密的存取在 embed/ollama.ts；稀疏的 分词/补写/检索 全在这
// 原理三句话：① jieba 分词（中文）+ ASCII 整段（保住 7664-93-9 这种 CAS 号不被切碎）
//            ② token → uint32 用 FNV 哈希当函数式词表（同词必同号，文档/查询共用本函数即一致）
//            ③ value 只放 tf 饱和值 1+log(tf)；IDF 由建字段时 modifier:"idf" 让 Qdrant 服务端乘
import { Jieba } from '@node-rs/jieba'
import { QdrantClient } from '@qdrant/js-client-rest'
import type { Retrieved } from '../embed/ollama' // 只借返回形状，不碰它的实现

const jieba = new Jieba() // v2 是类实例 API，自带默认词典

const QDRANT_URL = process.env.QDRANT_URL ?? 'http://localhost:6333'
const COLLECTION = process.env.RAG_COLLECTION ?? 'sds_embed_demo'
const SPARSE_FIELD = 'sparse'

const qdrant = new QdrantClient({ url: QDRANT_URL })

export interface SparseVec {
	indices: number[]
	values: number[]
}

const fnv1a = (s: string): number => {
	let h = 0x811c9dc5
	for (let i = 0; i < s.length; i++) {
		h ^= s.charCodeAt(i)
		h = Math.imul(h, 0x01000193)
	}
	return h >>> 0
}

/** 分词：ASCII 连续段（含 - . _，CAS/规格号整段保留）小写；中文段交给 jieba */
export function tokenize(text: string): string[] {
	const tokens: string[] = []
	for (const run of text.match(/[a-zA-Z0-9][a-zA-Z0-9._-]*/g) ?? []) tokens.push(run.toLowerCase())
	for (const seg of text.match(/[一-鿿]+/g) ?? []) tokens.push(...jieba.cut(seg))
	return tokens
}

/** 文本 → 稀疏向量：同 token 计 tf，值 = 1+log(tf)（出现 1 次=1，8 次≈3.1，温和饱和） */
export function toSparse(text: string): SparseVec {
	const tf = new Map<number, number>()
	for (const t of tokenize(text)) {
		const idx = fnv1a(t)
		tf.set(idx, (tf.get(idx) ?? 0) + 1)
	}
	const entries = [...tf.entries()].sort((a, b) => a[0] - b[0])
	return { indices: entries.map(([i]) => i), values: entries.map(([, f]) => 1 + Math.log(f)) }
}

/** 给集合补建 sparse 字段（已存在秒过；老库第一次跑会走 createVectorName 动态加列） */
async function ensureSparseField(): Promise<void> {
	const info = await qdrant.getCollection(COLLECTION)
	// 1.19 客户端的 getCollection 返回类型没把 sparse_vectors 长出来，绕类型看一眼真实 JSON
	const sparseCfg = (info.config as unknown as { sparse_vectors?: Record<string, unknown> }).sparse_vectors
	if (sparseCfg?.[SPARSE_FIELD]) return
	await qdrant.createVectorName(COLLECTION, SPARSE_FIELD, {
		sparse: { modifier: 'idf' }, // 服务端全库统计 df，自动乘 IDF —— 我们只管交 tf
	})
}

// ─────────────────────────────────────────────────────────
// 存储侧：给「已有 point」补挂稀疏向量（updateVectors 只动 named 字段，dense/payload 不碰）
// id 从哪来：insertDocBatch 的返回值 —— 链式用法：
//   const ids = await insertDocBatch(texts, meta)
//   await insertSparse(ids.map((id, i) => ({ id, text: texts[i] })))
// ─────────────────────────────────────────────────────────
export async function insertSparse(entries: { id: number; text: string }[]): Promise<void> {
	if (!entries.length) return
	await ensureSparseField()
	// 注：updateVectors 的 named-sparse 在 1.19 客户端类型里没长全，直接打官方 REST（服务端一等公民接口）
	const res = await fetch(`${QDRANT_URL}/collections/${COLLECTION}/points/update_vectors?wait=true`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({
			points: entries.map(e => ({ id: e.id, vectors: { [SPARSE_FIELD]: toSparse(e.text) } })),
		}),
	})
	if (!res.ok) throw new Error(`updateVectors 失败 ${res.status}: ${(await res.text()).slice(0, 200)}`)
}

/** 一次性回填：库里已存在但没有稀疏向量的点（hello 脚本灌的 6 条就靠它救），逐页扫 text 重算 */
export async function backfillSparse(): Promise<number> {
	await ensureSparseField()
	let offset: number | string | undefined
	let done = 0
	do {
		const page = await qdrant.scroll(COLLECTION, {
			with_payload: { include: ['text'] },
			limit: 256,
			offset,
		})
		const entries = page.points
			.filter(p => typeof (p.payload as { text?: unknown } | undefined)?.text === 'string')
			.map(p => ({ id: p.id as number, text: (p.payload as { text: string }).text }))
		await insertSparse(entries)
		done += entries.length
		const next = page.next_page_offset
		offset = typeof next === 'number' || typeof next === 'string' ? next : undefined
	} while (offset !== undefined)
	return done
}

// ─────────────────────────────────────────────────────────
// 检索侧
// ─────────────────────────────────────────────────────────

/** 纯关键词：查询词 → 稀疏向量 → sparse 字段最近邻（字面命中才有分，零命中=查不到，很诚实） */
export async function searchSparse(query: string, top = 3): Promise<Retrieved[]> {
	await ensureSparseField()
	const { points } = await qdrant.query(COLLECTION, {
		query: toSparse(query),
		using: SPARSE_FIELD,
		limit: top,
		with_payload: true,
	})
	return points.map(p => ({ score: p.score, ...(p.payload as object) } as Retrieved))
}
