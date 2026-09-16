// 试剂禁配/相容性安全知识 —— 数据访问层（唯一写 reaction_candidate / reaction_rule 的地方）
//
// 与 ingest_log 的差别（刻意为之，别照抄那边的写法）：
//   logIngest 是旁路台账，MySQL 挂了只 warn；这两张表**是主产物**，写失败必须抛，
//   读失败也必须抛。把"数据库出错"压成"没有记录"，等于拿"安全"回答一个未知问题。
//
// 已知缺口（本阶段不修，不许悄悄绕过）：
//   实体名不做同义词归并 —— "乙醇" 与 "无水乙醇"、"二甲基亚砜" 与 "DMSO" 会算成两个实体键。
//   可靠路径是 CAS（reagent 表已有 cas_number 且本次迁移补了索引）；
//   纯名称实体（category 和无 CAS 的 reagent）只能精确匹配，误漏风险见报告。
import type { PoolConnection, ResultSetHeader, RowDataPacket } from 'mysql2/promise'
import { pool } from '../db/mysql'
import { pointId } from '../rag/store/upsert'
import { ReactionKeyError, ReactionStateError } from './errors'
import {
  assertEvidenceContiguous,
  candidateKeyOf,
  orderEntityRefs,
  ruleKeyOf,
} from './keys'
import {
  assertApprovable,
  assertCandidateReviewTransition,
  assertPublishable,
  assertRuleSourceAutoTransition,
  assertRuleStatusTransition,
} from './lifecycle'
import {
  candidateListQuerySchema,
  publishRuleInputSchema,
  reactionCandidateInputSchema,
  reviewDecisionSchema,
} from './types'
import type {
  CandidateListQueryRaw,
  CandidateReviewStatus,
  CandidateRow,
  EntityRef,
  Hazard,
  PublishRuleInputRaw,
  ReactionCandidateInput,
  ReactionCandidateInputRaw,
  ReviewDecisionInputRaw,
  RelationType,
  RuleRow,
  RuleSourceState,
  Severity,
  SourceRef,
} from './types'

type DbRow = Record<string, any>

const CANDIDATE_COLS = [
  'id', 'candidate_key', 'relation_type', 'direction_semantics',
  'subject_kind', 'object_kind', 'subject_key', 'object_key', 'pair_key',
  'subject_name', 'object_name', 'subject_cas', 'object_cas',
  'severity', 'hazards_json', 'conditions_json', 'confidence', 'extractor_version',
  'evidence_text', 'source_doc_id', 'source_chunk_id', 'source_chunk_seq',
  'source_page', 'source_section', 'source_table_id', 'source_bbox_json',
  'last_seen_run_id', 'review_status', 'source_state',
  'reviewed_by', 'reviewed_at', 'review_note', 'created_at', 'updated_at',
].join(', ')

const RULE_COLS = [
  'id', 'candidate_id', 'rule_key', 'relation_type', 'direction_semantics',
  'subject_kind', 'object_kind', 'subject_key', 'object_key', 'pair_key',
  'subject_name', 'object_name', 'subject_cas', 'object_cas',
  'severity', 'hazards_json', 'conditions_json', 'confidence', 'extractor_version',
  'evidence_text', 'source_doc_id', 'source_chunk_id', 'source_chunk_seq',
  'source_page', 'source_section', 'source_table_id', 'source_bbox_json',
  'status', 'superseded_by_id', 'superseded_at', 'source_state',
  'source_rechecked_by', 'source_rechecked_at',
  'reviewed_by', 'reviewed_at', 'review_note', 'created_at', 'updated_at',
].join(', ')

// ── 行映射 ────────────────────────────────────────────────────────────────────
const toNum = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v))
const toDate = (v: unknown): Date | null => (v instanceof Date ? v : v ? new Date(String(v)) : null)

/** mysql2 对 JSON 列的返回形态随配置而异（对象或字符串），两种都兜住 */
function toJson<T>(v: unknown): T | null {
  if (v === null || v === undefined) return null
  return (typeof v === 'string' ? JSON.parse(v) : v) as T
}

function mapSource(r: DbRow): SourceRef {
  const src: SourceRef = {
    docId: String(r.source_doc_id),
    chunkId: String(r.source_chunk_id),
    chunkSeq: Number(r.source_chunk_seq),
  }
  if (r.source_page !== null && r.source_page !== undefined) src.page = Number(r.source_page)
  if (r.source_section !== null && r.source_section !== undefined) src.section = String(r.source_section)
  if (r.source_table_id !== null && r.source_table_id !== undefined) src.tableId = String(r.source_table_id)
  const bbox = toJson<number[]>(r.source_bbox_json)
  if (bbox) src.bbox = bbox
  return src
}

function mapCandidate(r: DbRow): CandidateRow {
  return {
    id: Number(r.id),
    candidateKey: String(r.candidate_key),
    relationType: r.relation_type as RelationType,
    directionSemantics: r.direction_semantics,
    subjectKind: r.subject_kind,
    objectKind: r.object_kind,
    subjectKey: String(r.subject_key),
    objectKey: String(r.object_key),
    pairKey: String(r.pair_key),
    subjectName: String(r.subject_name),
    objectName: String(r.object_name),
    subjectCas: r.subject_cas ?? null,
    objectCas: r.object_cas ?? null,
    severity: r.severity as Severity,
    hazards: toJson<Hazard[]>(r.hazards_json) ?? [],
    conditions: toJson<Record<string, unknown>>(r.conditions_json),
    confidence: toNum(r.confidence),
    extractorVersion: String(r.extractor_version),
    evidenceText: String(r.evidence_text),
    source: mapSource(r),
    lastSeenRunId: String(r.last_seen_run_id),
    reviewStatus: r.review_status as CandidateReviewStatus,
    sourceState: r.source_state,
    reviewedBy: toNum(r.reviewed_by),
    reviewedAt: toDate(r.reviewed_at),
    reviewNote: r.review_note ?? null,
    createdAt: toDate(r.created_at) as Date,
    updatedAt: toDate(r.updated_at) as Date,
  }
}

function mapRule(r: DbRow): RuleRow {
  return {
    id: Number(r.id),
    candidateId: Number(r.candidate_id),
    ruleKey: String(r.rule_key),
    relationType: r.relation_type as RelationType,
    directionSemantics: r.direction_semantics,
    subjectKind: r.subject_kind,
    objectKind: r.object_kind,
    subjectKey: String(r.subject_key),
    objectKey: String(r.object_key),
    pairKey: String(r.pair_key),
    subjectName: String(r.subject_name),
    objectName: String(r.object_name),
    subjectCas: r.subject_cas ?? null,
    objectCas: r.object_cas ?? null,
    severity: r.severity as Severity,
    hazards: toJson<Hazard[]>(r.hazards_json) ?? [],
    conditions: toJson<Record<string, unknown>>(r.conditions_json),
    confidence: toNum(r.confidence),
    extractorVersion: String(r.extractor_version),
    evidenceText: String(r.evidence_text),
    source: mapSource(r),
    status: r.status,
    supersededById: toNum(r.superseded_by_id),
    supersededAt: toDate(r.superseded_at),
    sourceState: r.source_state as RuleSourceState,
    sourceRecheckedBy: toNum(r.source_rechecked_by),
    sourceRecheckedAt: toDate(r.source_rechecked_at),
    reviewedBy: toNum(r.reviewed_by),
    reviewedAt: toDate(r.reviewed_at),
    reviewNote: r.review_note ?? null,
    createdAt: toDate(r.created_at) as Date,
    updatedAt: toDate(r.updated_at) as Date,
  }
}

function withTransaction<T>(fn: (conn: PoolConnection) => Promise<T>): Promise<T> {
  return pool.getConnection().then(async conn => {
    try {
      await conn.beginTransaction()
      const out = await fn(conn)
      await conn.commit()
      return out
    } catch (e) {
      await conn.rollback().catch(() => undefined) // 回滚失败不许掩盖原始错误
      throw e
    } finally {
      conn.release()
    }
  })
}

// ── 来源块 id 复算 ─────────────────────────────────────────────────────────────
/**
 * source_chunk_id = pointId(docId, seq)（确定性 UUIDv5）。
 * 不额外存雪花 id：重摄后仍可用 (doc_id, seq) 复算校验。
 * 调用方若显式给了 chunkId，必须与复算值一致 —— 这是拦"来源块被张冠李戴"的一道硬闸。
 */
export function resolveChunkId(source: { docId: string; chunkSeq: number; chunkId?: string }): string {
  const derived = pointId(source.docId, source.chunkSeq)
  if (source.chunkId && source.chunkId !== derived) {
    throw new ReactionKeyError(
      `source_chunk_id 与 (doc_id, chunk_seq) 复算值不一致：给了 ${source.chunkId}，复算得 ${derived}`,
    )
  }
  return derived
}

/** 把 EntityRef 拆成落库用的四件套 */
function refColumns(ref: EntityRef): { kind: string; name: string; cas: string | null } {
  return { kind: ref.kind, name: ref.name, cas: ref.cas ?? null }
}

// ── 候选写入（抽取流水线 Agent 2 用）────────────────────────────────────────────
export interface DerivedCandidate {
  candidateKey: string
  ruleKey: string
  pairKey: string
  subject: EntityRef
  object: EntityRef
  subjectKey: string
  objectKey: string
  chunkId: string
  value: ReactionCandidateInput
}

/**
 * 唯一入参解析口：zod 形状校验 → 实体键/对称排序 → 证据连续性断言。
 * 全部失败路径都抛，绝不产出"键算不出来就跳过"的半成品。
 */
export function deriveCandidate(input: ReactionCandidateInputRaw, chunkText: string): DerivedCandidate {
  const value = reactionCandidateInputSchema.parse(input)
  const { first, second, firstKey, secondKey, pairKey } = orderEntityRefs(value.subject, value.object)
  assertEvidenceContiguous(value.evidenceText, chunkText)
  return {
    candidateKey: candidateKeyOf({
      relationType: value.relationType,
      pairKey,
      sourceDocId: value.source.docId,
      sourceChunkSeq: value.source.chunkSeq,
      evidenceQuote: value.evidenceText,
    }),
    ruleKey: ruleKeyOf(value.relationType, pairKey),
    pairKey,
    subject: first,
    object: second,
    subjectKey: firstKey,
    objectKey: secondKey,
    chunkId: resolveChunkId(value.source),
    value,
  }
}

/**
 * 幂等写入一条候选：同 candidate_key 重复抽取不产生新行。
 * ON DUPLICATE KEY UPDATE 只刷新"来源维度 + 最后见到它的批次"，其余一律不动：
 *   —— 已人审的候选不许因为重摄被改回 pending；判定内容（severity/hazards/conditions/证据）
 *      是审核对象，不许在人审背后漂移。代价见报告「已知风险」。
 * 返回落库后的完整行（含已有行的真实 id）。
 */
export async function upsertCandidate(input: ReactionCandidateInputRaw, chunkText: string): Promise<CandidateRow> {
  const d = deriveCandidate(input, chunkText)
  const s = d.subject
  const o = d.object
  const src = d.value.source

  await pool.query<ResultSetHeader>(
    `INSERT INTO reaction_candidate (
       candidate_key, relation_type, direction_semantics,
       subject_kind, object_kind, subject_key, object_key, pair_key,
       subject_name, object_name, subject_cas, object_cas,
       severity, hazards_json, conditions_json, confidence, extractor_version,
       evidence_text, source_doc_id, source_chunk_id, source_chunk_seq,
       source_page, source_section, source_table_id, source_bbox_json,
       last_seen_run_id, review_status, source_state
     ) VALUES (?, ?, 'symmetric', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', 'active')
     ON DUPLICATE KEY UPDATE
       last_seen_run_id = VALUES(last_seen_run_id),
       source_state = 'active'`,
    [
      d.candidateKey, d.value.relationType,
      refColumns(s).kind, refColumns(o).kind, d.subjectKey, d.objectKey, d.pairKey,
      s.name, o.name, s.cas ?? null, o.cas ?? null,
      d.value.severity, JSON.stringify(d.value.hazards),
      d.value.conditions === null ? null : JSON.stringify(d.value.conditions),
      d.value.confidence, d.value.extractorVersion,
      d.value.evidenceText, src.docId, d.chunkId, src.chunkSeq,
      src.page ?? null, src.section ?? null, src.tableId ?? null,
      src.bbox ? JSON.stringify(src.bbox) : null,
      d.value.runId,
    ],
  )

  const row = await findCandidateByKey(d.candidateKey)
  if (!row) throw new ReactionStateError('候选写入后查不到（并发删除？）：' + d.candidateKey)
  return row
}

/**
 * 重摄收尾：把本文档下"本轮没再见到、且仍 pending"的候选标 stale（不物理删除）。
 * 为什么只碰 pending：approved 的来源有效性由它发布的规则表的 source_state 承载；
 * rejected/superseded 已是终态，不需要再降级。
 * 返回被标记的行数（调用方据此上报"本轮有多少候选变孤儿"）。
 */
export async function markStaleForDoc(docId: string, runId: string): Promise<number> {
  const [res] = await pool.query<ResultSetHeader>(
    `UPDATE reaction_candidate
        SET source_state = 'stale'
      WHERE source_doc_id = ? AND source_state = 'active'
        AND review_status = 'pending' AND last_seen_run_id <> ?`,
    [docId, runId],
  )
  return res.affectedRows
}

// ── 候选查询 ──────────────────────────────────────────────────────────────────
export async function findCandidateByKey(candidateKey: string): Promise<CandidateRow | null> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT ${CANDIDATE_COLS} FROM reaction_candidate WHERE candidate_key = ? LIMIT 1`,
    [candidateKey],
  )
  const r = (rows as DbRow[])[0]
  return r ? mapCandidate(r) : null
}

export async function getCandidate(id: number): Promise<CandidateRow | null> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT ${CANDIDATE_COLS} FROM reaction_candidate WHERE id = ? LIMIT 1`,
    [id],
  )
  const r = (rows as DbRow[])[0]
  return r ? mapCandidate(r) : null
}

/** 审核队列 / 运维排查用；筛选条件全部参数化，列名来自白名单常量 */
export async function listCandidates(query: CandidateListQueryRaw): Promise<CandidateRow[]> {
  const q = candidateListQuerySchema.parse(query)
  const where: string[] = []
  const params: unknown[] = []
  if (q.reviewStatus) { where.push('review_status = ?'); params.push(q.reviewStatus) }
  if (q.sourceState) { where.push('source_state = ?'); params.push(q.sourceState) }
  if (q.docId) { where.push('source_doc_id = ?'); params.push(q.docId) }
  if (q.relationType) { where.push('relation_type = ?'); params.push(q.relationType) }
  params.push(q.limit, q.offset)
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT ${CANDIDATE_COLS} FROM reaction_candidate
     ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
     ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?`,
    params,
  )
  return (rows as DbRow[]).map(mapCandidate)
}

/** 同一对物质的全部候选（人审时看"这对还有哪些证据"） */
export async function findCandidatesByPairKey(pairKey: string): Promise<CandidateRow[]> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT ${CANDIDATE_COLS} FROM reaction_candidate WHERE pair_key = ? ORDER BY id`,
    [pairKey],
  )
  return (rows as DbRow[]).map(mapCandidate)
}

// ── 审核（Agent 3 用）─────────────────────────────────────────────────────────
/** 人工裁决：pending → approved / rejected。状态机与"来源必须还在"两条断言都在写入前跑 */
export async function reviewCandidate(id: number, input: ReviewDecisionInputRaw): Promise<CandidateRow> {
  const v = reviewDecisionSchema.parse(input)
  const to: CandidateReviewStatus = v.decision === 'approve' ? 'approved' : 'rejected'
  return withTransaction(async conn => {
    const [rows] = await conn.query<RowDataPacket[]>(
      `SELECT ${CANDIDATE_COLS} FROM reaction_candidate WHERE id = ? FOR UPDATE`,
      [id],
    )
    const r = (rows as DbRow[])[0]
    if (!r) throw new ReactionStateError(`候选不存在: ${id}`)
    const cur = mapCandidate(r)
    if (to === 'approved') assertApprovable(cur)
    else assertCandidateReviewTransition(cur.reviewStatus, to)

    await conn.query(
      `UPDATE reaction_candidate SET review_status = ?, reviewed_by = ?, reviewed_at = NOW(), review_note = ?
        WHERE id = ?`,
      [to, v.reviewedBy, v.note, id],
    )
    const [after] = await conn.query<RowDataPacket[]>(
      `SELECT ${CANDIDATE_COLS} FROM reaction_candidate WHERE id = ?`,
      [id],
    )
    return mapCandidate((after as DbRow[])[0]!)
  })
}

// ── 规则发布（Agent 3 用，人审通过之后）─────────────────────────────────────────
/**
 * 从已审核通过的候选发布一条正式规则（快照式复制，发布后不再随重摄变化）。
 *
 * 业务不变量「同一 rule_key 不许有两条 active」的落地方式：
 *   事务内先对候选行 FOR UPDATE，再对同 rule_key 的 active 行 FOR UPDATE。
 *   REPEATABLE READ 下这条 SELECT 会锁住 rule_key 索引上的间隙，并发发布同一 rule_key
 *   会被串行化 —— 所以不需要唯一索引（唯一索引会误杀"同一对物质多证据"的合法场景）。
 *   代价：这条不变量只对"走本函数发布"成立，任何人绕过它直接 INSERT 都可能破坏它。
 * supersedeExisting=false（默认）时，撞已有 active 规则直接抛，绝不静默顶掉已生效的规则。
 */
export async function publishRule(input: PublishRuleInputRaw): Promise<RuleRow> {
  const v = publishRuleInputSchema.parse(input)
  return withTransaction(async conn => {
    const [cRows] = await conn.query<RowDataPacket[]>(
      `SELECT ${CANDIDATE_COLS} FROM reaction_candidate WHERE id = ? FOR UPDATE`,
      [v.candidateId],
    )
    const cRaw = (cRows as DbRow[])[0]
    if (!cRaw) throw new ReactionStateError(`候选不存在: ${v.candidateId}`)
    const cand = mapCandidate(cRaw)
    assertPublishable(cand)

    const ruleKey = ruleKeyOf(cand.relationType, cand.pairKey)
    const [existing] = await conn.query<RowDataPacket[]>(
      `SELECT id, candidate_id FROM reaction_rule WHERE rule_key = ? AND status = 'active' FOR UPDATE`,
      [ruleKey],
    )
    const prev = (existing as DbRow[])[0]
    if (prev && !v.supersedeExisting) {
      throw new ReactionStateError(
        `同一物质对已有生效规则（rule_key=${ruleKey}，rule id=${prev.id}）；如确要更换请显式 supersedeExisting=true`,
      )
    }

    const [ins] = await conn.query<ResultSetHeader>(
      `INSERT INTO reaction_rule (
         candidate_id, rule_key, relation_type, direction_semantics,
         subject_kind, object_kind, subject_key, object_key, pair_key,
         subject_name, object_name, subject_cas, object_cas,
         severity, hazards_json, conditions_json, confidence, extractor_version,
         evidence_text, source_doc_id, source_chunk_id, source_chunk_seq,
         source_page, source_section, source_table_id, source_bbox_json,
         status, source_state, reviewed_by, reviewed_at, review_note
       ) VALUES (?, ?, ?, 'symmetric', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', 'active', ?, NOW(), ?)`,
      [
        cand.id, ruleKey, cand.relationType,
        cand.subjectKind, cand.objectKind, cand.subjectKey, cand.objectKey, cand.pairKey,
        cand.subjectName, cand.objectName, cand.subjectCas, cand.objectCas,
        cand.severity, JSON.stringify(cand.hazards),
        cand.conditions === null ? null : JSON.stringify(cand.conditions),
        cand.confidence, cand.extractorVersion,
        cand.evidenceText, cand.source.docId, cand.source.chunkId!, cand.source.chunkSeq,
        cand.source.page ?? null, cand.source.section ?? null, cand.source.tableId ?? null,
        cand.source.bbox ? JSON.stringify(cand.source.bbox) : null,
        v.reviewedBy, v.note,
      ],
    )
    const newId = ins.insertId

    if (prev) {
      // 旧规则退役 + 它的候选一并标 superseded（那条候选的结论已被取代）
      assertRuleStatusTransition('active', 'superseded')
      await conn.query(
        `UPDATE reaction_rule SET status = 'superseded', superseded_by_id = ?, superseded_at = NOW() WHERE id = ?`,
        [newId, prev.id],
      )
      await conn.query(
        `UPDATE reaction_candidate SET review_status = 'superseded'
          WHERE id = ? AND review_status = 'approved'`,
        [prev.candidate_id],
      )
    }

    const [rows] = await conn.query<RowDataPacket[]>(
      `SELECT ${RULE_COLS} FROM reaction_rule WHERE id = ?`,
      [newId],
    )
    return mapRule((rows as DbRow[])[0]!)
  })
}

// ── 来源失效（摄取/删除流程与人工复核用）────────────────────────────────────────
/** 文档被重摄：该文档下所有 active 规则标 source_stale（等复核，不物理删除） */
export async function markRulesSourceStaleByDoc(docId: string): Promise<number> {
  assertRuleSourceAutoTransition('source_stale')
  const [res] = await pool.query<ResultSetHeader>(
    `UPDATE reaction_rule SET source_state = 'source_stale'
      WHERE source_doc_id = ? AND status = 'active' AND source_state = 'active'`,
    [docId],
  )
  return res.affectedRows
}

/** 文档被删除：升级为 source_missing（已 stale 的也要升级） */
export async function markRulesSourceMissingByDoc(docId: string): Promise<number> {
  const [res] = await pool.query<ResultSetHeader>(
    `UPDATE reaction_rule SET source_state = 'source_missing'
      WHERE source_doc_id = ? AND status = 'active' AND source_state IN ('active', 'source_stale')`,
    [docId],
  )
  return res.affectedRows
}

/**
 * 来源复核：显式确认来源仍在，失效态回到 active。
 * 只允许人工/受控流程调用 —— 重摄流程绝不许自动把 source_stale 洗回 active（见 lifecycle 注释）。
 */
export async function reconfirmRuleSource(ruleId: number, reviewedBy: number): Promise<RuleRow> {
  if (!Number.isInteger(ruleId) || ruleId <= 0) throw new ReactionStateError(`非法规则 id: ${ruleId}`)
  if (!Number.isInteger(reviewedBy) || reviewedBy <= 0) throw new ReactionStateError(`非法复核人 id: ${reviewedBy}`)
  return withTransaction(async conn => {
    const [rows] = await conn.query<RowDataPacket[]>(
      `SELECT ${RULE_COLS} FROM reaction_rule WHERE id = ? FOR UPDATE`,
      [ruleId],
    )
    const r = (rows as DbRow[])[0]
    if (!r) throw new ReactionStateError(`规则不存在: ${ruleId}`)
    const cur = mapRule(r)
    if (cur.sourceState === 'active') throw new ReactionStateError('规则来源本就是 active，无需复核')
    await conn.query(
      `UPDATE reaction_rule SET source_state = 'active', source_rechecked_by = ?, source_rechecked_at = NOW()
        WHERE id = ?`,
      [reviewedBy, ruleId],
    )
    const [after] = await conn.query<RowDataPacket[]>(
      `SELECT ${RULE_COLS} FROM reaction_rule WHERE id = ?`,
      [ruleId],
    )
    return mapRule((after as DbRow[])[0]!)
  })
}

// ── 规则查询（Agent 4 用）─────────────────────────────────────────────────────
export interface RuleQueryOptions {
  /** 默认 false：只回 active。source_state 一律原样带出，由调用方决定要不要降权/加警示 */
  includeSuperseded?: boolean
  limit?: number
}

function ruleStatusClause(opts: RuleQueryOptions, where: string[], params: unknown[]): void {
  if (!opts.includeSuperseded) where.push(`status = 'active'`)
  params.push(opts.limit ?? 50)
}

/**
 * 按物质对查正式规则（主查询路径）。**只回有记录的规则**：
 * 空数组只代表"库里没有这条记录"，不代表"两者相容" —— 这层语义由 Agent 4 的返回状态负责。
 */
export async function findRulesByPairKeys(pairKeys: string[], opts: RuleQueryOptions = {}): Promise<RuleRow[]> {
  if (!pairKeys.length) return []
  const where: string[] = ['pair_key IN (?)']
  const params: unknown[] = [pairKeys]
  ruleStatusClause(opts, where, params)
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT ${RULE_COLS} FROM reaction_rule WHERE ${where.join(' AND ')} ORDER BY id LIMIT ?`,
    params,
  )
  return (rows as DbRow[]).map(mapRule)
}

/**
 * 按单个实体键查（名称查询路径）。
 * 注意：只能命中以同一 entity_key 口径落库的规则；调用方拿到用户输入的名称后，
 * 应先在 reagent 表用 cas_number/name 索引把名称解析成 CAS，再算 `cas:<CAS>` 来查（见报告）。
 */
export async function findRulesByEntityKey(entityKey: string, opts: RuleQueryOptions = {}): Promise<RuleRow[]> {
  const where: string[] = ['(subject_key = ? OR object_key = ?)']
  const params: unknown[] = [entityKey, entityKey]
  ruleStatusClause(opts, where, params)
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT ${RULE_COLS} FROM reaction_rule WHERE ${where.join(' AND ')} ORDER BY id LIMIT ?`,
    params,
  )
  return (rows as DbRow[]).map(mapRule)
}

/** 按来源文档反查规则（文档删除/重摄影响面评估） */
export async function findRulesByDocId(docId: string): Promise<RuleRow[]> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT ${RULE_COLS} FROM reaction_rule WHERE source_doc_id = ? ORDER BY id`,
    [docId],
  )
  return (rows as DbRow[]).map(mapRule)
}
