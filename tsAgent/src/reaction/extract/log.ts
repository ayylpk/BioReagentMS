// 试剂禁配/相容性安全知识 —— 抽取批次台账 reaction_extract_log（表在 deploy/sql/03_*.sql）
//
// 定位：**旁路台账**，与 store.ts 的候选/规则表立场相反。
//   候选写失败必须抛（那是主产物，写不进去等于结论丢了）；
//   台账写失败只 warn（它只记过程，丢了不影响候选正确性，不该把整批抽取拖崩）。
//   —— 但"库不可用"要能被看见，所以 CLI 启动时会先探一次表在不在，缺表直接报错退出。
//
// 落到这张表而不是 ingest_log.flags 的理由（也写在 03_*.sql 顶部）：
//   抽取是**另一条流水线**，同一份文档会被跑很多轮（换 extractor_version 就重跑一次），
//   ingest_log 一行一文档的结构塞不下"多轮 × 每轮计数"。
import type { ExtractDocResult, ExtractStats } from './types'
import type { SqlRunner } from './docs'

export const EXTRACT_LOG_TABLE = 'reaction_extract_log'

export interface ExtractLogEntry {
  runId: string
  extractorVersion: string
  result: ExtractDocResult
}

/** 台账一行的对外视图 */
export interface ExtractLogRow {
  runId: string
  docId: string
  extractorVersion: string
  status: string
  chunksTotal: number
  chunksSelected: number
  llmCalls: number
  llmFailures: number
  accepted: number
  written: number
  rejected: number
  writeFailures: number
  staleMarked: number
  stats: ExtractStats
  error: string | null
}

const ERROR_MAX = 1000

/**
 * 入参拼装（**纯函数，可单测**）。
 * 为什么单独抽出来测：hazards_json/conditions_json 那类 MySQL JSON 列，写裸对象时
 * mysql2 会按 `k=v` 转义写坏（本仓已踩过），所以三个 JSON 列必须自己 JSON.stringify。
 * 这个错误在离线环境里完全看不出来，只有连库跑一轮才发现 —— 所以把它做成可断言的纯函数。
 */
export function toLogParams(entry: ExtractLogEntry): unknown[] {
  const r = entry.result
  const err = r.error ? r.error.slice(0, ERROR_MAX) : null
  return [
    entry.runId,
    r.docId,
    entry.extractorVersion,
    r.status,
    r.chunksTotal,
    r.chunksSelected,
    r.llmCalls,
    r.llmFailures,
    r.accepted,
    r.written,
    r.rejected,
    r.writeFailures,
    r.staleMarked,
    JSON.stringify(r.stats.skipReasons),
    JSON.stringify(r.stats.rejections),
    JSON.stringify(r.stats.notes),
    err,
  ]
}

/** 台账写入 SQL：同一 (run_id, doc_id) 重复执行是幂等更新，不刷历史行 */
export const EXTRACT_LOG_UPSERT_SQL = `INSERT INTO ${EXTRACT_LOG_TABLE} (
  run_id, doc_id, extractor_version, status,
  chunks_total, chunks_selected, llm_calls, llm_failures,
  accepted, written, rejected, write_failures, stale_marked,
  skip_json, reject_json, note_json, error_text
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
ON DUPLICATE KEY UPDATE
  extractor_version = VALUES(extractor_version), status = VALUES(status),
  chunks_total = VALUES(chunks_total), chunks_selected = VALUES(chunks_selected),
  llm_calls = VALUES(llm_calls), llm_failures = VALUES(llm_failures),
  accepted = VALUES(accepted), written = VALUES(written), rejected = VALUES(rejected),
  write_failures = VALUES(write_failures), stale_marked = VALUES(stale_marked),
  skip_json = VALUES(skip_json), reject_json = VALUES(reject_json), note_json = VALUES(note_json),
  error_text = VALUES(error_text)`

/** 写一条台账。失败只 warn：台账不是安全判定的依据（候选/规则表才是） */
export async function writeExtractLog(db: SqlRunner, entry: ExtractLogEntry): Promise<void> {
  try {
    await db.query(EXTRACT_LOG_UPSERT_SQL, toLogParams(entry))
  } catch (e) {
    console.warn(`[reaction/extract] 台账写入跳过（${EXTRACT_LOG_TABLE} 缺表或 MySQL 未起）: ${(e as Error).message.slice(0, 120)}`)
  }
}

/** 表是否已就绪（CLI 启动时探一次，缺表就直接报错退出，别让用户对着满屏 warn 猜） */
export async function extractLogReady(db: SqlRunner): Promise<boolean> {
  try {
    const rows = (await db.query(
      'SELECT table_name t FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = ?',
      [EXTRACT_LOG_TABLE],
    )) as unknown[]
    return Array.isArray(rows) && rows.length > 0
  } catch {
    return false
  }
}

const toJson = <T>(v: unknown): T | null => {
  if (v === null || v === undefined) return null
  return (typeof v === 'string' ? JSON.parse(v) : v) as T
}

/** 反查某文档的抽取历史（排查"这份文档为什么没出候选"） */
export async function listExtractLog(db: SqlRunner, docId: string, limit = 20): Promise<ExtractLogRow[]> {
  const rows = (await db.query(
    `SELECT run_id, doc_id, extractor_version, status, chunks_total, chunks_selected,
            llm_calls, llm_failures, accepted, written, rejected, write_failures, stale_marked,
            skip_json, reject_json, note_json, error_text
       FROM ${EXTRACT_LOG_TABLE} WHERE doc_id = ? ORDER BY created_at DESC, id DESC LIMIT ?`,
    [docId, Math.max(1, Math.floor(limit))],
  )) as Record<string, unknown>[]
  return rows.map(r => ({
    runId: String(r.run_id),
    docId: String(r.doc_id),
    extractorVersion: String(r.extractor_version),
    status: String(r.status),
    chunksTotal: Number(r.chunks_total),
    chunksSelected: Number(r.chunks_selected),
    llmCalls: Number(r.llm_calls),
    llmFailures: Number(r.llm_failures),
    accepted: Number(r.accepted),
    written: Number(r.written),
    rejected: Number(r.rejected),
    writeFailures: Number(r.write_failures),
    staleMarked: Number(r.stale_marked),
    stats: {
      skipReasons: toJson<ExtractStats['skipReasons']>(r.skip_json) ?? {},
      selectReasons: {},
      rejections: toJson<ExtractStats['rejections']>(r.reject_json) ?? {},
      notes: toJson<ExtractStats['notes']>(r.note_json) ?? {},
    },
    error: r.error_text ? String(r.error_text) : null,
  }))
}
