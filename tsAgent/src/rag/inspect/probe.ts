// ③ 前门·三层探测的 第一版（第一层魔数 + docx 结构计数 + PDF 轻量文字层判定）
// 产出 DocProfile：文件是什么、有什么病、走哪条路 —— 全确定性代码，下游 route 只照档案执行
// ⚠️ 本期未做（档案里如实标 unknown/0，不许瞎猜）：PDF 双栏间隙判定、线框密度 → 下期
import { unzipSync } from 'fflate'
import type { DocProfile, Strategy } from '../inspect/profile'
import { GARBLED_RE } from '../gate/quality'
import { loadPdf, pagePlainText } from '../parse/fromPdf'

const MAGIC = (head: Uint8Array): string => {
	const hex = [...head.slice(0, 8)].map(b => b.toString(16).padStart(2, '0')).join('') // ⚠️ 必须无空格拼接（带空格则 startsWith 全灭）
	if (hex.startsWith('d0cf11e0')) return 'ole2'      // 老 doc/xls —— 拒绝并提示转存
	if (hex.startsWith('25504446')) return 'pdf'        // %PDF
	if (hex.startsWith('504b0304')) return 'zip'        // docx/xlsx/pptx 都住这
	if (hex.startsWith('ffd8ff')) return 'jpeg'
	if (hex.startsWith('89504e47')) return 'png'
	return `unknown(${hex.slice(0, 16)})`
}

const tagCount = (xml: string, tag: string): number =>
	(xml.match(new RegExp(`<${tag}[ />]`, 'g')) ?? []).length

/** docx 结构探测：解 zip 读 document.xml 数标签（双栏只记录不处理——逻辑流完好） */
function probeDocx(xml: string): DocProfile['docx'] {
	const cols = [...xml.matchAll(/<w:cols[^>]*w:num="(\d+)"/g)].map(m => Number(m[1]))
	// 排版假表格：单行、≥2 格、整表纯文字 >400 字 —— 典型"表格伪装双栏"
	let layoutTables = 0
	for (const seg of xml.matchAll(/<w:tbl>[\s\S]*?<\/w:tbl>/g)) {
		const tbl = seg[0]
		const rows = (tbl.match(/<w:tr[ >]/g) ?? []).length
		const cells = (tbl.match(/<w:tc[ >]/g) ?? []).length
		const chars = tbl.replace(/<[^>]+>/g, '').length
		if (rows === 1 && cells >= 2 && chars > 400) layoutTables++
	}
	// 浮动文本框：内容顺序隐患，文字量达标才算（页眉水印之类忽略）
	const textBoxes = [...xml.matchAll(/<w:txbxContent>[\s\S]*?<\/w:txbxContent>/g)]
		.filter(seg => seg[0].replace(/<[^>]+>/g, '').length > 50).length
	return {
		columns: cols.length ? Math.max(...cols) : 1,
		tableCount: tagCount(xml, 'w:tbl'),
		layoutTables,
		textBoxes,
		drawingCount: tagCount(xml, 'w:drawing'),
		paraChars: xml.replace(/<[^>]+>/g, '').length,
	}
}

/** PDF 轻量探测：页数/文字层有无/页均字数（前 5 页取样）；加密件抛 PasswordException */
async function probePdf(file: string): Promise<DocProfile['pdf']> {
	const doc = await loadPdf(file)
	const sample = Math.min(doc.numPages, 5)
	let chars = 0
	let garbled = 0
	let sampled = 0
	for (let p = 1; p <= sample; p++) {
		const text = await pagePlainText(await doc.getPage(p) as never)
		chars += text.length
		garbled += (text.match(GARBLED_RE) ?? []).length
		if (text.trim()) sampled++
	}
	const charsPerPage = chars / Math.max(sample, 1)
	return {
		hasTextLayer: sampled > 0,
		pages: doc.numPages,
		charsPerPage,
		columns: 'unknown',        // 双栏判定下期：栏间隙直方图在 fromPdf 排期里
		gapConsistentRatio: 0,
		lineDensity: 0,
		garbledRatio: chars ? garbled / chars : 1,
	}
}

/** strategy 推导：全部判定来自档案字段，一条 switch 说清（code-over-tools） */
function decide(p: Omit<DocProfile, 'strategy' | 'reason'>): { strategy: Strategy; reason: string } {
	if (p.family === 'unknown' || p.family === 'legacy-doc')
		return { strategy: 'L2-review', reason: p.family === 'legacy-doc' ? '老 OLE 格式，请转存 docx 再入库' : '魔数不识别/文件损坏' }
	if (p.family === 'xlsx')
		return { strategy: 'L0-py', reason: 'sheet 级交 pytools：台账型 sheet 会被拒（转 MySQL），文档型进库' }
	if (p.family === 'text')
		return { strategy: 'L0-py', reason: '纯文本/Markdown：py 直读，md 语法顺带被块化' }
	if (p.family === 'image')
		return { strategy: 'L1-py-vl', reason: '纯图片文档，qwen-vl-ocr 整页解析' }
	if (p.family === 'docx' && p.docx) {
		const d = p.docx
		if (d.textBoxes > 0) return { strategy: 'L1-py-vl', reason: `浮动文本框×${d.textBoxes}，抽取顺序不可信` }
		if (d.drawingCount >= 3 && d.paraChars < d.drawingCount * 200)
			return { strategy: 'L1-py-vl', reason: '图文倒挂（图多字少），按图片文档处理' }
		if (d.layoutTables > 0) return { strategy: 'L0-cell-join', reason: `排版假表格×${d.layoutTables}（py 主力自带表格处理，手写 fallback 才用 cell-join）` }
		return { strategy: 'L0-py', reason: `docx 交 markitdown（分栏=${d.columns} 不影响抽取；手写 mammoth 为备胎）` }
	}
	if (p.family === 'pdf' && p.pdf) {
		const f = p.pdf
		if (!f.hasTextLayer) return { strategy: 'L1-py-vl', reason: '无文字层（扫描件），交给视觉解析' }
		if (f.garbledRatio > 0.02) return { strategy: 'L1-py-vl', reason: `文字层乱码率 ${(f.garbledRatio * 100).toFixed(1)}%，直抽不可信` }
		return { strategy: 'L0-py', reason: `数字版 PDF（${f.pages} 页，页均 ${f.charsPerPage.toFixed(0)} 字）→ pymupdf4llm` }
	}
	return { strategy: 'L2-review', reason: '档案信息不足，宁可人审' }
}

export async function probe(file: string): Promise<DocProfile> {
	const bunFile = Bun.file(file)
	const size = await bunFile.size
	if (!size) {
		const base: Omit<DocProfile, 'strategy' | 'reason'> = { file, family: 'unknown', magic: 'empty(0B)' }
		return { ...base, ...decide(base) }
	}
	const head = new Uint8Array(await bunFile.slice(0, 8).arrayBuffer())
	const magic = MAGIC(head)
	// 纯文本族走后缀白名单（没有魔数可看）：在 magic 判定前拦下
	if (/\.(txt|md|csv)$/i.test(file)) {
		const t: Omit<DocProfile, 'strategy' | 'reason'> = { file, family: 'text', magic: `text(${(await bunFile.text()).slice(0, 12).replace(/\s+/g, ' ')})` }
		return { ...t, ...decide(t) }
	}

	const base: Omit<DocProfile, 'strategy' | 'reason'> = { file, family: 'unknown', magic }
	try {
		if (magic === 'zip') {
			const entries = unzipSync(new Uint8Array(await bunFile.arrayBuffer()))
			if (entries['word/document.xml']) {
				base.family = 'docx'
				base.docx = probeDocx(new TextDecoder().decode(entries['word/document.xml']))
			} else if (Object.keys(entries).some(k => k.startsWith('xl/'))) base.family = 'xlsx'
		} else if (magic === 'pdf') {
			base.family = 'pdf'
			base.pdf = await probePdf(file)
		} else if (magic === 'ole2') base.family = 'legacy-doc'
		else if (magic === 'jpeg' || magic === 'png') base.family = 'image'
	} catch (e) {
		const msg = (e as Error).message ?? String(e)
		if (/password/i.test(msg)) return { ...base, strategy: 'L2-review', reason: '加密 PDF，需口令' }
		return { ...base, strategy: 'L2-review', reason: `探测失败：${msg.slice(0, 120)}` }
	}
	return { ...base, ...decide(base) }
}
