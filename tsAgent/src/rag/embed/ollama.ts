// 本地 embedding + Qdrant 存取（demo 口径三件套先集中在本文件：embed 向量化 / insertDoc 存 / searchDoc 查）
// Ollama bge-m3：1024 维，中英多语，输出已归一化 → Dot 与 Cosine 打分等价
// 与 dashscope.ts（云端备胎）同函数签名 embed(texts) → vectors，调用方零感知，换后端只换 import
import { QdrantClient } from '@qdrant/js-client-rest'

const OLLAMA_URL = process.env.OLLAMA_URL ?? 'http://localhost:11434'
const OLLAMA_EMBED_MODEL = process.env.OLLAMA_EMBED_MODEL ?? 'modelscope.cn/gpustack/bge-m3-GGUF:latest'

const QDRANT_URL = process.env.QDRANT_URL ?? 'http://localhost:6333'
const COLLECTION = process.env.RAG_COLLECTION ?? 'sds_embed_demo'
const DIM = 1024

const qdrant = new QdrantClient({ url: QDRANT_URL })

/** 批量向量化：一次请求进 N 条文本，出 N 条 1024 维向量 */
export async function embed(texts: string[]): Promise<number[][]> {
	if (!texts.length) return []
	let res: Response
	try {
		res = await fetch(`${OLLAMA_URL}/api/embed`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ model: OLLAMA_EMBED_MODEL, input: texts }),
		})
	} catch {
		throw new Error(`连不上 Ollama（${OLLAMA_URL}）—— 先启动 D:\\ollama 再试`)
	}
	if (!res.ok) throw new Error(`embedding 接口 ${res.status}: ${(await res.text()).slice(0, 200)}`)
	const data = (await res.json()) as { embeddings?: number[][] }
	if (!data.embeddings || data.embeddings.length !== texts.length) {
		throw new Error('Ollama 返回的向量数量与输入对不上')
	}
	return data.embeddings
}

// ─────────────────────────────────────────────────────────
// ① 向量化批量存储：texts[] → bge-m3 一次批量 → Qdrant 一次 upsert
//    meta 自由字段（section / cas_number...），入库带了什么，检索/filter 就能用什么
//    返回各条的 point id；正式摄取管线换 hash(doc_id+chunk_seq) 幂等 id（见 upsert.ts 注释）
// ─────────────────────────────────────────────────────────
export async function insertDocBatch(texts: string[], meta: Record<string, unknown> = {}): Promise<number[]> {
	await ensureCollection()
	const vectors = await embed(texts)
	const points = texts.map((t, i) => ({
		id: Math.floor(Math.random() * 1e15),
		vector: vectors[i]!,
		payload: { text: t, ...meta },
	}))
	await qdrant.upsert(COLLECTION, { wait: true, points })
	return points.map(p => p.id)
}

export interface Retrieved {
	score: number
	text: string
	[key: string]: unknown // section / source_doc / cas_number... 入库时带了什么就有什么
}

// ─────────────────────────────────────────────────────────
// ② 根据字符串检索：query → 向量化 → 最近邻 → 默认 top 3
// ─────────────────────────────────────────────────────────
export async function searchDoc(query: string, top = 3): Promise<Retrieved[]> {
	await ensureCollection()
	const [vector] = await embed([query])
	const { points } = await qdrant.query(COLLECTION, { query: vector!, limit: top, with_payload: true })
	return points.map(p => ({ score: p.score, ...(p.payload as object) } as Retrieved))
}

/** 库不存在就建（1024 维 + Dot + section 关键词索引），存在直接跳过
 *  ⚠️ 1.19 客户端 collectionExists 返回 {exists} 对象，判断必须 .exists 点出来（store 同款血泪坑） */
async function ensureCollection(): Promise<void> {
	if ((await qdrant.collectionExists(COLLECTION)).exists) return
	await qdrant.createCollection(COLLECTION, { vectors: { size: DIM, distance: 'Dot' } })
	await qdrant.createPayloadIndex(COLLECTION, { field_name: 'section', field_schema: 'keyword' })
}
