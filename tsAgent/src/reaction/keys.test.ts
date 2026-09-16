// 离线单测：规范化 / 实体键 / 对称规范化 / 幂等键 / 证据连续性
// 不连库、不连网、不 import store —— keys.ts 是纯模块，这里就是它的全部规则
import { test, expect } from 'bun:test'
import {
  assertEvidenceContiguous,
  candidateKeyOf,
  entityKeyOf,
  normalizeCas,
  normalizeEntityName,
  normalizeEvidence,
  orderEntityRefs,
  orderPair,
  pairKeyOf,
  ruleKeyOf,
} from './keys'
import { ReactionKeyError } from './errors'

const CAS_硫酸 = '7664-93-9'
const CAS_氢氧化钠 = '1310-73-2'
const CAS_过氧化氢 = '7722-84-1'

test('normalizeEntityName：全角折半角、小写、去空白、括号与连字符统一', () => {
  expect(normalizeEntityName('ＤＭＳＯ')).toBe('dmso')
  expect(normalizeEntityName('二甲基亚砜（DMSO）')).toBe('二甲基亚砜(dmso)')
  expect(normalizeEntityName(' 硫 酸 ')).toBe('硫酸')
  expect(normalizeEntityName('硫\t酸\n钠')).toBe('硫酸钠')
  expect(normalizeEntityName('硫酸【浓】')).toBe('硫酸(浓)')
  expect(normalizeEntityName('硫酸〔浓〕')).toBe('硫酸(浓)')
  expect(normalizeEntityName('硫酸[浓]')).toBe('硫酸(浓)')
  expect(normalizeEntityName('a\u2013b')).toBe('a-b') // EN DASH
  expect(normalizeEntityName('a\u2212b')).toBe('a-b') // MINUS SIGN
  expect(normalizeEntityName('甲醇\u0000')).toBe('甲醇') // 控制符剔除
})

test('normalizeEntityName：括号内容一律保留（"硫酸" 与 "硫酸(浓)" 是两条不同记录）', () => {
  expect(normalizeEntityName('硫酸')).not.toBe(normalizeEntityName('硫酸(浓)'))
  // 括号种类不同但规范化后同指一物 → 必须收敛到同一个键
  expect(normalizeEntityName('硫酸【浓】')).toBe(normalizeEntityName('硫酸（浓）'))
})

test('normalizeEntityName：超长名截断 + 8 位哈希后缀，定长且确定性', () => {
  const long = '甲'.repeat(300)
  const a = normalizeEntityName(long)
  expect(a.length).toBeLessThanOrEqual(240)
  expect(a).toBe(normalizeEntityName(long))                        // 确定性
  expect(a).not.toBe(normalizeEntityName(long.slice(0, 299) + '乙')) // 不同长名不撞
  expect(normalizeEntityName('甲'.repeat(200))).toBe('甲'.repeat(200)) // 边界内不动
})

test('normalizeCas：过校验位才放行，否则抛（错编号会把禁配关系挂到别的试剂上）', () => {
  expect(normalizeCas(' 7664-93-9 ')).toBe(CAS_硫酸)
  expect(normalizeCas('７６６４－９３－９')).toBe(CAS_硫酸) // 全角
  expect(() => normalizeCas('7664-93-8')).toThrow(ReactionKeyError) // 校验位错
  expect(() => normalizeCas('766-93-9')).toThrow(ReactionKeyError)  // 格式错
  expect(() => normalizeCas('')).toThrow(ReactionKeyError)
})

test('entityKeyOf：三类实体键前缀互不重叠，category 与 reagent 绝不混为一物', () => {
  expect(entityKeyOf({ kind: 'reagent', name: '硫酸', cas: CAS_硫酸 })).toBe(`cas:${CAS_硫酸}`)
  expect(entityKeyOf({ kind: 'reagent', name: ' 硫酸 ' })).toBe('name:硫酸')
  expect(entityKeyOf({ kind: 'category', name: '氧化剂' })).toBe('cat:氧化剂')
  // 名字一样但类型不同 → 两个实体（'cat:氧化剂' vs 'name:氧化剂'）
  expect(entityKeyOf({ kind: 'category', name: '氧化剂' })).not.toBe(entityKeyOf({ kind: 'reagent', name: '氧化剂' }))
  // 有 CAS 时名称差异不影响身份（同 CAS 的别名收敛）
  expect(entityKeyOf({ kind: 'reagent', name: '硫酸', cas: CAS_硫酸 })).toBe(
    entityKeyOf({ kind: 'reagent', name: '浓硫酸', cas: CAS_硫酸 }),
  )
  expect(() => entityKeyOf({ kind: 'category', name: '氧化剂', cas: CAS_过氧化氢 })).toThrow(ReactionKeyError)
  expect(() => entityKeyOf({ kind: 'reagent', name: '   ' })).toThrow(ReactionKeyError)
})

test('对称规范化：orderPair 按码元序、确定性；同一实体不许与自己配', () => {
  expect(orderPair('b', 'a')).toEqual(['a', 'b'])
  expect(orderPair('a', 'a')).toEqual(['a', 'a'])
  expect(() => pairKeyOf('cas:1', 'cas:1')).toThrow(ReactionKeyError)
})

test('pairKeyOf：A-B 与 B-A 落成同一个键（四种对称关系共用同一口径）', () => {
  const a = entityKeyOf({ kind: 'reagent', name: '硫酸', cas: CAS_硫酸 })
  const b = entityKeyOf({ kind: 'reagent', name: '氢氧化钠', cas: CAS_氢氧化钠 })
  expect(pairKeyOf(a, b)).toBe(pairKeyOf(b, a))
  // 分隔符是空格：规范化已剥离全部空白 → 拼接无歧义（含空格的键不可能出现）
  expect(pairKeyOf(a, b)).toBe(`cas:${CAS_氢氧化钠} cas:${CAS_硫酸}`)
  expect(pairKeyOf('cat:氧化剂', 'cas:' + CAS_硫酸)).toBe(`cas:${CAS_硫酸} cat:氧化剂`)
})

test('orderEntityRefs：键、显示名、CAS **一起**换位（否则人审页会把名字配错）', () => {
  const 硫酸 = { kind: 'reagent' as const, name: '硫酸', cas: CAS_硫酸 }
  const 氧化剂 = { kind: 'category' as const, name: '氧化剂' }
  const r = orderEntityRefs(硫酸, 氧化剂)
  expect(r.firstKey).toBe(`cas:${CAS_硫酸}`)   // 'cas:' < 'cat:'（'s' < 't'）
  expect(r.secondKey).toBe('cat:氧化剂')
  expect(r.first.name).toBe('硫酸')
  expect(r.second.name).toBe('氧化剂')
  expect(r.pairKey).toBe(`cas:${CAS_硫酸} cat:氧化剂`)
  // 反过来传，结果逐字节相同（对称）
  const r2 = orderEntityRefs(氧化剂, 硫酸)
  expect(r2.first).toEqual(r.first)
  expect(r2.pairKey).toBe(r.pairKey)
})

test('candidateKeyOf：确定性 + 各字段都真的在起作用', () => {
  const base = {
    relationType: 'incompatible' as const,
    pairKey: `cas:${CAS_氢氧化钠} cas:${CAS_硫酸}`,
    sourceDocId: 'chemistry__硫酸',
    sourceChunkSeq: 7,
    evidenceQuote: '本品与强碱剧烈反应。',
  }
  expect(candidateKeyOf(base)).toBe(candidateKeyOf(base))
  expect(candidateKeyOf(base)).toMatch(/^[0-9a-f]{40}$/)
  expect(candidateKeyOf({ ...base, relationType: 'storage_separate' })).not.toBe(candidateKeyOf(base))
  expect(candidateKeyOf({ ...base, sourceChunkSeq: 8 })).not.toBe(candidateKeyOf(base))
  expect(candidateKeyOf({ ...base, sourceDocId: 'chemistry__盐酸' })).not.toBe(candidateKeyOf(base))
  expect(candidateKeyOf({ ...base, evidenceQuote: '本品与强碱发生中和。' })).not.toBe(candidateKeyOf(base))
})

test('candidateKeyOf：证据只折叠无意义空白差异（重排换行不产生新候选）', () => {
  const base = {
    relationType: 'incompatible' as const,
    pairKey: 'a b',
    sourceDocId: 'd',
    sourceChunkSeq: 1,
    evidenceQuote: '与碱 剧烈\n反应',
  }
  expect(candidateKeyOf(base)).toBe(candidateKeyOf({ ...base, evidenceQuote: '与碱   剧烈 反应' }))
  expect(candidateKeyOf(base)).toBe(candidateKeyOf({ ...base, evidenceQuote: '  与碱 剧烈 反应  ' }))
  expect(normalizeEvidence('与碱　剧烈（全角空格）')).toBe('与碱 剧烈(全角空格)')
})

test('candidateKeyOf：字段含换行直接抛（保证换行拼接是单射，不靠运气）', () => {
  const base = {
    relationType: 'incompatible' as const,
    pairKey: 'a b',
    sourceDocId: 'd',
    sourceChunkSeq: 1,
    evidenceQuote: 'e',
  }
  expect(() => candidateKeyOf({ ...base, sourceDocId: 'd\n1' })).toThrow(ReactionKeyError)
  expect(() => candidateKeyOf({ ...base, pairKey: 'a\nb' })).toThrow(ReactionKeyError)
})

test('ruleKeyOf：只认 (关系类型, 物质对)，不含证据（同一对物质允许多条证据）', () => {
  const pair = `cas:${CAS_氢氧化钠} cas:${CAS_硫酸}`
  expect(ruleKeyOf('incompatible', pair)).toBe(ruleKeyOf('incompatible', pair))
  expect(ruleKeyOf('incompatible', pair)).not.toBe(ruleKeyOf('storage_separate', pair))
  expect(ruleKeyOf('incompatible', pair)).not.toBe(ruleKeyOf('incompatible', `cat:碱 ${pair}`))
})

test('assertEvidenceContiguous：必须是原文连续片段，改写/拼接一律拦下', () => {
  const chunk = '10 稳定性和反应性\n本品与强碱剧烈反应，放出大量热。须与氧化剂分开存放。'
  expect(() => assertEvidenceContiguous('本品与强碱剧烈反应，放出大量热。', chunk)).not.toThrow()
  expect(() => assertEvidenceContiguous('本品与强碱反应', chunk)).toThrow(ReactionKeyError)   // 少了字
  expect(() => assertEvidenceContiguous('本品与碱剧烈反应', chunk)).toThrow(ReactionKeyError) // 改写
  expect(() => assertEvidenceContiguous('', chunk)).toThrow(ReactionKeyError)
})
