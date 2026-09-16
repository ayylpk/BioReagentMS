// ② 后门质检：数字断言，不信 LLM 自觉（开工闸门同款教训）
// 输入 = DocProfile + Block[] + ParseDiag（抽取侧账本），输出 GateResult：pass / flags / 升级方向
// 灯语：红=废了只能人审(L2)；黄=机器还有一招(升L1)；信息=只记台账不判死
//
// 9/16 diag 断言（解析泛化第一刀）——**一律只记 info，不新开黄/红**，理由必须写在代码里：
//   当前处置链是"黄灯 → pipeline 落 quarantined，红灯 → review"，而 routes/review.ts 仍是空壳、
//   quarantined 无消费者。于是"新开一条黄灯"的实际语义不是"请人看一眼"，而是"这份文档从知识库里消失"。
//   缺页/大图截断这些事实确实该被看见，但**看见的方式是先记账**（flags 进 ingest_log，/list 可见），
//   等 review 闭环能接住再升级灯色。这条不是懒，是"别用一条断言把 1700 份语料慢慢清空"。
import type { Block, DocProfile, GateResult, ParseDiag } from '../inspect/profile'

// ── 阈值常量（调参只动这里）──
export const GARBLED_RATIO_MAX = 0.02    // 乱码字符占比上限
export const MIN_CHARS_PER_PAGE = 30     // 页均字数下限（低于=半页丢失/空抽）
export const TABLE_CONSISTENCY_MIN = 0.8 // 表格各行列数一致率下限
export const MIN_COVERAGE_RATIO = 0.6    // docx 覆盖率下限（抽出字符 / 档案里的正文总字符）
export const MIN_HEADING_CHARS = 500     // 正文超过这个长度却一个标题都没有 → 切块会退化成"单节巨块"

const CAS_RE = /^\d{2,7}-\d{2}-\d$/
// 乱码探测 = 替换符 U+FFFD + 私有使用区 U+E000-F8FF（字体缺字常被塞进 PUA）
// 用 new RegExp 而非字面量：源串走 \\u 双写，避开编码链路把 \u 转义提前解码成真实字符
export const GARBLED_RE = new RegExp('[\\uFFFD\\uE000-\\uF8FF]', 'g')

/** SDS 16 分节标准标题（软校验用：0 命中只怀疑不是 SDS，不判死——语料里还有 SOP/手册） */
const SDS_SECTIONS = [
	'化学品及企业标识', '危险性概述', '成分/组成信息', '急救措施', '消防措施',
	'泄漏应急处理', '操作处置与储存', '接触控制和个体防护', '理化特性', '稳定性和反应性',
	'毒理学信息', '生态学信息', '废弃处置', '运输信息', '法规信息', '其他信息',
]

/** CAS 校验位：末位 = 前面各位从右往左乘 1,2,3... 求和后 mod 10。零成本硬校验 */
export function casCheckDigitOk(cas: string): boolean {
	if (!CAS_RE.test(cas)) return false
	const digits = cas.replace(/-/g, '')
	const check = Number(digits[digits.length - 1])
	const body = digits.slice(0, -1)
	let sum = 0
	for (let i = 0; i < body.length; i++) sum += Number(body[body.length - 1 - i]) * (i + 1)
	return sum % 10 === check
}

/** 找出文本里所有形似 CAS 的串，返回校验失败的（化学品库读错编号=安全事故，一票红）
 *  ⚠️ 边界断言防串扰：ICSC 的欧盟老分类码 R:45-46-60-25 会被裸正则掐出"45-46-6"冒充 CAS → 全库误红（9/6 批爬实录） */
export function badCasIn(text: string): string[] {
	const found = text.match(/(?<![\d-])\d{2,7}-\d{2}-\d(?![\d-])/g) ?? []
	return [...new Set(found)].filter(c => !casCheckDigitOk(c))
}

/** md 表格各行列数（跳过分隔行 |---|---|） */
function mdTableRowCols(md: string): number[] {
	return md.split('\n')
		.filter(l => l.trim().startsWith('|'))
		.filter(l => !/^\|[\s:|-]+\|?$/.test(l.trim()))
		.map(l => l.split('|').length - 2)
}

/** 正文口径的唯一定义（gate 的乱码率/页均字数、route 手写 fallback 的 diag.chars 都必须用它）：
 *  非 image 块的 markdown 以 \n 相接 —— image 块是"图转文的一句描述"，算进正文会虚高覆盖率 */
export const plainTextOf = (blocks: Block[]): string =>
	blocks.filter(b => b.type !== 'image').map(b => b.markdown).join('\n')

export function gate(profile: DocProfile, blocks: Block[], diag?: ParseDiag): GateResult {
	const flags: string[] = []
	let red = false
	let yellow = false
	const mark = (msg: string, level: 'red' | 'yellow' | 'info') => {
		flags.push(`[${level}] ${msg}`)
		if (level === 'red') red = true
		else if (level === 'yellow') yellow = true
	}

	const text = plainTextOf(blocks)

	// ① 空抽取 —— 红，后面全不用看
	if (!text.trim()) {
		mark('抽取结果为空', 'red')
		return { pass: false, flags, escalate: 'L2' }
	}

	// ② 乱码率
	const garbled = (text.match(GARBLED_RE) ?? []).length
	const garbledRatio = garbled / text.length
	if (garbledRatio > GARBLED_RATIO_MAX)
		mark(`乱码率 ${(garbledRatio * 100).toFixed(1)}% 超阈值 ${GARBLED_RATIO_MAX * 100}%`, 'red')

	// ③ 页均字数（PDF 专用；docx 无页概念跳过）
	const pages = profile.pdf?.pages ?? 0
	if (pages > 0) {
		const charsPerPage = text.length / pages
		if (charsPerPage < MIN_CHARS_PER_PAGE)
			mark(`页均字数 ${charsPerPage.toFixed(0)} < ${MIN_CHARS_PER_PAGE}（疑似半页丢失）`, 'yellow')
	}

	// ④ 表格一致性：同一表格块各行列数应当一致，突变=塌表
	for (const [i, b] of blocks.entries()) {
		if (b.type !== 'table') continue
		const cols = mdTableRowCols(b.markdown)
		if (cols.length < 2) continue
		const mode = cols.sort((a, c) => cols.filter(v => v === a).length - cols.filter(v => v === c).length).pop()!
		const consistent = cols.filter(c => c === mode).length / cols.length
		if (consistent < TABLE_CONSISTENCY_MIN)
			mark(`表格#${i} 列数一致率 ${(consistent * 100).toFixed(0)}%（塌表）`, 'yellow')
	}

	// ⑤ CAS 验算：全文所有编号，一个错码=红
	const bad = badCasIn(text)
	if (bad.length) mark(`CAS 校验位失败: ${bad.join(', ')}`, 'red')

	// ⑥ SDS 分节软校验：只记信息不判死——
	//   0 命中：多半非 SDS（SOP/仪器手册/规章本来就没有分节，合法）
	//   1~15 命中：正常的"单节文档"（一节消防 SOP 就该只中一节），冤杀比漏判贵
	//   真·整本 SDS 缺节检测，等全量 SDS 上量后按"是否含第1节标识"再收紧不迟
	if (!flags.some(f => f.startsWith('[red]'))) {
		const hit = SDS_SECTIONS.filter(s => text.includes(s.slice(0, 4))).length
		if (hit === 0) mark('未命中任何 SDS 分节标题（按非 SDS 文档处理）', 'info')
		else mark(`SDS 分节命中 ${hit}/16`, 'info')
	}

	// ⑦ 抽取侧账本（diag）：降级事实必须被看见，但**不新开黄/红**（理由见文件头注释）
	markDiag(profile, blocks, text, diag, mark)

	return { pass: !red && !yellow, flags, escalate: red ? 'L2' : yellow ? 'L1' : undefined }
}

/** diag 断言：全部 info。一条断言 = 一个"发生了但肉眼看不见"的事实 */
function markDiag(
	profile: DocProfile,
	blocks: Block[],
	text: string,
	diag: ParseDiag | undefined,
	mark: (msg: string, level: 'red' | 'yellow' | 'info') => void,
): void {
	if (!diag) {
		mark('抽取侧无 diag（老 py 或手写 fallback）：本次降级事实不可知', 'info')
		return
	}
	mark(`抽取器=${diag.extractor} 正文=${text.length} 字`, 'info')

	// 页级：VL 重解析 / VL 失败 / 超上限跳过 —— 这三条是"内容缺了多少"的直接账
	if (diag.pages_total) {
		const parts = [`共 ${diag.pages_total} 页`]
		if (diag.pages_via_vl) parts.push(`VL 重解析 ${diag.pages_via_vl} 页`)
		if (diag.pages_empty) parts.push(`空页 ${diag.pages_empty}`)
		if (diag.pages_vl_failed) parts.push(`⚠️ VL 失败 ${diag.pages_vl_failed} 页（该页内容缺失）`)
		if (diag.pages_skipped_by_cap) parts.push(`⚠️ 超 VL 上限跳过 ${diag.pages_skipped_by_cap} 页（可用 VL_PAGE_CAP 调高）`)
		mark(`页级账本：${parts.join('，')}`, 'info')
	}

	// 图级：截断/失败/超上限 —— "图里的正文"丢了就是永久丢失
	const imgParts: string[] = []
	if (diag.images_total) imgParts.push(`图 ${diag.images_total} 张`)
	if (diag.images_captioned) imgParts.push(`已描述 ${diag.images_captioned}`)
	if (diag.captions_truncated) imgParts.push(`⚠️ 描述被打满截断 ${diag.captions_truncated}`)
	if (diag.captions_failed) imgParts.push(`⚠️ 描述失败 ${diag.captions_failed}`)
	if (diag.images_over_cap) imgParts.push(`⚠️ 超描述上限 ${diag.images_over_cap}（仅有原始引用）`)
	if (imgParts.length) mark(`图级账本：${imgParts.join('，')}`, 'info')

	// 表级：拒收/截断（既往"混装 workbook 里被拒的 sheet 无声消失"）
	const sheetParts: string[] = []
	if (diag.sheets_total) sheetParts.push(`表/sheet ${diag.sheets_total}`)
	if (diag.sheets_rejected) sheetParts.push(`⚠️ 判为台账型已跳过 ${diag.sheets_rejected}`)
	if (diag.sheets_truncated) sheetParts.push(`⚠️ 超行数上限截断 ${diag.sheets_truncated}`)
	if (diag.sheets_rejected || diag.sheets_truncated) mark(`表级账本：${sheetParts.join('，')}`, 'info')

	// 覆盖率断言：docx 的档案里现成有 paraChars（正文总字符），既往从没拿来比对过抽取结果
	const paraChars = profile.docx?.paraChars ?? 0
	if (paraChars > 0) {
		const ratio = text.length / paraChars
		if (ratio < MIN_COVERAGE_RATIO)
			mark(`覆盖率 ${(ratio * 100).toFixed(0)}%（抽出 ${text.length} / 档案正文 ${paraChars} 字）疑似只抽到一部分`, 'info')
	}

	// 标题数：切块靠 heading 撑层级，零标题的文档会退化成"单一巨型 section"且 section 全空
	if (text.length > MIN_HEADING_CHARS && !blocks.some(b => b.type === 'heading'))
		mark(`正文 ${text.length} 字却零标题：切块将退化为单节巨块（section 过滤会失效）`, 'info')

	// py 侧的人话降级说明原样带上（大图整页转录、编码非 UTF-8、解释器降级…）
	for (const n of diag.notes ?? []) mark(`抽取侧说明：${n}`, 'info')
}
