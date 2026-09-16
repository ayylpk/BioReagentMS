// 试剂禁配/相容性安全知识 —— 抽取编排（依赖全部注入，可全离线测试）
//
// 本文件是"抽取在 gate 之后"这句话的落点：
//   文档必须先被摄取流水线跑到 ingest_log.status='done'，才可能出现在这里（见 docs.ts 的 SQL gate）；
//   本流水线只写 reaction_candidate（靠 CandidateWriter 窄接口），
//   **一行都不写 reaction_rule** —— 正式规则的唯一入口是 store.publishRule（人工审核之后）。
//   所以 CandidateWriter 这个接口里刻意没有 publish 相关方法："抽取出正式规则"在类型上就写不出来。
//
// 三条不可动摇的行为（都有单测钉住）：
//   ① LLM / 落库失败**不得**让文档"没抽过"：记 failed、继续处理其它 chunk、其余候选照写。
//   ② 每份文档跑完（**含失败、含无可抽 chunk**）都必须调 markStaleForDoc：
//      否则该文档上一轮留下的 pending 候选会永远 active —— 证据早就不在了，人审却还能通过它。
//   ③ 空数组是合法结果。0 条候选不等于"安全"，它只等于"这份文档没说"；
//      这个语义由候选表（没有行）承载，台账里记 done + accepted=0。
import type { Chunk } from '../../rag/inspect/profile'
import type { ReactionCandidateInputRaw } from '../types'
import type { ChunkSource } from './chunkSource'
import type { RelationExtractor } from './llm'
import { selectChunks, summarizeSelection } from './select'
import { summarizeValidation, validateRelations } from './validate'
import {
  emptyStats,
  type ExtractDocResult,
  type ExtractRunSummary,
  type ExtractStats,
  type NormalizationNote,
  type RejectionCode,
  type SkipReason,
} from './types'

/** 抽取器版本：改判定逻辑（提示词/校验/归一化）必须升它。
 *  注意 store 的 ODKU 只刷新 last_seen_run_id、保留首见判定 —— 改判**不能靠重跑**，
 *  要靠换 extractor_version 让新候选成为新行（旧行留痕、不被悄悄改写）。 */
export const EXTRACTOR_VERSION = 'react-extract/0.1.0'

/** 单文档最多抽多少个 chunk（成本闸门；选择阶段已按优先级排序，超出的都是最不优先的） */
export const DEFAULT_MAX_CHUNKS_PER_DOC = 12

/** 候选写入的窄接口（store.ts 满足它；测试注入内存实现） */
export interface CandidateWriter {
  upsertCandidate(input: ReactionCandidateInputRaw, chunkText: string): Promise<unknown>
  markStaleForDoc(docId: string, runId: string): Promise<number>
}

export interface ExtractPipelineDeps {
  chunkSource: ChunkSource
  extractor: RelationExtractor
  writer: CandidateWriter
  /** 本轮批次 id：候选靠它判定"本轮还见过没"，是重摄失效机制的唯一输入 */
  runId: string
  extractorVersion?: string
  dryRun?: boolean
  maxChunksPerDoc?: number
  /** 每份文档收尾回调（写台账用）；抛错不影响抽取结果 */
  onDocResult?: (result: ExtractDocResult) => Promise<void> | void
}

const msg = (e: unknown): string => (e instanceof Error ? e.message : String(e))

function bump<K extends string>(map: Partial<Record<K, number>>, key: K, by = 1): void {
  map[key] = (map[key] ?? 0) + by
}

function mergeStats(target: ExtractStats, src: Partial<ExtractStats>): void {
  for (const [k, v] of Object.entries(src.skipReasons ?? {})) bump(target.skipReasons, k as SkipReason, v as number)
  for (const [k, v] of Object.entries(src.selectReasons ?? {})) bump(target.selectReasons, k, v as number)
  for (const [k, v] of Object.entries(src.rejections ?? {})) bump(target.rejections, k as RejectionCode, v as number)
  for (const [k, v] of Object.entries(src.notes ?? {})) bump(target.notes, k as NormalizationNote, v as number)
}

/**
 * 来源失效清扫（重摄收尾）。dry-run 时**不碰库**；其余情况一律要跑，失败要显形。
 * 抽出来单独一个函数，是为了让"失败路径也调它"在代码里只有一处、不会被漏掉。
 */
async function sweepStale(docId: string, deps: ExtractPipelineDeps, errors: string[]): Promise<number> {
  if (deps.dryRun) return 0
  try {
    return await deps.writer.markStaleForDoc(docId, deps.runId)
  } catch (e) {
    errors.push(`来源清扫失败（旧 pending 候选可能滞留 active）：${msg(e)}`)
    return 0
  }
}

/**
 * 单文档抽取核心（不碰数据源，直接吃 chunks —— 离线测试的主入口）。
 * 流程：选择 → 逐 chunk 调 LLM（失败只丢该块）→ 确定性校验 → 逐条写候选 → 来源清扫。
 */
export async function extractChunks(docId: string, chunks: readonly Chunk[], deps: ExtractPipelineDeps): Promise<ExtractDocResult> {
  const stats = emptyStats()
  const errors: string[] = []
  const maxChunks = deps.maxChunksPerDoc ?? DEFAULT_MAX_CHUNKS_PER_DOC

  const selection = selectChunks(chunks)
  mergeStats(stats, summarizeSelection(selection))
  const bySeq = new Map(chunks.map(c => [c.seq, c]))
  const picked = selection.selected.slice(0, Math.max(0, maxChunks))

  let llmCalls = 0
  let llmFailures = 0
  let accepted = 0
  let written = 0
  let rejected = 0
  let writeFailures = 0

  for (const item of picked) {
    const chunk = bySeq.get(item.seq)
    if (!chunk) continue
    llmCalls++
    let raw: unknown
    try {
      raw = await deps.extractor.extract(chunk)
    } catch (e) {
      // 一次调用失败只丢这一块：整份文档的其它段落照抽（规格明令不许上抛）
      llmFailures++
      errors.push(`chunk#${chunk.seq} LLM 调用失败：${msg(e)}`)
      continue
    }

    const outcome = validateRelations(raw, chunk.text)
    mergeStats(stats, summarizeValidation(outcome))
    accepted += outcome.accepted.length
    rejected += outcome.rejections.length

    for (const rel of outcome.accepted) {
      if (deps.dryRun) continue
      try {
        await deps.writer.upsertCandidate(
          {
            relationType: rel.relationType,
            subject: rel.subject,
            object: rel.object,
            severity: rel.severity,
            hazards: rel.hazards,
            conditions: rel.conditions,
            confidence: rel.confidence,
            evidenceText: rel.evidenceText,
            extractorVersion: deps.extractorVersion ?? EXTRACTOR_VERSION,
            runId: deps.runId,
            // 定位快照：chunkId 省略 → store 用 pointId(docId, seq) 复算（口径只有一处）
            source: {
              docId,
              chunkSeq: chunk.seq,
              page: chunk.page ?? null,
              section: chunk.section ?? null,
              tableId: chunk.tableId ?? null,
              bbox: chunk.bbox ?? null,
            },
          },
          chunk.text,
        )
        written++
      } catch (e) {
        // 落库失败 = 结论没进去，必须显形（不能像 LLM 失败那样只记一笔就过）
        writeFailures++
        errors.push(`chunk#${chunk.seq} 候选落库失败：${msg(e)}`)
      }
    }
  }

  // ② 无论前面发生了什么，收尾必扫（含 llmFailures / writeFailures / picked.length=0）
  const staleMarked = await sweepStale(docId, deps, errors)

  const nothingSelected = picked.length === 0
  const hadFailure = llmFailures > 0 || writeFailures > 0 || errors.length > 0
  // empty=根本没有可抽的块 / failed=过程中有失败 / done=跑完了（accepted 可以为 0，那不是"安全"）
  const status: ExtractDocResult['status'] = hadFailure ? 'failed' : nothingSelected ? 'empty' : 'done'

  const result: ExtractDocResult = {
    docId,
    status,
    chunksTotal: chunks.length,
    chunksSelected: picked.length,
    llmCalls,
    llmFailures,
    accepted,
    written,
    rejected,
    writeFailures,
    staleMarked,
    stats,
    ...(errors.length ? { error: errors.slice(0, 5).join(' | ') } : {}),
  }
  await notify(deps, result)
  return result
}

/** 收尾回调（台账）：回调自己抛错不许影响抽取结果 */
async function notify(deps: ExtractPipelineDeps, result: ExtractDocResult): Promise<void> {
  if (!deps.onDocResult) return
  try {
    await deps.onDocResult(result)
  } catch (e) {
    console.warn(`[reaction/extract] 收尾回调失败（${result.docId}）: ${msg(e).slice(0, 120)}`)
  }
}

/**
 * 取 chunks → 抽取。取数失败（Qdrant 挂了/文档不存在）同样**必须扫 stale**：
 * 取不到块，说明该文档这一轮的证据一个都没见着，旧候选就该被标成失效等复核。
 */
export async function extractDoc(docId: string, deps: ExtractPipelineDeps): Promise<ExtractDocResult> {
  let chunks: Chunk[]
  try {
    chunks = await deps.chunkSource.loadChunks(docId)
  } catch (e) {
    const errors = [`取 chunk 失败（来源 ${deps.chunkSource.name}）：${msg(e)}`]
    const staleMarked = await sweepStale(docId, deps, errors)
    const result: ExtractDocResult = {
      docId,
      status: 'failed',
      chunksTotal: 0,
      chunksSelected: 0,
      llmCalls: 0,
      llmFailures: 0,
      accepted: 0,
      written: 0,
      rejected: 0,
      writeFailures: 0,
      staleMarked,
      stats: emptyStats(),
      error: errors.join(' | '),
    }
    await notify(deps, result)
    return result
  }
  return extractChunks(docId, chunks, deps)
}

/** 批量跑（CLI 用）。逐份文档独立成败，一份失败不影响下一份 */
export async function runExtraction(
  docIds: readonly string[],
  deps: ExtractPipelineDeps,
  excluded: { docId: string; status: string }[] = [],
): Promise<ExtractRunSummary> {
  const docs: ExtractDocResult[] = []
  for (const docId of docIds) docs.push(await extractDoc(docId, deps))
  return {
    runId: deps.runId,
    extractorVersion: deps.extractorVersion ?? EXTRACTOR_VERSION,
    docs,
    docsExcluded: excluded,
    llmCalls: docs.reduce((n, d) => n + d.llmCalls, 0),
    accepted: docs.reduce((n, d) => n + d.accepted, 0),
    written: docs.reduce((n, d) => n + d.written, 0),
    rejected: docs.reduce((n, d) => n + d.rejected, 0),
    dryRun: !!deps.dryRun,
  }
}
