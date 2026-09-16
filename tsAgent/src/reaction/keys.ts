// 试剂禁配/相容性安全知识 —— 规范化与幂等键（**纯函数，无 IO**，可脱库单测）
// 为什么单独放一个文件：这些规则是"同一个物质对"能不能被认出来的唯一依据，
// 一旦混进 SQL 就只能在连库环境里验证；放这里可以逐条断言（见 keys.test.ts）。
import { createHash } from 'node:crypto'
import { casCheckDigitOk } from '../rag/gate/quality'
import { ReactionKeyError } from './errors'
import type { EntityKind, EntityRef, RelationType } from './types'

const sha1hex = (s: string): string => createHash('sha1').update(s, 'utf8').digest('hex')

// ── 名称规范化 ────────────────────────────────────────────────────────────────
/** 规范化后的实体名长度上限；超过则截断 + 哈希后缀（对齐 identity.ts 的 docIdOf 做法，保证定长且可复算） */
const NAME_MAX = 240
/** 括号统一表：NFKC 已把 （）［］ 折成半角，这里再收 【】〔〕；一次替换避免"左"先跑把右括号也吃掉 */
const BRACKETS = /[\[\]\u3010\u3011\u3014\u3015]/g
const BRACKET_MAP: Record<string, string> = {
  '[': '(', ']': ')', '\u3010': '(', '\u3011': ')', '\u3014': '(', '\u3015': ')',
}
/** 非 NFKC 能折掉的连字符变体统一成 '-'（‐ ‑ ‒ – — ― − ﹣）；名称里的破折号不承载语义 */
const DASH_VARIANTS = /[\u2010\u2011\u2012\u2013\u2014\u2015\u2212\uFE63]/g
/** 控制符一律剔除：规范化后的名字里绝不出现空白与控制符，pair_key 的拼接才无歧义 */
const CONTROL = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/g
const WHITESPACE = /\s+/gu

/**
 * 实体名规范化（规则固定，改这里等于改全库实体身份，必须同步 keys.test.ts）：
 *   ① NFKC：全角 → 半角（ＡＢＣ → abc、（） → ()、－ → -），顺带去掉组合字符差异
 *   ② 小写：化学名的拉丁部分大小写不承载语义（DMSO / dmso 是同一个东西）
 *   ③ 去全部空白：名称里的空格/换行/制表符不承载语义，且去掉后 pair_key 才能用空格当分隔符
 *   ④ 括号统一：() [] 【】 〔〕 → ()；**括号内容一律保留**（"硫酸" 与 "硫酸(浓)" 是两个不同的记录，
 *      名字层面的同义词归并（乙醇/无水乙醇）需要别名表，本阶段不做，见 store.ts 顶部的已知缺口）
 *   ⑤ 连字符变体统一为 '-'；⑥ 剔除控制符；⑦ 超长截断 + 8 位哈希后缀
 */
export function normalizeEntityName(raw: string): string {
  const s = raw
    .normalize('NFKC')
    .toLowerCase()
    .replace(WHITESPACE, '')
    .replace(BRACKETS, c => BRACKET_MAP[c] ?? c)
    .replace(DASH_VARIANTS, '-')
    .replace(CONTROL, '')
  return s.length <= NAME_MAX ? s : `${s.slice(0, NAME_MAX - 10)}~${sha1hex(s).slice(0, 8)}`
}

/**
 * CAS 规范化 + 硬校验：NFKC、去空白，然后必须过校验位。
 * 不过就抛 —— 错的 CAS 会把"甲试剂"的禁配关系挂到"乙试剂"身上，这类错误没有降级余地。
 */
export function normalizeCas(raw: string): string {
  const s = raw.normalize('NFKC').replace(WHITESPACE, '')
  if (!casCheckDigitOk(s)) throw new ReactionKeyError(`CAS 非法或校验位不通过: ${JSON.stringify(raw)}`)
  return s
}

/**
 * 实体键（防重与查询的核心身份）：
 *   reagent 有 CAS → `cas:<CAS>`   ← 唯一跨命名体系稳定的身份，优先用
 *   reagent 无 CAS → `name:<规范名>` ← 兜底：跨文档/跨语言的同义名不会自动合并（已知缺口）
 *   category       → `cat:<规范名>`  ← 类别是抽象实体，永远不带 CAS
 * 三类前缀互不重叠，因此 category 与 reagent 绝无可能被当成同一个实体。
 */
export function entityKeyOf(ref: Pick<EntityRef, 'kind' | 'name'> & { cas?: string | null }): string {
  const kind: EntityKind = ref.kind
  const name = normalizeEntityName(ref.name)
  if (!name) throw new ReactionKeyError(`实体名为空（规范化后）: ${JSON.stringify(ref.name)}`)
  if (kind === 'category') {
    if (ref.cas) throw new ReactionKeyError('category 不许携带 CAS')
    return `cat:${name}`
  }
  return ref.cas ? `cas:${normalizeCas(ref.cas)}` : `name:${name}`
}

// ── 对称规范化 ────────────────────────────────────────────────────────────────
/**
 * 规范化顺序：按 JS 字符串比较（UTF-16 码元序）升序。
 * 为什么用码元序而不是 localeCompare：locale 会随 ICU 版本/环境漂移，键必须跨机器逐字节稳定。
 * 注：MySQL 侧刻意不做 `subject_key <= object_key` 的 CHECK —— utf8mb4_0900_ai_ci 的排序与码元序
 * 对汉字可能不一致，DB 端断言会误杀合法行；顺序的唯一权威是这里。
 */
export function orderPair(a: string, b: string): [string, string] {
  return a <= b ? [a, b] : [b, a]
}

/**
 * 对键：两个实体键排序后拼接，**四种对称关系共用**（A-B 与 B-A 落成同一个 pair_key，天然去重）。
 * 分隔符用空格：normalizeEntityName 已剥离全部空白，实体键内不可能出现空格 → 拼接无歧义，
 * 且比控制符可读（直接 SELECT 出来能看懂）。
 */
export function pairKeyOf(aKey: string, bKey: string): string {
  if (aKey === bKey) throw new ReactionKeyError(`同一实体不能与自己构成关系: ${aKey}`)
  const [x, y] = orderPair(aKey, bKey)
  return `${x} ${y}`
}

/** 从两个实体引用一步算出 pair_key */
export function pairKeyOfRefs(a: EntityRef, b: EntityRef): string {
  return pairKeyOf(entityKeyOf(a), entityKeyOf(b))
}

/**
 * 按规范顺序排好两个实体引用：**键、显示名、CAS 一起换位**。
 * 为什么要连显示名一起排：只排键会让 subject_key 与 subject_name 指向不同实体，
 * 人审页面上就会把 A 的名字配到 B 的关系上——这种错没人看得出来。
 */
export function orderEntityRefs(
  a: EntityRef,
  b: EntityRef,
): { first: EntityRef; second: EntityRef; firstKey: string; secondKey: string; pairKey: string } {
  const aKey = entityKeyOf(a)
  const bKey = entityKeyOf(b)
  const pairKey = pairKeyOf(aKey, bKey)
  return aKey === orderPair(aKey, bKey)[0]
    ? { first: a, second: b, firstKey: aKey, secondKey: bKey, pairKey }
    : { first: b, second: a, firstKey: bKey, secondKey: aKey, pairKey }
}

// ── 幂等键 ────────────────────────────────────────────────────────────────────
/** 证据规范化：只折叠"无意义差异"（NFKC、连续空白 → 单空格、去首尾），不动字面 */
export function normalizeEvidence(raw: string): string {
  return raw.normalize('NFKC').replace(WHITESPACE, ' ').trim()
}

/**
 * 证据连续片段断言：evidence_text 必须能在来源 chunk 原文里逐字找到。
 * 用**原始串**比对（不做规范化），因为目的正是拦截"顺手续写/改写过的引文"。
 */
export function assertEvidenceContiguous(evidenceText: string, chunkText: string): void {
  if (!evidenceText) throw new ReactionKeyError('证据为空')
  if (!chunkText.includes(evidenceText)) {
    throw new ReactionKeyError(
      `evidence_text 不是来源 chunk 的连续原文片段（疑似改写/拼接）：${JSON.stringify(evidenceText.slice(0, 80))}`,
    )
  }
}

export interface CandidateKeyInput {
  relationType: RelationType
  pairKey: string
  sourceDocId: string
  sourceChunkSeq: number
  evidenceQuote: string
}

/**
 * 候选幂等键 = sha1(relation_type \n pair_key \n source_doc_id \n source_chunk_seq \n 规范化证据)。
 * 为什么必须包含 evidence_quote：同一条 chunk 里可能有多句各自独立的证据（如第 10 节同时写了
 * "禁配强氧化剂"和"须与碱分开储存"），只用 (doc, seq) 会把它们压成一条候选，证据被静默丢掉；
 * 带上证据后，同一句证据重复抽取 → 同 key → 幂等不重复，不同证据 → 各自成条互不覆盖。
 * 拼接用 '\n'：上面除证据外三个字段按构造不含换行（doc_id 由 identity.ts 剔除控制符，
 * pair_key 不含空白），证据经 normalizeEvidence 折叠掉换行，因此该编码是单射（这里再断言一次）。
 */
export function candidateKeyOf(input: CandidateKeyInput): string {
  const fields = [
    input.relationType,
    input.pairKey,
    input.sourceDocId,
    String(input.sourceChunkSeq),
    normalizeEvidence(input.evidenceQuote),
  ]
  if (fields.some(f => f.includes('\n'))) {
    throw new ReactionKeyError('幂等键字段含换行，拼接会产生歧义（doc_id/pair_key 不该含换行）')
  }
  return sha1hex(fields.join('\n'))
}

/**
 * 规则业务键 = sha1(relation_type \n pair_key)。
 * 刻意只到"物质对 + 关系类型"这一层：同一对物质的同一类关系允许来自多条证据（多条规则共存），
 * "同一 rule_key 不许同时有两条 active" 是业务不变量，由 store.publishRule 在事务里守，不用唯一索引。
 */
export function ruleKeyOf(relationType: RelationType, pairKey: string): string {
  if (pairKey.includes('\n')) throw new ReactionKeyError('pair_key 含换行')
  return sha1hex(`${relationType}\n${pairKey}`)
}
