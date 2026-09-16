// 试剂禁配/相容性安全知识 —— chunk 选择（**纯函数**：给 chunks 与规则，返回"该抽哪些 + 为什么跳过"）
//
// 为什么单独一层、且必须是纯函数：
//   ① 这是**唯一的花钱闸门**。抽错一次只是浪费一次调用、多一条待审候选；漏抽一次就是知识永久缺失。
//      两者都必须在单测里逐条钉住，而不是"跑一遍看看"。
//   ② 选择规则要能被反复解释。给每个跳过的 chunk 记原因分类，运维才能回答
//      "为什么这份文档一条候选都没出"——是没识别出分节，还是分节不在目标范围内。
//   ③ 不许连库、不许连向量库：真实环境下 Qdrant 常常不在，选择逻辑必须能在任何地方单独验证。
import { normalizeSection } from '../../rag/sections'
import type { Chunk } from '../../rag/inspect/profile'
import type { ChunkSelection, ChunkSkip, SelectReason, SkipReason } from './types'

/**
 * 目标 SDS 分节（按优先级排序，越靠前越先抽）。
 * 口径来源：第二阶段任务书 —— 第 10 节（稳定性和反应性，禁配物的主产地）、第 7 节（操作处置与储存）、
 * 第 5 节（消防措施）、第 6 节（泄漏应急处理）、第 3 节（成分/组成信息，用来把主体实体认准）。
 *
 * ⚠️ 只认这 5 节：标准 SDS 的其它分节（如"危险性概述""毒理学信息"）**明确不抽**，
 *    命中就记 section_not_safety。这是有意的收窄 —— 本阶段要的是"禁配/相容性"，
 *    从别的分节捞关系会把"燃爆特性""急救措施"这类文本也喂进来，稀释候选质量。
 *    要放宽只需往这个数组里加名字，跳过原因分类会自动跟着变（不需要改任何逻辑）。
 */
export const TARGET_SECTIONS = [
  '稳定性和反应性',
  '操作处置与储存',
  '消防措施',
  '泄漏应急处理',
  '成分/组成信息',
] as const

/**
 * 安全规章 / SOP 类**标题**标记。用于"文档根本不是 SDS"的场景（操作规程、管理制度）：
 * 这类文档没有 16 分节，只有自己的小标题，靠标题上的显式标记来认定。
 * 一律写成小写无空白形态，匹配时对标题做同样归一化。
 */
export const SAFETY_HEADING_MARKERS = [
  '安全规程', '安全操作', '安全管理制度', '操作规程', '操作规范', '作业指导',
  '应急处置', '应急预案', '禁配', '相容性', '危险化学品管理', 'sop',
] as const

/**
 * 段落级安全标签。用于"既不是目标分节、标题也没标记，但段落里自带安全字段名"的场景 ——
 * ICSC 化学品安全卡就是典型：它没有 SDS 的 16 分节，禁配信息写在第 5 节之外的
 * "化学危险性:" 字段里（本仓库语料 1586/1713 份是这类卡片，不认这个标记就等于全库漏抽）。
 * 这些都是**原文里真实出现的字段名/术语**，不是我们编的语义标签。
 */
export const SAFETY_PARAGRAPH_MARKERS = [
  '化学危险性', '禁配', '不相容', '避免接触', '避免与', '分开存放', '分开储存', '隔离储存', '危险反应',
] as const

/** 分节优先级：目标分节按 TARGET_SECTIONS 顺序，标题/段落标记排在其后 */
const SECTION_PRIORITY = new Map<string, number>(TARGET_SECTIONS.map((s, i) => [s, i]))
const HEADING_MARKER_PRIORITY = TARGET_SECTIONS.length
const PARAGRAPH_MARKER_PRIORITY = TARGET_SECTIONS.length + 1

/** 标题/段落标记匹配用的归一化：小写 + 去空白。只抹掉"无意义差异"，不动字面 */
const norm = (s: string): string => s.toLowerCase().replace(/\s+/g, '')

/** 证据文本最短长度：太短的片段（如"遇酸"）撑不起"谁与谁什么关系"，一律不抽 */
export const MIN_SAFETY_TEXT_CHARS = 8

/**
 * 找出能代表本 chunk 的标准 SDS 分节名。
 * 查找顺序（确定性，且**从最具体到最泛**）：
 *   ① payload.section（chunker 的叶子分节名，最准）
 *   ② headingPath 从叶到根（section 缺失或不是标准名时，往上层找）
 * 找不到返回 null —— 认不出就是认不出，绝不猜（猜错等于把"毒理学信息"当成"稳定性和反应性"）。
 */
export function resolveStandardSection(chunk: Pick<Chunk, 'section' | 'headingPath'>): string | null {
  const fromSection = chunk.section ? normalizeSection(chunk.section) : undefined
  if (fromSection) return fromSection
  for (let i = chunk.headingPath.length - 1; i >= 0; i--) {
    const hit = normalizeSection(chunk.headingPath[i]!)
    if (hit) return hit
  }
  return null
}

/** 在标题路径里找安全规章/SOP 标记。返回命中的标记与所在标题（供人审定位） */
export function matchHeadingMarker(
  chunk: Pick<Chunk, 'headingPath' | 'section'>,
): { marker: string; heading: string } | null {
  const heads = [...chunk.headingPath, ...(chunk.section ? [chunk.section] : [])]
  for (const h of heads) {
    const n = norm(h)
    for (const m of SAFETY_HEADING_MARKERS) if (n.includes(norm(m))) return { marker: m, heading: h }
  }
  return null
}

/** 在正文里找段落级安全标签 */
export function matchParagraphMarker(text: string): string | null {
  const n = norm(text)
  for (const m of SAFETY_PARAGRAPH_MARKERS) if (n.includes(norm(m))) return m
  return null
}

/** 单个 chunk 的判定结果：选中（带理由与优先级）或跳过（带原因分类） */
export type ChunkVerdict =
  | { kind: 'select'; reason: SelectReason; priority: number }
  | { kind: 'skip'; reason: SkipReason; detail: string }

/**
 * 判定**一个** chunk 该不该抽。抽出来单独导出是为了让人审/排查能对单个 chunk 复算判定过程，
 * 不用把整份文档的 chunks 都跑一遍。
 *
 * 判定顺序（短路，顺序即语义，改动前先想清楚）：
 *   ① 空文本 → 跳过（向量库里理论上不该有，但重摄/脏数据会有；空文本喂 LLM 纯烧钱）
 *   ② 太短 → 跳过（同上，短于 MIN_SAFETY_TEXT_CHARS 不可能承载一条关系）
 *   ③ 能认出标准 SDS 分节 → 在 TARGET_SECTIONS 里就抽，否则 section_not_safety（**在此终止**）
 *   ④ 认不出分节 → 标题带安全规章/SOP 标记就抽
 *   ⑤ 还没有 → 正文带段落级安全字段名就抽
 *   ⑥ 都没有 → section_unidentified
 */
export function judgeChunk(chunk: Chunk): ChunkVerdict {
  const text = chunk.text ?? ''
  if (!text.trim()) return { kind: 'skip', reason: 'empty_text', detail: '文本为空或纯空白' }
  if (text.trim().length < MIN_SAFETY_TEXT_CHARS) {
    return { kind: 'skip', reason: 'too_short', detail: `有效文本不足 ${MIN_SAFETY_TEXT_CHARS} 字符` }
  }

  const std = resolveStandardSection(chunk)
  if (std) {
    const p = SECTION_PRIORITY.get(std)
    if (p === undefined) {
      return { kind: 'skip', reason: 'section_not_safety', detail: `标准 SDS 分节「${std}」不在目标分节内` }
    }
    return { kind: 'select', reason: { kind: 'sds_section', section: std }, priority: p }
  }

  const hm = matchHeadingMarker(chunk)
  if (hm) {
    return {
      kind: 'select',
      reason: { kind: 'safety_heading', heading: hm.heading, marker: hm.marker },
      priority: HEADING_MARKER_PRIORITY,
    }
  }

  const pm = matchParagraphMarker(text)
  if (pm) {
    return {
      kind: 'select',
      reason: { kind: 'safety_paragraph', marker: pm },
      priority: PARAGRAPH_MARKER_PRIORITY,
    }
  }

  return { kind: 'skip', reason: 'section_unidentified', detail: '认不出分节，也没有安全规章/SOP 或安全字段标记' }
}

/**
 * 对一份文档的全部 chunk 做选择。
 * 返回的 selected **已排序**（priority 升序 → seq 升序）：预算不够时先烧最该抽的分节，
 * 且排序是确定的 —— 同样的输入永远同样的顺序，CLI 的 --limit 才有可复现的含义。
 */
export function selectChunks(chunks: readonly Chunk[]): ChunkSelection {
  const selected: ChunkSelection['selected'] = []
  const skipped: ChunkSkip[] = []
  for (const c of chunks) {
    const v = judgeChunk(c)
    if (v.kind === 'select') selected.push({ seq: c.seq, reason: v.reason, priority: v.priority })
    else skipped.push({ seq: c.seq, section: c.section ?? null, reason: v.reason, detail: v.detail })
  }
  selected.sort((a, b) => (a.priority - b.priority) || (a.seq - b.seq))
  return { selected, skipped }
}

/** 选择结果的计数汇总（进抽取台账的 skip_json / select_json 用） */
export function summarizeSelection(sel: ChunkSelection): {
  skipReasons: Partial<Record<SkipReason, number>>
  selectReasons: Record<string, number>
} {
  const skipReasons: Partial<Record<SkipReason, number>> = {}
  for (const s of sel.skipped) skipReasons[s.reason] = (skipReasons[s.reason] ?? 0) + 1
  const selectReasons: Record<string, number> = {}
  for (const s of sel.selected) selectReasons[s.reason.kind] = (selectReasons[s.reason.kind] ?? 0) + 1
  return { skipReasons, selectReasons }
}
