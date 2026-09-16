// 试剂禁配/相容性安全知识 —— 确定性校验与归一化（**纯函数，无 IO**，本任务的重头）
//
// 为什么这层比提示词重要：
//   提示词只能"请模型别乱来"。真正拦住"模型凭常识补 CAS""把否定句读成禁配""引文被顺手改写"
//   的，是这一层的逐条数字断言 —— 每条拒绝都有独立编码，能在抽取台账里被数出来。
//   静默丢弃是**禁止**的：宁可候选表里少几条，也要在 reject_json 里看见它们是怎么少的。
//
// 与下游的契约边界：
//   · evidence_quote 必须**原样**是 sourceText 的连续子串（不做 NFKC/空白规整再比对）——
//     因为 store.deriveCandidate 会用同样的原样 contains 断言，这里放水下游就会当场抛。
//   · CAS 必须过 casCheckDigitOk（错编号会把甲的禁配关系挂到乙身上，没有降级余地）。
//   · 允许的关系枚举里**没有 compatible** —— "未提及"在类型层就写不成"兼容"。
import type { EntityRef, Hazard, Severity } from '../types'
import { casCheckDigitOk } from '../../rag/gate/quality'
import { entityKeyOf, normalizeEntityName } from '../keys'
import {
  strictRelationSchema,
  type NormalizationNote,
  type RejectionCode,
  type RelationRejection,
  type ValidationOutcome,
  type ValidatedRelation,
} from './types'

/** 证据最短长度：短于此的片段（"遇酸""见上"）撑不起"谁与谁什么关系" */
export const MIN_EVIDENCE_CHARS = 4
/** 证据最长长度：对齐 reaction_candidate.evidence_text 的 TEXT 上限与 zod 上限；超了**不截断**（截断会破坏 candidate_key 的可复算语义） */
export const MAX_EVIDENCE_CHARS = 8000

// ── 类别词表 ──────────────────────────────────────────────────────────────────
/**
 * 精确匹配（不是子串匹配！）的类别词表：名字归一化后**完全等于**表里某项 → 判为 category。
 * 为什么必须精确匹配：'酸' 是类别，但 '硫酸' 含 '酸' 却是具体物质 —— 子串匹配会把硫酸降级成类别，
 * 于是"硫酸 × 氢氧化钠"变成"某类酸 × 某类碱"，正式规则就再也查不到具体那瓶试剂了。
 * 用途是落实规则 4（"避免接触强氧化剂" → object_kind=category，且不许虚构具体物质列表）：
 * 模型若把 '氧化剂' 标成 reagent，这里确定性纠正并留痕 coerced_category。
 */
export const CATEGORY_VOCAB: readonly string[] = [
  '氧化剂', '强氧化剂', '氧化性物质', '还原剂', '强还原剂', '还原性物质',
  '酸', '强酸', '酸类', '无机酸', '有机酸',
  '碱', '强碱', '碱类', '碱金属', '碱金属氢氧化物',
  '卤素', '金属', '金属粉末', '重金属', '活泼金属',
  '过氧化物', '有机过氧化物', '催化剂',
  '胺', '胺类', '醇', '醇类', '有机物', '有机材料',
  '可燃物', '易燃物', '可燃材料', '可燃物质',
]

/**
 * 占位泛称：这类"实体"在原文里确实出现过（所以过得了 ENTITY_NOT_IN_SOURCE），
 * 但它不是任何可查的东西 —— ICSC 卡片原句就是"与不相容物质接触，有着火和爆炸的危险"，
 * 抽出来的关系对象是"不相容物质"，谁也没法拿它去查库，还会给人"已经知道禁配谁了"的错觉。
 * 一律拒收，让它在 reject_json 里显形（而不是变成一条永远审不完的候选）。
 */
export const GENERIC_ENTITY_NAMES: readonly string[] = [
  '不相容物质', '不相容材料', '不相容物', '相容物质', '其他物质', '其它物质', '未知物质',
  '杂质', '任何物质', '所有物质', '多种物质', '危险物质', '有害物质',
]

// ── 危害词表 → 原文关键词 ─────────────────────────────────────────────────────
/**
 * 每个危害枚举值对应的原文关键词。hazards 是"原文明确写出的危险结果"，
 * 所以模型给出的每个危害都必须在**源 chunk 原文**里找得到依据，找不到就剔除并记 dropped_hazards。
 * 'other' 是词表兜底位（"其它"），没有专属关键词，故恒保留 —— 它本身就是"不属于以上任何一类"的表达。
 * 注意 heat 只认"放热"语义（放热/发热/放出大量热/产生热量），**不认"高温/加热"**：
 * 后者是条件（该进 conditions），不是危险结果。混在一起会把"在高温下"错记成"放热"。
 */
export const HAZARD_KEYWORDS: Readonly<Record<Hazard, readonly string[]>> = {
  heat: ['放热', '发热', '放出大量热', '放出热量', '产生热量'],
  fire: ['着火', '燃烧', '火灾', '起火'],
  explosion: ['爆炸', '爆燃'],
  toxic_gas: ['有毒', '毒气', '剧毒'],
  flammable_gas: ['易燃气体', '可燃气体', '易燃蒸气', '易燃蒸汽'],
  pressure: ['压力', '爆沸', '超压'],
  polymerization: ['聚合'],
  decomposition: ['分解'],
  other: [],
}

// ── 否定句 ────────────────────────────────────────────────────────────────────
/**
 * 否定表述。命中即整条丢弃（NEGATED_RELATION）："与碱不发生反应"绝不许变成"与碱禁配"。
 * 为什么整条丢而不是本地摘掉否定词：中文否定有作用域歧义（"不与酸反应，但与碱剧烈反应"），
 * 靠正则判断"否定管到哪"必然出错；错的方向还是"把否定读成肯定"，最危险的那种。
 * 代价：同一句里既有否定又有肯定的证据会被整条丢掉 —— 那是**漏**，漏是安全的；
 * 让模型按第 3 条规则只引"与碱剧烈反应"这一段的原文，才是正确的修法。
 */
const NEGATION_PATTERNS: readonly RegExp[] = [
  /不反应/,
  /(不|无|未|没有)[^，。；;、,!?！？]{0,6}(反应|分解|聚合|燃烧|爆炸|危险)/,
  /(反应|分解|聚合|燃烧|爆炸)[^，。；;、,!?！？]{0,4}(不会发生|不发生|不会|不成)/,
]

export function isNegated(text: string): boolean {
  return NEGATION_PATTERNS.some(re => re.test(text))
}

/** "无资料/未提及/暂无数据"这类**无信息**表述：它在原文里真实存在，但什么也没说，不是关系 */
const NO_INFO_RE = /(无|没有|未|暂无|缺乏)[^，。；;、]{0,3}(相关)?(资料|数据|信息|内容|记载|说明|提及)|不适用|not\s*available|no\s*data/i

export function isNoInformation(text: string): boolean {
  return NO_INFO_RE.test(text)
}

// ── 条件短语 ──────────────────────────────────────────────────────────────────
/**
 * 条件短语抽取（规则 5 的确定性兜底）：原文写"在高温下""遇水时"，就必须落进 conditions，
 * 不许只留在自由文本里。模型自己填的 conditions 优先；填了空数组而证据里明明有条件短语时，
 * 由这里从**证据原文**里原样摘出来回填（是抄原文，不是补常识），并记 backfilled_conditions。
 */
const CONDITION_PATTERNS: readonly RegExp[] = [
  /在[^，。；;、\n]{1,16}?(?:条件下|情况下|环境下|作用下|下|时)/g,
  /当[^，。；;、\n]{1,14}?(?:时|下)/g,
  /有[^，。；;、\n]{0,10}?(?:存在|共存)(?:时)?/g,
  /(?:遇|接触)(?:水|酸|碱|潮|湿|空气|光|热|明火)[^，。；;、\n]{0,4}?时?/g,
  /(?:加热|受热|高温|低温|冷冻|冷却|避光|光照|阳光|干燥|潮湿|通风|密闭|惰性气氛|氮气保护|明火|火焰)/g,
  /(?:高于|低于|超过|不超过)\s*\d+\s*(?:℃|°C|度|摄氏度)/g,
]

export function extractConditionPhrases(text: string): string[] {
  const found: { phrase: string; start: number }[] = []
  for (const re of CONDITION_PATTERNS) {
    for (const m of text.matchAll(re)) if (m[0].trim()) found.push({ phrase: m[0], start: m.index ?? 0 })
  }
  // 去重叠：长短语优先（"在高温下" 命中之后，不该再补一个被它包住的 "高温"）。
  // 不做这步，conditions 里会塞进一堆同义碎片，人审看到的是噪声而不是条件。
  found.sort((a, b) => b.phrase.length - a.phrase.length || a.start - b.start)
  const kept: { phrase: string; start: number; end: number }[] = []
  for (const f of found) {
    const end = f.start + f.phrase.length
    if (kept.some(k => f.start < k.end && end > k.start)) continue
    kept.push({ phrase: f.phrase, start: f.start, end })
  }
  kept.sort((a, b) => a.start - b.start)
  return kept.map(k => k.phrase.trim())
}

// ── 单项校验 ──────────────────────────────────────────────────────────────────
export interface ValidateOptions {
  /** 单条证据最多承载几条候选（防止模型在一句话上刷出一堆重复关系）；默认 4 */
  maxPerEvidence?: number
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const asStr = (v: unknown): string => (typeof v === 'string' ? v : '')

/** 把 LLM 的宽松输出整理成严格 schema 的入参：只补"缺省即空"的字段，绝不补语义 */
function toStrictInput(item: Record<string, unknown>): Record<string, unknown> {
  return {
    subject_name: asStr(item.subject_name),
    subject_cas: item.subject_cas === undefined || item.subject_cas === null || item.subject_cas === '' ? null : asStr(item.subject_cas),
    subject_kind: item.subject_kind,
    relation_type: item.relation_type,
    object_name: asStr(item.object_name),
    object_cas: item.object_cas === undefined || item.object_cas === null || item.object_cas === '' ? null : asStr(item.object_cas),
    object_kind: item.object_kind,
    conditions: Array.isArray(item.conditions) ? item.conditions.filter(c => typeof c === 'string' && c.trim()) : null,
    hazards: Array.isArray(item.hazards) ? item.hazards : [],
    // severity 缺失 = 原文未评估（枚举里的 'unknown' 就是干这个的），不是"不危险"
    severity: item.severity === undefined || item.severity === null || item.severity === '' ? 'unknown' : item.severity,
    evidence_quote: asStr(item.evidence_quote),
    confidence: typeof item.confidence === 'number' ? item.confidence : null,
  }
}

/** 危害的原文依据过滤：源 chunk 原文里找不到关键词的危害一律剔除（记 dropped_hazards） */
export function filterSupportedHazards(hazards: readonly Hazard[], sourceText: string): { kept: Hazard[]; dropped: Hazard[] } {
  const kept: Hazard[] = []
  const dropped: Hazard[] = []
  for (const h of hazards) {
    const kws = HAZARD_KEYWORDS[h] ?? []
    if (!kws.length || kws.some(k => sourceText.includes(k))) kept.push(h)
    else dropped.push(h)
  }
  return { kept, dropped }
}

/** 名称归一化后是否命中类别词表（精确匹配，理由见 CATEGORY_VOCAB 注释） */
export function isCategoryName(name: string): boolean {
  return CATEGORY_VOCAB.includes(normalizeEntityName(name))
}

/** 是否是没有任何可查对象的占位泛称 */
export function isGenericEntityName(name: string): boolean {
  return GENERIC_ENTITY_NAMES.includes(normalizeEntityName(name))
}

/**
 * 实体名是否在源 chunk 原文里出现过。
 * 比对用 normalizeEntityName（NFKC + 去空白 + 小写 + 括号/连字符统一）—— 它抹掉的只是
 * "全角半角/空格"这类无意义差异，字符本身没变；**它不是同义词归并**（乙醇 ≠ 无水乙醇）。
 * 这一步是拦"模型凭常识补出来的实体"：原文没写过的东西，规范化后也找不到。
 */
export function entityAppearsInSource(name: string, sourceText: string): boolean {
  const n = normalizeEntityName(name)
  if (!n) return false
  return normalizeEntityName(sourceText).includes(n)
}

interface EntityCheck {
  ref: EntityRef | null
  rejection?: { code: RejectionCode; detail: string }
  note?: NormalizationNote
}

/** 单个实体的校验与归一化（kind 纠正 → 泛称/类别/原文/CAS 四道闸 → 拼出 EntityRef） */
function checkEntity(
  rawName: string,
  rawCas: string | null,
  rawKind: string,
  sourceText: string,
  side: 'subject' | 'object',
): EntityCheck {
  const name = rawName.trim()
  if (isGenericEntityName(name)) {
    return { ref: null, rejection: { code: 'GENERIC_ENTITY', detail: `${side} 是占位泛称「${name}」，没有可查对象` } }
  }
  if (!entityAppearsInSource(name, sourceText)) {
    return { ref: null, rejection: { code: 'ENTITY_NOT_IN_SOURCE', detail: `${side} 名「${name}」未在源 chunk 原文出现（疑似常识补全）` } }
  }

  // 类别判定优先于模型自己的标注：名字是类别词表里的词，就按类别处理（规则 4）
  let kind: EntityRef['kind'] = rawKind === 'category' ? 'category' : 'reagent'
  let cas = rawCas
  let note: NormalizationNote | undefined
  if (isCategoryName(name)) {
    if (kind !== 'category' || cas) {
      kind = 'category'
      cas = null
      note = 'coerced_category'
    }
  } else if (kind === 'category' && cas) {
    return { ref: null, rejection: { code: 'CATEGORY_WITH_CAS', detail: `${side} 判为类别却带 CAS ${cas}：类别是没有 CAS 的抽象实体` } }
  }
  if (kind === 'category') cas = null

  if (cas !== null) {
    if (!casCheckDigitOk(cas)) {
      return { ref: null, rejection: { code: 'CAS_CHECK_DIGIT_FAIL', detail: `${side} CAS ${cas} 校验位不通过（错编号=事故）` } }
    }
    if (!sourceText.includes(cas)) {
      return { ref: null, rejection: { code: 'CAS_NOT_IN_SOURCE', detail: `${side} CAS ${cas} 未在源 chunk 原文出现（疑似常识补全）` } }
    }
  }

  if (!normalizeEntityName(name)) {
    return { ref: null, rejection: { code: 'ENTITY_INVALID', detail: `${side} 名「${rawName}」规范化后为空` } }
  }
  return { ref: { kind, name, cas }, ...(note ? { note } : {}) }
}

/**
 * 校验一批 LLM 输出。返回"能进候选表的关系"与"被拒明细"。
 *
 * 判定顺序即语义，改动前先想清楚（前面的失败会短路后面的）：
 *   证据存在/长度 → 形状与枚举 → 证据在场 → 有信息 → 非否定 → 实体 → CAS → 危害 → 条件 → 键 → 自反
 * 说明：证据类检查**先于** strict schema 解析，是为了让"引文被改写"拿到 EVIDENCE_* 这个更准的码，
 * 而不是被笼统地记成 SCHEMA_INVALID。
 */
export function validateRelations(raw: unknown, sourceText: string, opts: ValidateOptions = {}): ValidationOutcome {
  const maxPerEvidence = opts.maxPerEvidence ?? 4
  const accepted: ValidatedRelation[] = []
  const rejections: RelationRejection[] = []
  const items = isRecord(raw) && Array.isArray(raw.relations) ? (raw.relations as unknown[]) : []
  const perEvidence = new Map<string, number>()

  items.forEach((item, index) => {
    const reject = (code: RejectionCode, detail: string) => rejections.push({ index, code, detail })
    if (!isRecord(item)) return reject('SCHEMA_INVALID', '条目不是对象')

    // ① 证据本身（用原样比对，理由见文件头）
    const quote = asStr(item.evidence_quote)
    if (!quote) return reject('EVIDENCE_EMPTY', 'evidence_quote 为空')
    if (quote.length < MIN_EVIDENCE_CHARS) return reject('EVIDENCE_TOO_SHORT', `证据仅 ${quote.length} 字符：${JSON.stringify(quote)}`)
    if (quote.length > MAX_EVIDENCE_CHARS) return reject('EVIDENCE_TOO_LONG', `证据 ${quote.length} 字符超上限 ${MAX_EVIDENCE_CHARS}`)
    if (!sourceText.includes(quote)) {
      return reject('EVIDENCE_NOT_IN_SOURCE', `证据不是源 chunk 的连续原文片段：${JSON.stringify(quote.slice(0, 80))}`)
    }
    const seen = perEvidence.get(quote) ?? 0
    if (seen >= maxPerEvidence) return reject('SCHEMA_INVALID', `同一句证据承载的关系超过 ${maxPerEvidence} 条`)
    perEvidence.set(quote, seen + 1)

    // ② 形状与枚举（severity/relation_type/kind/hazards 越界都在这里被拒）
    const parsed = strictRelationSchema.safeParse(toStrictInput(item))
    if (!parsed.success) {
      const first = parsed.error.issues[0]
      return reject('SCHEMA_INVALID', `${first?.path.join('.') ?? '?'}: ${first?.message ?? '形状不合法'}`)
    }
    const rel = parsed.data

    // ③ 语义安全闸
    if (isNoInformation(quote)) return reject('NO_INFORMATION', `证据是无信息表述：${JSON.stringify(quote.slice(0, 60))}`)
    if (isNegated(quote)) return reject('NEGATED_RELATION', `证据含否定表述，绝不许抽成禁配：${JSON.stringify(quote.slice(0, 60))}`)

    // ④ 两个实体
    const subj = checkEntity(rel.subject_name, rel.subject_cas, rel.subject_kind, sourceText, 'subject')
    if (!subj.ref) return reject(subj.rejection!.code, subj.rejection!.detail)
    const obj = checkEntity(rel.object_name, rel.object_cas, rel.object_kind, sourceText, 'object')
    if (!obj.ref) return reject(obj.rejection!.code, obj.rejection!.detail)

    // ⑤ 危害：原文找不到依据的剔除（可见，不静默）
    const { kept, dropped } = filterSupportedHazards(rel.hazards, sourceText)

    // ⑥ 条件：原文有条件短语而模型没填 → 从证据里原样回填
    const notes: NormalizationNote[] = []
    if (subj.note) notes.push(subj.note)
    if (obj.note) notes.push(obj.note)
    if (dropped.length) notes.push('dropped_hazards')
    let phrases = rel.conditions ?? []
    if (!phrases.length) {
      const found = extractConditionPhrases(quote)
      if (found.length) {
        phrases = found
        notes.push('backfilled_conditions')
      }
    }
    if (rel.relation_type === 'conditionally_compatible' && !phrases.length) {
      return reject('MISSING_CONDITIONS', 'conditionally_compatible 却给不出任何条件：没有条件的"条件共存"读出来就是"可以共存"')
    }

    // ⑦ 实体键（对称排序与幂等键交给 keys.ts；这里只确认能算出来，且不是自反关系）
    let subjectKey: string
    let objectKey: string
    try {
      subjectKey = entityKeyOf(subj.ref)
      objectKey = entityKeyOf(obj.ref)
    } catch (e) {
      return reject('KEY_INVALID', `实体键算不出来：${(e as Error).message}`)
    }
    if (subjectKey === objectKey) {
      return reject('SELF_RELATION', `同一实体与自身构成关系：${subjectKey}`)
    }

    accepted.push({
      relationType: rel.relation_type,
      subject: subj.ref,
      object: obj.ref,
      severity: rel.severity as Severity,
      hazards: kept,
      conditions: phrases.length ? { text: phrases } : null,
      confidence: rel.confidence,
      evidenceText: quote,
      notes: [...new Set(notes)],
    })
  })

  return { accepted, rejections }
}

/** 校验结果的计数汇总（进抽取台账的 reject_json / note_json 用） */
export function summarizeValidation(out: ValidationOutcome): {
  rejections: Partial<Record<RelationRejection['code'], number>>
  notes: Partial<Record<NormalizationNote, number>>
} {
  const rejections: Partial<Record<RelationRejection['code'], number>> = {}
  for (const r of out.rejections) rejections[r.code] = (rejections[r.code] ?? 0) + 1
  const notes: Partial<Record<NormalizationNote, number>> = {}
  for (const a of out.accepted) for (const n of a.notes) notes[n] = (notes[n] ?? 0) + 1
  return { rejections, notes }
}
