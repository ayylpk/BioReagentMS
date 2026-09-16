// 试剂禁配/相容性安全知识 —— 抽取层形状（LLM 输出 DTO + 校验结果形状）
//
// 分层（本目录内，从纯到有 IO）：
//   types.ts       形状与拒绝码（纯）
//   prompt.ts      提示词 + 喂给 LLM 的宽松 schema（纯）
//   select.ts      哪些 chunk 该抽（纯函数，可脱库单测）
//   validate.ts    确定性校验与归一化（纯函数，**本任务的重头**）
//   chunkSource.ts Chunk 数据源接口（Qdrant 生产实现 / 本地语料重建实现 / 测试 fixture）
//   docs.ts        文档选择（只读 ingest_log，gate 在 SQL 的 WHERE 里）
//   llm.ts         LLM 结构化抽取（唯一有网络 IO 的一层）
//   log.ts         抽取批次台账 reaction_extract_log（新建表）
//   pipeline.ts    编排（依赖全部注入，可全离线测试）
//
// 铁律（写在类型层，不靠注释口口相传）：
//   ① 允许的关系枚举 **不含** 'compatible' —— 类型上就写不出"未提及 → 兼容"这种结论。
//   ② 空 relations 是合法结果（"原文没有明确关系时返回空数组"），绝不是"安全"。
//   ③ 本层只产出候选（reaction_candidate），**一行都不许写 reaction_rule**；
//      正式规则的唯一入口是 store.publishRule（人工审核之后）。
import { z } from 'zod'
import { ENTITY_KINDS, HAZARDS, RELATION_TYPES, SEVERITIES } from '../types'
import type { EntityRef, Hazard, RelationType, Severity } from '../types'

// ── 喂给 LLM 的 schema（宽松）──────────────────────────────────────────────────
// 为什么宽松：invoke(withStructuredOutput) 会用这份 schema 解析模型返回的 tool args，
// 一旦解析失败就是整块 chunk 抽取失败（一条 severity 写错就白烧一次调用）。
// 所以这层只保证"形状是对象/数组"，**值域一律用 string 兜住**；
// 真正的硬校验（枚举越界、CAS、证据连续性…）全部在 validate.ts 逐条做，
// 好处是越界的条目能被单独计数丢弃（SCHEMA_INVALID），而不是把整块结果炸掉。
// 另一面：字段本身尽量保持 required（不给 .optional()），否则 function-calling 的参数表里
// 这些字段变成可选，模型会开始省字段 —— 这是"宽松值域"换来的代价，值域宽松不影响取值率。
// conditions 的取舍：要 `string[]`（条件短语原文）而不是自由对象。理由有二 ——
//   ① function-calling 里"自由键值对象"（additionalProperties）各家兼容性最差，最容易整块调用失败；
//   ② 让模型自己编 {"temperature":"高温"} 就等于让它改写原文，而"条件是原文哪句话"必须可回查。
// 于是 conditions 只收原文短语，落地时由 validate.ts 确定性包成 {"text": [...]} 再进 conditions_json。
export const llmRelationLooseSchema = z.object({
  subject_name: z.string().describe('主体实体名，必须能在原文中找到（通常是本文档的主体化学品）'),
  subject_cas: z.string().nullish().describe('仅当原文明确出现且能对应到该实体时填写，否则 null；严禁凭常识补'),
  subject_kind: z.string().describe("reagent（具体物质）或 category（抽象类别，如氧化剂/碱类）"),
  relation_type: z
    .string()
    .describe('incompatible / storage_separate / hazardous_reaction / conditionally_compatible 之一'),
  object_name: z.string().describe('客体实体名，必须能在原文中找到'),
  object_cas: z.string().nullish().describe('同 subject_cas：原文没写就 null'),
  object_kind: z.string().describe('reagent 或 category；"避免氧化剂"里的氧化剂是 category'),
  conditions: z
    .array(z.string())
    .nullish()
    .describe('关系成立的**条件短语原文**（如 ["在高温下","遇水时"]）；原文有"在高温下""遇水时"必须落这里，不许只留在自由文本'),
  hazards: z.array(z.string()).nullish().describe('原文明确写出的危险结果，取值见提示词；原文没说就留空'),
  severity: z.string().nullish().describe('low / medium / high / critical / unknown（原文未评估填 unknown）'),
  evidence_quote: z.string().describe('逐字复制原文中的连续片段，不许改写、拼接、补全'),
  confidence: z.number().nullish().describe('0~1 的抽取置信度'),
})
export type LlmRelationLoose = z.infer<typeof llmRelationLooseSchema>

/**
 * LLM 返回的顶层形状。
 * 用 `relations` 包一层而不是直接要数组：function-calling 的参数必须是一个对象，
 * 且"返回空数组"要能明确表达为 `{"relations": []}`（顶层裸数组做不到这点）。
 */
export const llmExtractionLooseSchema = z.object({ relations: z.array(llmRelationLooseSchema) })
export type LlmExtractionLoose = z.infer<typeof llmExtractionLooseSchema>

// ── 逐条硬校验用的严格 schema（运行时必过，不过就丢该条）──────────────────────
// 这一层对齐 Agent 1 的契约（types.ts 的枚举），并**额外**把 'compatible' 关在门外。
export const strictRelationSchema = z.object({
  subject_name: z.string().min(1).max(200),
  subject_cas: z.string().min(1).max(50).nullable(),
  subject_kind: z.enum(ENTITY_KINDS),
  relation_type: z.enum(RELATION_TYPES),
  object_name: z.string().min(1).max(200),
  object_cas: z.string().min(1).max(50).nullable(),
  object_kind: z.enum(ENTITY_KINDS),
  conditions: z.array(z.string().min(1).max(200)).max(20).nullable(),
  hazards: z.array(z.enum(HAZARDS)).max(HAZARDS.length),
  severity: z.enum(SEVERITIES),
  evidence_quote: z.string().min(1).max(8000),
  confidence: z.number().min(0).max(1).nullable(),
})
export type StrictRelation = z.infer<typeof strictRelationSchema>

// ── 拒绝码（每一条都在抽取统计里可见，绝不允许静默丢弃）──────────────────────
export const REJECTION_CODES = [
  'SCHEMA_INVALID',        // 条目形状/枚举越界（含 severity 越界、relation_type 越界）
  'EVIDENCE_EMPTY',        // 证据为空
  'EVIDENCE_TOO_SHORT',    // 证据过短（无法支撑一条关系）
  'EVIDENCE_TOO_LONG',     // 证据超列上限 8000（不截断：截断会破坏 candidate_key 的可复算语义）
  'EVIDENCE_NOT_IN_SOURCE',// 证据不是源 chunk 的连续原文片段（疑似改写/拼接）
  'NO_INFORMATION',        // 证据本身是"无资料/无数据"这类无信息表述
  'NEGATED_RELATION',      // 否定句（"与碱不发生反应"）—— 绝不许抽成禁配候选
  'ENTITY_INVALID',        // 实体名规范化后为空或超长
  'ENTITY_NOT_IN_SOURCE',  // 实体名在源 chunk 原文里找不到（疑似模型常识补全的实体）
  'CATEGORY_WITH_CAS',     // category 携带 CAS：模型自相矛盾，类别与物质不许混
  'CAS_NOT_IN_SOURCE',     // CAS 未在原文出现（模型凭常识补的 CAS）
  'CAS_CHECK_DIGIT_FAIL',  // CAS 校验位不通过（错编号=事故）
  'GENERIC_ENTITY',        // 实体是"不相容物质"这类占位泛称，抽出的关系没有可查的对象
  'SELF_RELATION',         // 同一实体与自身构成关系
  'KEY_INVALID',           // 实体键算不出来（正常不该发生，兜底可见化）
  'MISSING_CONDITIONS',    // conditionally_compatible 却给不出任何条件
] as const
export type RejectionCode = (typeof REJECTION_CODES)[number]

/** 归一化时做过的"改写动作"（不是拒绝，但要留痕，供人审知道这条被系统动过什么） */
export const NORMALIZATION_NOTES = [
  'coerced_category',      // reagent → category（名称命中类别词表）
  'dropped_hazards',       // 部分 hazards 在原文里找不到依据，已剔除
  'backfilled_conditions', // conditions 由原文条件短语确定性回填
] as const
export type NormalizationNote = (typeof NORMALIZATION_NOTES)[number]

export interface RelationRejection {
  /** 该 chunk 内第几条（0 起，对应 LLM 返回的 relations 下标），便于人去看原始输出 */
  index: number
  code: RejectionCode
  detail: string
}

/** 通过全部确定性校验、可直接喂给 store.upsertCandidate 的关系 */
export interface ValidatedRelation {
  relationType: RelationType
  subject: EntityRef
  object: EntityRef
  severity: Severity
  hazards: Hazard[]
  conditions: Record<string, unknown> | null
  confidence: number | null
  evidenceText: string
  notes: NormalizationNote[]
}

export interface ValidationOutcome {
  accepted: ValidatedRelation[]
  rejections: RelationRejection[]
}

// ── chunk 选择结果 ────────────────────────────────────────────────────────────
export const SKIP_REASONS = [
  'empty_text',            // 文本为空/纯空白
  'too_short',             // 有效文本过短，不可能承载一条关系
  'section_not_safety',    // 能认出是标准 SDS 分节，但不在目标分节内（如"毒理学信息"）
  'section_unidentified',  // 认不出分节、也没有安全规章/SOP 或安全字段标记
] as const
export type SkipReason = (typeof SKIP_REASONS)[number]

/** 选中理由：SDS 目标分节 / 标题上的安全规章标记 / 段落内的显式安全标签 */
export type SelectReason =
  | { kind: 'sds_section'; section: string }
  | { kind: 'safety_heading'; heading: string; marker: string }
  | { kind: 'safety_paragraph'; marker: string }

/** 跳过的 chunk。刻意不带 chunk_id：point id 可由 pointId(docId, seq) 复算，
 *  放进来只会逼本模块 import rag 的（会 new QdrantClient 的）模块，把纯函数变成有依赖的。 */
export interface ChunkSkip {
  seq: number
  section: string | null
  reason: SkipReason
  detail: string
}

export interface ChunkSelection {
  /** 按 priority 升序（越小越先抽）再按 seq 升序：预算有限时先烧最该抽的分节 */
  selected: { seq: number; reason: SelectReason; priority: number }[]
  skipped: ChunkSkip[]
}

// ── 抽取批次结果（写 reaction_extract_log 的内容）───────────────────────────────
/** 文档级状态：done=抽取跑完（候选数可以为 0）/ empty=没有可抽的 chunk / failed=有失败 */
export const EXTRACT_DOC_STATUSES = ['done', 'empty', 'failed'] as const
export type ExtractDocStatus = (typeof EXTRACT_DOC_STATUSES)[number]

export interface ExtractStats {
  /** 选择阶段：各 skip 原因计数 */
  skipReasons: Partial<Record<SkipReason, number>>
  /** 选择阶段：各选中理由计数（sds_section / safety_heading / safety_paragraph） */
  selectReasons: Record<string, number>
  /** 校验阶段：各拒绝码计数 */
  rejections: Partial<Record<RejectionCode, number>>
  /** 归一化动作计数 */
  notes: Partial<Record<NormalizationNote, number>>
}

export function emptyStats(): ExtractStats {
  return { skipReasons: {}, selectReasons: {}, rejections: {}, notes: {} }
}

export interface ExtractDocResult {
  docId: string
  status: ExtractDocStatus
  chunksTotal: number
  chunksSelected: number
  llmCalls: number
  llmFailures: number
  accepted: number
  written: number
  rejected: number
  /** 落库失败数（候选写不进去；来源清扫仍会跑） */
  writeFailures: number
  staleMarked: number
  stats: ExtractStats
  error?: string
}

export interface ExtractRunSummary {
  runId: string
  extractorVersion: string
  docs: ExtractDocResult[]
  /** gate 之外被跳过的文档（docId → 原因），选文档阶段就排除，不产生抽取日志行 */
  docsExcluded: { docId: string; status: string }[]
  llmCalls: number
  accepted: number
  written: number
  rejected: number
  dryRun: boolean
}
