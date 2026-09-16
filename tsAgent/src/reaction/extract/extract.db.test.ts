// 连库往返测试：抽取流水线 × 真实 store（幂等 / 重摄失效 / JSON 列往返 / 绝不碰规则表）
//   —— 这些行为在有 Qdrant 和真 LLM 之前就能验证，因为它们只依赖"候选写入"这一半。
//
// 纪律（照抄 store.db.test.ts）：
//   库不可用 / 迁移未应用 → **整组跳过**，绝不让离线环境变红；
//   自建数据只落在 'selftest.extract.' 前缀的 doc_id 下，测试前后各清一次。
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import type { Pool, RowDataPacket } from 'mysql2/promise'
import type { Chunk } from '../../rag/inspect/profile'
import type { CandidateWriter } from './pipeline'
import type { LlmExtractionLoose } from './types'

const DOC_PREFIX = 'selftest.extract.'
const RUN_A = 'selftest-run-a'
const RUN_B = 'selftest-run-b'
const SEQ = 3

const T1 = '硫酸（CAS 7664-93-9）｜10 稳定性和反应性 本品与氢氧化钠（CAS 1310-73-2）剧烈反应，放出大量热。'
const T2 = '硫酸（CAS 7664-93-9）｜7 操作处置与储存 须与强碱分开存放，避免与氧化剂接触。'
const T3 = '硫酸（CAS 7664-93-9）｜7 操作处置与储存 在高温下与还原剂剧烈反应。'

const chunkOf = (docId: string, text: string, section: string): Chunk => ({
  docId, seq: SEQ, section, headingPath: ['硫酸SDS', section], page: 3, text,
})

const llm1: LlmExtractionLoose = {
  relations: [{
    subject_name: '硫酸', subject_cas: '7664-93-9', subject_kind: 'reagent',
    relation_type: 'incompatible',
    object_name: '氢氧化钠', object_cas: '1310-73-2', object_kind: 'reagent',
    conditions: [], hazards: ['heat'], severity: 'high',
    evidence_quote: '本品与氢氧化钠（CAS 1310-73-2）剧烈反应，放出大量热。', confidence: 0.8,
  }],
}
const llm2: LlmExtractionLoose = {
  relations: [{
    subject_name: '硫酸', subject_cas: '7664-93-9', subject_kind: 'reagent',
    relation_type: 'storage_separate',
    object_name: '强碱', object_cas: null, object_kind: 'category',
    conditions: [], hazards: [], severity: 'unknown',
    evidence_quote: '须与强碱分开存放，避免与氧化剂接触。', confidence: null,
  }],
}
const llm3: LlmExtractionLoose = {
  relations: [{
    subject_name: '硫酸', subject_cas: '7664-93-9', subject_kind: 'reagent',
    relation_type: 'incompatible',
    object_name: '还原剂', object_cas: null, object_kind: 'category',
    conditions: [], hazards: [], severity: 'medium',
    evidence_quote: '在高温下与还原剂剧烈反应。', confidence: null,
  }],
}

let pipeline: typeof import('./pipeline') | null = null
let store: typeof import('../store') | null = null
let poolRef: Pool | null = null
let logTableReady = false
let skipReason = ''
try {
  const db = await import('../../db/mysql')
  await db.pool.query('SELECT 1')
  const [rows] = await db.pool.query<RowDataPacket[]>(
    'SELECT table_name t FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name IN (?, ?)',
    ['reaction_candidate', 'reaction_extract_log'],
  )
  const names = rows.map(r => String(r.t))
  if (!names.includes('reaction_candidate')) {
    skipReason = '迁移 02_reaction_rule.sql 未应用'
  } else {
    logTableReady = names.includes('reaction_extract_log')
    pipeline = await import('./pipeline')
    store = await import('../store')
    poolRef = db.pool
  }
} catch (e) {
  skipReason = 'MySQL 不可用：' + (e as Error).message.slice(0, 90)
}

/** 用真实 store 当 writer（抽取侧只认这个窄接口） */
const realWriter = (): CandidateWriter => ({
  upsertCandidate: (input, chunkText) => store!.upsertCandidate(input, chunkText),
  markStaleForDoc: (docId, runId) => store!.markStaleForDoc(docId, runId),
})

/** 桩 LLM：按 seq 返回固定结果（本轮不调真模型） */
const stubExtractor = (res: LlmExtractionLoose) => ({
  name: 'stub',
  async extract() { return res },
})

async function cleanup(): Promise<void> {
  const p = poolRef
  if (!p) return
  await p.query('DELETE FROM reaction_candidate WHERE source_doc_id LIKE ?', [DOC_PREFIX + '%'])
  await p.query('DELETE FROM reaction_extract_log WHERE doc_id LIKE ?', [DOC_PREFIX + '%'])
}

describe.skipIf(pipeline === null || store === null || poolRef === null)(`reaction 抽取 × store 连库往返（${skipReason || '可用'}）`, () => {
  beforeAll(cleanup)
  afterAll(cleanup)

  test('重复抽取同一份 chunk（不同 runId）→ 只有一行候选，last_seen_run_id 刷新、来源保持 active', async () => {
    const { extractChunks } = pipeline!
    const docId = DOC_PREFIX + 'idem'
    const chunk = chunkOf(docId, T1, '10 稳定性和反应性')

    const r1 = await extractChunks(docId, [chunk], {
      chunkSource: { name: 'fixture', loadChunks: async () => [chunk] },
      extractor: stubExtractor(llm1), writer: realWriter(), runId: RUN_A,
    })
    expect(r1.status).toBe('done')
    expect(r1.accepted).toBe(1)
    expect(r1.written).toBe(1)

    const r2 = await extractChunks(docId, [chunk], {
      chunkSource: { name: 'fixture', loadChunks: async () => [chunk] },
      extractor: stubExtractor(llm1), writer: realWriter(), runId: RUN_B,
    })
    expect(r2.written).toBe(1)

    const rows = await store!.listCandidates({ docId })
    expect(rows).toHaveLength(1)
    expect(rows[0]!.lastSeenRunId).toBe(RUN_B)
    expect(rows[0]!.sourceState).toBe('active') // 证据背书 → 不掉 stale
    expect(rows[0]!.reviewStatus).toBe('pending')
  })

  test('重摄后证据变了 → 旧候选标 stale（不删行），新证据成新候选并 active', async () => {
    const { extractChunks } = pipeline!
    const docId = DOC_PREFIX + 'restale'
    const before = chunkOf(docId, T1, '10 稳定性和反应性')
    const after = chunkOf(docId, T2, '7 操作处置与储存')

    await extractChunks(docId, [before], {
      chunkSource: { name: 'fixture', loadChunks: async () => [before] },
      extractor: stubExtractor(llm1), writer: realWriter(), runId: RUN_A,
    })
    const fresh = await store!.listCandidates({ docId })
    expect(fresh).toHaveLength(1)
    const oldKey = fresh[0]!.candidateKey

    const r = await extractChunks(docId, [after], {
      chunkSource: { name: 'fixture', loadChunks: async () => [after] },
      extractor: stubExtractor(llm2), writer: realWriter(), runId: RUN_B,
    })
    expect(r.staleMarked).toBe(1) // 上一轮那条 pending 变孤儿

    const rows = await store!.listCandidates({ docId })
    expect(rows).toHaveLength(2) // 绝不物理删除
    const old = rows.find(x => x.candidateKey === oldKey)!
    const neu = rows.find(x => x.candidateKey !== oldKey)!
    expect(old.sourceState).toBe('stale')
    expect(old.reviewStatus).toBe('pending') // 审核维度不被来源维度改写
    expect(neu.sourceState).toBe('active')
    expect(neu.lastSeenRunId).toBe(RUN_B)
    // 孤儿候选能按来源状态单独筛出来给人工复核
    expect((await store!.listCandidates({ docId, sourceState: 'stale' })).map(x => x.candidateKey)).toEqual([oldKey])
  })

  test('conditions / hazards / severity 经真实 JSON 列往返：读回来还是对象与数组', async () => {
    const { extractChunks } = pipeline!
    const docId = DOC_PREFIX + 'json'
    const chunk = chunkOf(docId, T3, '7 操作处置与储存')
    await extractChunks(docId, [chunk], {
      chunkSource: { name: 'fixture', loadChunks: async () => [chunk] },
      extractor: stubExtractor(llm3), writer: realWriter(), runId: RUN_A,
    })

    const row = (await store!.listCandidates({ docId }))[0]!
    expect(row.conditions).toEqual({ text: ['在高温下'] }) // 条件句落进了结构化字段，不是只留在证据文本里
    expect(row.hazards).toEqual([])
    expect(row.severity).toBe('medium')
    expect(row.objectKind).toBe('category')
    expect(row.objectCas).toBeNull()
    expect(row.subjectKey).toBe('cas:7664-93-9')
    expect(row.source.chunkSeq).toBe(SEQ)
    expect(row.source.page).toBe(3)
    expect(row.extractorVersion).toBe('react-extract/0.1.0')
  })

  test('抽取流水线**一行都不写** reaction_rule（正式规则只能人审后发布）', async () => {
    const p = poolRef!
    const [rows] = await p.query<RowDataPacket[]>(
      'SELECT COUNT(*) c FROM reaction_rule WHERE source_doc_id LIKE ?',
      [DOC_PREFIX + '%'],
    )
    expect(Number(rows[0]!.c)).toBe(0)
  })

  test.skipIf(!logTableReady)('抽取台账往返：JSON 统计列写进去能按对象读回来', async () => {
    const { extractChunks } = pipeline!
    const { writeExtractLog, listExtractLog } = await import('./log')
    const db = await import('./docs')
    const docId = DOC_PREFIX + 'log'
    const chunk = chunkOf(docId, T1, '10 稳定性和反应性')
    const runner = db.poolRunner(poolRef!)

    const r = await extractChunks(docId, [chunk], {
      chunkSource: { name: 'fixture', loadChunks: async () => [chunk] },
      extractor: stubExtractor(llm1), writer: realWriter(), runId: RUN_A,
      onDocResult: result => writeExtractLog(runner, { runId: RUN_A, extractorVersion: 'react-extract/0.1.0', result }),
    })
    expect(r.status).toBe('done')

    const logs = await listExtractLog(runner, docId)
    expect(logs).toHaveLength(1)
    expect(logs[0]!.runId).toBe(RUN_A)
    expect(logs[0]!.status).toBe('done')
    expect(logs[0]!.written).toBe(1)
    // 这份夹料只有一块且被选中 → 跳过计数为空；台账不落"选中理由"（可由候选与 chunk 源复算）
    expect(logs[0]!.stats.skipReasons).toEqual({})
    expect(logs[0]!.stats.rejections).toEqual({})
    expect(logs[0]!.error).toBeNull()
  })
})
