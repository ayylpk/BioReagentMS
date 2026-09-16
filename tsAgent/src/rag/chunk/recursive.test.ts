// 离线单测：通用切块引擎 —— **断言与文档内容无关**（这才是"通用"的可测定义）
// 六条：① 零丢失 ② 尺寸落区间 ③ 重叠恰 10% ④ 不编造结构 ⑤ 去重不误删 ⑥ 幂等
// 靶子刻意全是"结构随意"的：散文长文、无空行 OCR 长串、一行一词日志、无标点巨串、混合表格、配置代码
import { describe, expect, test } from 'bun:test'
import {
	MAX_CHUNK, MIN_CHUNK, OVERLAP_CAP, OVERLAP_RATIO,
	applyOverlap, chooseCut, cutPieces, dedupeAdjacentLines, mergeToMin, normalizeText, scanBoundaries, splitUniversal,
} from './recursive'
import { MAX_TABLE_CHARS } from './params'
import { bySection } from './bySection'
import type { Block } from '../inspect/profile'

// ── 靶子：任意结构 ──
/** 散文长文：有段落、有句号、没有标题、没有空行分隔的短句混排 */
const prose = Array.from({ length: 60 }, (_, i) =>
	`第${i + 1}段讲的是实验室通风与个人防护的关系，这一段没有任何标题也没有列表符号，只是一直往下写句子。`).join('\n')

/** 无空行 OCR 长串：整篇一个换行都没有，只有句号 */
const ocrOneLine = Array.from({ length: 120 }, (_, i) => `第${i + 1}行识别结果，此处为扫描件文字层直出的内容`).join('。')

/** 无标点巨串：中文、英文、数字混在一起，找不到任何自然边界 */
const noPunct = '实验室安全规范'.repeat(300)

/** 一行一词的日志 */
const logLines = Array.from({ length: 400 }, (_, i) => `2026-09-15 10:${String(i % 60).padStart(2, '0')}:00 INFO ingest doc=${i} status=done`).join('\n')

/** 配置/代码类：缩进敏感、短行多 */
const codeish = ['[server]', 'port = 8123', '[db]', 'host = 127.0.0.1', ...Array.from({ length: 80 }, (_, i) => `key_${i} = value_${i}`)].join('\n')

const ALL = { prose, ocrOneLine, noPunct, logLines, codeish }

/** 归一化后逐字比对用：去掉所有空白，只比字符序列 */
const squash = (s: string) => s.replace(/\s+/g, '')

describe('① 零丢失：切块阶段不许吃掉任何字符（归一化与去重之外）', () => {
	for (const [name, raw] of Object.entries(ALL)) {
		test(`${name}：所有字符都能在切出的片里按序找到`, () => {
			const { pieces } = splitUniversal(raw, { overlapRatio: 0 }) // 关重叠，纯测切分
			const joined = squash(pieces.map(p => p.text).join(''))
			expect(joined).toBe(squash(normalizeText(raw)))
		})
	}

	test('归一化只动版式：换行/零宽/尾空白被规范，字一个不少', () => {
		const raw = '甲  \r\n\r\n\r\n\r\n乙\u200b丙\r丁'
		expect(normalizeText(raw)).toBe('甲\n\n乙丙\n丁')
	})
})

describe('② 尺寸落区间：p50/p90 落在 [MIN, MAX×1.15]；低于 MIN 必须有正当理由', () => {
	for (const [name, raw] of Object.entries(ALL)) {
		test(`${name}：除帧尾外无碎块，且无超软上限块`, () => {
			const { pieces } = splitUniversal(raw, { overlapRatio: 0 })
			const softMax = Math.floor(MAX_CHUNK * 1.15)
			for (const p of pieces) expect([name, p.text.length <= softMax]).toEqual([name, true])
			// 低于下限的片：只允许出现在最后一片（帧尾），或该片本身就是"单片超长被硬切"的产物
			const lowOnes = pieces.filter(p => p.belowMin)
			expect(lowOnes.length).toBeLessThanOrEqual(1)
			if (lowOnes.length) expect(lowOnes[0]).toBe(pieces[pieces.length - 1])
		})
	}

	test('★ 无标点巨串：不返回超限片（硬切兜底），且前进保证不死循环', () => {
		const { pieces } = splitUniversal(noPunct, { overlapRatio: 0 })
		expect(pieces.every(p => p.text.length <= MAX_CHUNK)).toBe(true)
		expect(pieces.every(p => p.cut === 'hard' || p.cut === 'end')).toBe(true)
		expect(pieces.length).toBeGreaterThan(1)
	})
})

describe('③ 切点落在自然边界上：优先级 段落 > 句末 > 换行 > 逗号', () => {
	test('scanBoundaries：四类边界都识别，同位置留优先级最高的', () => {
		const kinds = scanBoundaries('甲。乙\n丙，丁\n\n戊').map(b => b.kind)
		expect(kinds).toContain('sentence')
		expect(kinds).toContain('line')
		expect(kinds).toContain('comma')
		expect(kinds).toContain('paragraph')
	})

	test('窗口内有句末与逗号 → 选句末（语义优先），不是"最近的那个"', () => {
		const text = `${'甲'.repeat(300)}。${'乙'.repeat(300)}，${'丙'.repeat(300)}`
		const bounds = scanBoundaries(text)
		const { kind } = chooseCut(text, bounds, 0, { max: MAX_CHUNK, min: MIN_CHUNK, slack: 0.15 })
		expect(kind).toBe('sentence')
	})

	test('窗口内一个边界都没有 → 扩到软上限抓第一个（"达到上限继续往后找"）', () => {
		// 前 400 字无边界，第 850 字才是句号：窗口 [250,800] 空 → 扩到 920 抓到它
		const text = `${'甲'.repeat(849)}。${'乙'.repeat(200)}`
		const bounds = scanBoundaries(text)
		const { pos, kind } = chooseCut(text, bounds, 0, { max: MAX_CHUNK, min: MIN_CHUNK, slack: 0.15 })
		expect(kind).toBe('sentence')
		expect(pos).toBe(850)
		expect(pos).toBeGreaterThan(MAX_CHUNK)          // 确实向后扩了
		expect(pos).toBeLessThanOrEqual(Math.floor(MAX_CHUNK * 1.15))
	})

	test('软上限内仍无边界 → 硬切于 MAX（绝不超限）', () => {
		const text = '甲'.repeat(3000)
		const { pos, kind } = chooseCut(text, scanBoundaries(text), 0, { max: MAX_CHUNK, min: MIN_CHUNK, slack: 0.15 })
		expect(kind).toBe('hard')
		expect(pos).toBe(MAX_CHUNK)
	})

	test('OCR 无空行长串：切点全在句末（不会按行/逗号乱切）', () => {
		const { pieces } = splitUniversal(ocrOneLine, { overlapRatio: 0 })
		const cuts = pieces.slice(0, -1).map(p => p.cut)
		expect(cuts.every(c => c === 'sentence')).toBe(true)
	})
})

describe('④ 重叠：只在真切开的缝上，比例 10%、上限 150 字', () => {
	test('下一块头部 = 上一块尾部 round(len×10%)（按上一块的**自身内容**算，不叠加它自己的重叠前缀）', () => {
		const base = mergeToMin(cutPieces(prose), {})
		const out = applyOverlap(base, {})
		const withOverlap = out.filter(p => p.overlapChars > 0)
		expect(withOverlap.length).toBeGreaterThan(0)
		for (const [i, p] of out.entries()) {
			if (p.overlapChars === 0) continue
			const own = base[i - 1]!                       // 未经重叠的上一块
			const k = Math.min(Math.round(own.text.length * OVERLAP_RATIO), OVERLAP_CAP)
			expect(p.overlapChars).toBe(k)
			expect(p.text.startsWith(own.text.slice(-k))).toBe(true)
		}
	})

	test('比例会被上限封顶（长块不把 150 字以上拖过去）', () => {
		const long = '甲'.repeat(2000)
		const out = applyOverlap(mergeToMin(cutPieces(long), {}), {})
		expect(Math.max(...out.map(p => p.overlapChars))).toBeLessThanOrEqual(OVERLAP_CAP)
	})

	test('前一片太短就不带重叠（带过去也不值钱）', () => {
		const raw = `${'甲'.repeat(40)}。${'乙'.repeat(900)}`     // 首片 41 字 < 80
		const pieces = mergeToMin(cutPieces(raw, { min: 20 }), { min: 20 })
		expect(pieces[0]!.text.length).toBeLessThan(80)
		expect(applyOverlap(pieces, {})[1]!.overlapChars).toBe(0)
	})

	test('合并缝内部不复制内容（内容连续，没有丢东西也就没有重叠）', () => {
		// 直接喂手工初切片：两小片会被并、大片不会 → 验证"并"的语义与缝的位置
		const a = '甲'.repeat(100)
		const b = '乙'.repeat(100)
		const c = '丙'.repeat(800)
		const merged = mergeToMin([{ text: a, cut: 'paragraph' }, { text: b, cut: 'paragraph' }, { text: c, cut: 'end' }], {})
		expect(merged).toHaveLength(2)
		expect(merged[0]!.mergedFrom).toBe(2)
		expect(merged[0]!.text).toBe(`${a}\n${b}`)            // 缝上没有任何重复与标记
		expect(merged[0]!.text.split('甲').length - 1).toBe(100) // 甲没被复制一遍
		// 最终片之间的那条缝才是"切缝"→ 才有重叠
		const out = applyOverlap(merged, {})
		expect(out[1]!.overlapChars).toBeGreaterThan(0)
		expect(out[0]!.overlapChars).toBe(0)
	})
})

describe('⑤ 去重保守：同内容两形态删一条，差一个条件的两条必须都留', () => {
	test('ICSC 形态：naive 拼接 + 带全角｜的同内容行 → 只留一条', () => {
		const raw = '吸入 迅速脱离现场至空气新鲜处\n吸入｜迅速脱离现场至空气新鲜处\n皮肤接触 用大量清水冲洗'
		const r = dedupeAdjacentLines(raw)
		expect(r.dropped).toBe(1)
		expect(r.text.split('\n')).toHaveLength(2)
	})

	test('★ 安全数据不许误删：两条急救步骤只差一个部位 → 两条都留', () => {
		const raw = '皮肤接触：立即脱去污染的衣着，用大量流动清水冲洗至少15分钟。\n眼睛接触：立即提起眼睑，用大量流动清水冲洗至少15分钟。'
		expect(dedupeAdjacentLines(raw).dropped).toBe(0)
	})

	test('短行不去重（<12 字太容易误判）', () => {
		expect(dedupeAdjacentLines('无资料\n无资料').dropped).toBe(0)
	})

	test('后一行更全 → 替换前一行（留信息量大的）；被包含者须 ≥24 字才敢动', () => {
		const short = '本试剂为无色透明液体具有特殊刺激性气味易溶于水与多数有机溶剂'
		const full = `${short}，CAS 67-64-1，实验室常用于清洗与萃取`
		const r = dedupeAdjacentLines(`${short}\n${full}`)
		expect(r.dropped).toBe(1)
		expect(r.text).toContain('67-64-1')
		// 被包含者不足 24 字 → 不动（阈值就是防误删的那道闸）
		expect(dedupeAdjacentLines(`${'物质名称：丙酮'}\n物质名称：丙酮（分析纯，含量≥99.5%）`).dropped).toBe(0)
	})
})

describe('⑥ 幂等：同输入两次结果逐字节相同（重摄幂等的前提）', () => {
	test('splitUniversal 确定性', () => {
		const a = splitUniversal(prose)
		const b = splitUniversal(prose)
		expect(JSON.stringify(a)).toBe(JSON.stringify(b))
	})
})

describe('接入切块层：结构只当"帧"，不参与切法', () => {
	const T = (text: string): Block => ({ type: 'text', markdown: text })
	const H = (level: number, text: string): Block => ({ type: 'heading', level, markdown: text })

	test('无标题文档（任意结构）：section 必须留空，不许拿文件名或首行硬凑', () => {
		const chunks = bySection('corpus/misc/随手记.dat', [T(prose)])
		expect(chunks.length).toBeGreaterThan(0)
		expect(chunks.every(c => c.section === undefined)).toBe(true)
		expect(chunks.every(c => c.headingPath.length === 0)).toBe(true)
		// 锚仍要在（稀疏路要有靶），但它只是"文档标识"，冒充不了分节
		expect(chunks[0]!.text.startsWith('misc__随手记')).toBe(true)
	})

	test('★ 同一帧内的短段落被打包成一块（治碎块：6 个短块 → 1 块，不是 6 个碎片）', () => {
		const blocks = [H(1, '手册'), ...Array.from({ length: 6 }, (_, i) => T(`第${i + 1}条：实验室安全要求说明文字。`))]
		const chunks = bySection('corpus/misc/x.md', blocks)
		expect(chunks).toHaveLength(1)
		expect(chunks[0]!.text).toContain('第1条')
		expect(chunks[0]!.text).toContain('第6条')
	})

	test('帧尾碎块被并进前一片（合并缝出现在"尾巴"上）；mergeToMin 单测钉住语义', () => {
		const merged = mergeToMin([
			{ text: '甲'.repeat(300), cut: 'sentence' },
			{ text: '乙'.repeat(40), cut: 'end' },      // 尾巴只有 40 字 < MIN → 应该被并
		], {})
		expect(merged).toHaveLength(1)
		expect(merged[0]!.mergedFrom).toBe(2)
		expect(merged[0]!.belowMin).toBe(false)
	})

	test('★ 跨节打包（9/16 新语义）：短节被打成一块，section 记公共祖先、sections 记覆盖到的各节', () => {
		const blocks = [H(1, 'ICSC 0003 铬酸铅'), H(2, '吸入'), T('迅速脱离现场至空气新鲜处。'), H(2, '皮肤接触'), T('脱去污染的衣着，用大量清水冲洗。')]
		const chunks = bySection('corpus/misc/icsc.md', blocks)
		expect(chunks).toHaveLength(1)                       // 两节 40 字 → 打成一块（治碎块）
		expect(chunks[0]!.section).toBe('ICSC 0003 铬酸铅')   // 公共祖先（**不编造**成其中一节）
		expect(chunks[0]!.headingPath).toEqual(['ICSC 0003 铬酸铅'])
		expect(chunks[0]!.sections).toEqual(['吸入', '皮肤接触']) // 覆盖到的节名如实全记
		expect(chunks[0]!.flags?.some(f => f.startsWith('[cross_section]'))).toBe(true)
	})

	test('一节一块模式（perFrameBoundary）：路径与 section 精确，块可能偏小（两种模式都可选）', () => {
		const blocks = [H(1, 'ICSC 0003 铬酸铅'), H(2, '吸入'), T('迅速脱离现场至空气新鲜处。'), H(2, '皮肤接触'), T('脱去污染的衣着，用大量清水冲洗。')]
		const chunks = bySection('corpus/misc/icsc.md', blocks, { perFrameBoundary: true })
		expect(chunks.map(c => c.section)).toEqual(['吸入', '皮肤接触'])
		expect(chunks.map(c => c.headingPath)).toEqual([['ICSC 0003 铬酸铅', '吸入'], ['ICSC 0003 铬酸铅', '皮肤接触']])
		expect(chunks.every(c => c.sections?.length === 1)).toBe(true)
	})

	test('切缝重叠进了 payload 字段（overlapChars），正文里没有标记', () => {
		const blocks = [H(1, '长文'), T(prose)]
		const chunks = bySection('corpus/misc/z.md', blocks)
		const withOv = chunks.filter(c => (c.overlapChars ?? 0) > 0)
		expect(withOv.length).toBeGreaterThan(0)
		for (const c of withOv) {
			expect(c.flags?.some(f => f.startsWith('[overlap]'))).toBe(true)
			expect(c.text).not.toContain('[overlap]')        // 标记只在 flags，正文纯原文
		}
	})

	test('表格仍然是原子的：不参与合并、不参与重叠（行为未变）', () => {
		const table = '| 列1 | 列2 |\n|---|---|\n| 甲 | 乙 |'
		const chunks = bySection('corpus/misc/t.md', [H(1, '表'), T('前文。'), { type: 'table', markdown: table }])
		const t = chunks.find(c => c.tableId)!
		expect(t.tablePart).toEqual({ index: 1, total: 1 })
		expect(t.overlapChars).toBeUndefined()
		expect(t.flags ?? []).toEqual([])
	})

	test('参数口径：MAX_TABLE_CHARS 仍从切块层可取（旧 import 路径不断）', () => {
		expect(MAX_TABLE_CHARS).toBe(1600)
	})
})
