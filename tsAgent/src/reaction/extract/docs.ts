// 试剂禁配/相容性安全知识 —— 文档选择（只读 ingest_log，**gate 写在 SQL 的 WHERE 里**）
//
// 铁律：只处理 ingest_log.status='done' 的文档。
//   为什么把 gate 写进 SQL 而不是"查出来再 filter"：过滤器可以被人顺手删掉/改写条件，
//   而 SQL 的 WHERE 是这一层唯一的存在理由 —— 有测试直接断言 SQL 里有 status='done'（见 docs.test.ts），
//   谁把 gate 拿掉，测试当场红。
//   gate 的语义：status='done' 是**摄取侧的后门质检已经放行**（gate/quality.ts 无红无黄）的标记；
//   review/quarantined/failed 的文档本身还在人审/隔离队列里，从它们抽候选等于绕过第一道闸。
//
// 依赖注入：只依赖一个"能跑 SQL 的对象"，不 import db/mysql —— 这样文档选择的 SQL 拼装
// 可以在离线单测里逐字断言，连库测试只在需要时注入真池子。
import type { Pool } from 'mysql2/promise'

/** 最小 SQL 依赖：返回行数组即可（`SqlRunner` 这个名字对应"只跑 SELECT"的用法） */
export interface SqlRunner {
  query(sql: string, params?: unknown[]): Promise<unknown>
}

/** 把 mysql2 连接池包成 SqlRunner（只取 rows，丢掉 fields） */
export function poolRunner(pool: Pool): SqlRunner {
  return { query: async (sql, params) => (await pool.query(sql, params as never))[0] }
}

export interface TargetDoc {
  docId: string
  file: string
  chunks: number
  status: string
}

export interface DocQueryOptions {
  /** 只抽某一份文档（CLI --doc） */
  docId?: string
  /** 最多取多少份（CLI --limit） */
  limit?: number
}

/** status 白名单：字面量，不许从外部传进来（能传就能被改成 'review'） */
const DONE_STATUS = 'done'

/**
 * 目标文档查询（纯函数，可逐字断言）。
 * 排序：doc_id 升序 —— 确定的顺序让 --limit 有可复现的含义（"跑前 N 份"每次是同一批）。
 */
export function buildTargetDocQuery(opts: DocQueryOptions = {}): { sql: string; params: unknown[] } {
  const where = [`status = '${DONE_STATUS}'`]
  const params: unknown[] = []
  if (opts.docId) {
    where.push('doc_id = ?')
    params.push(opts.docId)
  }
  const limit = Math.max(1, Math.floor(opts.limit ?? 500))
  params.push(limit)
  return {
    sql: `SELECT doc_id, file, chunks, status FROM ingest_log WHERE ${where.join(' AND ')} ORDER BY doc_id LIMIT ?`,
    params,
  }
}

/**
 * 被 gate 挡掉的文档（docId + 它当前的 status），用于在报告里说清"为什么没抽它"。
 * 刻意与目标查询同源同参：两个查询的补集就是 ingest_log 全集，
 * 若哪天有人把 gate 放宽，这里会立刻体现出"被排除的变少了"。
 */
export function buildExcludedDocQuery(opts: DocQueryOptions = {}): { sql: string; params: unknown[] } {
  const where = [`status <> '${DONE_STATUS}'`]
  const params: unknown[] = []
  if (opts.docId) {
    where.push('doc_id = ?')
    params.push(opts.docId)
  }
  return {
    sql: `SELECT doc_id, status FROM ingest_log WHERE ${where.join(' AND ')} ORDER BY doc_id`,
    params,
  }
}

/** 取出本轮可以抽取的文档（gate 在 SQL 里） */
export async function listExtractTargets(db: SqlRunner, opts: DocQueryOptions = {}): Promise<TargetDoc[]> {
  const { sql, params } = buildTargetDocQuery(opts)
  const rows = (await db.query(sql, params)) as Record<string, unknown>[]
  return rows.map(r => ({
    docId: String(r.doc_id),
    file: String(r.file ?? ''),
    chunks: Number(r.chunks ?? 0),
    status: String(r.status),
  }))
}

/** 取出被 gate 排除的文档（只用于报告/日志，不参与抽取） */
export async function listExcludedDocs(db: SqlRunner, opts: DocQueryOptions = {}): Promise<{ docId: string; status: string }[]> {
  const { sql, params } = buildExcludedDocQuery(opts)
  const rows = (await db.query(sql, params)) as Record<string, unknown>[]
  return rows.map(r => ({ docId: String(r.doc_id), status: String(r.status) }))
}

/** doc_id → 本地文件路径（离线重建用；取不到返回 null） */
export async function resolveDocFile(db: SqlRunner, docId: string): Promise<string | null> {
  const rows = (await db.query('SELECT file FROM ingest_log WHERE doc_id = ? LIMIT 1', [docId])) as Record<string, unknown>[]
  const f = rows[0]?.file
  return typeof f === 'string' && f ? f : null
}
