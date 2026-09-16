// 离线单测：物质相容性查询（安全铁律的回归网）
// ═══ 本文件存在的唯一理由：**没查到禁配证据 ≠ 可以安全混合** ═══
// 断言目标有三个：① 返回值里根本没有"相容"这个状态 ② 没命中时必须说清"未命中不等于安全"
// ③ 身份键三段都试（CAS / 表解析 CAS / 规范名），因为漏一段就等于漏一类命中，而漏命中会被读成安全
import { describe, expect, test } from 'bun:test'
import { findCompatibility, renderCompat, resolveEntityKeys, type CompatDeps, type CompatFinding } from './reactionCompat'
import type { RuleRow } from '../reaction/types'

const rule = (over: Partial<RuleRow> = {}): RuleRow => ({
	id: 1, candidateId: 1, ruleKey: 'k', relationType: 'incompatible', directionSemantics: 'symmetric',
	subjectKind: 'reagent', objectKind: 'reagent',
	subjectKey: 'cas:7664-93-9', objectKey: 'cas:7722-64-7', pairKey: 'cas:7664-93-9 cas:7722-64-7',
	subjectName: '硫酸', objectName: '高锰酸钾', subjectCas: '7664-93-9', objectCas: '7722-64-7',
	severity: 'high', hazards: ['heat', 'toxic_gas'], conditions: null, confidence: null,
	extractorVersion: 'v1', evidenceText: '与强氧化剂接触剧烈反应，放出有毒气体。',
	source: { docId: 'ICSC-0363-硫酸', chunkSeq: 3, section: '稳定性和反应性' },
	status: 'active', supersededById: null, supersededAt: null,
	sourceState: 'active', sourceRecheckedBy: null, sourceRecheckedAt: null,
	reviewedBy: 1, reviewedAt: null, reviewNote: null, createdAt: new Date(), updatedAt: new Date(),
	...over,
} as RuleRow)

const deps = (over: Partial<CompatDeps> = {}): CompatDeps => ({
	findRules: async () => [],
	lookupCasByName: async () => null,
	...over,
})

describe('★ 安全铁律：类型层面就没有"相容"这个取值', () => {
	test('status 只允许 confirmed / insufficient_evidence（写死在这里，拆了会红）', () => {
		// @ts-expect-error 'compatible' 不是允许的取值 —— 这行要是编译不过，说明类型封死被拆了
		const bad: CompatFinding['status'] = 'compatible'
		void bad
		const good: CompatFinding['status'][] = ['confirmed', 'insufficient_evidence']
		expect(good).toHaveLength(2)
	})
})

describe('resolveEntityKeys：三段身份键都试（漏一段就漏一类命中）', () => {
	test('显式合法 CAS → cas: 键排第一', async () => {
		const { keys } = await resolveEntityKeys({ name: '硫酸', cas: '7664-93-9' }, deps())
		expect(keys[0]).toBe('cas:7664-93-9')
		expect(keys).toContain('name:硫酸')
	})

	test('只有名字 → 经 reagent 表解析出 CAS，仍然拿到 cas: 键', async () => {
		const { keys } = await resolveEntityKeys({ name: '硫酸' }, deps({ lookupCasByName: async () => '7664-93-9' }))
		expect(keys).toEqual(['cas:7664-93-9', 'name:硫酸'])
	})

	test('表里查不到 CAS → 退 name: 键（可解释：triedKeys 里看得见缺了 cas: 那段）', async () => {
		const { keys } = await resolveEntityKeys({ name: '某种自制试剂' }, deps())
		expect(keys).toEqual(['name:某种自制试剂'])
	})

	test('非法 CAS 不抛异常（退名字键并记账，不能让一个错编号把查询整条打死）', async () => {
		const { keys } = await resolveEntityKeys({ name: '硫酸', cas: '7664-93-8' }, deps())
		expect(keys.some(k => k.startsWith('cas:'))).toBe(false)
		expect(keys).toContain('name:硫酸')
	})
})

describe('findCompatibility：命中给结论、没命中给"证据不足"', () => {
	test('库里有规则 → confirmed，带严重度/危害/证据/来源', async () => {
		const f = await findCompatibility({ name: '硫酸' }, { name: '高锰酸钾' }, deps({ findRules: async () => [rule()] }))
		expect(f.status).toBe('confirmed')
		expect(f.rules).toHaveLength(1)
		const text = renderCompat(f, '硫酸', '高锰酸钾')
		expect(text).toContain('已确认禁配')
		expect(text).toContain('严重度=high')
		expect(text).toContain('放热')
		expect(text).toContain('有毒气体')
		expect(text).toContain('证据原文')
		expect(text).toContain('ICSC-0363-硫酸')
	})

	test('★ 库里没有 → insufficient_evidence，且必须把"未命中不等于可以混合"说出来', async () => {
		const f = await findCompatibility({ name: '甲试剂' }, { name: '乙试剂' }, deps())
		expect(f.status).toBe('insufficient_evidence')
		expect(f.rules).toEqual([])
		expect(f.reason).toContain('未命中不等于可以混合')
		expect(f.reason).toContain('同义名')
		expect(renderCompat(f)).toContain('证据不足')
	})

	test('★ 没命中时：必须带"未命中不等于可以混合"这句否定，且不许出现任何"没事"式措辞', async () => {
		const f = await findCompatibility({ name: '甲' }, { name: '乙' }, deps())
		const text = renderCompat(f)
		// ① 否定句必须在（这就是这条铁律的落点）
		expect(text).toContain('未命中不等于可以混合')
		// ② 任何"放心的说法"都不许出现 —— 注意 "可以混合" 本身出现在否定句里，所以只能查它的肯定式变体
		for (const bad of ['可以混放', '可以一起', '是安全的', '无风险', '没有问题', '相容']) {
			expect([bad, text.includes(bad)]).toEqual([bad, false])
		}
	})

	test('键的笛卡尔积：一边 CAS、一边只有名字 → 两条对键都查（混搭不漏）', async () => {
		const seen: string[][] = []
		const f = await findCompatibility(
			{ name: '硫酸', cas: '7664-93-9' },
			{ name: '高锰酸钾' },
			deps({ findRules: async (keys) => { seen.push(keys); return [] } }),
		)
		// 对键按码元序排好，所以 cas: 段在前、name: 段在后
		expect(seen[0]).toEqual(['cas:7664-93-9 name:高锰酸钾', 'name:硫酸 name:高锰酸钾'])
		expect(f.triedKeys).toEqual(['cas:7664-93-9', 'name:硫酸', 'name:高锰酸钾'])
	})

	test('两边都拿不到键（空输入）→ insufficient_evidence，不抛', async () => {
		const f = await findCompatibility({ name: '' }, { name: '' }, deps())
		expect(f.status).toBe('insufficient_evidence')
		expect(f.reason).toContain('无法为这两个输入构造出可查的身份键')
	})

	test('来源失效的规则：结论照给，但必须带"待复核"警示（不许静默降级成正常结论）', async () => {
		const f = await findCompatibility({ name: '硫酸' }, { name: '高锰酸钾' }, deps({
			findRules: async () => [rule({ sourceState: 'source_stale' })],
		}))
		expect(renderCompat(f)).toContain('来源状态=source_stale')
		expect(renderCompat(f)).toContain('待人工复核')
	})
})
