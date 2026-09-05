// ⑤ Tier0 · 数字版 PDF 直抽：pdfjs-dist 文字层 → Block[]
// 第一版只处理单栏；双栏判定与重排、表格线框识别 = 下期（probe 报 columns=2 时 route 会拦）
// heading 无法从文字层得知（PDF 无结构），整页出一个 text 块，标题树交给"下期结构恢复"
import { getDocument, GlobalWorkerOptions, type PDFDocumentProxy } from 'pdfjs-dist/legacy/build/pdf.mjs'
import type { Block } from '../inspect/profile'

// worker 指向包内文件（bun/node 通用）；失败则 pdfjs 自动降级 fake worker，不阻塞
try {
	// @ts-ignore — import.meta.resolve 运行时存在，TS 配置未开对应 module
	GlobalWorkerOptions.workerSrc = import.meta.resolve('pdfjs-dist/legacy/build/pdf.worker.mjs')
} catch { /* 拿不到就交给 fake worker */ }

/** 载入 PDF（探测与抽取共用这一扇门；加密件会抛 PasswordException，由 probe 识别） */
export async function loadPdf(file: string): Promise<PDFDocumentProxy> {
	const data = new Uint8Array(await Bun.file(file).arrayBuffer())
	return getDocument({ data }).promise
}

/** 单页纯文本：text 项按 y 从页顶到页底、x 从左到右排序，行内拼接、行间换行 */
export async function pagePlainText(page: { getTextContent: () => Promise<{ items: unknown[] }> }): Promise<string> {
	// transform 定死六元组：[4]=x [5]=y（PDF 坐标 y 向上，从页顶读起 = y 降序）
	type Item = { str: string; transform: [number, number, number, number, number, number] }
	const isItem = (it: unknown): it is Item => {
		const t = it as Item
		return typeof t?.str === 'string' && t.str.trim() !== '' && Array.isArray(t?.transform) && t.transform.length === 6
	}
	const { items } = await page.getTextContent()
	const good = items.filter(isItem)
	good.sort((a, b) => b.transform[5] - a.transform[5] || a.transform[4] - b.transform[4])

	// 按 y 容差聚行（行高差 >3 视为换行）
	const lines: string[] = []
	let cur: Item[] = []
	for (const it of good) {
		const last = cur[cur.length - 1]
		if (last && Math.abs(last.transform[5] - it.transform[5]) > 3) {
			lines.push(cur.map(c => c.str).join(' '))
			cur = []
		}
		cur.push(it)
	}
	if (cur.length) lines.push(cur.map(c => c.str).join(' '))
	return lines.join('\n')
}

export async function fromPdf(file: string): Promise<Block[]> {
	const doc = await loadPdf(file)
	const blocks: Block[] = []
	for (let p = 1; p <= doc.numPages; p++) {
		const page = await doc.getPage(p)
		const text = await pagePlainText(page as never)
		if (text.trim()) blocks.push({ type: 'text', page: p, markdown: text })
		// 空页不产块 —— 页均字数由 gate 的 MIN_CHARS_PER_PAGE 统一问责
	}
	return blocks
}
