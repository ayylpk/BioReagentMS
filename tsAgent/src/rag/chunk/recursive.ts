// ⑩ 通用切块引擎（切片泛化第二刀）：**只认纯文本，不认"这是 SDS"**
//
// 为什么要有这一层：bySection 原来是"结构优先、递归兜底"，但结构信号一旦没有（OCR 长串、散文、
// 一行一词的日志、被压平的段落），兜底的 splitLong 只会按层级降级 → 掉到"按行切/按逗号切"，
// 于是句中下刀、切出几十字的碎尾。语料实测（300 份）：块长 p50=109 字、**59.5% 的块不足 120 字**、
// 超长只占 2.4% —— 病不是"切不断"，是"切太碎、切点不讲究"。
//
// 本文件的切法（四条，全与文档结构无关）：
//   ① 归一      只动版式不动字：统一换行、去零宽、压缩 3+ 连续空行、去行尾空白。**保行结构**是前提。
//   ② 窗口切    目标区间 [MIN 250, MAX 800]，软上限 MAX×1.15=920：
//                在 [from+MIN, from+MAX] 里找切点，取**优先级最高**的一类里最靠右的那个；
//                窗口内没有切点 → 向后扩到软上限，取**遇到的第一个**（"达到上限继续往后找边界"）；
//                连软上限都没有（无标点巨串）→ 硬切于 from+MAX，绝不返回超限块。
//                优先级：段落 > 句末(。！？；) > 换行 > 逗号(，、：,)
//   ③ 并到下限  同一次 flush 内相邻片并到 ≥ MIN 为止（永不超软上限）。这治的是"原本就短的段落"；
//                ②里的下限顺带治"贪心打包留下的碎尾"——两者分工不同，都要。
//   ④ 重叠 10%  只在**真切开的缝**上给：下一块头部 = 上一块尾部 round(len×10%)（上限 150 字，
//                前一块不足 80 字不带）。合并掉的缝不算缝（内容连续，没有丢东西，不需要重叠）。
//
// 结构信息（标题/分节/表格）在这一层只是"帧"与"不参与合并的片"，**不参与切法决策**：
// 无标题文档 = 单帧 → 整篇自由合并，就是通用退化情形，不需要另走一条代码路。
//
// 红线（与 bySection 同款）：text 只由 ①源文 ②重叠前缀 ③锚 ④表续标记 拼成 —— 任何位置都不许掺 LLM 内容。
// 纯函数、零 I/O、零 LLM，可离线单测（见 recursive.test.ts）
import { MAX_TABLE_CHARS } from './params'

/** 目标区间与重叠参数（全局一套；env 可覆盖，**不按文档族分表** —— 通用性就是这个意思） */
const envInt = (key: string, fallback: number): number => {
	const v = Number(process.env[key])
	return Number.isFinite(v) && v > 0 ? Math.floor(v) : fallback
}
export const MAX_CHUNK = envInt('CHUNK_MAX', 800)
export const MIN_CHUNK = envInt('CHUNK_MIN', 250)
/** 软上限系数：窗口内找不到边界时，允许超出 MAX 去够第一个边界（"再往后扩百分之多少"） */
export const SOFT_SLACK = 0.15
/** 重叠比例：下一块头部带上一块尾部的百分比（用户口径："保留上次百分之十"） */
export const OVERLAP_RATIO = 0.1
/** 重叠上限：比例算出来太大就封顶，免得短块被上一块的尾巴主导 */
export const OVERLAP_CAP = 150
/** 前一块短于这个数就不带重叠（带过去也没多少信息） */
export const OVERLAP_MIN_CARRY = 80

export interface CutOptions {
	max?: number
	min?: number
	slack?: number
	overlapRatio?: number
	overlapCap?: number
	overlapMinCarry?: number
}

/** 片的收尾边界类型：段落/句末/换行/逗号 = 自然边界；hard = 无标点巨串的硬切；end = 文本自然结束 */
export type CutKind = 'paragraph' | 'sentence' | 'line' | 'comma' | 'hard' | 'end'

export interface Piece {
	text: string
	cut: CutKind
	/** 切缝处从前一片带过来的重叠字符数（0 = 没带） */
	overlapChars: number
	/** 由几个初切片合并而成（1 = 未合并） */
	mergedFrom: number
	/** 低于 MIN：只有"帧尾"或"单片超长"两种正当理由，其余一律算切法 bug */
	belowMin: boolean
}

// ─────────────────────────────────────────────────────────
// ① 归一：只动版式，不动字
// ─────────────────────────────────────────────────────────
/** 归一：CRLF/CR → LF；去零宽字符；行尾空白清零；3+ 连续空行压成 1 个空行；首尾空白清零
 *  ⚠️ 绝不把连续非空行合成一段 —— 那正是"块化阶段先把行结构扔掉、切块层无从下手"的病根 */
export function normalizeText(raw: string): string {
	return raw
		.replace(/\r\n?/g, '\n')
		.replace(/[\u200B-\u200D\uFEFF\u2060]/g, '')
		.replace(/[ \t]+$/gm, '')
		.replace(/\n{3,}/g, '\n\n')
		.trim()
}

/** 去标点后的比较形态：只用来判断"两行是不是同一件事"，不参与输出 */
const cmpForm = (s: string): string => s.replace(/[^\p{L}\p{N}]/gu, '')

/**
 * "这两段说的是同一件事吗"（保守判据，与行去重同一套）：
 *   去标点后 ①逐字相同 或 ②一方包含另一方且**被包含者 ≥24 字**。
 * 为什么保守：两条急救步骤只差一个条件（"皮肤接触"vs"眼睛接触"）的情况真实存在，
 * 安全数据上错删一条的代价远大于留一条重复（重复只让 tf 灌点水）。
 */
export function isSameFact(a: string, b: string): boolean {
	const x = cmpForm(a)
	const y = cmpForm(b)
	if (x.length < 12 || y.length < 12) return false
	if (x === y) return true
	return (x.includes(y) && y.length >= 24) || (y.includes(x) && x.length >= 24)
}

/**
 * 相邻重复行去重（**保守**，宁可留重复也不许错删）：
 *   只比相邻两行；去标点后 ①逐字相同 或 ②一方包含另一方且**被包含者 ≥24 字** → 留信息量大的那条。
 * 为什么保守：两条急救步骤只差一个条件（"皮肤接触"vs"眼睛接触"）的情况真实存在，
 * 安全数据上错删一条的代价远大于留一条重复（重复只让 tf 灌点水）。
 * 实测依据：300/300 份 ICSC 卡含"同内容两形态"相邻行（naive 列拼接 + 带全角｜的版本）。
 */
export function dedupeAdjacentLines(text: string): { text: string; dropped: number } {
	const lines = text.split('\n')
	const out: string[] = []
	let dropped = 0
	for (const line of lines) {
		const prev = out[out.length - 1]
		if (prev !== undefined && line.trim() !== '' && prev.trim() !== '') {
			if (isSameFact(prev, line)) {
				// 后者更全（包含前者）→ 换成后者；否则丢掉后者
				if (cmpForm(line).length > cmpForm(prev).length) out[out.length - 1] = line
				dropped++
				continue
			}
		}
		out.push(line)
	}
	return { text: out.join('\n'), dropped }
}

// ─────────────────────────────────────────────────────────
// ② 窗口切：候选边界 + 优先级 + 软上限
// ─────────────────────────────────────────────────────────
/** 边界优先级：数越小越"语义化"（窗口里优先选它） */
const PRIO = { paragraph: 1, sentence: 2, line: 3, comma: 4 } as const
type NaturalKind = keyof typeof PRIO

/** 一次扫出全部候选边界（切点 = 边界**之后**的位置），按位置升序、同位置留优先级最高的 */
interface Boundary { pos: number; kind: NaturalKind }
const BOUNDARY_RE = /(\n[ \t]*\n+)|([。！？；!?;]+)|(\n)|([，、：,:])/g

export function scanBoundaries(text: string): Boundary[] {
	const found = new Map<number, NaturalKind>()
	BOUNDARY_RE.lastIndex = 0
	for (let m = BOUNDARY_RE.exec(text); m; m = BOUNDARY_RE.exec(text)) {
		const kind: NaturalKind = m[1] ? 'paragraph' : m[2] ? 'sentence' : m[3] ? 'line' : 'comma'
		const pos = m.index + m[0].length
		const prev = found.get(pos)
		if (prev === undefined || PRIO[kind] < PRIO[prev]) found.set(pos, kind)
	}
	return [...found.entries()].map(([pos, kind]) => ({ pos, kind })).sort((a, b) => a.pos - b.pos)
}

/** 参数补全（唯一一处默认值来源；chooseCut / cutPieces / mergeToMin 都走它） */
const resolve = (opts: CutOptions): Required<CutOptions> => ({
	max: opts.max ?? MAX_CHUNK, min: opts.min ?? MIN_CHUNK, slack: opts.slack ?? SOFT_SLACK,
	overlapRatio: opts.overlapRatio ?? OVERLAP_RATIO, overlapCap: opts.overlapCap ?? OVERLAP_CAP,
	overlapMinCarry: opts.overlapMinCarry ?? OVERLAP_MIN_CARRY,
})

/** 代理对（emoji 等）不许被劈成两半：切点落在低位代理上就往后挪一位 */
const safePos = (text: string, pos: number): number => {
	const c = text.charCodeAt(pos)
	return c >= 0xdc00 && c <= 0xdfff ? pos + 1 : pos
}

/**
 * 找一个切点（纯函数，返回切点在 text 里的下标）。**只返回 > from 的位置**，保证调用方一定前进。
 * 顺序：窗口 [from+min, from+max] 内 → 优先级最高者里最靠右的；
 *       没找到 → 软上限 [from+max, from+softMax] 内遇到的第一个；
 *       还没有 → 硬切 from+max。
 */
export function chooseCut(
	text: string,
	bounds: readonly Boundary[],
	from: number,
	opts: CutOptions = {},
): { pos: number; kind: CutKind } {
	const o = resolve(opts)
	const max = o.max
	const softMax = Math.floor(max * (1 + o.slack))
	const lo = from + o.min
	const hi = from + max

	// 窗口内：语义优先级最高的那一类里，取最靠右的（块尽量满，但不牺牲边界质量）
	let bestKind: NaturalKind | null = null
	let bestPos = -1
	for (const b of bounds) {
		if (b.pos <= from) continue
		if (b.pos > hi) break
		if (b.pos < lo) continue
		if (bestKind === null || PRIO[b.kind] < PRIO[bestKind] || (b.kind === bestKind && b.pos > bestPos)) {
			bestKind = b.kind
			bestPos = b.pos
		}
	}
	if (bestKind !== null && bestPos > from) return { pos: bestPos, kind: bestKind }

	// 窗口内无边界 → 往后扩到软上限，取遇到的第一个（"达到上限继续往后直到遇到边界"）
	for (const b of bounds) {
		if (b.pos <= hi) continue
		if (b.pos > from + softMax) break
		return { pos: b.pos, kind: b.kind }
	}
	// 连软上限内都没有（无标点巨串）→ 硬切；绝不返回超限块
	return { pos: safePos(text, Math.min(from + max, text.length)), kind: 'hard' }
}

/** 把一片文本切成初切片：[MIN, 软上限] 区间内、切点落在自然边界上 */
export function cutPieces(text: string, opts: CutOptions = {}): { text: string; cut: CutKind }[] {
	const o = resolve(opts)
	const softMax = Math.floor(o.max * (1 + o.slack))
	if (text.length <= o.max) return [{ text, cut: 'end' }]
	const bounds = scanBoundaries(text)
	const out: { text: string; cut: CutKind }[] = []
	let from = 0
	while (from < text.length) {
		while (from < text.length && /\s/.test(text[from]!)) from++   // 片首空白丢掉（归一化里已保证不丢字）
		if (from >= text.length) break
		if (text.length - from <= o.max) { out.push({ text: text.slice(from), cut: 'end' }); break }
		const { pos, kind } = chooseCut(text, bounds, from, o)
		const at = Math.max(pos, from + 1) // 前进保证：宁可切得不美，也不许死循环
		// 别留碎尾：切完剩下的尾巴不足下限、且并进来还不超软上限 → 直接收尾，不单独造一个碎块
		if (text.length - at < o.min && text.length - from <= softMax) {
			out.push({ text: text.slice(from).trimEnd(), cut: 'end' })
			break
		}
		out.push({ text: text.slice(from, at).trimEnd(), cut: kind })
		from = at
	}
	return out
}

// ─────────────────────────────────────────────────────────
// ③ 并到下限 + ④ 切缝重叠
// ─────────────────────────────────────────────────────────
/**
 * 合并到 MIN：同一次 flush 内（= 同一上下文帧、原文连续）相邻片顺序并。
 * 两种该并的情形：
 *   ① 累计片还不足 MIN → 继续吃下一片（治"原本就短的段落"）
 *   ② 下一片不足 MIN → 也并进来（治"尾巴碎块"：40 字的尾巴不该单独成块）
 * 硬约束：并完不得超软上限（宁可留一个略短的片，也不接受超长块）。
 * 被并掉的缝在输出里消失 → 那些缝不算"切缝"，不配重叠。
 */
export function mergeToMin(
	pieces: readonly { text: string; cut: CutKind }[],
	opts: CutOptions = {},
): Piece[] {
	const o = resolve(opts)
	const softMax = Math.floor(o.max * (1 + o.slack))
	const out: Piece[] = []
	for (const p of pieces) {
		const last = out[out.length - 1]
		const wantMerge = last !== undefined && (last.text.length < o.min || p.text.length < o.min)
		if (last && wantMerge && last.text.length + 1 + p.text.length <= softMax) {
			last.text = `${last.text}\n${p.text}`
			last.cut = p.cut
			last.mergedFrom++
			continue
		}
		out.push({ text: p.text, cut: p.cut, overlapChars: 0, mergedFrom: 1, belowMin: false })
	}
	for (const p of out) p.belowMin = p.text.length < o.min
	return out
}

/** 切缝重叠：只在相邻片之间加（合并掉的缝不在这里出现）；返回新数组，不原地改 */
export function applyOverlap(pieces: readonly Piece[], opts: CutOptions = {}): Piece[] {
	const o = resolve(opts)
	return pieces.map((p, i) => {
		const prev = pieces[i - 1]
		if (!prev || prev.text.length < o.overlapMinCarry) return { ...p }
		const k = Math.min(Math.round(prev.text.length * o.overlapRatio), o.overlapCap)
		if (k <= 0) return { ...p }
		return { ...p, text: `${prev.text.slice(-k)}${p.text}`, overlapChars: k }
	})
}

/**
 * 通用切块（独立使用）：归一 → 去重 → 切 → 并 → 重叠。
 * bySection 走的是"分步版"（prepareText + splitPrepared），因为块化层要按段追踪帧信息。
 */
export function splitUniversal(raw: string, opts: CutOptions = {}): { pieces: Piece[]; droppedLines: number } {
	const prepared = prepareText(raw)
	if (!prepared.text) return { pieces: [], droppedLines: prepared.dropped }
	return { pieces: splitPrepared(prepared.text, opts), droppedLines: prepared.dropped }
}

/** 归一 + 相邻重复行去重（**只此一处**定义"清洗"，别处不许再各写一份） */
export function prepareText(raw: string): { text: string; dropped: number } {
	const text = normalizeText(raw)
	if (!text) return { text: '', dropped: 0 }
	const d = dedupeAdjacentLines(text)
	return { text: d.text, dropped: d.dropped }
}

/** 已清洗文本的切+并+重叠（bySection 用这条：它自己做过归一与去重，且要按段追踪来源帧） */
export function splitPrepared(cleaned: string, opts: CutOptions = {}): Piece[] {
	if (!cleaned) return []
	return applyOverlap(mergeToMin(cutPieces(cleaned, opts), opts), opts)
}
