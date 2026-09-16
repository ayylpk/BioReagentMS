// 离线单测：切片（bySection）——完整标题路径 / 重复标题 / 大表按行拆 / 小表原子
// 不连 Qdrant / MySQL / 网络：只喂内存里的 Block[]，断言纯函数输出
//
// ⚠️ 9/16 起：本文件里"帧逻辑"（标题栈/路径）的用例统一传 `{ perFrameBoundary: true, cut: { min: 0 } }`
//    —— 即"一节一块 + 不打包"，好让断言只针对帧逻辑本身；跨节打包的语义（sections[]、公共祖先）
//    在 recursive.test.ts 里专测。理由：ICSC 那种每节 70 字的文档，默认 MIN=250 会把相邻几节打成一块，
//    那是设计不是 bug，但它会把"路径算得对不对"这层断言淹掉。
import { test, expect } from 'bun:test'
import { bySection, splitMdTable, MAX_TABLE_CHARS } from './bySection'
import { docIdOf } from '../inspect/identity'
import type { Block } from '../inspect/profile'

const FILE = 'corpus/chem/硫酸.md'
const DOC = docIdOf(FILE) // chem__硫酸（身份口径的唯一来源，测试不自己拼）
/** 只测帧逻辑：一节一块 + 关掉打包 */
const NO_MERGE = { perFrameBoundary: true, cut: { min: 0 } } as const

const H = (level: number, text: string): Block => ({ type: 'heading', level, markdown: text })
const T = (text: string): Block => ({ type: 'text', markdown: text })

/** 造一张 md 表：1 表头 + 1 分隔行 + rows 行数据，每行 ~49 字符 */
function mdTable(rows: number, cols = 3): { md: string; head: string; sep: string; data: string[] } {
	const head = `| ${Array.from({ length: cols }, (_, i) => `列${i + 1}`).join(' | ')} |`
	const sep = `| ${Array.from({ length: cols }, () => '---').join(' | ')} |`
	const data = Array.from({ length: rows }, (_, i) => `| 行${i + 1}甲 | 行${i + 1}乙 | ${'x'.repeat(30)} |`)
	return { md: [head, sep, ...data].join('\n'), head, sep, data }
}

/** 从 chunk 正文里按行提取数据行（行首必须恰好是 `|`，顺带验证"锚没把表挤到同一行"） */
const dataRowsIn = (text: string) => text.split('\n').filter(l => /^\| 行\d+甲 \|/.test(l))

test('多级标题：headingPath 从顶层到叶节点，顺序完整；section 仍是叶子', () => {
	const chunks = bySection(FILE, [
		H(1, '化学品安全技术说明书'),
		H(2, '4 急救措施'),
		H(3, '4.1 皮肤接触'),
		T('脱去污染的衣着，用大量流动清水冲洗。'),
	], NO_MERGE)
	expect(chunks).toHaveLength(1)
	expect(chunks[0]!.headingPath).toEqual(['化学品安全技术说明书', '4 急救措施', '4.1 皮肤接触'])
	expect(chunks[0]!.section).toBe('4.1 皮肤接触')
})

test('标题回退：4 级标题后接同级/更高级 → 正确出栈（同级也弹出）', () => {
	const chunks = bySection(FILE, [
		H(1, 'A'), H(2, 'B'), H(3, 'C'), H(4, 'D'), T('深'),
		H(3, 'E'), T('回三级'),
		H(2, 'F'), T('回二级'),
	], NO_MERGE)
	expect(chunks[0]!.headingPath).toEqual(['A', 'B', 'C', 'D'])
	expect(chunks[1]!.headingPath).toEqual(['A', 'B', 'E'])
	expect(chunks[2]!.headingPath).toEqual(['A', 'F'])
})

test('重复/同名标题：栈不崩、路径不丢（同名各归自己的父节）', () => {
	const chunks = bySection(FILE, [
		H(1, '手册'),
		H(2, '8 接触控制'), H(2, '其他信息'), T('第一处'),
		H(2, '9 理化特性'), H(2, '其他信息'), T('第二处'),
		H(3, '其他信息'), T('第三处'),
	], NO_MERGE)
	expect(chunks[0]!.headingPath).toEqual(['手册', '其他信息'])
	expect(chunks[1]!.headingPath).toEqual(['手册', '其他信息'])
	expect(chunks[2]!.headingPath).toEqual(['手册', '其他信息', '其他信息']) // 同名嵌套照样完整
	expect(chunks.map(c => c.section)).toEqual(['其他信息', '其他信息', '其他信息'])
})

test('level 缺失：markdown 前导 # 兜底；既无 level 也无 # → 当顶层(=1)', () => {
	const chunks = bySection(FILE, [
		{ type: 'heading', markdown: '# 顶层' },
		{ type: 'heading', markdown: '## 二级' },
		T('甲'),
		{ type: 'heading', markdown: '无井号标题' },
		T('乙'),
	], NO_MERGE)
	expect(chunks[0]!.headingPath).toEqual(['顶层', '二级'])
	expect(chunks[1]!.headingPath).toEqual(['无井号标题']) // 当作顶层 → 把前面的栈清掉
})

test('小表保持原子（行为未变）：单块 + tablePart 1/1 + 正文完整含表头与所有行', () => {
	const { md, head } = mdTable(3)
	const chunks = bySection(FILE, [H(1, '标题'), { type: 'table', markdown: md }])
	expect(chunks).toHaveLength(1)
	expect(chunks[0]!.tableId).toBe(`${DOC}#1`)
	expect(chunks[0]!.tablePart).toEqual({ index: 1, total: 1 })
	expect(chunks[0]!.text).toContain(head)
	expect(dataRowsIn(chunks[0]!.text)).toHaveLength(3)
	expect(chunks[0]!.flags ?? []).toEqual([])
})

test('大表按行拆：片数正确、每片重复表头+分隔行、行数守恒、无行被截断', () => {
	const { md, head, sep, data } = mdTable(200)
	expect(md.length).toBeGreaterThan(MAX_TABLE_CHARS)
	const chunks = bySection(FILE, [H(1, '标题'), H(2, '3 成分'), { type: 'table', markdown: md }])

	const total = chunks[0]!.tablePart!.total
	expect(total).toBeGreaterThan(1)
	expect(chunks).toHaveLength(total)
	expect(chunks.map(c => c.tablePart!.index)).toEqual(Array.from({ length: total }, (_, i) => i + 1))
	for (const c of chunks) {
		expect(c.text).toContain(head)    // 每片都有表头
		expect(c.text).toContain(sep)     // 每片都有分隔行（丢了 md 表就塌）
		expect(c.tableId).toBe(`${DOC}#2`) // 同一来源 block → 同一个 table_id
		expect(c.headingPath).toEqual(['标题', '3 成分'])
		expect(c.section).toBe('3 成分')
	}

	const got = chunks.flatMap(c => dataRowsIn(c.text))
	expect(got).toHaveLength(data.length)                 // 行数守恒
	expect(got).toEqual(data)                             // 顺序与内容逐行一致（无截断/无重复/无丢失）
})

test('表格不走文本切法：表内行从不被 overlap 粘出半行，锚独占首行', () => {
	const { md, data } = mdTable(120)
	const chunks = bySection(FILE, [{ type: 'table', markdown: md }])
	expect(chunks.flatMap(c => dataRowsIn(c.text))).toEqual(data)
	for (const c of chunks) {
		const lines = c.text.split('\n').filter(l => l.trim() !== '')
		expect(lines[0]!.startsWith('|')).toBe(false)                        // 第一行是锚
		expect(lines.slice(1).every(l => l.startsWith('|') || l.startsWith('（表续'))).toBe(true)
	}
})

test('续接标记：只有第 2..N 片带（表续 i/N），独立成行、不破表结构', () => {
	const { md } = mdTable(200)
	const chunks = bySection(FILE, [{ type: 'table', markdown: md }])
	const total = chunks.length
	expect(chunks[0]!.text).not.toContain('（表续')
	for (const [i, c] of chunks.entries()) {
		if (i === 0) continue
		expect(c.text).toContain(`（表续 ${i + 1}/${total}）`)
		const lines = c.text.split('\n')
		const markerAt = lines.findIndex(l => l.startsWith('（表续'))
		expect(markerAt).toBeGreaterThan(0)
		expect(lines[markerAt + 1]!.startsWith('|')).toBe(true)  // 标记行紧接着就是表头行，未插进表内
	}
})

test('不可安全拆的表：无分隔行 → 整块保留 + 记 flag（宁可大也不瞎切）', () => {
	const rows = Array.from({ length: 60 }, (_, i) => `| 行${i + 1}甲 | 行${i + 1}乙 | ${'x'.repeat(30)} |`)
	const md = rows.join('\n') // 没有表头/分隔行
	expect(md.length).toBeGreaterThan(MAX_TABLE_CHARS)
	const chunks = bySection(FILE, [{ type: 'table', markdown: md }])
	expect(chunks).toHaveLength(1)
	expect(chunks[0]!.text).toContain(rows[0]!)
	expect(chunks[0]!.flags?.[0]).toContain('整块保留未拆')
})

test('复杂表（带 html 原文 = 合并单元格）：超阈值也不拆，整块 + flag', () => {
	const { md, data } = mdTable(200)
	const chunks = bySection(FILE, [
		{ type: 'table', markdown: md, html: '<table><tr><td rowspan="2">合并</td></tr></table>' },
	])
	expect(md.length).toBeGreaterThan(MAX_TABLE_CHARS)
	expect(chunks).toHaveLength(1)
	expect(chunks[0]!.text).toContain(data[0]!)
	expect(chunks[0]!.flags?.[0]).toContain('复杂表')
})

test('表格前后的非表格行：表标题跟第一片、残留行跟最后一片，都不丢', () => {
	const { md } = mdTable(200)
	const wrapped = `表1 成分信息\n${md}\n注：本表数据来自厂商 SDS`
	const chunks = bySection(FILE, [{ type: 'table', markdown: wrapped }])
	expect(chunks[0]!.text).toContain('表1 成分信息')
	expect(chunks[0]!.text).not.toContain('注：本表数据来自厂商 SDS')
	expect(chunks[chunks.length - 1]!.text).toContain('注：本表数据来自厂商 SDS')
	expect(chunks[1]!.text).not.toContain('表1 成分信息') // 表标题不会重复出现在每片
})

test('tableId 用 block 下标：同文档两个表 → 两个不同 table_id', () => {
	const chunks = bySection(FILE, [
		H(1, '标题'), T('前言'),
		{ type: 'table', markdown: mdTable(3).md },
		T('中间文字'),
		{ type: 'table', markdown: mdTable(4).md },
	], NO_MERGE)
	expect(chunks.map(c => c.tableId)).toEqual([undefined, `${DOC}#2`, undefined, `${DOC}#4`])
})

test('splitMdTable 纯函数：同输入两次调用结果逐字相同（确定性）', () => {
	const { md } = mdTable(80)
	expect(splitMdTable(md, MAX_TABLE_CHARS)).toEqual(splitMdTable(md, MAX_TABLE_CHARS))
})
