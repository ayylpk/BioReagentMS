// 文档选择的离线单测：gate 必须写在 SQL 里，且必须被断言住
//
// 这一组的核心不是"能不能查"，而是"**没有 done 的文档混进来**"这件事要被测试钉死：
// 过滤器可以被顺手删掉，SQL 的 WHERE 是这层存在的唯一理由，所以直接对 SQL 文案做断言。
import { describe, expect, test } from 'bun:test'
import {
  buildExcludedDocQuery,
  buildTargetDocQuery,
  listExcludedDocs,
  listExtractTargets,
  poolRunner,
  resolveDocFile,
  type SqlRunner,
} from './docs'

/** 记录调用的假 SQL 执行器 */
function fakeDb(rowsBySql: (sql: string, params?: unknown[]) => unknown): { db: SqlRunner; calls: { sql: string; params?: unknown[] }[] } {
  const calls: { sql: string; params?: unknown[] }[] = []
  return {
    calls,
    db: {
      async query(sql, params) {
        calls.push({ sql, params })
        return rowsBySql(sql, params)
      },
    },
  }
}

describe('docs：目标文档查询（gate 在 SQL 的 WHERE 里）', () => {
  test('SQL 里必须出现 status = \'done\' —— 这是"抽取跑在 gate 之后"的唯一实现', () => {
    const { sql } = buildTargetDocQuery()
    expect(sql).toContain(`status = 'done'`)
    expect(sql).toContain('ORDER BY doc_id') // 确定顺序 → --limit 可复现
    expect(sql).toContain('LIMIT ?')
  })

  test('--doc 只加一个等值条件；--limit 进 params（值不拼进 SQL）', () => {
    const q = buildTargetDocQuery({ docId: 'ICSC-0005-对草快二氯化物', limit: 3 })
    expect(q.sql).toContain('doc_id = ?')
    expect(q.params).toEqual(['ICSC-0005-对草快二氯化物', 3])
  })

  test('limit 缺省与下限保护：默认 500，给 0/负数也至少 1', () => {
    expect(buildTargetDocQuery().params).toEqual([500])
    expect(buildTargetDocQuery({ limit: 0 }).params).toEqual([1])
    expect(buildTargetDocQuery({ limit: -5 }).params).toEqual([1])
  })

  test('被排除的文档查询与目标查询互为补集（status <> done）', () => {
    expect(buildExcludedDocQuery().sql).toContain(`status <> 'done'`)
    expect(buildExcludedDocQuery({ docId: 'd' }).params).toEqual(['d'])
  })
})

describe('docs：行映射与取数', () => {
  test('listExtractTargets 把行映射成 TargetDoc（chunks 缺省为 0）', async () => {
    const { db, calls } = fakeDb(() => [{ doc_id: 'a', file: 'F:/corpus/a.md', chunks: 12, status: 'done' }, { doc_id: 'b', file: null, status: 'done' }])
    const targets = await listExtractTargets(db, { limit: 2 })
    expect(targets).toEqual([
      { docId: 'a', file: 'F:/corpus/a.md', chunks: 12, status: 'done' },
      { docId: 'b', file: '', chunks: 0, status: 'done' },
    ])
    expect(calls[0]!.params).toEqual([2])
  })

  test('listExcludedDocs 只回 doc_id + status（不参与抽取，只为报告说清原因）', async () => {
    const { db } = fakeDb(() => [{ doc_id: 'x', status: 'review' }, { doc_id: 'y', status: 'failed' }])
    expect(await listExcludedDocs(db)).toEqual([{ docId: 'x', status: 'review' }, { docId: 'y', status: 'failed' }])
  })

  test('resolveDocFile 命中返回路径，未命中返回 null（离线重建用）', async () => {
    expect(await resolveDocFile(fakeDb(() => [{ file: 'F:/corpus/a.md' }]).db, 'a')).toBe('F:/corpus/a.md')
    expect(await resolveDocFile(fakeDb(() => []).db, 'a')).toBeNull()
    expect(await resolveDocFile(fakeDb(() => [{ file: '' }]).db, 'a')).toBeNull()
  })
})

describe('docs：poolRunner 适配器', () => {
  test('把 mysql2 的 [rows, fields] 收成 rows（抽取侧只关心行）', async () => {
    const fakePool = { query: async () => [[{ doc_id: 'a' }], [{ /* fields */ }]] }
    const db = poolRunner(fakePool as never)
    expect(await db.query('SELECT 1')).toEqual([{ doc_id: 'a' }])
  })
})
