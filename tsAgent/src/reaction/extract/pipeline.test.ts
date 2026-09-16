// 抽取编排的离线单测（LLM 与存储全部注入，不连模型、不连库）
//
// 这一组测的是"流程的骨架"：失败往哪儿走、收尾有没有漏、幂等键是不是同一个。
// 具体某条关系收不收，是 validate.test.ts 的事 —— 两边不重复测同一件事。
import { describe, expect, test } from 'bun:test'
import type { Chunk } from '../../rag/inspect/profile'
import type { ReactionCandidateInputRaw } from '../types'
import { candidateKeyOf, pairKeyOfRefs } from '../keys'
import type { ChunkSource } from './chunkSource'
import type { RelationExtractor } from './llm'
import { EXTRACTOR_VERSION, extractChunks, extractDoc, runExtraction, type CandidateWriter } from './pipeline'
import type { LlmExtractionLoose } from './types'

// ── 夹具 ──────────────────────────────────────────────────────────────────────
const DOC = 'doc.extract.test'
const CHUNK_TEXT = '硫酸（CAS 7664-93-9）｜10 稳定性和反应性 本品与氢氧化钠（CAS 1310-73-2）剧烈反应，放出大量热，并生成有毒气体。'
const CHUNK_COND_TEXT = '硫酸（CAS 7664-93-9）｜7 操作处置与储存 在高温下与还原剂剧烈反应。'
const EVIDENCE = '本品与氢氧化钠（CAS 1310-73-2）剧烈反应，放出大量热，并生成有毒气体。'

const chunkStable: Chunk = {
  docId: DOC, seq: 3, section: '10 稳定性和反应性', headingPath: ['硫酸SDS', '10 稳定性和反应性'],
  page: 2, bbox: [10, 20, 30, 40], tableId: `${DOC}#5`, text: CHUNK_TEXT,
}
const chunkStorage: Chunk = {
  docId: DOC, seq: 4, section: '7 操作处置与储存', headingPath: ['硫酸SDS', '7 操作处置与储存'],
  text: CHUNK_COND_TEXT,
}
const chunkNoise: Chunk = {
  docId: DOC, seq: 9, section: '毒理学信息', headingPath: ['硫酸SDS', '毒理学信息'],
  text: '毒理学信息 无致癌性资料，未见急性毒性数据。',
}

const OK_RELATION: LlmExtractionLoose = {
  relations: [{
    subject_name: '硫酸', subject_cas: '7664-93-9', subject_kind: 'reagent',
    relation_type: 'incompatible',
    object_name: '氢氧化钠', object_cas: '1310-73-2', object_kind: 'reagent',
    conditions: [], hazards: ['heat', 'toxic_gas'], severity: 'high',
    evidence_quote: EVIDENCE, confidence: 0.9,
  }],
}
const COND_RELATION: LlmExtractionLoose = {
  relations: [{
    subject_name: '硫酸', subject_cas: '7664-93-9', subject_kind: 'reagent',
    relation_type: 'incompatible',
    object_name: '还原剂', object_cas: null, object_kind: 'category',
    conditions: [], hazards: [], severity: 'unknown',
    evidence_quote: '在高温下与还原剂剧烈反应。', confidence: null,
  }],
}

/** 按 seq 给答案的桩 LLM（Error 表示这一次调用失败） */
function stubExtractor(bySeq: Record<number, LlmExtractionLoose | Error>): RelationExtractor & { calls: number[] } {
  const calls: number[] = []
  return {
    name: 'stub',
    calls,
    async extract(chunk: Chunk) {
      calls.push(chunk.seq)
      const r = bySeq[chunk.seq]
      if (r instanceof Error) throw r
      return r ?? { relations: [] }
    },
  }
}

interface Recorded { input: ReactionCandidateInputRaw; chunkText: string }

function makeWriter() {
  const writes: Recorded[] = []
  const sweeps: { docId: string; runId: string }[] = []
  const opts = { failUpsert: false, failSweep: false }
  const writer: CandidateWriter = {
    async upsertCandidate(input, chunkText) {
      if (opts.failUpsert) throw new Error('DB 写入失败（模拟）')
      writes.push({ input, chunkText })
      return { id: writes.length }
    },
    async markStaleForDoc(docId, runId) {
      sweeps.push({ docId, runId })
      if (opts.failSweep) throw new Error('来源清扫失败（模拟）')
      return 1
    },
  }
  return { writer, writes, sweeps, opts }
}

const staticSource = (chunks: Chunk[] | Error): ChunkSource => ({
  name: 'fixture',
  async loadChunks() {
    if (chunks instanceof Error) throw chunks
    return chunks
  },
})

const deps = (over: Partial<Parameters<typeof extractChunks>[2]> = {}) => {
  const w = makeWriter()
  return {
    ...w,
    deps: {
      chunkSource: staticSource([chunkStable, chunkStorage, chunkNoise]),
      extractor: stubExtractor({ 3: OK_RELATION, 4: COND_RELATION }),
      writer: w.writer,
      runId: 'run-1',
      ...over,
    },
  }
}

const keyOf = (w: Recorded): string =>
  candidateKeyOf({
    relationType: w.input.relationType,
    pairKey: pairKeyOfRefs(w.input.subject, w.input.object),
    sourceDocId: w.input.source.docId,
    sourceChunkSeq: w.input.source.chunkSeq,
    evidenceQuote: w.input.evidenceText,
  })

// ── 正向路径 ──────────────────────────────────────────────────────────────────
describe('pipeline：正向路径', () => {
  test('抽到明确禁配 → 写一条候选，来源定位快照与所选 chunk 逐项对得上', async () => {
    const { deps: d, writes, sweeps } = deps()
    const r = await extractChunks(DOC, [chunkStable, chunkStorage, chunkNoise], d)

    expect(r.status).toBe('done')
    expect(r.chunksTotal).toBe(3)
    expect(r.chunksSelected).toBe(2) // 毒理学信息被选择阶段排除
    expect(r.llmCalls).toBe(2)
    expect(r.rejected).toBe(0)
    expect(r.accepted).toBe(2)
    expect(r.written).toBe(2)

    const w = writes.find(x => x.input.source.chunkSeq === 3)!
    expect(w.chunkText).toBe(CHUNK_TEXT) // 证据连续性断言需要原文
    expect(w.input.evidenceText).toBe(EVIDENCE)
    expect(w.input.extractorVersion).toBe(EXTRACTOR_VERSION)
    expect(w.input.runId).toBe('run-1')
    expect(w.input.source).toEqual({
      docId: DOC, chunkSeq: 3, page: 2, section: '10 稳定性和反应性', tableId: `${DOC}#5`, bbox: [10, 20, 30, 40],
    })
    expect('chunkId' in w.input.source).toBe(false) // 留空 → 交给 store 用 pointId 复算，口径只有一处
    expect(sweeps).toEqual([{ docId: DOC, runId: 'run-1' }])
  })

  test('条件句的 conditions 原样落到候选（不是只留在自由文本里）', async () => {
    const { deps: d, writes } = deps()
    await extractChunks(DOC, [chunkStable, chunkStorage, chunkNoise], d)
    const w = writes.find(x => x.input.source.chunkSeq === 4)!
    expect(w.input.conditions).toEqual({ text: ['在高温下'] })
    expect(w.input.object.kind).toBe('category')
  })

  test('选择顺序按优先级：预算只有 1 块时先抽"稳定性和反应性"，不抽"操作处置与储存"', async () => {
    const { deps: d, writes } = deps({ maxChunksPerDoc: 1 })
    const r = await extractChunks(DOC, [chunkStorage, chunkStable, chunkNoise], d)
    expect(r.chunksSelected).toBe(1)
    expect(writes.map(w => w.input.source.chunkSeq)).toEqual([3])
  })
})

// ── 幂等 ──────────────────────────────────────────────────────────────────────
describe('pipeline：重复执行的幂等', () => {
  test('同一份 chunk 跑两轮（不同 runId）→ 候选幂等键完全相同（重跑不产生新候选）', async () => {
    const a = deps({ runId: 'run-1' })
    const b = deps({ runId: 'run-2' })
    await extractChunks(DOC, [chunkStable], a.deps)
    await extractChunks(DOC, [chunkStable], b.deps)
    expect(a.writes).toHaveLength(1)
    expect(b.writes).toHaveLength(1)
    expect(keyOf(a.writes[0]!)).toBe(keyOf(b.writes[0]!))
    // runId 变化只影响"最后见到它的批次"，不影响候选身份
    expect(a.writes[0]!.input.runId).toBe('run-1')
    expect(b.writes[0]!.input.runId).toBe('run-2')
  })
})

// ── 失败与重跑 ────────────────────────────────────────────────────────────────
describe('pipeline：失败旁路化（绝不上抛到文档级）', () => {
  test('LLM 调用失败 → 只丢该 chunk，其它块照抽；文档记 failed 不抛；收尾仍扫 stale', async () => {
    const { deps: d, writes, sweeps } = deps({ extractor: stubExtractor({ 3: new Error('LLM 超时（模拟）'), 4: COND_RELATION }) })
    const r = await extractChunks(DOC, [chunkStable, chunkStorage], d)

    expect(r.status).toBe('failed')
    expect(r.llmFailures).toBe(1)
    expect(r.written).toBe(1) // 另一块照样落库
    expect(writes.map(w => w.input.source.chunkSeq)).toEqual([4])
    expect(r.error).toContain('LLM 超时')
    expect(sweeps).toHaveLength(1) // 失败也必须扫，否则旧候选永远滞留 active
  })

  test('落库失败 → 计入 writeFailures 并显形（不像 LLM 失败那样静默）', async () => {
    const { deps: d, opts } = deps()
    opts.failUpsert = true
    const r = await extractChunks(DOC, [chunkStable], d)
    expect(r.status).toBe('failed')
    expect(r.writeFailures).toBe(1)
    expect(r.accepted).toBe(1)
    expect(r.written).toBe(0)
    expect(r.error).toContain('候选落库失败')
  })

  test('来源清扫失败 → 记 failed 且写明后果（"旧 pending 候选可能滞留 active"）', async () => {
    const { deps: d, opts } = deps()
    opts.failSweep = true
    const r = await extractChunks(DOC, [chunkStable], d)
    expect(r.status).toBe('failed')
    expect(r.error).toContain('来源清扫失败')
    expect(r.staleMarked).toBe(0)
  })

  test('取 chunk 失败（向量库挂了）→ 文档记 failed 且**仍然**扫 stale，绝不上抛', async () => {
    const { deps: d, sweeps, writes } = deps({ chunkSource: staticSource(new Error('Qdrant 连接失败（模拟）')) })
    const r = await extractDoc(DOC, d)
    expect(r.status).toBe('failed')
    expect(r.error).toContain('Qdrant 连接失败')
    expect(writes).toHaveLength(0)
    expect(sweeps).toEqual([{ docId: DOC, runId: 'run-1' }])
  })

  test('台账回调抛错不影响抽取结果（台账是旁路，不是主产物）', async () => {
    const { deps: d, writes } = deps({ onDocResult: () => { throw new Error('台账表不存在（模拟）') } })
    const r = await extractChunks(DOC, [chunkStable], d)
    expect(r.status).toBe('done')
    expect(writes).toHaveLength(1)
  })
})

// ── 空结果是合法结果 ──────────────────────────────────────────────────────────
describe('pipeline：空数组 = 原文没写，不是"安全"', () => {
  test('桩 LLM 返回空数组 → done，0 候选，且不留任何候选行', async () => {
    const { deps: d, writes } = deps({ extractor: stubExtractor({}) })
    const r = await extractChunks(DOC, [chunkStable, chunkStorage], d)
    expect(r.status).toBe('done')
    expect(r.accepted).toBe(0)
    expect(r.written).toBe(0)
    expect(writes).toEqual([])
    expect(r.llmCalls).toBe(2) // 确实问过模型，只是它说没有
  })

  test('全部关系都被确定性校验拒掉 → done + rejected 计数（不写候选，但过程可见）', async () => {
    const { deps: d, writes } = deps({ extractor: stubExtractor({ 3: { relations: [{ ...OK_RELATION.relations[0]!, severity: 'severe' }] } }) })
    const r = await extractChunks(DOC, [chunkStable], d)
    expect(r.status).toBe('done')
    expect(r.accepted).toBe(0)
    expect(r.rejected).toBe(1)
    expect(r.stats.rejections).toEqual({ SCHEMA_INVALID: 1 })
    expect(writes).toEqual([])
  })

  test('没有可抽的 chunk → empty（连 LLM 都不调），但收尾仍然扫 stale', async () => {
    const { deps: d, sweeps } = deps()
    const r = await extractChunks(DOC, [chunkNoise], d)
    expect(r.status).toBe('empty')
    expect(r.chunksSelected).toBe(0)
    expect(r.llmCalls).toBe(0)
    expect(r.stats.skipReasons).toEqual({ section_not_safety: 1 })
    expect(sweeps).toHaveLength(1)
  })

  test('选择阶段的 skip 统计进 stats，能回答"为什么这份文档一条都没出"', async () => {
    const { deps: d } = deps()
    const r = await extractChunks(DOC, [chunkStable, chunkNoise], d)
    expect(r.stats.selectReasons).toEqual({ sds_section: 1 })
    expect(r.stats.skipReasons).toEqual({ section_not_safety: 1 })
  })
})

// ── dry-run ───────────────────────────────────────────────────────────────────
describe('pipeline：dry-run 零副作用', () => {
  test('dry-run 仍然调 LLM 并统计，但不写候选、不扫 stale', async () => {
    const { deps: d, writes, sweeps } = deps({ dryRun: true })
    const r = await extractChunks(DOC, [chunkStable, chunkStorage], d)
    expect(r.llmCalls).toBe(2)
    expect(r.accepted).toBe(2)
    expect(r.written).toBe(0)
    expect(writes).toEqual([])
    expect(sweeps).toEqual([])
  })
})

// ── 批量 ──────────────────────────────────────────────────────────────────────
describe('pipeline：批量抽取逐份独立', () => {
  test('一份失败不挡下一份；汇总数带出"被 gate 排除"的文档', async () => {
    let call = 0
    const source: ChunkSource = {
      name: 'fixture',
      async loadChunks() {
        call++
        if (call === 1) throw new Error('第一份取数失败（模拟）')
        return [chunkStable]
      },
    }
    const { deps: d } = deps({ chunkSource: source })
    const summary = await runExtraction(['doc.a', 'doc.b'], d, [{ docId: 'doc.x', status: 'review' }])

    expect(summary.docs.map(x => x.status)).toEqual(['failed', 'done'])
    expect(summary.docsExcluded).toEqual([{ docId: 'doc.x', status: 'review' }])
    expect(summary.written).toBe(1)
    expect(summary.extractorVersion).toBe(EXTRACTOR_VERSION)
    expect(summary.dryRun).toBe(false)
  })
})
