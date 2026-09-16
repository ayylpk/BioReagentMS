// 试剂禁配/相容性安全知识 —— 契约层（枚举 + zod 运行时 DTO + 只读行形状）
// 分层：types.ts 只管形状与校验 → keys.ts 管规范化与幂等键（纯） → lifecycle.ts 管状态机（纯） → store.ts 管落库
// 立场：抽取产物（LLM）与被调方入参同样是不可信输入，一律走 zod 运行时校验，不信调用方
// 唯一事实源：本文件的枚举必须与 deploy/sql/02_reaction_rule.sql 的 CHECK 约束逐字一致，改一边就得改另一边
import { z } from 'zod'
import { casCheckDigitOk } from '../rag/gate/quality'

// ── 关系类型 ──────────────────────────────────────────────────────────────────
// 本阶段四类关系语义**全部对称**（A 与 B 禁配 ⇔ B 与 A 禁配；分开储存 / 危险反应 / 条件共存同理）。
// 不含 'directed'：契约里不许出现尚未支持的方向语义，等真有非对称关系（如"可催化"）再一起加。
export const RELATION_TYPES = [
  'incompatible',            // 禁配：混合即危险
  'storage_separate',        // 分开储存：同库存放有风险
  'hazardous_reaction',      // 危险反应：会产生有害结果
  'conditionally_compatible',// 条件共存：在给定条件下可以共存
] as const
export type RelationType = (typeof RELATION_TYPES)[number]

/** 方向语义：显式落库，不靠注释口口相传。本阶段恒为 symmetric */
export const DIRECTION_SEMANTICS = ['symmetric'] as const
export type DirectionSemantics = (typeof DIRECTION_SEMANTICS)[number]

/** 实体类型：category 与 reagent 绝不许混为同一实体（'cat:' 与 'name:'/'cas:' 前缀天然隔离） */
export const ENTITY_KINDS = ['reagent', 'category'] as const
export type EntityKind = (typeof ENTITY_KINDS)[number]

export const SEVERITIES = ['low', 'medium', 'high', 'critical', 'unknown'] as const
export type Severity = (typeof SEVERITIES)[number]

/** 危害集合：枚举限定词表，避免自由文本（词表外的危害走 'other' 并在 hazards_json 里给 detail） */
export const HAZARDS = [
  'heat',            // 放热
  'fire',            // 燃烧
  'explosion',       // 爆炸
  'toxic_gas',       // 有毒气体
  'flammable_gas',   // 易燃气体
  'pressure',        // 压力/爆沸
  'polymerization',  // 聚合
  'decomposition',   // 分解
  'other',
] as const
export type Hazard = (typeof HAZARDS)[number]

// ── 状态枚举（与 DDL 的 CHECK 约束一一对应）────────────────────────────────────
/** 候选的审核维度 */
export const CANDIDATE_REVIEW_STATUSES = ['pending', 'approved', 'rejected', 'superseded'] as const
export type CandidateReviewStatus = (typeof CANDIDATE_REVIEW_STATUSES)[number]
/** 候选的来源有效性维度（与审核维度正交，别混成一个字段） */
export const CANDIDATE_SOURCE_STATES = ['active', 'stale'] as const
export type CandidateSourceState = (typeof CANDIDATE_SOURCE_STATES)[number]
/** 规则生命周期状态 */
export const RULE_STATUSES = ['active', 'superseded'] as const
export type RuleStatus = (typeof RULE_STATUSES)[number]
/** 规则的来源有效性：来源失效绝不物理删除，只降级等着复核 */
export const RULE_SOURCE_STATES = ['active', 'source_stale', 'source_missing'] as const
export type RuleSourceState = (typeof RULE_SOURCE_STATES)[number]

/** source_chunk_id 的格式：pointId() 产出的确定性 UUIDv5（版本位恒为 5） */
const CHUNK_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

// ── 实体引用 ──────────────────────────────────────────────────────────────────
/**
 * 实体身份三件套：kind + name + cas?。
 * cas 只有 reagent 才允许带；带了就必须过 CAS 校验位（错编号 = 安全事故，一票否决）。
 * name 只做长度校验，真正的规范化在 keys.normalizeEntityName（纯函数，可单测）。
 */
export const entityRefSchema = z
  .strictObject({
    kind: z.enum(ENTITY_KINDS),
    name: z.string().trim().min(1).max(200),
    cas: z.string().trim().min(1).max(50).nullable().optional(),
  })
  .refine(v => !(v.kind === 'category' && v.cas), {
    message: 'category 绝不许携带 CAS：类别是没有 CAS 的抽象实体，带上就是把两种实体混成一个',
    path: ['cas'],
  })
  .refine(v => !(v.cas && !casCheckDigitOk(v.cas)), {
    message: 'CAS 校验位不通过（错编号会被当成另一瓶试剂，安全事故）',
    path: ['cas'],
  })
export type EntityRef = z.infer<typeof entityRefSchema>

/** 来源定位快照：规则发布后不再随重摄变化，复核时以此为准 */
export const sourceRefSchema = z.strictObject({
  docId: z.string().trim().min(1).max(128),
  /** 可省略：默认由 pointId(docId, chunkSeq) 复算；给了就必须与复算值一致（store 会断言） */
  chunkId: z.string().trim().regex(CHUNK_ID_RE, 'source_chunk_id 必须是 pointId() 产出的 UUIDv5').optional(),
  chunkSeq: z.number().int().min(0),
  page: z.number().int().min(1).nullable().optional(),
  section: z.string().max(200).nullable().optional(),
  tableId: z.string().max(191).nullable().optional(),
  /** 4 个数的坐标 [x1,y1,x2,y2]；docx 等无坐标来源传 null/省略 */
  bbox: z.array(z.number()).length(4).nullable().optional(),
})
export type SourceRef = z.infer<typeof sourceRefSchema>

// ── 候选入参（抽取流水线 → store）──────────────────────────────────────────────
// strictObject：多出来的字段一律报错，绝不静默丢弃（写错 chunk 定位字段名 = 溯源信息悄悄丢一半）
export const reactionCandidateInputSchema = z
  .strictObject({
    relationType: z.enum(RELATION_TYPES),
    subject: entityRefSchema,
    object: entityRefSchema,
    severity: z.enum(SEVERITIES).default('unknown'),
    hazards: z.array(z.enum(HAZARDS)).max(HAZARDS.length).default([]),
    /** 共存条件（如 { "temp_max_c": 40 }）；非条件关系可空 */
    conditions: z.record(z.string(), z.unknown()).nullable().default(null),
    confidence: z.number().min(0).max(1).nullable().default(null),
    /** 证据原文：必须是来源 chunk 里的连续片段，store 写入前 contains 断言 */
    evidenceText: z.string().min(1).max(8000),
    extractorVersion: z.string().trim().min(1).max(32),
    /** 本次抽取批次 id：重摄后靠它判定哪些旧候选已失效 */
    runId: z.string().trim().min(1).max(64),
    source: sourceRefSchema,
  })
  .refine(v => v.relationType !== 'conditionally_compatible' || (v.conditions !== null && Object.keys(v.conditions).length > 0), {
    message: 'conditionally_compatible 必须给出至少一条共存条件：没有条件的"条件共存"读出来就是"可以共存"',
    path: ['conditions'],
  })
export type ReactionCandidateInput = z.infer<typeof reactionCandidateInputSchema>
/** 调用方看到的入参形状（severity/hazards/... 可省略，由默认值补齐） */
export type ReactionCandidateInputRaw = z.input<typeof reactionCandidateInputSchema>

// ── 审核 / 发布入参（审核 API → store）──────────────────────────────────────────
export const reviewDecisionSchema = z.object({
  decision: z.enum(['approve', 'reject']),
  reviewedBy: z.number().int().positive(),
  note: z.string().max(500).nullable().default(null),
})
export type ReviewDecisionInput = z.infer<typeof reviewDecisionSchema>
/** 调用方入参形状（note 可省，由默认值补齐） */
export type ReviewDecisionInputRaw = z.input<typeof reviewDecisionSchema>

export const publishRuleInputSchema = z.object({
  candidateId: z.number().int().positive(),
  reviewedBy: z.number().int().positive(),
  note: z.string().max(500).nullable().default(null),
  /** 同一 rule_key 已有 active 规则时：true=取代它，false=拒绝发布（默认拒绝，避免静默顶掉已生效规则） */
  supersedeExisting: z.boolean().default(false),
})
export type PublishRuleInput = z.infer<typeof publishRuleInputSchema>
/** 调用方入参形状（note/supersedeExisting 可省，由默认值补齐） */
export type PublishRuleInputRaw = z.input<typeof publishRuleInputSchema>

/** 候选列表筛选（审核队列 / 运维排查用） */
export const candidateListQuerySchema = z.object({
  reviewStatus: z.enum(CANDIDATE_REVIEW_STATUSES).optional(),
  sourceState: z.enum(CANDIDATE_SOURCE_STATES).optional(),
  docId: z.string().max(128).optional(),
  relationType: z.enum(RELATION_TYPES).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
})
export type CandidateListQuery = z.infer<typeof candidateListQuerySchema>
/** 调用方入参形状（limit/offset 可省，由默认值补齐） */
export type CandidateListQueryRaw = z.input<typeof candidateListQuerySchema>

// ── 只读行形状（store 映射 DB 行后的对外视图；下游 Agent 3/4 只认这里）────────────
export interface CandidateRow {
  id: number
  candidateKey: string
  relationType: RelationType
  directionSemantics: DirectionSemantics
  subjectKind: EntityKind
  objectKind: EntityKind
  subjectKey: string
  objectKey: string
  pairKey: string
  subjectName: string
  objectName: string
  subjectCas: string | null
  objectCas: string | null
  severity: Severity
  hazards: Hazard[]
  conditions: Record<string, unknown> | null
  confidence: number | null
  extractorVersion: string
  evidenceText: string
  source: SourceRef
  lastSeenRunId: string
  reviewStatus: CandidateReviewStatus
  sourceState: CandidateSourceState
  reviewedBy: number | null
  reviewedAt: Date | null
  reviewNote: string | null
  createdAt: Date
  updatedAt: Date
}

export interface RuleRow {
  id: number
  candidateId: number
  ruleKey: string
  relationType: RelationType
  directionSemantics: DirectionSemantics
  subjectKind: EntityKind
  objectKind: EntityKind
  subjectKey: string
  objectKey: string
  pairKey: string
  subjectName: string
  objectName: string
  subjectCas: string | null
  objectCas: string | null
  severity: Severity
  hazards: Hazard[]
  conditions: Record<string, unknown> | null
  confidence: number | null
  extractorVersion: string
  evidenceText: string
  source: SourceRef
  status: RuleStatus
  supersededById: number | null
  supersededAt: Date | null
  sourceState: RuleSourceState
  sourceRecheckedBy: number | null
  sourceRecheckedAt: Date | null
  reviewedBy: number | null
  reviewedAt: Date | null
  reviewNote: string | null
  createdAt: Date
  updatedAt: Date
}
