// chunk 选择的离线单测（纯函数，不连库不连向量库）
//
// 这层是**唯一的花钱闸门**：多选一次只浪费一次调用，漏选一次就是知识永久缺失，
// 所以每条规则都用"真实语料样式的文案"钉住，而不是"甲/乙"这种玩具串。
// 语料事实（2026-09 实测）：本仓库 1713 份语料里 1586 份是 ICSC 化学品安全卡，
// 它们**没有 SDS 的 16 分节**，禁配信息写在"化学危险性:"字段里 —— 这就是 safety_paragraph 存在的理由。
import { describe, expect, test } from 'bun:test'
import type { Chunk } from '../../rag/inspect/profile'
import { MIN_SAFETY_TEXT_CHARS, TARGET_SECTIONS, judgeChunk, matchParagraphMarker, resolveStandardSection, selectChunks, summarizeSelection } from './select'

const ck = (seq: number, text: string, section?: string, headingPath: string[] = []): Chunk => ({
  docId: 'doc.test',
  seq,
  text,
  headingPath,
  ...(section ? { section } : {}),
})

/** ICSC 卡的真实句式（取自语料 corpus/ICSC-0005-对草快二氯化物.md） */
const ICSC_FIRE = '对草快二氯化物（ICSC 0005）｜火灾 急性危险/症状：不可燃。在火焰中释放出刺激性或有毒烟雾（或气体）。急救/消防：周围环境着火时，使用适当的灭火剂。'
const ICSC_HAZARD = '对草快二氯化物（ICSC 0005）｜重要数据 物理状态、外观: 无色、易吸湿的晶体。 化学危险性: 高于300℃时，分解，生成含有氮氧化物和氯化氢的有毒烟雾。 侵蚀金属。'
const ICSC_PACK = '对草快二氯化物（ICSC 0005）｜包装与标志 将易碎包装放在密封的不易碎容器中。不得与食品和饲料一起运输。'

describe('select：目标 SDS 分节', () => {
  test('"10 稳定性和反应性"命中，且优先级最高（禁配物的主产地）', () => {
    const chunks = [ck(0, '第10节 稳定性和反应性：本品与强碱剧烈反应，放出大量热。', '10 稳定性和反应性')]
    const sel = selectChunks(chunks)
    expect(sel.skipped).toEqual([])
    expect(sel.selected).toEqual([{ seq: 0, reason: { kind: 'sds_section', section: '稳定性和反应性' }, priority: 0 }])
    expect(TARGET_SECTIONS[0]).toBe('稳定性和反应性')
  })

  test('5 个目标分节全部命中，其它标准分节明确跳过（section_not_safety）', () => {
    const chunks = [
      ck(0, '稳定性和反应性 本品与强碱剧烈反应。', '稳定性和反应性'),
      ck(1, '操作处置与储存 须与碱类分开存放。', '操作处置与储存'),
      ck(2, '消防措施 用水雾灭火。', '消防措施'),
      ck(3, '泄漏应急处理 用沙子吸收。', '泄漏应急处理'),
      ck(4, '成分/组成信息 氢氧化钠 100%。', '成分/组成信息'),
      ck(5, '毒理学信息 无致癌性资料。', '毒理学信息'),
      ck(6, '运输信息 不属于危险货物。', '运输信息'),
    ]
    const sel = selectChunks(chunks)
    expect(sel.selected.map(s => s.seq)).toEqual([0, 1, 2, 3, 4]) // 按 priority：稳定性0 → 储存1 → 消防2 → 泄漏3 → 成分4
    expect(sel.skipped.map(s => s.reason)).toEqual(['section_not_safety', 'section_not_safety'])
    expect(sel.skipped.map(s => s.section)).toEqual(['毒理学信息', '运输信息'])
  })

  test('口语别名与编号写法都能认出来（火灾→消防措施 / "第5节"）', () => {
    expect(resolveStandardSection({ section: '火灾', headingPath: [] })).toBe('消防措施')
    expect(resolveStandardSection({ section: '泄漏处理', headingPath: [] })).toBe('泄漏应急处理')
    expect(resolveStandardSection({ section: '第10节', headingPath: [] })).toBe('稳定性和反应性')
  })

  test('section 认不出时往 headingPath 上层找（section 缺失的 chunk 不因此漏抽）', () => {
    const chunks = [ck(0, '本品与强碱剧烈反应，放出大量热。', undefined, ['硫酸安全技术说明书', '10 稳定性和反应性', '10.1 反应性'])]
    const sel = selectChunks(chunks)
    expect(sel.selected[0]!.reason).toEqual({ kind: 'sds_section', section: '稳定性和反应性' })
  })
})

describe('select：非 SDS 文档（安全规章 / 段落标签）', () => {
  test('标题带安全规章/SOP 标记 → safety_heading', () => {
    const chunks = [ck(0, '试剂领用须双人复核，接触强酸强碱须戴护目镜。', '配制岗', ['实验室安全操作规程'])]
    const sel = selectChunks(chunks)
    expect(sel.selected[0]!.reason).toEqual({ kind: 'safety_heading', heading: '实验室安全操作规程', marker: '安全操作' })
  })

  test('ICSC 卡的"化学危险性:"字段 → safety_paragraph（1616 份卡片全靠这一条进来）', () => {
    const sel = selectChunks([ck(0, ICSC_HAZARD, '重要数据')])
    expect(sel.selected).toHaveLength(1)
    expect(sel.selected[0]!.reason).toEqual({ kind: 'safety_paragraph', marker: '化学危险性' })
    expect(sel.selected[0]!.priority).toBeGreaterThan(0) // 排在目标分节之后
  })

  test('段落标签只在"分节认不出"时才用来救场；认出的非目标分节仍然跳过（不两头都要）', () => {
    expect(matchParagraphMarker(ICSC_HAZARD)).toBe('化学危险性')
    const sel = selectChunks([ck(0, '毒理学信息 化学危险性 的描述不在这里。', '毒理学信息')])
    expect(sel.selected).toEqual([])
    expect(sel.skipped[0]!.reason).toBe('section_not_safety')
  })
})

describe('select：跳过原因分类必须能解释"为什么这份文档一条都没抽"', () => {
  test('空文本 / 纯空白 → empty_text', () => {
    const sel = selectChunks([ck(0, ''), ck(1, '   \n  ')])
    expect(sel.selected).toEqual([])
    expect(sel.skipped.map(s => s.reason)).toEqual(['empty_text', 'empty_text'])
  })

  test('文本过短 → too_short（短于此不可能承载一条关系）', () => {
    const sel = selectChunks([ck(0, '遇酸')])
    expect(sel.selected).toEqual([])
    expect(sel.skipped[0]!.reason).toBe('too_short')
    expect('遇酸'.length).toBeLessThan(MIN_SAFETY_TEXT_CHARS)
  })

  test('认不出分节、也没有任何安全标记 → section_unidentified（ICSC 的灭火/急救段落就是这样被排除的）', () => {
    const sel = selectChunks([ck(0, '用大量水冲洗几分钟（如可能易行，摘除隐形眼镜）。', '眼睛')])
    expect(sel.skipped[0]!.reason).toBe('section_unidentified')
  })

  test('summarizeSelection 把跳过与选中理由都数清楚', () => {
    const sel = selectChunks([
      ck(0, '稳定性和反应性 本品与强碱剧烈反应。', '稳定性和反应性'),
      ck(1, '毒理学信息 无致癌性资料。', '毒理学信息'),
      ck(2, '用大量水冲洗几分钟。', '眼睛'),
      ck(3, ICSC_HAZARD, '重要数据'),
    ])
    const sum = summarizeSelection(sel)
    expect(sum.selectReasons).toEqual({ sds_section: 1, safety_paragraph: 1 })
    expect(sum.skipReasons).toEqual({ section_not_safety: 1, section_unidentified: 1 })
  })
})

describe('select：真实 ICSC 卡的整体判定（离线可复算）', () => {
  test('火灾段进抽（消防措施），重要数据段进抽（化学危险性），包装段不进（既非目标分节也无安全标记）', () => {
    const chunks = [ck(0, ICSC_FIRE, '火灾'), ck(1, ICSC_HAZARD, '重要数据'), ck(2, ICSC_PACK, '包装与标志')]
    const sel = selectChunks(chunks)
    expect(sel.selected.map(s => s.seq)).toEqual([0, 1])
    expect(sel.selected[0]!.reason).toEqual({ kind: 'sds_section', section: '消防措施' })
    expect(sel.selected[1]!.reason).toEqual({ kind: 'safety_paragraph', marker: '化学危险性' })
    expect(sel.skipped.map(s => s.seq)).toEqual([2])
    expect(sel.skipped[0]!.reason).toBe('section_unidentified')
  })

  test('judgeChunk 可单独复算（排查单个 chunk 时不用把整份文档跑一遍）', () => {
    expect(judgeChunk(ck(0, ICSC_FIRE, '火灾')).kind).toBe('select')
    expect(judgeChunk(ck(2, ICSC_PACK, '包装与标志')).kind).toBe('skip')
  })
})
