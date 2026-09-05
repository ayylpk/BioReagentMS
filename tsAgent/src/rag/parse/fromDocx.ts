// ④ Tier0 · docx 直抽：mammoth → HTML → Block[]（纯 TS，无 py 无模型）
// docx 是逻辑流格式：XML 段落序 = 阅读序，双栏无感（见 inspect/probe 注释）——
// 真正要处理的是它的两位老熟人：排版假表格（cell-join 按列拼）、复杂表（html 原样保留）
import mammoth from 'mammoth'
import type { Block } from '../inspect/profile'

/** HTML 实体最小反解 + 去标签 */
function plain(html: string): string {
	return html
		.replace(/<[^>]+>/g, '')
		.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
		.replace(/&quot;/g, '"').replace(/&nbsp;/g, ' ')
		.replace(/&#(\d+);/g, (_, c: string) => String.fromCodePoint(Number(c)))
		.trim()
}

/** 一张 <table> HTML → 行×列 二维数组 + 是否含合并单元格 */
function parseTable(tblHtml: string): { rows: string[][]; merged: boolean } {
	const rows: string[][] = []
	let merged = false
	for (const tr of tblHtml.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)) {
		const cells: string[] = []
		for (const tc of (tr[1] ?? '').matchAll(/<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/gi)) {
			if (/colspan|rowspan/i.test(tc[0])) merged = true
			cells.push(plain(tc[1] ?? '').replace(/\n/g, ' '))
		}
		if (cells.length) rows.push(cells)
	}
	// colspan/rowspan 挂在 <td> 属性上，上面属性被吃掉时的漏网 → 全文补查一次
	if (!merged && /colspan|rowspan/i.test(tblHtml)) merged = true
	return { rows, merged }
}

/** 行×列 → markdown 管道表（无合并时才许转；首行当表头） */
function toMdTable(rows: string[][]): string {
	const width = Math.max(...rows.map(r => r.length))
	const pad = (r: string[]) => [...r, ...Array(width - r.length).fill('')]
	const head = pad(rows[0]!)
	const body = rows.slice(1).map(pad)
	return [
		`| ${head.join(' | ')} |`,
		`|${'---|'.repeat(width)}`,
		...body.map(r => `| ${r.join(' | ')} |`),
	].join('\n')
}

export async function fromDocx(file: string, mode: 'direct' | 'cell-join' = 'direct'): Promise<Block[]> {
	const buf = await Bun.file(file).arrayBuffer()
	const { value: html } = await mammoth.convertToHtml({ buffer: Buffer.from(buf) })

	const blocks: Block[] = []
	// 表格先占位摘出（保住块序），碎片再按 heading/段落拆
	const tables: string[] = []
	const skeleton = html.replace(/<table[\s\S]*?<\/table>/gi, m => {
		tables.push(m)
		return `\x00T${tables.length - 1}\x00`
	})

	for (const frag of skeleton.split(/(?=\x00T\d+\x00)|(?<=\x00T\d+\x00)/)) {
		const tm = frag.match(/^\x00T(\d+)\x00$/)
		if (tm) {
			const tblHtml = tables[Number(tm[1])]!
			const { rows, merged } = parseTable(tblHtml)
			if (!rows.length) continue
			// ★ 排版假表格（单行多格、格内大段文字）：按列拼接成普通文本块，不按行咬合
			if (mode === 'cell-join' && rows.length === 1 && rows[0]!.length > 1) {
				for (const cell of rows[0]!) if (cell) blocks.push({ type: 'text', markdown: cell })
				continue
			}
			blocks.push(merged
				? { type: 'table', markdown: toMdTable(rows), html: tblHtml } // 复杂表：md 兜底看 + html 原文留底
				: { type: 'table', markdown: toMdTable(rows) })
			continue
		}
		// 非表格碎片：按出现顺序取 heading/段落
		for (const m of frag.matchAll(/<h([1-6])[^>]*>([\s\S]*?)<\/h\1>|<p[^>]*>([\s\S]*?)<\/p>/gi)) {
			const level = m[1] ? Number(m[1]) : undefined
			const text = plain((m[2] ?? m[3] ?? ''))
			if (!text) continue
			blocks.push(level ? { type: 'heading', level, markdown: text } : { type: 'text', markdown: text })
		}
	}
	return blocks
}
