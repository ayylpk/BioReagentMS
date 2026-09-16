// 禁配/相容性查询（Agent 4 的工具 + 图节点共用的执行体）
//
// ═══ 安全铁律（用户拍板，写在最前面）═══
// **没查到禁配证据 ≠ 可以安全混合。** 本工具的返回值只有两种：
//   · 'confirmed'            —— 库里有经人工审核的正式规则（附严重度/危害/条件/证据原文/来源）
//   · 'insufficient_evidence' —— 库里没有该物质对的记录
// 返回类型里**根本没有 "compatible" 这个取值**，所以上游无论怎么写都表达不出"可以混合"。
// 这是类型层面的封死，不靠提示词自觉（与 reaction/types.ts 里 RELATION_TYPES 的做法一致）。
//
// 已知缺口（必须在 insufficient_evidence 的文案里说出来，否则会被读成"安全"）：
//   · 同义名不归并：乙醇 vs 无水乙醇、DMSO vs 二甲基亚砜 是两个实体 → 会漏命中；
//   · 库内以 CAS 为身份（cas: 键），只有名字的查询要先经 reagent 表解析 CAS，解析不到就退 name: 键，
//     而 name: 键与 cas: 键是两个不互通的键空间 → 又一处漏命中的来源。
// 所以查不到时**建议换写法或补 CAS 再试**，绝不说"没查到就是安全"。
import { tool } from '@langchain/core/tools'
import { z } from 'zod'
import { queryReadOnly } from '../db/mysql'
import { entityKeyOf, normalizeEntityName, pairKeyOf } from '../reaction/keys'
import { findRulesByPairKeys } from '../reaction/store'
import type { EntityRef } from '../reaction/types'
import type { RuleRow } from '../reaction/types'

/** 关系类型 → 人话（**不含"相容/可以混合"**） */
const RELATION_CN: Record<string, string> = {
	incompatible: '已确认禁配（混合即危险）',
	storage_separate: '须分开储存（同库存放有风险）',
	hazardous_reaction: '已确认危险反应（会产生有害结果）',
	conditionally_compatible: '仅限给定条件下共存（条件见下，条件不满足即为危险）',
}

/** 危害枚举 → 人话 */
const HAZARD_CN: Record<string, string> = {
	heat: '放热', fire: '燃烧', explosion: '爆炸', toxic_gas: '有毒气体',
	flammable_gas: '易燃气体', pressure: '压力/爆沸', polymerization: '聚合', decomposition: '分解', other: '其他',
}

export interface CompatFinding {
	status: 'confirmed' | 'insufficient_evidence'
	/** 两个实体最终用哪些键去查的（可解释性：能区分"键算错了"与"库里真没有"） */
	triedKeys: string[]
	rules: RuleRow[]
	/** status='insufficient_evidence' 时的人话原因（含已知缺口），直接可以念给用户 */
	reason: string
}

/** 依赖注入：生产实现走 MySQL，单测塞内存桩（这样"键怎么算、没命中怎么说话"能离线钉死） */
export interface CompatDeps {
	findRules: (pairKeys: string[]) => Promise<RuleRow[]>
	lookupCasByName: (name: string) => Promise<string | null>
}

export const defaultCompatDeps: CompatDeps = {
	findRules: (pairKeys) => findRulesByPairKeys(pairKeys, { limit: 20 }),
	lookupCasByName: async (name) => {
		// reagent 表是主数据（7 行量级），按名称或 CAS 都能命中；查不到返回 null，不编
		try {
			const rows = await queryReadOnly<{ cas_number: string | null }>(
				'SELECT cas_number FROM reagent WHERE name = ? OR cas_number = ? LIMIT 1',
				[name, name],
			)
			const cas = rows[0]?.cas_number?.trim()
			return cas ? cas : null
		} catch {
			return null // 库不可达时退 name: 键，仍然给出可解释结果（不假装命中）
		}
	},
}

export interface CompatSubject { name: string; cas?: string | null }

/**
 * 把一个输入（可能只有名字）解析成候选实体键列表，**按可信度排序**：
 *   ① 显式合法 CAS        → `cas:<CAS>`（跨命名体系稳定，命中率最高）
 *   ② reagent 表解析出的 CAS → `cas:<CAS>`
 *   ③ 规范化名字           → `name:<规范名>`（兜底；与 cas: 键空间不互通）
 * 三段都试而不是只试一段：漏一段就等于漏一类命中，而漏命中会被误读成"安全"。
 */
export async function resolveEntityKeys(subject: CompatSubject, deps: CompatDeps): Promise<{ keys: string[]; ref: EntityRef }> {
	const keys: string[] = []
	const push = (k: string | null) => { if (k && !keys.includes(k)) keys.push(k) }

	const name = subject.name?.trim()
	const casInput = subject.cas?.trim() || undefined
	// ① 显式 CAS：entityKeyOf 会过校验位，错编号直接抛 → 这种情况退回名字键并记账
	if (casInput) {
		try {
			push(entityKeyOf({ kind: 'reagent', name: name || casInput, cas: casInput }))
		} catch {
			/* 错 CAS 不阻断：退名字键，让调用方在 triedKeys 里看到缺了 cas: 那一段 */
		}
	}
	// ② 名字 → reagent 表解析 CAS
	if (name && !keys.some(k => k.startsWith('cas:'))) {
		const cas = await deps.lookupCasByName(name)
		if (cas) {
			try {
				push(entityKeyOf({ kind: 'reagent', name, cas }))
			} catch {
				/* 表里存了非法 CAS：忽略该段 */
			}
		}
	}
	// ③ 名字兜底
	if (name) {
		try {
			push(`name:${normalizeEntityName(name)}`)
		} catch {
			/* 名字规范化失败：没有可用的键 */
		}
	}
	const ref: EntityRef = { kind: 'reagent', name: name || casInput || '', ...(casInput ? { cas: casInput } : {}) }
	return { keys, ref }
}

/**
 * 查两个物质之间**已审核**的规则。只回两种状态，永不回"相容"。
 * pairKeys 会按两边的所有候选键做笛卡尔积（去重后一把查），从而兼容"一边有 CAS、另一边只有名字"的混搭。
 */
export async function findCompatibility(a: CompatSubject, b: CompatSubject, deps: CompatDeps = defaultCompatDeps): Promise<CompatFinding> {
	const [ra, rb] = await Promise.all([resolveEntityKeys(a, deps), resolveEntityKeys(b, deps)])
	const pairKeys: string[] = []
	for (const ka of ra.keys) {
		for (const kb of rb.keys) {
			if (ka === kb) continue // 同一个实体不构成关系（keys.ts 会抛，这里跳过）
			try {
				pairKeys.push(pairKeyOf(ka, kb))
			} catch {
				/* 同键，跳过 */
			}
		}
	}
	const triedKeys = [...ra.keys, ...rb.keys]
	if (!pairKeys.length) {
		return {
			status: 'insufficient_evidence',
			triedKeys,
			rules: [],
			reason: '无法为这两个输入构造出可查的身份键（至少一边没有可用的名称或 CAS）。请给出物质名或合法 CAS 再试。',
		}
	}

	const rules = await deps.findRules(pairKeys)
	if (rules.length) return { status: 'confirmed', triedKeys, rules, reason: '' }

	return {
		status: 'insufficient_evidence',
		triedKeys,
		rules: [],
		reason:
			'知识库中没有这两个物质的已审核记录。**未命中不等于可以混合**：本库只收录经人工审核、带原文证据的 SDS 结论；' +
			'且同义名不自动归并（乙醇 vs 无水乙醇、DMSO vs 二甲基亚砜 算两个实体），' +
			`本次实际尝试的身份键：${triedKeys.join('、')}。建议补上 CAS 号或换用规范名再查；` +
			'若两者均为强氧化剂/强还原剂、酸碱、遇水放热物等，请按实验室化学品分级存放通则处理，不要依赖本库的"未命中"。',
	}
}

/** 人话渲染（喂给最终回答模型，也可直接给前端）：【关系｜严重度】+ 条件 + 证据原文 + 来源 */
export function renderCompat(finding: CompatFinding, aLabel?: string, bLabel?: string): string {
	if (finding.status === 'insufficient_evidence') return `【证据不足】${finding.reason}`
	const head = `${aLabel ?? '物质A'} × ${bLabel ?? '物质B'}`
	const lines = finding.rules.map((r) => {
		const sev = r.severity === 'unknown' ? '未评估' : r.severity
		const hazards = (r.hazards ?? []).map(h => HAZARD_CN[h] ?? h).join('、') || '未列出'
		const cond = r.conditions && Object.keys(r.conditions).length ? `｜条件=${JSON.stringify(r.conditions)}` : ''
		// 来源失效必须写在结论里：规则还 active，但支撑它的文档已经变了/没了
		const stale = r.sourceState !== 'active' ? `｜⚠️ 来源状态=${r.sourceState}（来源文档已变更，结论待人工复核）` : ''
		return [
			`【${RELATION_CN[r.relationType] ?? r.relationType}｜严重度=${sev}｜危害=${hazards}】${head}${cond}${stale}`,
			`证据原文：「${r.evidenceText}」`,
			`来源：${r.source.docId}${r.source.section ? ` · ${r.source.section}` : ''}（chunk#${r.source.chunkSeq}）`,
		].join('\n')
	})
	return lines.join('\n---\n')
}

// ── LangChain 工具（给图/模型用；执行体就是上面的 findCompatibility） ──
export const findReactionCompatibility = tool(
	async ({ subject, object, subject_cas, object_cas }) => {
		const finding = await findCompatibility(
			{ name: subject, cas: subject_cas ?? null },
			{ name: object, cas: object_cas ?? null },
		)
		return renderCompat(finding, subject, object)
	},
	{
		name: 'find_reaction_compatibility',
		description: '查询两种试剂/化学品之间**已人工审核**的禁配与相容性结论（禁配/须分开储存/危险反应/条件共存）。若库中无记录，返回"证据不足"，绝不代表可以混合。',
		schema: z.object({
			subject: z.string().describe('第一种物质名称，如 硫酸'),
			object: z.string().describe('第二种物质名称，如 高锰酸钾'),
			subject_cas: z.string().optional().describe('可选：第一种物质的 CAS 号（有就给，命中率显著更高）'),
			object_cas: z.string().optional().describe('可选：第二种物质的 CAS 号'),
		}),
	},
)
