// 候选关系抽取 CLI：bun run extract -- [--limit N] [--doc <doc_id>] [--dry-run] [--source qdrant|local] [--select-only]
//
// 定位（与 scripts/ingest.ts / reingest.ts 的分工）：
//   ingest 是"文档 → 向量库"的摄取；本脚本是"向量库 → 候选"的抽取，**跑在 gate 之后**：
//   只读 ingest_log.status='done' 的文档（gate 写在 SQL 里，见 src/reaction/extract/docs.ts）。
//   刻意**不做成上传即自动抽取**：一次全库抽取 = 1740 份文档 × 若干 chunk 次 LLM 调用，
//   成本不可控且会跟着上传动作随机发生。抽取必须是一个显式的、带 --limit 的运维动作。
//
// 产物边界：只写 reaction_candidate（候选，待人工审核）。
//   正式规则（reaction_rule）只能由人审通过后走 store.publishRule —— 本脚本不碰、也没法碰。
//
// 开关：
//   --limit N        最多处理 N 份文档（默认 50；跑全库请显式给大值，别让一次手滑烧掉预算）
//   --doc <doc_id>   只抽某一份文档
//   --dry-run        只选 chunk + 统计，不调 LLM、不写候选、不标 stale
//   --select-only    只跑 chunk 选择（不调 LLM、不写库），用于核对"这份文档到底哪些块会被抽"
//   --source qdrant  从向量库取 chunk（默认；要求 Qdrant 在跑）
//   --source local   用本地语料文件重建 chunk（离线核对用，要求 ingest_log.file 可读）
import { pool } from '../src/db/mysql'
import { listExcludedDocs, listExtractTargets, poolRunner, resolveDocFile, type SqlRunner } from '../src/reaction/extract/docs'
import { LocalCorpusChunkSource, QdrantChunkSource, type ChunkSource } from '../src/reaction/extract/chunkSource'
import { extractLogReady, writeExtractLog } from '../src/reaction/extract/log'
import { createLlmExtractor } from '../src/reaction/extract/llm'
import { DEFAULT_MAX_CHUNKS_PER_DOC, EXTRACTOR_VERSION, runExtraction, type CandidateWriter } from '../src/reaction/extract/pipeline'
import { selectChunks, summarizeSelection } from '../src/reaction/extract/select'
import type { ExtractDocResult } from '../src/reaction/extract/types'
import * as store from '../src/reaction/store'

const argv = process.argv.slice(2)

function flagValue(name: string): string | undefined {
  const i = argv.indexOf(name)
  return i >= 0 ? argv[i + 1] : undefined
}
const has = (name: string): boolean => argv.includes(name)

const limit = Number(flagValue('--limit') ?? 50) || 50
const docId = flagValue('--doc')
const dryRun = has('--dry-run')
const selectOnly = has('--select-only')
const sourceName = flagValue('--source') ?? 'qdrant'

if (!['qdrant', 'local'].includes(sourceName)) {
  console.error(`usage: bun run extract -- [--limit N] [--doc <doc_id>] [--dry-run] [--source qdrant|local] [--select-only]`)
  process.exit(1)
}

const db: SqlRunner = poolRunner(pool)

/** 抽取批次 id：同一批次内重跑是幂等的（candidate_key 不变，只刷 last_seen_run_id） */
function newRunId(): string {
  const ts = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14)
  const rand = String(Math.floor(Math.random() * 10000)).padStart(4, '0')
  return `react-${ts}-${rand}`
}

const runId = newRunId()

// ── gate：只处理已入库（quality gate 已放行）的文档 ──
const targets = await listExtractTargets(db, { docId, limit })
const excluded = await listExcludedDocs(db, { docId })
if (!targets.length) {
  console.error(
    docId
      ? `没有可抽取的文档：doc_id=${docId} 不在 ingest_log 且 status='done'（review/quarantined/failed 的文档不许抽）`
      : "没有可抽取的文档：ingest_log 里没有 status='done' 的行",
  )
  process.exit(1)
}

const chunkSource: ChunkSource =
  sourceName === 'local'
    ? new LocalCorpusChunkSource(docId0 => resolveDocFile(db, docId0))
    : new QdrantChunkSource()

console.log(`抽取批次 ${runId}  抽取器 ${EXTRACTOR_VERSION}  来源 ${chunkSource.name}  ${dryRun ? '[dry-run]' : ''}`)
console.log(`目标文档 ${targets.length} 份（gate: ingest_log.status='done'）；被 gate 排除 ${excluded.length} 份${excluded.length ? '（' + excluded.map(e => `${e.docId}:${e.status}`).slice(0, 5).join(', ') + (excluded.length > 5 ? ' …' : '') + '）' : ''}`)

// ── select-only：只核对"哪些块会被抽"，不烧调用 ──
if (selectOnly) {
  let selected = 0
  let loaded = 0
  for (const t of targets) {
    try {
      const chunks = await chunkSource.loadChunks(t.docId)
      loaded += chunks.length
      const sel = selectChunks(chunks)
      const sum = summarizeSelection(sel)
      selected += sel.selected.length
      console.log(
        `  ${t.docId}  chunks=${chunks.length} 选中=${sel.selected.length}  ${JSON.stringify(sum.selectReasons)}  跳过=${JSON.stringify(sum.skipReasons)}`,
      )
    } catch (e) {
      console.log(`  ${t.docId}  取 chunk 失败：${(e as Error).message.slice(0, 120)}`)
    }
  }
  console.log(`\n共取 chunk ${loaded} 块，判定该抽 ${selected} 块。本轮未调用 LLM、未写任何候选。`)
  process.exit(0)
}

// ── 真抽取前先确认台账表在（缺表就直接报错，别让用户对着满屏 warn 猜）──
if (!dryRun && !(await extractLogReady(db))) {
  console.error('缺表 reaction_extract_log：请先执行 deploy/sql/03_reaction_extract_log.sql')
  process.exit(1)
}

const writer: CandidateWriter = {
  upsertCandidate: (input, chunkText) => store.upsertCandidate(input, chunkText),
  markStaleForDoc: (docId0, runId0) => store.markStaleForDoc(docId0, runId0),
}

console.log(`每份文档最多抽 ${DEFAULT_MAX_CHUNKS_PER_DOC} 块；LLM 调用不超过 ${targets.length * DEFAULT_MAX_CHUNKS_PER_DOC} 次\n`)

const summary = await runExtraction(
  targets.map(t => t.docId),
  {
    chunkSource,
    extractor: createLlmExtractor(),
    writer,
    runId,
    extractorVersion: EXTRACTOR_VERSION,
    ...(dryRun ? { dryRun: true } : {}),
    // dry-run 不写台账：dry-run 的契约是"零副作用"，连过程记录也不落
    ...(dryRun ? {} : { onDocResult: (result: ExtractDocResult) => writeExtractLog(db, { runId, extractorVersion: EXTRACTOR_VERSION, result }) }),
  },
  excluded,
)

for (const d of summary.docs) {
  console.log(
    `${d.status.padEnd(7)} ${d.docId}  块=${d.chunksTotal} 选=${d.chunksSelected} 调用=${d.llmCalls} 失败=${d.llmFailures} ` +
      `候选=${d.accepted} 入库=${d.written} 拒=${d.rejected} 落库失败=${d.writeFailures} 标stale=${d.staleMarked}`,
  )
  if (Object.keys(d.stats.rejections).length) console.log(`    拒绝明细 ${JSON.stringify(d.stats.rejections)}`)
  if (d.error) console.log(`    错误 ${d.error}`)
}

const tally = summary.docs.reduce<Record<string, number>>((m, d) => ((m[d.status] = (m[d.status] ?? 0) + 1), m), {})
console.log(
  `\n完 ${summary.docs.length} 份:` +
    Object.entries(tally).map(([k, v]) => ` ${k}=${v}`).join('') +
    `\nLLM 调用 ${summary.llmCalls}  候选 ${summary.accepted}  入库 ${summary.written}  被拒 ${summary.rejected}` +
    `\n⚠️ 候选只是候选：未人工审核前不得对外作答；本轮未写任何 reaction_rule。`,
)

// 硬退：mysql 连接池会吊住事件循环（scripts/ingest.ts 同款血泪）
process.exit(0)
