// 离线单测：前门三层探测（魔数 / zip 深判 / 内容嗅探 / decide）——不连任何服务
// 靶子用 samples/ 里真实落盘的文件（不是内存桩）：魔数这条路只有"真文件头的字节"才测得准
import { describe, expect, test } from 'bun:test'
import { fileURLToPath } from 'node:url'
import { MAGIC, classifyZip, looksLikeText, probe } from './probe'

const sample = (name: string) => fileURLToPath(new URL(`../../../samples/${name}`, import.meta.url))

const bytes = (s: string) => new TextEncoder().encode(s)
const hexBytes = (h: string) => new Uint8Array(h.match(/../g)!.map(b => parseInt(b, 16)))

describe('MAGIC：魔数表（表驱动，加格式只加一行）', () => {
	test('各家族真头字节都认得', () => {
		const cases: [string, string][] = [
			['255044462d312e37', 'pdf'],
			['504b030414000000', 'zip'],
			['d0cf11e0a1b11ae1', 'ole2'],
			['ffd8ffe000104a46', 'jpeg'],
			['89504e470d0a1a0a', 'png'],
			['4749463839610100', 'gif'],
			['524946462400000057454250', 'webp'],
			['49492a0008000000', 'tiff'],
			['4d4d002a00000008', 'tiff'],
			['000000186674797068656963', 'heic'],
		]
		for (const [h, want] of cases) expect([h, MAGIC(hexBytes(h))]).toEqual([h, want])
	})

	test('文本型头：rtf / html / xml 分开认（html 与 xml 不能混）', () => {
		expect(MAGIC(bytes('{\\rtf1\\ansi'))).toBe('rtf')
		expect(MAGIC(bytes('<!DOCTYPE html>\n<html>'))).toBe('html')
		expect(MAGIC(bytes('<html lang="zh">'))).toBe('html')
		expect(MAGIC(bytes('<?xml version="1.0"?>'))).toBe('xml')
		expect(MAGIC(bytes('# 硫酸 SDS\n'))).toBe('unknown') // 普通 md 走内容嗅探，不是魔数
	})

	test('BMP 的 2 字节魔数不许误伤以 "BM" 开头的文本', () => {
		// 真 BMP：'BM' + 文件大小 + 4 字节保留字段 0
		expect(MAGIC(hexBytes('424d4600000000000000'))).toBe('bmp')
		expect(MAGIC(bytes('BMW 是汽车品牌，本行只是文本'))).toBe('unknown')
	})

	test('空/极短头不崩：返回 unknown', () => {
		expect(MAGIC(new Uint8Array([]))).toBe('unknown')
		expect(MAGIC(bytes('a'))).toBe('unknown')
	})
})

describe('looksLikeText：陌生后缀的兜底判据（与 py 侧 looks_like_text 同口径）', () => {
	test('中文/英文/带 BOM 的文本都判 true', () => {
		expect(looksLikeText(bytes('危险化学品仓库管理规定\n第一条 严禁明火。'))).toBe(true)
		expect(looksLikeText(bytes('plain ascii log line\n'))).toBe(true)
		expect(looksLikeText(hexBytes('fffe4100'))).toBe(true) // UTF-16 LE BOM（FF FE = 魐 ？ 不是 BOM，别写错）
	})

	test('二进制判 false（NUL 一票否决）', () => {
		expect(looksLikeText(hexBytes('0001020300ff'))).toBe(false)
		expect(looksLikeText(hexBytes('89504e470d0a1a0a0000000d49484452'))).toBe(false)
		expect(looksLikeText(new Uint8Array([]))).toBe(false)
	})
})

describe('classifyZip：四族共用一个 zip 魔数，靠内部布局区分', () => {
	test('docx / xlsx / pptx / odf 各归各家', () => {
		expect(classifyZip({ 'word/document.xml': 1, '[Content_Types].xml': 1 })).toBe('docx')
		expect(classifyZip({ 'xl/workbook.xml': 1, '[Content_Types].xml': 1 })).toBe('xlsx')
		expect(classifyZip({ 'ppt/presentation.xml': 1, '[Content_Types].xml': 1 })).toBe('pptx')
		expect(classifyZip({ mimetype: 1, 'META-INF/manifest.xml': 1, 'content.xml': 1 })).toBe('odf')
	})

	test('认不出结构 → null（普通压缩包不许被当 docx 硬啃）', () => {
		expect(classifyZip({ 'a.txt': 1, 'dir/b.bin': 1 })).toBeNull()
		expect(classifyZip({})).toBeNull()
	})

	test('docx 优先于 xlsx（混装包按 docx 走，别两边都认）', () => {
		expect(classifyZip({ 'word/document.xml': 1, 'xl/workbook.xml': 1 })).toBe('docx')
	})
})

describe('probe：真文件过前门（samples/ 靶子）', () => {
	test('纯文本 md → text 族 + L0-py', async () => {
		const p = await probe(sample('硫酸-sop.txt'))
		expect(p.family).toBe('text')
		expect(p.strategy).toBe('L0-py')
	})

	test('HTML → html 族（不是 text 族：它有自己的抽取器）', async () => {
		const p = await probe(sample('family-html.html'))
		expect(p.family).toBe('html')
		expect(p.strategy).toBe('L0-py')
	})

	test('ODF / PPTX → zip 深判出正确家族', async () => {
		expect((await probe(sample('family-odt.odt'))).family).toBe('odf')
		expect((await probe(sample('family-pptx.pptx'))).family).toBe('pptx')
	})

	test('★ 陌生后缀 + 文本内容 → text 族（内容嗅探兜底），且 notes 记账', async () => {
		const p = await probe(sample('family-unknown.dat'))
		expect(p.family).toBe('text')
		expect(p.strategy).toBe('L0-py')
		expect(p.notes?.some(n => n.includes('内容像纯文本'))).toBe(true)
	})

	test('有文字层的 PDF → pdf 族 + 档案带页数', async () => {
		const p = await probe(sample('family-text.pdf'))
		expect(p.family).toBe('pdf')
		expect(p.pdf?.pages).toBe(3)
		expect(p.pdf?.hasTextLayer).toBe(true)
		expect(p.strategy).toBe('L0-py')
	})

	test('★ 无文字层 PDF（扫描件）→ L1-py-vl（交给视觉解析）', async () => {
		const p = await probe(sample('family-scan.pdf'))
		expect(p.family).toBe('pdf')
		expect(p.pdf?.hasTextLayer).toBe(false)
		expect(p.strategy).toBe('L1-py-vl')
	})

	test('RTF → rtf 族（既往连魔数都没有，会掉进 unknown→L2 黑洞）', async () => {
		const p = await probe(sample('family-rtf.rtf'))
		expect(p.family).toBe('rtf')
		expect(p.strategy).toBe('L0-py')
	})

	test('GBK 文本 / CSV → text 族（编码在 py 侧解决，前门不拦）', async () => {
		expect((await probe(sample('family-gbk.txt'))).family).toBe('text')
		expect((await probe(sample('family-table.csv'))).family).toBe('text')
	})

	test('空文件 → unknown + L2-review，且说明是空文件（不许静默）', async () => {
		const p = await probe(sample('family-empty.dat'))
		expect(p.family).toBe('unknown')
		expect(p.strategy).toBe('L2-review')
		expect(p.notes?.[0]).toContain('空文件')
	})
})

describe('probe：后缀与内容不符时以内容为准（改前是先看后缀直接 return）', () => {
	test('★ 叫 .md 的 PDF：必须按 pdf 走，并记账"声明 vs 实判"', async () => {
		// 真靶子：把有文字层的 PDF 复制成 .md（真实世界里"另存错了后缀"就这么发生）
		const { copyFile, rm } = await import('node:fs/promises')
		const fake = sample('family-text.pdf').replace(/family-text\.pdf$/, 'family-mismatch.md')
		await copyFile(sample('family-text.pdf'), fake)
		try {
			const p = await probe(fake)
			expect(p.family).toBe('pdf')                      // 内容赢
			expect(p.notes?.some(n => n.includes('声明为 text'))).toBe(true)
			expect(p.notes?.some(n => n.includes('按内容走'))).toBe(true)
		} finally {
			await rm(fake, { force: true })
		}
	})
})
