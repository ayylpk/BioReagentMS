// 生产读侧唯一入口：reagent_knowledge 双向量混合检索 + RRF 融合
// ragNode（图内检索）与 searchKnowledge（工具）共用这一份实现 —— 检索口径必须只有一处定义
// 分工线：embed/ollama.ts 与 sparse/bm25.ts 是"demo 期"的老文件（集合指向 sds_embed_demo），
//         本文件用 config 口径直连生产集合，named dense + named sparse 两路各查各的再融合
import { QdrantClient } from '@qdrant/js-client-rest'
import { config } from '../config/env'
import { embed, type Retrieved } from './embed' // 门面选择后端（EMBED_BACKEND），不直认 Ollama
import { toSparse } from './sparse/bm25'

const qdrant = new QdrantClient({ url: config.QDRANT_URL, apiKey: config.QDRANT_API_KEY || undefined })
const COLL = config.QDRANT_COLLECTION

const RRF_K = 60 // 论文正统常数，与 graph.ragNode 时代同款

export interface HybridOptions {
	top?: number // 融合后取几条（默认 6）
	limit?: number // 每路各捞几条（默认 10）
	section?: string // 可选：SDS 分节过滤（payload keyword）
	minDense?: number // 稠密路余弦下限（bge-m3 归一化向量·Dot=Cosine）：低于它的内容视为无关
}

// 0.35 是拍脑袋的保守地板（相关 SDS 段落实测多在 0.5+，无关文本 0.2~0.3）：
// 没这道闸，任何问题都会"凑满 top3"喂给生成端赌相关性——垃圾进垃圾出；qa50 上线后用评估集回调此值
const MIN_DENSE_DEFAULT = 0.35

/** 混合检索：稠密(named dense) + 稀疏(named sparse) 并发 → 只认名次的 RRF 融合 → top */
export async function hybridSearch(query: string, opts: HybridOptions = {}): Promise<Retrieved[]> {
	const { top = 6, limit = 10, section, minDense = MIN_DENSE_DEFAULT } = opts
	const filter = section ? { must: [{ key: 'section', match: { value: section } }] } : undefined
	const [vector] = await embed([query])

	// 两路并发；一路挂只丢一路（旁路化：宁可召回差一点，不要整问失败）
	const [denseRes, sparseRes] = await Promise.all([
		qdrant.query(COLL, { query: vector, using: 'dense', limit, filter, with_payload: true })
			.then(r => r.points).catch(e => { console.warn('[search] 稠密路失败:', (e as Error).message); return [] }),
		qdrant.query(COLL, { query: toSparse(query), using: 'sparse', limit, filter, with_payload: true })
			.then(r => r.points).catch(e => { console.warn('[search] 稀疏路失败:', (e as Error).message); return [] }),
	])

	// RRF：score = Σ 各路 1/(k+名次)；合并键 = payload.text（两路回的是同一批 point）
	const rrf = new Map<string, { score: number; dense: number; item: Retrieved }>()
	for (const [list, isDense] of [[denseRes, true], [sparseRes, false]] as const)
		for (let i = 0; i < list.length; i++) {
			const p = list[i]!
			const text = String((p.payload as { text?: string })?.text ?? '')
			if (!text) continue
			const hit = { score: p.score, ...(p.payload as object) } as Retrieved
			const prev = rrf.get(text)
			rrf.set(text, {
				score: (prev?.score ?? 0) + 1 / (RRF_K + i + 1),
				dense: isDense ? p.score : (prev?.dense ?? 0), // 记住稠密路原始分（稀疏分不做地板：字面命中但语义偏的情况放行给融合）
				item: prev?.item ?? hit,
			})
		}
	// 地板闸：只认稠密路原始分。纯稀疏命中（稠密 top 里没它）暂被地板拒绝——
	// 当前语料只有个位数文档，字面巧合多、真·关键词独占命中少；上量后若 CAS 精查被误伤，给 qa50 的数据说话再放宽
	return [...rrf.values()]
		.filter(x => x.dense >= minDense)
		.sort((a, b) => b.score - a.score)
		.slice(0, top)
		.map(x => x.item)
}
