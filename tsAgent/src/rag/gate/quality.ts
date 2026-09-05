// ② 后门质检：数字断言，不信 LLM 自觉（开工闸门同款教训）
// 输入 = DocProfile + Block[]（抽取结果），输出 GateResult：pass / flags / 升级方向
// 灯语：红=废了只能人审(L2)；黄=机器还有一招(升L1)；信息=只记台账不判死
import type { Block, DocProfile, GateResult } from '../inspect/profile'

// ── 阈值常量（调参只动这里）──
export const GARBLED_RATIO_MAX = 0.02    // 乱码字符占比上限
export const MIN_CHARS_PER_PAGE = 30     // 页均字数下限（低于=半页丢失/空抽）
export const TABLE_CONSISTENCY_MIN = 0.8 // 表格各行列数一致率下限

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

/** 找出文本里所有形似 CAS 的串，返回校验失败的（化学品库读错编号=安全事故，一票红） */
export function badCasIn(text: string): string[] {
	const found = text.match(/\d{2,7}-\d{2}-\d/g) ?? []
	return [...new Set(found)].filter(c => !casCheckDigitOk(c))
}

/** md 表格各行列数（跳过分隔行 |---|---|） */
function mdTableRowCols(md: string): number[] {
	return md.split('\n')
		.filter(l => l.trim().startsWith('|'))
		.filter(l => !/^\|[\s:|-]+\|?$/.test(l.trim()))
		.map(l => l.split('|').length - 2)
}

export function gate(profile: DocProfile, blocks: Block[]): GateResult {
	const flags: string[] = []
	let red = false
	let yellow = false
	const mark = (msg: string, level: 'red' | 'yellow' | 'info') => {
		flags.push(`[${level}] ${msg}`)
		if (level === 'red') red = true
		else if (level === 'yellow') yellow = true
	}

	const text = blocks.filter(b => b.type !== 'image').map(b => b.markdown).join('\n')

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

	return { pass: !red && !yellow, flags, escalate: red ? 'L2' : yellow ? 'L1' : undefined }
}
