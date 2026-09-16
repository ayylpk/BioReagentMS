// 离线单测：后门质检 gate —— CAS 校验位 / 乱码率 / 表一致性（老断言） + diag 账本断言（9/16 新增）
// 纪律：diag 断言**一律 info，不许改 pass 与 status**。本文件把它钉成回归：
//   "缺页/截断这些事实必须在 flags 里出现" 且 "不能因此把文档判死" —— 两条同时成立才算对。
import { describe, expect, test } from 'bun:test'
import { casCheckDigitOk, badCasIn, gate, plainTextOf } from './quality'
import type { Block, DocProfile, ParseDiag } from '../inspect/profile'

const blocks = (...md: string[]): Block[] => md.map(m => ({ type: 'text', markdown: m }))
const diag = (over: Partial<ParseDiag> = {}): ParseDiag => ({ extractor: 'pymupdf4llm', chars: 100, ...over })

const profileOf = (over: Partial<DocProfile> = {}): DocProfile => ({
	file: 'x/y.pdf', family: 'pdf', magic: 'pdf', strategy: 'L0-py', reason: '测试用', ...over,
})

describe('老断言不许被 diag 改动带歪', () => {
	test('CAS 校验位：合法通过，一字之差即失败', () => {
		expect(casCheckDigitOk('7664-93-9')).toBe(true)
		expect(casCheckDigitOk('7664-93-8')).toBe(false)
		expect(casCheckDigitOk('67-64-1')).toBe(true)
	})

	test('badCasIn：边界断言防 R/S 码串扰（45-46-6 不是 CAS）', () => {
		expect(badCasIn('R:45-46-60-25')).toEqual([])
		expect(badCasIn('CAS 7664-93-8')).toEqual(['7664-93-8'])
	})

	test('空抽取 → 红 → escalate L2（与 diag 无关，第一优先）', () => {
		const r = gate(profileOf(), [], diag())
		expect(r.pass).toBe(false)
		expect(r.escalate).toBe('L2')
		expect(r.flags.some(f => f.startsWith('[red]'))).toBe(true)
	})

	test('plainTextOf 与 gate 的正文口径同源：image 块不算正文', () => {
		const bs: Block[] = [
			{ type: 'text', markdown: 'abc' },
			{ type: 'image', markdown: '![一句图片描述](a.png)' },
			{ type: 'heading', markdown: '标题' },
		]
		expect(plainTextOf(bs)).toBe('abc\n标题')
	})
})

describe('diag 账本断言：事实必须出现', () => {
	test('VL 失败 / 超上限跳过页 → 必须记账', () => {
		const r = gate(profileOf(), blocks('正文内容'), diag({ pages_total: 30, pages_via_vl: 5, pages_vl_failed: 2, pages_skipped_by_cap: 9 }))
		const all = r.flags.join('\n')
		expect(all).toContain('VL 失败 2 页')
		expect(all).toContain('超 VL 上限跳过 9 页')
		expect(all).toContain('VL 重解析 5 页')
	})

	test('图转文：截断 / 失败 / 超上限 → 必须记账', () => {
		const r = gate(profileOf(), blocks('正文'), diag({ images_total: 12, images_captioned: 9, captions_truncated: 3, images_over_cap: 3 }))
		const all = r.flags.join('\n')
		expect(all).toContain('图 12 张')
		expect(all).toContain('描述被打满截断 3')
		expect(all).toContain('超描述上限 3')
	})

	test('表级：混装 workbook 里被拒的 sheet 不再无声消失', () => {
		const r = gate(profileOf({ family: 'xlsx' }), blocks('正文'), diag({ sheets_total: 3, sheets_rejected: 1, sheets_truncated: 1 }))
		const all = r.flags.join('\n')
		expect(all).toContain('判为台账型已跳过 1')
		expect(all).toContain('超行数上限截断 1')
	})

	test('docx 覆盖率：拿档案里现成的 paraChars 比抽取结果（既往这个数从没被用过）', () => {
		const p = profileOf({ family: 'docx', docx: { columns: 1, tableCount: 0, layoutTables: 0, textBoxes: 0, drawingCount: 0, paraChars: 1000 } })
		const low = gate(p, blocks('只抽到一点'.repeat(5)), diag({ extractor: 'markitdown', chars: 25 }))
		expect(low.flags.join('\n')).toContain('覆盖率')
		const high = gate(p, blocks('抽得挺全'.repeat(200)), diag({ extractor: 'markitdown', chars: 800 }))
		expect(high.flags.join('\n')).not.toContain('覆盖率')
	})

	test('零标题 + 正文够长 → 提示切块会退化（切块依赖 heading）', () => {
		const r = gate(profileOf(), blocks('很长的一段正文'.repeat(100)), diag())
		expect(r.flags.join('\n')).toContain('零标题')
		const withHeading = gate(profileOf(), [{ type: 'heading', markdown: '标题' }, ...blocks('很长的一段正文'.repeat(100))], diag())
		expect(withHeading.flags.join('\n')).not.toContain('零标题')
	})

	test('无 diag（老 py / 手写 fallback）→ 明说"降级事实不可知"，不假装没事', () => {
		const r = gate(profileOf(), blocks('正文内容'), undefined)
		expect(r.flags.join('\n')).toContain('无 diag')
	})

	test('py 侧 notes 原样带上（大图整页转录、编码非 UTF-8…）', () => {
		const r = gate(profileOf(), blocks('正文'), diag({ notes: ['文本按 gb18030 解码（非 UTF-8）'] }))
		expect(r.flags.join('\n')).toContain('gb18030')
	})
})

describe('★ diag 断言不许改判（只有 info，不新开黄/红）', () => {
	test('一堆降级事实堆在一起，pass 仍为 true、escalate 仍为空', () => {
		const p = profileOf({ family: 'docx', docx: { columns: 1, tableCount: 0, layoutTables: 0, textBoxes: 0, drawingCount: 0, paraChars: 9999 } })
		const r = gate(p, blocks('正常正文'.repeat(20)), diag({
			extractor: 'markitdown', chars: 80,
			pages_total: 100, pages_via_vl: 10, pages_vl_failed: 3, pages_skipped_by_cap: 60, pages_empty: 4,
			images_total: 50, images_captioned: 20, captions_truncated: 5, captions_failed: 2, images_over_cap: 30,
			sheets_total: 4, sheets_rejected: 2, sheets_truncated: 1,
			notes: ['解释了为什么'],
		}))
		// 断言一：事实都在（⚠️ 逐条数出现次数：页级 2 处、图级 3 处、表级 2 处）
		const warns = (r.flags.join('\n').match(/⚠️/g) ?? []).length
		expect(warns).toBeGreaterThanOrEqual(6)
		// 断言二：一条都没升级成判死 —— 当前处置链里黄灯=整档隔离且无人复核，"看见"和"判死"必须分开
		expect(r.flags.some(f => f.startsWith('[yellow]'))).toBe(false)
		expect(r.flags.some(f => f.startsWith('[red]'))).toBe(false)
		expect(r.pass).toBe(true)
		expect(r.escalate).toBeUndefined()
	})

	test('老黄灯仍然存在（页均字数那条没被改掉）', () => {
		const p = profileOf({ pdf: { hasTextLayer: true, pages: 100, charsPerPage: 5, columns: 'unknown', gapConsistentRatio: 0, lineDensity: 0, garbledRatio: 0 } })
		const r = gate(p, blocks('很短'), diag())
		expect(r.flags.join('\n')).toContain('页均字数')
		expect(r.escalate).toBe('L1')
	})
})
