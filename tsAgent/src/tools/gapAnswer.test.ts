// 离线单测：缺口问答（生成 → MySQL 待办 → 人工完成 → 同问题复用）
// ═══ 三条契约必须钉死 ═══
//   ① 归一化只做"同一句话的不同写法算同一条"，不做同义改写（语义归并是另一个量级的决定）
//   ② **复用优先**：命中已有记录就绝不重新生成、绝不重复插行（没有这条，表会变成垃圾场）
//   ③ 生成内容必须带免责声明，且 prompt 里封死"不许给安全数值/混放结论"
import { describe, expect, test } from 'bun:test'
import { answerGap, renderGapMaterial, type GapDeps } from './gapAnswer'
import { hashQuestion, normalizeQuestion, type GapRow } from '../rag/store/gap'

const row = (over: Partial<GapRow> = {}): GapRow => ({
	id: 7,
	question: '七氧化二锰的半致死量是多少？',
	questionHash: 'h',
	answer: '本地文档库中没有查到对应依据，以下是通用参考（未经核实）：\n请查 SDS 第 11 节。',
	status: 'pending',
	route: 'knowledge',
	model: 'deepseek-chat',
	nearMisses: [],
	askCount: 1,
	reviewedBy: null,
	reviewedAt: null,
	createdAt: new Date(),
	updatedAt: new Date(),
	...over,
})

/** 依赖桩：把"调用了几次生成、插了几行"记下来，好断言"复用优先" */
function deps(over: Partial<GapDeps> = {}) {
	const calls = { generate: 0, insert: 0, bump: 0 }
	const d: GapDeps = {
		findReusable: async () => null,
		insertGap: async () => { calls.insert++; return 101 },
		bumpAskCount: async () => { calls.bump++ },
		generate: async () => { calls.generate++; return '通用参考正文。' },
		...over,
	}
	return { d, calls }
}

describe('问题归一化：同句不同写法算同一条（不做语义归并）', () => {
	test('空白/标点/大小写/全角差异都折叠掉', () => {
		const a = hashQuestion('七氧化二锰的半致死量是多少？')
		for (const variant of ['七氧化二锰的半致死量是多少', '七氧化二锰 的 半致死量 是多少？', '七氧化二锰的半致死量是多少。']) {
			expect(hashQuestion(variant)).toBe(a)
		}
	})

	test('★ 不做同义改写：换了说法就是两条（这是刻意的边界）', () => {
		expect(hashQuestion('怎么急救')).not.toBe(hashQuestion('如何急救'))
	})

	test('归一化输出可读（保留字与数字，只去噪声；连字符也去 —— 7664-93-9 与 7664939 该算同一问题）', () => {
		expect(normalizeQuestion('CAS 7664-93-9 的 消防措施！')).toBe('cas7664939的消防措施')
		expect(hashQuestion('CAS 7664-93-9 的消防措施')).toBe(hashQuestion('cas 7664939 的消防措施'))
	})

	test('确定性：同输入永远同 hash（唯一键的前提）', () => {
		expect(hashQuestion('硫酸着火了怎么办')).toBe(hashQuestion('硫酸着火了怎么办'))
	})
})

describe('answerGap：复用优先 → 没命中才生成', () => {
	test('命中 pending 记录 → 复用，不生成、不插行，只加计数', async () => {
		const { d, calls } = deps({ findReusable: async () => row({ status: 'pending' }) })
		const out = await answerGap('七氧化二锰的半致死量是多少？', [], d)
		expect(out.source).toBe('reused_pending')
		expect(out.status).toBe('pending')
		expect(out.text).toContain('待人工确认')
		expect(calls.generate).toBe(0)   // ★ 不重复生成
		expect(calls.insert).toBe(0)     // ★ 不重复插行
		expect(calls.bump).toBe(1)
	})

	test('命中 done 记录 → 复用，口径变成"已确认的缺口知识"', async () => {
		const { d, calls } = deps({ findReusable: async () => row({ status: 'done' }) })
		const out = await answerGap('七氧化二锰的半致死量是多少？', [], d)
		expect(out.source).toBe('reused_done')
		expect(out.text).toContain('已确认的缺口知识')
		expect(calls.generate).toBe(0)
	})

	test('没命中 → 生成 + 落表，返回待办 id', async () => {
		const { d, calls } = deps()
		const out = await answerGap('某个冷门问题', [], d)
		expect(out.source).toBe('generated')
		expect(out.id).toBe(101)
		expect(out.status).toBe('pending')
		expect(calls.generate).toBe(1)
		expect(calls.insert).toBe(1)
	})

	test('★ 免责声明兜底：模型漏写第一句时由代码补上（不许靠提示词自觉）', async () => {
		const { d } = deps({ generate: async () => '通用参考正文，没写声明。' })
		const out = await answerGap('某个冷门问题', [], d)
		expect(out.text.startsWith('本地文档库中没有查到对应依据')).toBe(true)
	})

	test('生成失败 → 给人话，id 为 null（不当成"已记录"）', async () => {
		const { d } = deps({ generate: async () => { throw new Error('LLM 401') } })
		const out = await answerGap('某个冷门问题', [], d)
		expect(out.id).toBeNull()
		expect(out.text).toContain('暂时生成失败')
	})

	test('落表失败（MySQL 没起）→ 内容照给、只是没进待办（旁路化）', async () => {
		const { d, calls } = deps({ insertGap: async () => { calls.insert++; return null } })
		const out = await answerGap('某个冷门问题', [], d)
		expect(out.text).toContain('通用参考')
		expect(out.id).toBeNull()
		expect(out.status).toBeNull()
	})

	test('查表失败 → 退化为重新生成，但不会因此报错', async () => {
		const { d, calls } = deps({ findReusable: async () => { throw new Error('ECONNREFUSED') } })
		const out = await answerGap('某个冷门问题', [], d)
		expect(calls.generate).toBe(1)
		expect(out.source).toBe('generated')
	})

	test('空问题 → 什么都不做（不打 LLM、不落表）', async () => {
		const { d, calls } = deps()
		const out = await answerGap('   ', [], d)
		expect(out.text).toBe('')
		expect(calls.generate).toBe(0)
		expect(calls.insert).toBe(0)
	})
})

describe('素材渲染：把"未核实"写在脸上，别让生成模型当成文献', () => {
	test('带 id 时附上待办编号（人能找到那条记录）', () => {
		const text = renderGapMaterial({ text: '本地文档库中没有查到对应依据…', id: 42, source: 'generated', status: 'pending' })
		expect(text).toContain('待办 #42')
	})

	test('无文本 → 空串（不进素材，免得出现空标题）', () => {
		expect(renderGapMaterial({ text: '', id: null, source: 'generated', status: null })).toBe('')
	})
})
