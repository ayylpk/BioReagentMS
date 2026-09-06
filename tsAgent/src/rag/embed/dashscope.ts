// DashScope text-embedding-v4 —— 云端 embed 备胎（上线五哨①：服务器内存紧张时的切换位）
// 签名与 ollama.ts 的 embed 完全一致（texts → 1024 维向量），调用方零感知，切换走 EMBED_BACKEND
// 计费：¥0.0005/千 token（内地），300~500 份 SDS 全量重灌 <¥1，比养 Ollama 进程省内存
import { config } from '../../config/env'

const DASHSCOPE_EMBED_URL = 'https://dashscope.aliyuncs.com/compatible-mode/v1/embeddings'
const BATCH_CAP = 10 // v4 OpenAI 兼容口单批 input 上限 10 条，超了整批 400

/** 批量向量化（自动切 ≤10 条的小批，顺序请求） */
export async function embed(texts: string[]): Promise<number[][]> {
	if (!texts.length) return []
	const out: number[][] = []
	for (let i = 0; i < texts.length; i += BATCH_CAP) {
		const batch = texts.slice(i, i + BATCH_CAP)
		const res = await fetch(DASHSCOPE_EMBED_URL, {
			method: 'POST',
			headers: { Authorization: `Bearer ${config.DASHSCOPE_API_KEY}`, 'Content-Type': 'application/json' },
			body: JSON.stringify({ model: config.EMBEDDING_MODEL, input: batch, dimensions: config.EMBED_DIM }),
		})
		if (!res.ok) throw new Error(`DashScope embedding ${res.status}: ${(await res.text()).slice(0, 200)}`)
		const data = (await res.json()) as { data?: { embedding: number[] }[] }
		if (!data.data || data.data.length !== batch.length) throw new Error('DashScope 返回向量数量与输入对不上')
		out.push(...data.data.map((d) => d.embedding))
	}
	return out
}
