// v4 地板实验（一次性工具）：10 题 × dense top5 原始余弦分
// 口径说明：不走 hybridSearch——它返回的是 RRF 名次分（1/61+1/61 那种），
// 余弦原始分在融合层就被扔了；定地板要的恰恰是原始分，所以单查 dense 一路。
// 题目对照 9/6 bge-m3 那轮（[[bioreagentms-mindense-0906]]）：相关5+无关5，两组分数带若拉开，中点即新地板。
// 跑法：bun run scripts/floor-v4.ts
import { QdrantClient } from '@qdrant/js-client-rest'
import { config } from '../src/config/env'
import { embed } from '../src/rag/embed'

const qdrant = new QdrantClient({ url: config.QDRANT_URL, apiKey: config.QDRANT_API_KEY || undefined })

// 相关组：库里 1735 份 SDS/ICSC 必有答案
const REL = [
	'丙酮着火怎么灭火',
	'硫酸溅到眼睛怎么办',
	'吗啉的分子式',
	'二氧化钛是可燃物吗',
	'对硫磷中毒的急救措施',
]
// 无关组：化学库里绝无对应内容
const IRRELEVANT = [
	'今天北京天气',
	'帮我写一首关于秋天的诗',
	'Java 的 GC 算法有哪些',
	'红楼梦是谁写的',
	'如何制作红烧肉',
]

async function row(tag: string, q: string) {
	const [v] = await embed([q])
	const r = await qdrant.query(config.QDRANT_COLLECTION, {
		query: v as number[], using: 'dense', limit: 5, with_payload: true,
	})
	console.log(`\n[${tag}] ${q}`)
	for (const p of r.points) {
		const pl = p.payload as { source_doc?: string; section?: string } | undefined
		console.log(`  ${p.score.toFixed(4)}  ${pl?.source_doc ?? '?'} / ${pl?.section ?? '-'}`)
	}
	if (!r.points.length) console.log('  （空）')
}

for (const q of REL) await row('rel', q)
for (const q of IRRELEVANT) await row('irr', q)
console.log('\n—— rel 组 top1 的最小值 与 irr 组 top1 的最大值 之间即分界带，取中点为新地板')
process.exit(0)
