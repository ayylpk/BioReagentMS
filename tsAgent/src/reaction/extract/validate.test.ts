// 确定性校验的离线单测 —— 本任务的安全网（没有真环境可依赖时，它是唯一能"证明"行为的东西）
//
// 覆盖口径：用户点名的每一条（明确禁配 / 类别禁配 / 条件句 / 否定句 / 无关系 / 虚构 CAS /
//   引文不在原文）各一例，外加契约一致性断言（危害词表 ↔ 提示词、枚举 ↔ CATEGORY_VOCAB）。
// 纪律：所有源文本都是**从真实语料写法里摘的样式**（ICSC 卡/SDS 第 10 节的句式），
//   不用"甲与乙反应"这种玩具句 —— 玩具句测不出"避免与强氧化剂接触"里的空格式差别。
import { describe, expect, test } from 'bun:test'
import { HAZARDS } from '../types'
import { HAZARD_VOCABULARY } from './prompt'
import {
  CATEGORY_VOCAB,
  HAZARD_KEYWORDS,
  MAX_EVIDENCE_CHARS,
  entityAppearsInSource,
  extractConditionPhrases,
  filterSupportedHazards,
  isCategoryName,
  isGenericEntityName,
  isNegated,
  isNoInformation,
  summarizeValidation,
  validateRelations,
} from './validate'
import type { RejectionCode } from './types'

// ── 源文本（每条测试自带一份，避免互相污染）────────────────────────────────────
const SRC_FULL = '硫酸（CAS 7664-93-9）｜10 稳定性和反应性 本品与氢氧化钠（CAS 1310-73-2）剧烈反应，放出大量热，并生成有毒气体。'
const SRC_CAT = '硫酸（CAS 7664-93-9）｜7 操作处置与储存 须与碱类分开存放，避免与强氧化剂接触。'
const SRC_CATCAS = '硫酸（CAS 7664-93-9）｜7 操作处置与储存 避免与聚合引发剂（CAS 7732-18-5）接触。'
const SRC_COND = '硫酸（CAS 7664-93-9）｜10 稳定性和反应性 在高温下与还原剂剧烈反应。'
const SRC_COEXIST = '硫酸（CAS 7664-93-9）｜本品可与水共存。'
const SRC_NEG = '硫酸（CAS 7664-93-9）｜10 稳定性和反应性 本品与碱不发生反应。'
const SRC_NOINFO = '硫酸（CAS 7664-93-9）｜10 稳定性和反应性 该物质无相关资料。'
const SRC_GENERIC = '硫酸（CAS 7664-93-9）｜与不相容物质接触，有着火和爆炸的危险。'

/** 一条"看着对"的 LLM 输出，各测试只覆盖自己关心的字段 */
const rel = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  subject_name: '硫酸',
  subject_cas: '7664-93-9',
  subject_kind: 'reagent',
  relation_type: 'incompatible',
  object_name: '氢氧化钠',
  object_cas: '1310-73-2',
  object_kind: 'reagent',
  conditions: [],
  hazards: ['heat', 'toxic_gas'],
  severity: 'high',
  evidence_quote: '本品与氢氧化钠（CAS 1310-73-2）剧烈反应，放出大量热，并生成有毒气体。',
  confidence: 0.9,
  ...over,
})

const codes = (out: ReturnType<typeof validateRelations>): RejectionCode[] => out.rejections.map(r => r.code)

describe('validate：明确禁配（正向路径必须通）', () => {
  test('原文明确写出的禁配关系 → 收下，且字段逐项落到候选形状上', () => {
    const out = validateRelations({ relations: [rel()] }, SRC_FULL)
    expect(out.rejections).toEqual([])
    expect(out.accepted).toHaveLength(1)
    const a = out.accepted[0]!
    expect(a.relationType).toBe('incompatible')
    expect(a.subject).toEqual({ kind: 'reagent', name: '硫酸', cas: '7664-93-9' })
    expect(a.object).toEqual({ kind: 'reagent', name: '氢氧化钠', cas: '1310-73-2' })
    expect(a.severity).toBe('high')
    expect(a.hazards).toEqual(['heat', 'toxic_gas'])
    expect(a.evidenceText).toBe('本品与氢氧化钠（CAS 1310-73-2）剧烈反应，放出大量热，并生成有毒气体。')
    expect(a.confidence).toBe(0.9)
    expect(a.conditions).toBeNull()
    expect(a.notes).toEqual([])
  })

  test('同一句证据承载的多条关系各自成条；不同证据互不覆盖（幂等键按证据区分的前提）', () => {
    const a = rel()
    const b = rel({ relation_type: 'storage_separate', evidence_quote: '本品与氢氧化钠（CAS 1310-73-2）剧烈反应，放出大量热，并生成有毒气体。' })
    const out = validateRelations({ relations: [a, b] }, SRC_FULL)
    expect(out.accepted).toHaveLength(2)
    expect(new Set(out.accepted.map(x => x.evidenceText)).size).toBe(1)
  })

  test('同一句证据刷出太多关系 → 超出上限的被拒（可见，不静默）', () => {
    const out = validateRelations({ relations: [rel(), rel()] }, SRC_FULL, { maxPerEvidence: 1 })
    expect(out.accepted).toHaveLength(1)
    expect(codes(out)).toEqual(['SCHEMA_INVALID'])
  })
})

describe('validate：类别关系与具体物质关系必须分开', () => {
  test('"避免与强氧化剂接触" → object_kind=category，且不许虚构具体物质清单', () => {
    const out = validateRelations(
      { relations: [rel({ relation_type: 'storage_separate', object_name: '强氧化剂', object_kind: 'category', object_cas: null, hazards: [], evidence_quote: '避免与强氧化剂接触。' })] },
      SRC_CAT,
    )
    expect(out.rejections).toEqual([])
    expect(out.accepted[0]!.object).toEqual({ kind: 'category', name: '强氧化剂', cas: null })
    expect(out.accepted[0]!.notes).toEqual([])
  })

  test('模型把"强氧化剂"标成 reagent → 确定性纠正为 category 并留痕 coerced_category', () => {
    const out = validateRelations(
      { relations: [rel({ relation_type: 'storage_separate', object_name: '强氧化剂', object_kind: 'reagent', object_cas: null, hazards: [], evidence_quote: '避免与强氧化剂接触。' })] },
      SRC_CAT,
    )
    expect(out.accepted).toHaveLength(1)
    expect(out.accepted[0]!.object.kind).toBe('category')
    expect(out.accepted[0]!.notes).toContain('coerced_category')
  })

  test('"碱类"（类别）与"氢氧化钠"（物质）是两个实体：前者不许被当成后者的别名', () => {
    const out = validateRelations(
      { relations: [rel({ relation_type: 'storage_separate', object_name: '碱类', object_kind: 'category', object_cas: null, hazards: [], evidence_quote: '须与碱类分开存放，' })] },
      SRC_CAT,
    )
    expect(out.accepted[0]!.object).toEqual({ kind: 'category', name: '碱类', cas: null })
    // 硫酸是具体物质，且 '酸' 是类别词 —— 精确匹配保证它不被降级成类别
    expect(out.accepted[0]!.subject).toEqual({ kind: 'reagent', name: '硫酸', cas: '7664-93-9' })
  })

  test('类别却带 CAS → CATEGORY_WITH_CAS（自相矛盾，拒绝）', () => {
    const out = validateRelations(
      { relations: [rel({ object_name: '聚合引发剂', object_kind: 'category', object_cas: '7732-18-5', hazards: [], evidence_quote: '避免与聚合引发剂（CAS 7732-18-5）接触。' })] },
      SRC_CATCAS,
    )
    expect(codes(out)).toEqual(['CATEGORY_WITH_CAS'])
  })

  test('CATEGORY_VOCAB 是精确匹配词表：具体物质名不许被误判成类别', () => {
    expect(isCategoryName('强氧化剂')).toBe(true)
    expect(isCategoryName('氧化剂')).toBe(true)
    expect(isCategoryName('硫酸')).toBe(false) // 含"酸"但不是类别词本身
    expect(isCategoryName('氢氧化钠')).toBe(false)
    expect(CATEGORY_VOCAB).toContain('强碱')
  })
})

describe('validate：条件句必须落进 conditions', () => {
  test('"在高温下"必须写进 conditions，不许只留在自由文本里（模型没填则从证据原文回填）', () => {
    const out = validateRelations(
      { relations: [rel({ object_name: '还原剂', object_kind: 'category', object_cas: null, conditions: [], hazards: [], evidence_quote: '在高温下与还原剂剧烈反应。' })] },
      SRC_COND,
    )
    expect(out.rejections).toEqual([])
    const a = out.accepted[0]!
    expect(a.conditions).not.toBeNull()
    expect(a.conditions!.text).toEqual(['在高温下'])
    expect(a.notes).toContain('backfilled_conditions')
  })

  test('模型自己填了条件 → 原样保留，不回填、不留痕', () => {
    const out = validateRelations(
      { relations: [rel({ object_name: '还原剂', object_kind: 'category', object_cas: null, conditions: ['在高温下'], hazards: [], evidence_quote: '在高温下与还原剂剧烈反应。' })] },
      SRC_COND,
    )
    expect(out.accepted[0]!.conditions).toEqual({ text: ['在高温下'] })
    expect(out.accepted[0]!.notes).toEqual([])
  })

  test('conditionally_compatible 却给不出任何条件 → MISSING_CONDITIONS', () => {
    const out = validateRelations(
      { relations: [rel({ relation_type: 'conditionally_compatible', object_name: '水', object_cas: null, conditions: null, hazards: [], evidence_quote: '可与水共存。' })] },
      SRC_COEXIST,
    )
    expect(codes(out)).toEqual(['MISSING_CONDITIONS'])
  })

  test('conditionally_compatible 且证据里有条件短语 → 回填后放行（不是靠"猜"）', () => {
    const out = validateRelations(
      { relations: [rel({ relation_type: 'conditionally_compatible', object_name: '还原剂', object_kind: 'category', object_cas: null, conditions: [], hazards: [], evidence_quote: '在高温下与还原剂剧烈反应。' })] },
      SRC_COND,
    )
    expect(out.accepted).toHaveLength(1)
    expect(out.accepted[0]!.conditions).toEqual({ text: ['在高温下'] })
  })

  test('条件短语抽取：常见问法都要认出来', () => {
    expect(extractConditionPhrases('在高温下')).toEqual(['在高温下'])
    expect(extractConditionPhrases('遇水时，放出气体')).toContain('遇水时')
    expect(extractConditionPhrases('有水存在时，与铝发生反应')).toContain('有水存在时')
    expect(extractConditionPhrases('加热时分解')).toContain('加热')
    expect(extractConditionPhrases('高于300℃时分解')).toContain('高于300℃')
  })
})

describe('validate：否定句绝不产生禁配候选', () => {
  test('"与碱不发生反应" → NEGATED_RELATION', () => {
    const out = validateRelations(
      { relations: [rel({ object_name: '碱', object_kind: 'category', object_cas: null, hazards: [], evidence_quote: '本品与碱不发生反应。' })] },
      SRC_NEG,
    )
    expect(codes(out)).toEqual(['NEGATED_RELATION'])
  })

  test('否定判定只认"反应/分解/聚合/燃烧/爆炸/危险"这类结果词：禁配指令不是否定', () => {
    expect(isNegated('本品与碱不发生反应')).toBe(true)
    expect(isNegated('不与水反应')).toBe(true)
    expect(isNegated('正常情况下无危险反应')).toBe(true)
    expect(isNegated('与强氧化剂剧烈反应')).toBe(false)
    expect(isNegated('不得与食品和饲料一起运输')).toBe(false) // 禁止性要求 ≠ 否定
    expect(isNegated('避免与氧化剂接触')).toBe(false)
  })

  test('同一句里既有否定又有肯定 → 整条丢弃（宁可漏，不可把否定读成肯定）', () => {
    expect(isNegated('不与酸反应，但与碱剧烈反应')).toBe(true)
  })
})

describe('validate：无关系 / 无资料', () => {
  test('LLM 返回空数组是合法结果（0 条候选 ≠ 安全）', () => {
    const out = validateRelations({ relations: [] }, SRC_FULL)
    expect(out.accepted).toEqual([])
    expect(out.rejections).toEqual([])
    expect(summarizeValidation(out)).toEqual({ rejections: {}, notes: {} })
  })

  test('"无资料/未提及"这类无信息表述 → NO_INFORMATION（它只是没写，不是"没危险"）', () => {
    const out = validateRelations(
      { relations: [rel({ object_name: '氢氧化钠', hazards: [], evidence_quote: '该物质无相关资料。' })] },
      SRC_NOINFO,
    )
    expect(codes(out)).toEqual(['NO_INFORMATION'])
    expect(isNoInformation('该物质无相关资料。')).toBe(true)
    expect(isNoInformation('本品与氢氧化钠剧烈反应。')).toBe(false)
  })

  test('输入形状完全不对（null / relations 不是数组）→ 0 收 0 拒，不上抛', () => {
    expect(validateRelations(null, SRC_FULL)).toEqual({ accepted: [], rejections: [] })
    expect(validateRelations({ relations: 'nope' }, SRC_FULL)).toEqual({ accepted: [], rejections: [] })
    expect(validateRelations({ relations: [42] }, SRC_FULL).rejections.map(r => r.code)).toEqual(['SCHEMA_INVALID'])
  })
})

describe('validate：证据必须是源 chunk 的原始连续子串', () => {
  test('把原文里的"（CAS …）"顺手删掉 → EVIDENCE_NOT_IN_SOURCE（疑似改写）', () => {
    const out = validateRelations(
      { relations: [rel({ evidence_quote: '本品与氢氧化钠剧烈反应，放出大量热，并生成有毒气体。' })] },
      SRC_FULL,
    )
    expect(codes(out)).toEqual(['EVIDENCE_NOT_IN_SOURCE'])
  })

  test('把全角括号"规整"成半角 → 同样拒（比对不做任何规范化）', () => {
    const out = validateRelations(
      { relations: [rel({ evidence_quote: '本品与氢氧化钠(CAS 1310-73-2)剧烈反应，放出大量热，并生成有毒气体。' })] },
      SRC_FULL,
    )
    expect(codes(out)).toEqual(['EVIDENCE_NOT_IN_SOURCE'])
  })

  test('证据过短 / 过长分别有专属拒绝码', () => {
    const short = validateRelations({ relations: [rel({ evidence_quote: '遇酸' })] }, SRC_FULL)
    expect(codes(short)).toEqual(['EVIDENCE_TOO_SHORT'])
    const long = validateRelations({ relations: [rel({ evidence_quote: 'x'.repeat(MAX_EVIDENCE_CHARS + 1) })] }, SRC_FULL)
    expect(codes(long)).toEqual(['EVIDENCE_TOO_LONG'])
    const empty = validateRelations({ relations: [rel({ evidence_quote: '' })] }, SRC_FULL)
    expect(codes(empty)).toEqual(['EVIDENCE_EMPTY'])
  })
})

describe('validate：CAS 与实体不许凭常识补', () => {
  test('CAS 未在原文出现 → CAS_NOT_IN_SOURCE', () => {
    const out = validateRelations({ relations: [rel({ object_cas: '7732-18-5', object_name: '氢氧化钠' })] }, SRC_FULL)
    expect(codes(out)).toEqual(['CAS_NOT_IN_SOURCE'])
  })

  test('CAS 校验位不通过 → CAS_CHECK_DIGIT_FAIL（排在"是否在原文"之前，错编号优先暴露）', () => {
    const out = validateRelations({ relations: [rel({ object_cas: '7732-18-4' })] }, SRC_FULL)
    expect(codes(out)).toEqual(['CAS_CHECK_DIGIT_FAIL'])
  })

  test('实体名未在原文出现 → ENTITY_NOT_IN_SOURCE（模型常识补全的实体）', () => {
    const out = validateRelations({ relations: [rel({ object_name: '高锰酸钾', object_cas: null })] }, SRC_FULL)
    expect(codes(out)).toEqual(['ENTITY_NOT_IN_SOURCE'])
  })

  test('实体名比对抹平全角/空白差异，但不做同义词归并', () => {
    expect(entityAppearsInSource('氢氧化钠 ', SRC_FULL)).toBe(true)
    expect(entityAppearsInSource('无水硫酸', SRC_FULL)).toBe(false) // 同义名不自动合并（已知缺口）
  })

  test('占位泛称（"不相容物质"）→ GENERIC_ENTITY：原文里确实有，但没有可查对象', () => {
    const out = validateRelations(
      { relations: [rel({ object_name: '不相容物质', object_cas: null, hazards: ['explosion'], evidence_quote: '与不相容物质接触，有着火和爆炸的危险。' })] },
      SRC_GENERIC,
    )
    expect(codes(out)).toEqual(['GENERIC_ENTITY'])
    expect(isGenericEntityName('不相容物质')).toBe(true)
    expect(isGenericEntityName('氢氧化钠')).toBe(false)
  })

  test('同一实体与自身构成关系 → SELF_RELATION', () => {
    const out = validateRelations({ relations: [rel({ object_name: '硫酸', object_cas: '7664-93-9' })] }, SRC_FULL)
    expect(codes(out)).toEqual(['SELF_RELATION'])
  })
})

describe('validate：形状与枚举越界（含"compatible"被类型层封死）', () => {
  test('severity 越界 → SCHEMA_INVALID', () => {
    const out = validateRelations({ relations: [rel({ severity: 'severe' })] }, SRC_FULL)
    expect(codes(out)).toEqual(['SCHEMA_INVALID'])
  })

  test('relation_type 越界 → SCHEMA_INVALID；"compatible"根本不在允许枚举里', () => {
    const out = validateRelations({ relations: [rel({ relation_type: 'compatible' })] }, SRC_FULL)
    expect(codes(out)).toEqual(['SCHEMA_INVALID'])
  })

  test('hazards 越界 → SCHEMA_INVALID', () => {
    const out = validateRelations({ relations: [rel({ hazards: ['corrosive'] })] }, SRC_FULL)
    expect(codes(out)).toEqual(['SCHEMA_INVALID'])
  })

  test('severity 缺失 → 落成 unknown（未评估），不是"不危险"', () => {
    const out = validateRelations({ relations: [rel({ severity: undefined })] }, SRC_FULL)
    expect(out.accepted[0]!.severity).toBe('unknown')
  })
})

describe('validate：危害必须有原文依据', () => {
  test('原文没写"爆炸"却报 explosion → 剔除并留痕 dropped_hazards', () => {
    const out = validateRelations({ relations: [rel({ hazards: ['explosion', 'heat'] })] }, SRC_FULL)
    expect(out.accepted[0]!.hazards).toEqual(['heat'])
    expect(out.accepted[0]!.notes).toContain('dropped_hazards')
  })

  test('"高温/加热"是条件，不是"放热"危害 —— heat 只认放热语义', () => {
    const { kept, dropped } = filterSupportedHazards(['heat'], SRC_COND)
    expect(kept).toEqual([])
    expect(dropped).toEqual(['heat'])
  })

  test('危害词表与契约枚举一一对应（改契约忘了改这里会红）', () => {
    expect(Object.keys(HAZARD_KEYWORDS).sort()).toEqual([...HAZARDS].sort())
  })

  test('提示词里的危害词表覆盖全部枚举值（模型拿不到词表就会自由发挥，整条被 SCHEMA_INVALID 拒掉）', () => {
    for (const h of HAZARDS) expect(HAZARD_VOCABULARY).toContain(h)
  })
})

describe('validate：拒绝明细可定位、可计数', () => {
  test('rejections 带 index（对应 LLM 返回的下标），计数与明细一致', () => {
    const out = validateRelations({ relations: [rel(), rel({ severity: 'severe' })] }, SRC_FULL)
    expect(out.rejections).toHaveLength(1)
    expect(out.rejections[0]!.index).toBe(1)
    expect(out.rejections[0]!.detail).toContain('severity')
    const sum = summarizeValidation(out)
    expect(sum.rejections).toEqual({ SCHEMA_INVALID: 1 })
  })
})
