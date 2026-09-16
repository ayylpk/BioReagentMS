// 离线单测：zod DTO 运行时校验 + 契约与 DDL 的一致性（不连库）
// 最后两个用例把 types.ts 的枚举、迁移脚本的纪律钉在一起：改了任一边都会红。
import { test, expect } from 'bun:test'
import { readFileSync } from 'node:fs'
import {
  CANDIDATE_REVIEW_STATUSES,
  CANDIDATE_SOURCE_STATES,
  DIRECTION_SEMANTICS,
  ENTITY_KINDS,
  HAZARDS,
  RELATION_TYPES,
  RULE_SOURCE_STATES,
  RULE_STATUSES,
  SEVERITIES,
  candidateListQuerySchema,
  publishRuleInputSchema,
  reactionCandidateInputSchema,
  reviewDecisionSchema,
} from './types'

const CAS_硫酸 = '7664-93-9'
const CAS_氢氧化钠 = '1310-73-2'

const validInput = () => ({
  relationType: 'incompatible',
  subject: { kind: 'reagent', name: '硫酸', cas: CAS_硫酸 },
  object: { kind: 'reagent', name: '氢氧化钠', cas: CAS_氢氧化钠 },
  severity: 'high',
  hazards: ['heat'],
  confidence: 0.9,
  evidenceText: '本品与强碱剧烈反应。',
  extractorVersion: 'react-extract/0.1.0',
  runId: 'run-2026-09-14',
  source: { docId: 'chemistry__硫酸', chunkSeq: 3 },
})

test('reactionCandidateInputSchema：合法输入通过，可省字段由默认值补齐', () => {
  const p = reactionCandidateInputSchema.parse(validInput())
  expect(p.hazards).toEqual(['heat'])
  expect(p.confidence).toBe(0.9)

  const minimal = validInput()
  const { severity, hazards, confidence, ...rest } = minimal
  const m = reactionCandidateInputSchema.parse(rest)
  expect(m.severity).toBe('unknown')  // 未评估 ≠ 不危险，但必须显式落成 unknown
  expect(m.hazards).toEqual([])
  expect(m.conditions).toBeNull()
  expect(m.confidence).toBeNull()
})

test('reactionCandidateInputSchema：枚举/取值越界一律拒绝', () => {
  expect(() => reactionCandidateInputSchema.parse({ ...validInput(), relationType: 'compatible' })).toThrow()
  expect(() => reactionCandidateInputSchema.parse({ ...validInput(), severity: 'fatal' })).toThrow()
  expect(() => reactionCandidateInputSchema.parse({ ...validInput(), hazards: ['toxic'] })).toThrow()
  expect(() => reactionCandidateInputSchema.parse({ ...validInput(), confidence: 1.5 })).toThrow()
  expect(() => reactionCandidateInputSchema.parse({ ...validInput(), confidence: -0.1 })).toThrow()
  expect(() => reactionCandidateInputSchema.parse({ ...validInput(), extractorVersion: '' })).toThrow()
  expect(() => reactionCandidateInputSchema.parse({ ...validInput(), runId: '' })).toThrow()
  expect(() => reactionCandidateInputSchema.parse({ ...validInput(), evidenceText: '' })).toThrow()
})

test('reactionCandidateInputSchema：实体类型与 CAS 的硬规则', () => {
  // category 带 CAS → 拒（类别是没有 CAS 的抽象实体）
  expect(() => reactionCandidateInputSchema.parse({
    ...validInput(),
    subject: { kind: 'category', name: '碱', cas: CAS_氢氧化钠 },
  })).toThrow()
  // CAS 校验位错 → 拒
  expect(() => reactionCandidateInputSchema.parse({
    ...validInput(),
    subject: { kind: 'reagent', name: '硫酸', cas: '7664-93-8' },
  })).toThrow()
  // 无 CAS 的 reagent 允许（走 name: 键）
  const p = reactionCandidateInputSchema.parse({
    ...validInput(),
    subject: { kind: 'reagent', name: '未知混合物' },
  })
  expect(p.subject.cas).toBeUndefined()
})

test('reactionCandidateInputSchema：conditionally_compatible 必须带条件', () => {
  expect(() => reactionCandidateInputSchema.parse({
    ...validInput(), relationType: 'conditionally_compatible', conditions: null,
  })).toThrow()
  expect(() => reactionCandidateInputSchema.parse({
    ...validInput(), relationType: 'conditionally_compatible', conditions: {},
  })).toThrow()
  const ok = reactionCandidateInputSchema.parse({
    ...validInput(), relationType: 'conditionally_compatible', conditions: { temp_max_c: 4 },
  })
  expect(ok.conditions).toEqual({ temp_max_c: 4 })
})

test('reactionCandidateInputSchema：来源字段与多余字段', () => {
  expect(() => reactionCandidateInputSchema.parse({
    ...validInput(), source: { docId: 'd', chunkSeq: 0, bbox: [1, 2, 3] },
  })).toThrow() // bbox 必须 4 个数
  expect(() => reactionCandidateInputSchema.parse({
    ...validInput(), source: { docId: 'd', chunkSeq: 0, bbox: [1, 2, 3, 4] },
  })).not.toThrow()
  expect(() => reactionCandidateInputSchema.parse({
    ...validInput(), source: { docId: 'd', chunkSeq: -1 },
  })).toThrow()
  // 多余字段不许静默丢弃（写错字段名 = 溯源信息悄悄丢一半）
  expect(() => reactionCandidateInputSchema.parse({ ...validInput(), evidence: 'x' })).toThrow()
  expect(() => reactionCandidateInputSchema.parse({
    ...validInput(), source: { docId: 'd', chunkSeq: 0, chunkID: 'x' },
  })).toThrow()
  // chunkId 给了就必须是点 id 口径的 UUIDv5
  expect(() => reactionCandidateInputSchema.parse({
    ...validInput(), source: { docId: 'd', chunkSeq: 0, chunkId: 'not-a-uuid' },
  })).toThrow()
})

test('审核/发布/列表入参 DTO：默认值与 coerce', () => {
  expect(reviewDecisionSchema.parse({ decision: 'approve', reviewedBy: 1 }).note).toBeNull()
  expect(() => reviewDecisionSchema.parse({ decision: 'auto-approve', reviewedBy: 1 })).toThrow()

  const pub = publishRuleInputSchema.parse({ candidateId: 3, reviewedBy: 1 })
  expect(pub.supersedeExisting).toBe(false) // 默认拒绝顶掉已生效规则
  expect(pub.note).toBeNull()

  const q = candidateListQuerySchema.parse({ reviewStatus: 'pending', limit: '10', offset: '5' })
  expect(q.limit).toBe(10)
  expect(q.offset).toBe(5)
  expect(candidateListQuerySchema.parse({}).limit).toBe(50)
  expect(() => candidateListQuerySchema.parse({ limit: '9999' })).toThrow()
  expect(() => candidateListQuerySchema.parse({ reviewStatus: 'unknown' })).toThrow()
})

// ── 契约 ↔ 迁移脚本 一致性 ──────────────────────────────────────────────────────
// 路径：tsAgent/src/reaction/ → 上三层 = 仓库根，迁移脚本在根下的 deploy/sql/
const SQL_PATH = new URL('../../../deploy/sql/02_reaction_rule.sql', import.meta.url)
const sqlRaw = readFileSync(SQL_PATH, 'utf8')
/** 去掉 -- 注释后的"纯 SQL"，纪律检查只看真语句，不看注释里提到的词 */
const sqlCode = sqlRaw.split('\n').map(l => l.replace(/--.*$/, '')).join('\n')
const flat = sqlCode.replace(/\s+/g, '')
const inList = (vals: readonly string[]) => `IN('${vals.join("','")}')`

test('枚举与 DDL 的 CHECK 约束逐字一致（改一边就得改另一边）', () => {
  expect(flat).toContain(inList(RELATION_TYPES))
  expect(flat).toContain(inList(DIRECTION_SEMANTICS))
  expect(flat).toContain(inList(ENTITY_KINDS))
  expect(flat).toContain(inList(CANDIDATE_REVIEW_STATUSES))
  expect(flat).toContain(inList(CANDIDATE_SOURCE_STATES))
  expect(flat).toContain(inList(RULE_STATUSES))
  expect(flat).toContain(inList(RULE_SOURCE_STATES))
  expect(flat).toContain(inList(SEVERITIES))
  // 两张表都在，且都是 IF NOT EXISTS（幂等）
  expect(flat).toContain('CREATETABLEIFNOTEXISTSreaction_candidate')
  expect(flat).toContain('CREATETABLEIFNOTEXISTSreaction_rule')
})

test('危害词表在 DDL 的列注释里有据可查，且无重复项', () => {
  expect(new Set(HAZARDS).size).toBe(HAZARDS.length)
  for (const h of HAZARDS) expect(flat).toContain(h)
})

test('迁移脚本遵守加性纪律：无 DROP TABLE/DATABASE、无 TRUNCATE、无 DELETE', () => {
  expect(sqlCode).not.toMatch(/\bDROP\s+(TABLE|DATABASE)\b/i)
  expect(sqlCode).not.toMatch(/\bTRUNCATE\b/i)
  expect(sqlCode).not.toMatch(/\bDELETE\s+FROM\b/i)
  expect(sqlCode).not.toMatch(/\bUPDATE\s+reaction_/i) // 本迁移不写业务数据
})
