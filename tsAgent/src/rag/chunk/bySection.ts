// ⑦ 切块：Block[] → Chunk[]，全确定性。优先级焊死：结构 → 递归兜底，LLM 摘要位默认永久关
// 锚规则（上次稀疏空枪的根治）：每块文本头部拼 "标题（CAS xxx）｜当前分节"，
// 让 CAS/试剂名这些精确 token 真实存在于 chunk 正文里 —— toSparse 才有靶可打
import type { Block, Chunk } from '../inspect/profile'
import { badCasIn } from '../gate/quality'

const LLM_SUMMARY_ENABLED = false // 开了也只准写 summary（召回用），正文一个字不许动 —— 写入侧红线
const MAX_CHUNK = 800             // 超长判定
const OVERLAP = 80                // 递归兜底的重叠窗口
const docIdOf = (file: string) => file.replace(/^.*[\\/]/, '').replace(/\.[^.]+$/, '') // 文件名去扩展名

/** 递归切：段落 → 句子 → 字符，三级降级；级间带 overlap */
function splitLong(text: string, max = MAX_CHUNK): string[] {
	if (text.length <= max) return [text]
	for (const sep of [/\n+/, /(?<=[。！？；!?;])/g, /(?<=[，,])/g]) {
		const parts = text.split(sep).filter(p => p !== '')
		if (parts.length <= 1) continue
		const out: string[] = []
		let cur = ''
		for (const p of parts) {
			if (cur && (cur + p).length > max) {
				out.push(cur)
				cur = cur.slice(-OVERLAP) + p   // 上一块尾巴搭进新块，切缝两侧都有上下文
			} else cur += p
		}
		if (cur) out.push(cur)
		if (out.every(o => o.length <= max * 1.2 || o.length <= max)) return out
	}
	// 三降级都救不了（无标点巨串）→ 硬切
	const out: string[] = []
	for (let i = 0; i < text.length; i += max - OVERLAP) out.push(text.slice(i, i + max))
	return out
}

export function bySection(file: string, blocks: Block[]): Chunk[] {
	const docId = docIdOf(file)
	const title = blocks.find(b => b.type === 'heading')?.markdown ?? docId
	// CAS 锚：全文恰好一种有效编号且标题里没写过，才补进锚（防"标题自带+再拼一遍"双份）
	const body = blocks.map(b => b.markdown).join('\n')
	const allCas = [...new Set(body.match(/\d{2,7}-\d{2}-\d/g) ?? [])]
		.filter(c => !badCasIn(body).includes(c))
	const casTag = allCas.length === 1 && !title.includes(allCas[0]!) ? `（CAS ${allCas[0]}）` : ''
	const anchor = `${title}${casTag}`

	const chunks: Chunk[] = []
	let section = ''           // 最近一个标题 = 当前分节
	let seq = 0
	const emit = (text: string, page?: number, bbox?: number[]) => {
		for (const piece of splitLong(text)) {
			// 单节文档 section 常等于标题：相等就不重复拼（防锚三连击）
			const sec = section && section !== title ? `｜${section}` : ''
			chunks.push({
				docId, seq: seq++, section: section || undefined, page, bbox,
				text: piece.startsWith(anchor) ? piece : `${anchor}${sec} ${piece}`,
			})
		}
	}

	for (const b of blocks) {
		switch (b.type) {
			case 'heading':
				section = b.markdown.replace(/^#+\s*/, '').slice(0, 40)
				break // 标题本身不单独成块，它活在后续块的 section/锚里
			case 'text':
				emit(b.markdown, b.page, b.bbox)
				break
			case 'table': // 表格原子：永不拆，锚+表题拼前缀整块走
				emit(b.markdown, b.page, b.bbox)
				break
			case 'image': // 图片块：caption 文本（VL 产的"一句描述"）有内容才入库
				if (b.markdown.trim()) emit(b.markdown, b.page, b.bbox)
				break
		}
	}

	if (LLM_SUMMARY_ENABLED) {
		// TODO(M3)：逐块调 LLM 生成一句话摘要 → ch.summary（只喂 embedding 召回，答案仍回原文）
	}
	return chunks
}
