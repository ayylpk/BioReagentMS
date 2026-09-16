// 连库往返测试：证明"迁移 02 的 DDL ↔ store 的列清单/映射口径"真的对得上
//   （列名拼错、JSON/DECIMAL 回读口径不符、状态机/事务写错这类问题，离线测不出来）
// 纪律：库不可用 / 迁移未应用 → **整组跳过**，绝不让离线环境变红；
//       自建数据只落在 'selftest.reaction.' 前缀的 doc_id 下，测试前后各清一次。
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import type { Pool, RowDataPacket } from 'mysql2/promise'
import type { ReactionCandidateInputRaw } from './types'

const DOC_PREFIX = 'selftest.reaction.'
const REVIEWER = 1
const CHUNK_TEXT = '10 稳定性和反应性\n本品与强碱剧烈反应，放出大量热。须与碱类分开存放，避免与氧化剂接触。'

let store: typeof import('./store') | null = null
let poolRef: Pool | null = null
let skipReason = ''
try {
  const db = await import('../db/mysql')
  await db.pool.query('SELECT 1')
  const [rows] = await db.pool.query<RowDataPacket[]>(
    'SELECT table_name t FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name IN (?, ?)',
    ['reaction_candidate', 'reaction_rule'],
  )
  if (rows.length < 2) {
    skipReason = '迁移 02_reaction_rule.sql 未应用'
  } else {
    store = await import('./store')
    poolRef = db.pool
  }
} catch (e) {
  skipReason = 'MySQL 不可用：' + (e as Error).message.slice(0, 90)
}

const mk = (docId: string, evidence: string, over: Partial<ReactionCandidateInputRaw> = {}): ReactionCandidateInputRaw => ({
  relationType: 'incompatible',
  subject: { kind: 'reagent', name: '硫酸', cas: '7664-93-9' },
  object: { kind: 'reagent', name: '氢氧化钠', cas: '1310-73-2' },
  severity: 'high',
  hazards: ['heat', 'toxic_gas'],
  confidence: 0.9,
  evidenceText: evidence,
  extractorVersion: 'react-extract/0.1.0',
  runId: 'run-a',
  source: { docId, chunkSeq: 3, page: 2, section: '10 稳定性和反应性', bbox: [10, 20, 30, 40] },
  ...over,
})

/**
 * 断言"必须抛"。
 * 不用 expect(promise).rejects.toThrow()：bun 1.3.14 在本文件里对该写法会一直挂住
 * （已实测复现：换成显式 try/catch 立刻恢复），所以统一走这里。
 */
async function expectThrow(fn: () => Promise<unknown>, what: string): Promise<void> {
  try {
    await fn()
  } catch {
    return
  }
  throw new Error(`预期抛错却成功返回：${what}`)
}

async function cleanup(): Promise<void> {
  const p = poolRef
  if (!p) return
  await p.query('DELETE FROM reaction_rule WHERE source_doc_id LIKE ?', [DOC_PREFIX + '%'])
  await p.query('DELETE FROM reaction_candidate WHERE source_doc_id LIKE ?', [DOC_PREFIX + '%'])
}

describe.skipIf(store === null || poolRef === null)(`reaction store 连库往返（${skipReason || '可用'}）`, () => {
  beforeAll(cleanup)
  afterAll(cleanup)

  test('upsertCandidate：写进去再读回来，JSON/DECIMAL/对称排序/点 id 全部对得上', async () => {
    const S = store!
    const docId = DOC_PREFIX + 'basic'
    const row = await S.upsertCandidate(mk(docId, '本品与强碱剧烈反应，放出大量热。'), CHUNK_TEXT)

    // 对称规范化：氢氧化钠（cas:1310-…）排在硫酸（cas:7664-…）前面，且名字跟着键一起换位
    expect(row.subjectKey).toBe('cas:1310-73-2')
    expect(row.subjectName).toBe('氢氧化钠')
    expect(row.objectKey).toBe('cas:7664-93-9')
    expect(row.objectName).toBe('硫酸')
    expect(row.pairKey).toBe('cas:1310-73-2 cas:7664-93-9')
    expect(row.directionSemantics).toBe('symmetric')

    // JSON 列回读成对象/数组；DECIMAL 列回读成 number（不是字符串）
    expect(row.hazards).toEqual(['heat', 'toxic_gas'])
    expect(row.conditions).toBeNull()
    expect(row.confidence).toBe(0.9)
    expect(typeof row.confidence).toBe('number')

    // 溯源快照
    expect(row.source.docId).toBe(docId)
    expect(row.source.chunkSeq).toBe(3)
    expect(row.source.page).toBe(2)
    expect(row.source.section).toBe('10 稳定性和反应性')
    expect(row.source.bbox).toEqual([10, 20, 30, 40])
    const { pointId } = await import('../rag/store/upsert')
    expect(row.source.chunkId).toBe(pointId(docId, 3))
    expect(row.source.chunkId).toBe(S.resolveChunkId({ docId, chunkSeq: 3 }))

    // 默认态
    expect(row.reviewStatus).toBe('pending')
    expect(row.sourceState).toBe('active')
    expect(row.lastSeenRunId).toBe('run-a')

    // 幂等：同一条证据再抽一次 → 同一行，不新增
    const again = await S.upsertCandidate(mk(docId, '本品与强碱剧烈反应，放出大量热。'), CHUNK_TEXT)
    expect(again.id).toBe(row.id)
    expect(await S.findCandidatesByPairKey(row.pairKey)).toHaveLength(1)
  })

  test('upsertCandidate：证据不是 chunk 原文连续片段 → 抛，且库里不留行', async () => {
    const S = store!
    const docId = DOC_PREFIX + 'evidence'
    await expectThrow(() => S.upsertCandidate(mk(docId, '本品与碱剧烈反应'), CHUNK_TEXT), '证据被改写')
    expect(await S.listCandidates({ docId })).toHaveLength(0)
    // chunk id 自相矛盾也拦下
    await expectThrow(
      () => S.upsertCandidate(
        mk(docId, '本品与强碱剧烈反应，放出大量热。', {
          source: { docId, chunkSeq: 3, chunkId: '11111111-1111-5111-8111-111111111111' },
        }),
        CHUNK_TEXT,
      ),
      'chunk id 与 (doc_id, seq) 复算值不符',
    )
  })

  test('重摄清扫：pending 候选标 stale（不删行），已 approved 的不动，同证据再现可回 active', async () => {
    const S = store!
    const docId = DOC_PREFIX + 'sweep'
    const pending = await S.upsertCandidate(mk(docId, '本品与强碱剧烈反应，放出大量热。'), CHUNK_TEXT)
    const approved = await S.upsertCandidate(mk(docId, '须与碱类分开存放，避免与氧化剂接触。'), CHUNK_TEXT)
    await S.reviewCandidate(approved.id, { decision: 'approve', reviewedBy: REVIEWER, note: null })

    const marked = await S.markStaleForDoc(docId, 'run-b')
    expect(marked).toBe(1) // 只扫 pending 那条
    expect((await S.getCandidate(pending.id))!.sourceState).toBe('stale')
    expect((await S.getCandidate(pending.id))!.reviewStatus).toBe('pending') // 审核维度不被来源维度改写
    expect((await S.getCandidate(approved.id))!.sourceState).toBe('active')

    // 行还在（绝不物理删除），且能按"孤儿候选"筛出来
    expect((await S.listCandidates({ docId })).length).toBe(2)
    expect((await S.listCandidates({ docId, sourceState: 'stale' })).map(r => r.id)).toEqual([pending.id])

    // 同一条证据在新一轮里又被抽到 → 证据背书，回到 active
    const reseen = await S.upsertCandidate(
      mk(docId, '本品与强碱剧烈反应，放出大量热。', { runId: 'run-b' }),
      CHUNK_TEXT,
    )
    expect(reseen.id).toBe(pending.id)
    expect(reseen.sourceState).toBe('active')
    expect(reseen.lastSeenRunId).toBe('run-b')
  })

  test('审核 → 发布：同一 rule_key 第二条必须显式 supersede，旧规则下线且留 superseded_by', async () => {
    const S = store!
    const docId = DOC_PREFIX + 'publish'
    const a = await S.upsertCandidate(mk(docId, '本品与强碱剧烈反应，放出大量热。'), CHUNK_TEXT)
    const b = await S.upsertCandidate(
      mk(docId, '须与碱类分开存放，避免与氧化剂接触。', { severity: 'critical' }),
      CHUNK_TEXT,
    )
    expect(a.pairKey).toBe(b.pairKey)
    expect(a.candidateKey).not.toBe(b.candidateKey) // 同 pair 不同证据 → 两条候选

    // 未审核不许发布
    await expectThrow(() => S.publishRule({ candidateId: a.id, reviewedBy: REVIEWER }), '未审核候选发布规则')

    await S.reviewCandidate(a.id, { decision: 'approve', reviewedBy: REVIEWER, note: '低风险重复' })
    await S.reviewCandidate(b.id, { decision: 'approve', reviewedBy: REVIEWER, note: null })

    const r1 = await S.publishRule({ candidateId: a.id, reviewedBy: REVIEWER, note: '首版' })
    expect(r1.status).toBe('active')
    expect(r1.sourceState).toBe('active')
    expect(r1.severity).toBe('high')
    expect(r1.hazards).toEqual(['heat', 'toxic_gas'])
    expect(r1.candidateId).toBe(a.id)

    // 一个候选最多发布一条规则（UNIQUE candidate_id 兜底）
    await expectThrow(() => S.publishRule({ candidateId: a.id, reviewedBy: REVIEWER }), '同一候选重复发布')

    // 同 rule_key 已有 active：默认拒绝，绝不静默顶掉
    await expectThrow(() => S.publishRule({ candidateId: b.id, reviewedBy: REVIEWER }), '未显式 supersede')

    const r2 = await S.publishRule({ candidateId: b.id, reviewedBy: REVIEWER, note: '换证据', supersedeExisting: true })
    expect(r2.status).toBe('active')
    expect(r2.ruleKey).toBe(r1.ruleKey)
    const old = (await S.findRulesByDocId(docId)).find(r => r.id === r1.id)!
    expect(old.status).toBe('superseded')
    expect(old.supersededById).toBe(r2.id)
    expect(old.supersededAt).not.toBeNull()
    expect((await S.getCandidate(a.id))!.reviewStatus).toBe('superseded')

    // 默认查询只回 active（superseded 不参与作答）
    expect((await S.findRulesByPairKeys([r1.pairKey])).map(r => r.id)).toEqual([r2.id])
    expect(await S.findRulesByPairKeys([r1.pairKey], { includeSuperseded: true })).toHaveLength(2)
    // 单实体查询：硫酸那一侧也要能查到（subject_key OR object_key）
    expect((await S.findRulesByEntityKey('cas:7664-93-9')).map(r => r.id)).toEqual([r2.id])

    // 来源失效：重摄标 stale → 文档删除升级 missing → 人工复核才回 active，全程不删行
    expect(await S.markRulesSourceStaleByDoc(docId)).toBe(1)
    expect((await S.findRulesByEntityKey('cas:7664-93-9'))[0]!.sourceState).toBe('source_stale')
    expect(await S.markRulesSourceMissingByDoc(docId)).toBe(1)
    const missing = (await S.findRulesByEntityKey('cas:7664-93-9'))[0]!
    expect(missing.sourceState).toBe('source_missing')
    expect(missing.reviewedBy).toBe(REVIEWER) // 发布留痕不被复核动作覆盖

    const back = await S.reconfirmRuleSource(r2.id, REVIEWER)
    expect(back.sourceState).toBe('active')
    expect(back.sourceRecheckedBy).toBe(REVIEWER)
    expect(back.sourceRecheckedAt).not.toBeNull()
    expect(await S.findRulesByDocId(docId)).toHaveLength(2) // 物理行数没变过
  })
})
