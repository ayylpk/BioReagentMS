// chunk 数据源的离线单测：payload 映射、markdown 重建、scroll 翻页（全部用桩，不连 Qdrant）
//
// 为什么值得单测：payload 字段名写错在生产里完全看不出来 —— 抽取照样跑，
// 只是候选的 section/page 全变 null、证据定位错位。这类错只有靠"逐字段断言映射"才能提前抓到。
import { describe, expect, test } from 'bun:test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { docIdOf } from '../../rag/inspect/identity'
import { LocalCorpusChunkSource, QdrantChunkSource, chunkFromPayload, markdownToBlocks, type ScrollClient } from './chunkSource'

const FULL_PAYLOAD = {
  doc_id: 'ICSC-0005-对草快二氯化物',
  source_doc: 'ICSC-0005-对草快二氯化物.md',
  section: '火灾',
  heading_path: ['对草快二氯化物（ICSC 0005）', '火灾'],
  seq: 2,
  cas_number: '1910-42-5',
  page: 1,
  bbox: [10, 20, 30, 40],
  text: '对草快二氯化物（ICSC 0005）｜火灾 在火焰中释放出刺激性或有毒烟雾。',
  table_id: 'ICSC-0005-对草快二氯化物#4',
  table_part: '1/2',
  schema_version: 2,
  chunk_flags: ['[table] 存在超长单行（行原子，未再切）'],
}

describe('chunkFromPayload：payload → Chunk 的忠实映射', () => {
  test('全字段 payload 逐项映射（含数组型 heading_path 与 "1/2" 形态的 table_part）', () => {
    const c = chunkFromPayload(FULL_PAYLOAD)!
    expect(c.docId).toBe('ICSC-0005-对草快二氯化物')
    expect(c.seq).toBe(2)
    expect(c.section).toBe('火灾')
    expect(c.headingPath).toEqual(['对草快二氯化物（ICSC 0005）', '火灾'])
    expect(c.page).toBe(1)
    expect(c.bbox).toEqual([10, 20, 30, 40])
    expect(c.tableId).toBe('ICSC-0005-对草快二氯化物#4')
    expect(c.tablePart).toEqual({ index: 1, total: 2 })
    expect(c.flags).toEqual(['[table] 存在超长单行（行原子，未再切）'])
    expect(c.text).toBe(FULL_PAYLOAD.text)
  })

  test('缺 doc_id / seq / text 的 point 一律丢弃（定位不全的 chunk 抽出来的候选溯源必然失真）', () => {
    expect(chunkFromPayload({ ...FULL_PAYLOAD, doc_id: undefined })).toBeNull()
    expect(chunkFromPayload({ ...FULL_PAYLOAD, seq: undefined })).toBeNull()
    expect(chunkFromPayload({ ...FULL_PAYLOAD, seq: 1.5 })).toBeNull()
    expect(chunkFromPayload({ ...FULL_PAYLOAD, seq: -1 })).toBeNull()
    expect(chunkFromPayload({ ...FULL_PAYLOAD, text: undefined })).toBeNull()
    expect(chunkFromPayload(null)).toBeNull()
    expect(chunkFromPayload('nope')).toBeNull()
  })

  test('可选字段缺失/形态不对时降级为空，而不是造出脏值', () => {
    const c = chunkFromPayload({ doc_id: 'd', seq: 0, text: 'txt', section: null, page: null, bbox: 'oops', table_part: 'x/y', heading_path: 'nope' })!
    expect(c.section).toBeUndefined()
    expect(c.page).toBeUndefined()
    expect(c.bbox).toBeUndefined()
    expect(c.tablePart).toBeUndefined()
    expect(c.headingPath).toEqual([])
  })
})

describe('markdownToBlocks：离线重建用的 md 解析（不是生产解析器）', () => {
  test('标题行成 heading（level 来自 # 个数），其余成正文段', () => {
    const blocks = markdownToBlocks('# 硫酸（ICSC 0363）\n\nCAS：7664-93-9\n\n## 火灾\n\n用水雾灭火。\n')
    expect(blocks.map(b => b.type)).toEqual(['heading', 'text', 'heading', 'text'])
    expect(blocks[0]).toMatchObject({ type: 'heading', level: 1, markdown: '硫酸（ICSC 0363）' })
    expect(blocks[2]).toMatchObject({ type: 'heading', level: 2, markdown: '火灾' })
  })

  test('空文档 → 空块列表（不产生空正文块）', () => {
    expect(markdownToBlocks('')).toEqual([])
    expect(markdownToBlocks('\n\n   \n')).toEqual([])
  })
})

describe('QdrantChunkSource：scroll 翻页与顺序（用桩客户端，不连网络）', () => {
  test('按 doc_id 过滤、翻完所有页、结果按 seq 升序（选择阶段的优先级排序依赖它）', async () => {
    const calls: Record<string, unknown>[] = []
    let page = 0
    const client: ScrollClient = {
      async scroll(_coll, args) {
        calls.push(args)
        page++
        if (page === 1) {
          return {
            points: [{ payload: { doc_id: 'd', seq: 5, text: 'B', heading_path: [] } }],
            next_page_offset: 5,
          }
        }
        return {
          points: [
            { payload: { doc_id: 'd', seq: 1, text: 'A', heading_path: [] } },
            { payload: { doc_id: 'd', seq: 3, text: 'C', heading_path: [] } },
          ],
          next_page_offset: null,
        }
      },
    }
    const src = new QdrantChunkSource(client, 'reagent_knowledge')
    const chunks = await src.loadChunks('d')
    expect(chunks.map(c => c.seq)).toEqual([1, 3, 5])
    expect(calls).toHaveLength(2)
    expect(calls[0]).toMatchObject({ filter: { must: [{ key: 'doc_id', match: { value: 'd' } }] }, with_payload: true })
    expect(calls[0]!.offset).toBeUndefined() // 首页不带游标
    expect(calls[1]!.offset).toBe(5)
    expect(src.name).toBe('qdrant')
  })

  test('游标形态不认识时停止翻页并告警（绝不假装翻完了 —— 少翻一页 = 静默少抽）', async () => {
    let n = 0
    const client: ScrollClient = {
      async scroll() {
        n++
        return { points: [{ payload: { doc_id: 'd', seq: 0, text: 'A', heading_path: [] } }], next_page_offset: { weird: true } }
      },
    }
    const warn = console.warn
    const seen: string[] = []
    console.warn = (...a: unknown[]) => { seen.push(a.join(' ')) }
    try {
      const chunks = await new QdrantChunkSource(client, 'c').loadChunks('d')
      expect(chunks).toHaveLength(1)
      expect(n).toBe(1)
      expect(seen.join('\n')).toContain('无法识别的 scroll offset')
    } finally {
      console.warn = warn
    }
  })
})

describe('LocalCorpusChunkSource：本地语料重建（离线核对选择逻辑用）', () => {
  test('md 文件 → 复用生产切块器 bySection，doc_id 与 docIdOf 口径一致', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'reaction-extract-'))
    const file = join(dir, 'sample.md')
    try {
      await writeFile(file, '# 硫酸（ICSC 0363）\n\nCAS：7664-93-9\n\n## 火灾\n\n用水雾灭火。\n', 'utf8')
      const expected = docIdOf(file)
      const src = new LocalCorpusChunkSource(async () => file)
      const chunks = await src.loadChunks(expected)
      expect(chunks.length).toBeGreaterThan(0)
      expect(chunks.every(c => c.docId === expected)).toBe(true)
      expect(chunks.some(c => c.section === '火灾' || c.sections?.includes('火灾'))).toBe(true)
      expect(src.name).toBe('local-corpus')
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test('doc_id 与文件对不上 → 当场抛（source_doc_id 指错文档比少抽危险得多）', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'reaction-extract-'))
    const file = join(dir, 'sample.md')
    try {
      await writeFile(file, '# 硫酸\n\n## 火灾\n\n用水雾灭火。\n', 'utf8')
      const src = new LocalCorpusChunkSource(async () => file)
      let threw = false
      try {
        await src.loadChunks('完全不相干的-doc-id')
      } catch (e) {
        threw = true
        expect((e as Error).message).toContain('不一致')
      }
      expect(threw).toBe(true)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test('文件解析不到 → 抛（交由 pipeline 记 failed 并扫 stale）', async () => {
    const src = new LocalCorpusChunkSource(async () => null)
    let threw = false
    try {
      await src.loadChunks('d')
    } catch (e) {
      threw = true
      expect((e as Error).message).toContain('找不到')
    }
    expect(threw).toBe(true)
  })
})
