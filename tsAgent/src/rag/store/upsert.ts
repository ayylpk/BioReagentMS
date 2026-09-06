// ⑧ 入库调度：三件套的唯一写入口（稠密 embed + 稀疏 toSparse + payload）+ doc_id 幂等 + 台账
// 分工线：embed/、sparse/ 只管自己模态的向量算法；"一条 chunk 同时长两种向量"的组合只发生在这层
// 读侧提醒：生产 collection 的稠密字段是 named "dense"——ragNode/searchDoc 接入真库那天加 using:'dense'
import { QdrantClient } from '@qdrant/js-client-rest'
import { config } from '../../config/env'
import { embed } from '../embed' // 门面选择后端（EMBED_BACKEND），写读永远同模
import { toSparse } from '../sparse/bm25'
import { pool } from '../../db/mysql'
import type { Chunk, DocProfile } from '../inspect/profile'

// 台账表（接线日跑一次；logIngest 对缺表只 warn，旁路化）：
// CREATE TABLE IF NOT EXISTS ingest_log (
//   doc_id VARCHAR(128) PRIMARY KEY, file VARCHAR(512), status VARCHAR(16),
//   chunks INT, cost_ms INT, flags TEXT, updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP)
// 老库补列：ALTER TABLE ingest_log ADD COLUMN cost_ms INT NULL AFTER chunks

const qdrant = new QdrantClient({ url: config.QDRANT_URL, apiKey: config.QDRANT_API_KEY || undefined })
const COLL = config.QDRANT_COLLECTION
const EMBED_BATCH = 32 // v4/bge 批量上限内取稳；Ollama 不限但内存友好

/** 确定性 point id：hash(doc_id#seq) → 同文档重跑幂等覆盖，增量按 doc_id 删旧插新 */
export function pointId(docId: string, seq: number): number {
	let h = 0x811c9dc5 // FNV-1a，与 bm25 同款（用途不同：那边是词表编号，这边是主键）
	for (const c of `${docId}#${seq}`) {
		h ^= c.codePointAt(0)!
		h = Math.imul(h, 0x01000193)
	}
	return h >>> 0
}

let collectionReady = false
async function ensureCollection(): Promise<void> {
	if (collectionReady) return
	// ⚠️ 1.19 客户端 collectionExists 返回 {exists:boolean} 对象而非裸布尔——直接 if(await) 恒真，血泪注释
	if ((await qdrant.collectionExists(COLL)).exists) { collectionReady = true; return }
	await qdrant.createCollection(COLL, {
		vectors: { dense: { size: config.EMBED_DIM, distance: 'Dot' } },
		sparse_vectors: { sparse: { modifier: 'idf' } }, // IDF 服务端统计，写入只管交 tf
	})
	await qdrant.createPayloadIndex(COLL, { field_name: 'section', field_schema: 'keyword' })
	await qdrant.createPayloadIndex(COLL, { field_name: 'cas_number', field_schema: 'keyword' })
	await qdrant.createPayloadIndex(COLL, { field_name: 'doc_id', field_schema: 'keyword' })
	collectionReady = true
}

/** 把一个文档的全部 chunk 写入向量库（先删同 doc_id 旧版本 = 增量重建不全库） */
export async function upsertChunks(profile: DocProfile, chunks: Chunk[]): Promise<void> {
	if (!chunks.length) return
	await ensureCollection()
	const docId = chunks[0]!.docId
	await qdrant.delete(COLL, { filter: { must: [{ key: 'doc_id', match: { value: docId } }] }, wait: true })

	const sourceDoc = profile.file.replace(/^.*[\\/]/, '')
	for (let i = 0; i < chunks.length; i += EMBED_BATCH) {
		const batch = chunks.slice(i, i + EMBED_BATCH)
		const dense = await embed(batch.map(c => c.text)) // 一次批量
		const points = batch.map((c, j) => ({
			id: pointId(c.docId, c.seq),
			vector: { dense: dense[j]!, sparse: toSparse(c.text) },
			payload: {
				doc_id: c.docId,
				source_doc: sourceDoc,
				section: c.section ?? null,
				cas_number: c.text.match(/\d{2,7}-\d{2}-\d/)?.[0] ?? null, // 锚前缀里就带着
				page: c.page ?? null,
				bbox: c.bbox ?? null,
				text: c.text,
				...(c.summary ? { summary: c.summary } : {}),
			},
		}))
		await qdrant.upsert(COLL, { wait: true, points })
	}
}

/** 整档删除：向量库按 doc_id 清空（与 upsert 同款 filter 写法），知识库页 / 重摄前用 */
export async function deleteDoc(docId: string): Promise<void> {
	await qdrant.delete(COLL, { filter: { must: [{ key: 'doc_id', match: { value: docId } }] }, wait: true })
}

/** 摄取台账 upsert：表没建/MySQL 没起都不许挡主流程（旁路化降级，同 sys_task 桥姿势） */
export async function logIngest(entry: { docId: string; file: string; status: string; chunks: number; flags: string[]; costMs?: number }): Promise<void> {
	try {
		await pool.query(
			`INSERT INTO ingest_log (doc_id, file, status, chunks, cost_ms, flags) VALUES (?, ?, ?, ?, ?, ?)
			 ON DUPLICATE KEY UPDATE status=VALUES(status), chunks=VALUES(chunks), cost_ms=VALUES(cost_ms), flags=VALUES(flags)`,
			[entry.docId, entry.file, entry.status, entry.chunks, entry.costMs ?? null, entry.flags.join('\n')],
		)
	} catch (e) {
		console.warn('[store] 台账写入跳过（ingest_log 缺表或 MySQL 未起）:', (e as Error).message.slice(0, 100))
	}
}
