// 抽取台账的离线单测
//
// 重点是那个离线环境永远看不出来、只有连库跑一轮才炸的坑：
// MySQL 的 JSON 列**必须自己 JSON.stringify**（mysql2 绑定裸对象会按 `k=v` 转义写坏）。
// 把它做成纯函数断言，是"离线也能拦住它"的唯一办法。
import { describe, expect, test } from 'bun:test'
import { EXTRACT_LOG_TABLE, EXTRACT_LOG_UPSERT_SQL, extractLogReady, listExtractLog, toLogParams, writeExtractLog } from './log'
import { emptyStats, type ExtractDocResult } from './types'
import type { SqlRunner } from './docs'

const result = (over: Partial<ExtractDocResult> = {}): ExtractDocResult => ({
  docId: 'doc.a',
  status: 'done',
  chunksTotal: 10,
  chunksSelected: 3,
  llmCalls: 3,
  llmFailures: 0,
  accepted: 2,
  written: 2,
  rejected: 1,
  writeFailures: 0,
  staleMarked: 4,
  stats: { ...emptyStats(), skipReasons: { section_not_safety: 7 }, selectReasons: { sds_section: 3 }, rejections: { EVIDENCE_NOT_IN_SOURCE: 1 }, notes: { coerced_category: 1 } },
  ...over,
})

describe('log：入参拼装（JSON 列必须自己 stringify）', () => {
  test('三个 JSON 列是**字符串**而不是对象（写裸对象会被 mysql2 按 k=v 转义写坏）', () => {
    const p = toLogParams({ runId: 'run-1', extractorVersion: 'react-extract/0.1.0', result: result() })
    expect(typeof p[13]).toBe('string')
    expect(typeof p[14]).toBe('string')
    expect(typeof p[15]).toBe('string')
    expect(JSON.parse(p[13] as string)).toEqual({ section_not_safety: 7 })
    expect(JSON.parse(p[14] as string)).toEqual({ EVIDENCE_NOT_IN_SOURCE: 1 })
    expect(JSON.parse(p[15] as string)).toEqual({ coerced_category: 1 })
  })

  test('参数顺序与列顺序一一对应（错位会让"标 stale 数"写进"被拒数"）', () => {
    const p = toLogParams({ runId: 'run-1', extractorVersion: 'v1', result: result() })
    expect(p).toHaveLength(17)
    expect(p.slice(0, 4)).toEqual(['run-1', 'doc.a', 'v1', 'done'])
    expect(p.slice(4, 13)).toEqual([10, 3, 3, 0, 2, 2, 1, 0, 4])
    expect(p[16]).toBeNull()
  })

  test('error 截断到 1000 字符（DDL 是 VARCHAR(1000)，超长会被 MySQL 拒或静默截断）', () => {
    const p = toLogParams({ runId: 'r', extractorVersion: 'v', result: result({ error: 'x'.repeat(5000) }) })
    expect((p[16] as string).length).toBe(1000)
  })

  test('失败状态与错误摘要一起落库（"这份文档没抽成"必须能查）', () => {
    const p = toLogParams({ runId: 'r', extractorVersion: 'v', result: result({ status: 'failed', error: 'LLM 超时' }) })
    expect(p[3]).toBe('failed')
    expect(p[16]).toBe('LLM 超时')
  })

  test('SQL 的占位符个数与入参个数一致；同一批次重跑靠 (run_id, doc_id) 幂等更新', () => {
    expect((EXTRACT_LOG_UPSERT_SQL.match(/\?/g) ?? []).length).toBe(toLogParams({ runId: 'r', extractorVersion: 'v', result: result() }).length)
    expect(EXTRACT_LOG_UPSERT_SQL).toContain('ON DUPLICATE KEY UPDATE')
    expect(EXTRACT_LOG_UPSERT_SQL).toContain(EXTRACT_LOG_TABLE)
  })
})

describe('log：写入是旁路，坏掉不许拖崩抽取', () => {
  test('写失败只 warn 不上抛（台账丢一行不影响候选正确性）', async () => {
    const db: SqlRunner = { async query() { throw new Error('表不存在（模拟）') } }
    const warn = console.warn
    const seen: string[] = []
    console.warn = (...a: unknown[]) => { seen.push(a.join(' ')) }
    try {
      let threw = false
      try {
        await writeExtractLog(db, { runId: 'r', extractorVersion: 'v', result: result() })
      } catch {
        threw = true
      }
      expect(threw).toBe(false)
      expect(seen.join('\n')).toContain('台账写入跳过')
    } finally {
      console.warn = warn
    }
  })

  test('extractLogReady：有表 true / 没表 false / 查询抛错 false（CLI 靠它给出可执行的提示）', async () => {
    expect(await extractLogReady({ async query() { return [{ t: EXTRACT_LOG_TABLE }] } })).toBe(true)
    expect(await extractLogReady({ async query() { return [] } })).toBe(false)
    expect(await extractLogReady({ async query() { throw new Error('MySQL 未起') } })).toBe(false)
  })
})

describe('log：历史反查', () => {
  test('listExtractLog 把 JSON 列解析回对象，error 为空时是 null', async () => {
    const db: SqlRunner = {
      async query() {
        return [{
          run_id: 'run-1', doc_id: 'doc.a', extractor_version: 'v1', status: 'done',
          chunks_total: 10, chunks_selected: 3, llm_calls: 3, llm_failures: 0,
          accepted: 2, written: 2, rejected: 1, write_failures: 0, stale_marked: 4,
          skip_json: '{"section_not_safety":7}', reject_json: '{"EVIDENCE_NOT_IN_SOURCE":1}',
          note_json: '{}', error_text: null,
        }]
      },
    }
    const rows = await listExtractLog(db, 'doc.a')
    expect(rows).toHaveLength(1)
    expect(rows[0]!.stats.skipReasons).toEqual({ section_not_safety: 7 })
    expect(rows[0]!.stats.rejections).toEqual({ EVIDENCE_NOT_IN_SOURCE: 1 })
    expect(rows[0]!.error).toBeNull()
    expect(rows[0]!.extractorVersion).toBe('v1')
  })
})
