// 离线单测：不起 Qdrant/MySQL/Ollama、不 spawn python、不联网。
// 覆盖 ①契约结构校验 ②错误语义出口 ③扩展名口径 ④跨语言一致性（最有价值的回归网）
import { describe, expect, test } from 'bun:test'
import { fileURLToPath } from 'node:url'
import { validatePyPayload, validateBlocks, validateDiag, formatIssues, pythonCandidates } from './fromPy'
import { ALLOWED_EXT, TEXT_FAMILY_EXT, PY_PARSER_EXT, JUNK_EXT, extOf, familyOfExt, isJunkExt, unsupportedReason } from './formats'

const block = (over: Record<string, unknown> = {}) => ({ type: 'text', markdown: 'x', ...over })

describe('validatePyPayload 顶层契约', () => {
	test('合法 payload 全量通过（四种 block + 可选字段）', () => {
		const r = validatePyPayload({
			blocks: [
				{ type: 'heading', level: 2, markdown: '试剂安全', page: 1 },
				{ type: 'text', markdown: '正文', page: 1, bbox: [0, 0, 10, 20] },
				{ type: 'table', markdown: '|a|b|', html: '<table></table>' },
				{ type: 'image', markdown: '![GHS 象形图](a.png)' },
			],
			reject: null,
		})
		if (!r.ok) throw new Error(formatIssues(r.issues))
		expect(r.payload.blocks).toHaveLength(4)
		expect(r.payload.reject).toBeNull()
	})

	test('reject 缺省归一为 null；空 blocks 合法（合法空文档）', () => {
		const r = validatePyPayload({ blocks: [] })
		if (!r.ok) throw new Error(formatIssues(r.issues))
		expect(r.payload.reject).toBeNull()
		expect(r.payload.blocks).toHaveLength(0)
	})

	test('reject 为字符串原样透出（走 DocReject 出口）', () => {
		const r = validatePyPayload({ blocks: [], reject: '台账型 sheet 拒入向量库' })
		if (!r.ok) throw new Error(formatIssues(r.issues))
		expect(r.payload.reject).toBe('台账型 sheet 拒入向量库')
	})

	test('顶层不是对象 → 结构化失败（null / 数组 / 字符串 / 数字 / undefined）', () => {
		for (const bad of [null, [], 'nope', 42, undefined]) {
			const r = validatePyPayload(bad)
			expect(r.ok).toBe(false)
			if (r.ok) throw new Error('不应通过')
			expect(r.issues[0]!.field).toBe('$')
			expect(r.issues[0]!.message).toContain('对象')
		}
	})

	test('blocks 不是数组（缺字段 / null / 字符串 / 对象）', () => {
		for (const bad of [undefined, null, 'nope', { a: 1 }]) {
			const r = validatePyPayload({ blocks: bad })
			expect(r.ok).toBe(false)
			if (r.ok) throw new Error('不应通过')
			expect(r.issues[0]!.field).toBe('blocks')
		}
	})

	test('reject 类型非法（数字 / 布尔 / 对象）', () => {
		for (const bad of [123, true, { x: 1 }]) {
			const r = validatePyPayload({ blocks: [], reject: bad })
			expect(r.ok).toBe(false)
			if (r.ok) throw new Error('不应通过')
			expect(r.issues.some(i => i.field === 'reject')).toBe(true)
		}
	})
})

describe('validateBlocks 单个 block 形状', () => {
	test('type 未知 / 缺失 / 非字符串', () => {
		for (const t of ['code', undefined, 7]) {
			const r = validateBlocks([block({ type: t })])
			expect(r.ok).toBe(false)
			if (r.ok) throw new Error('不应通过')
			expect(r.issues[0]!.field).toBe('type')
		}
	})

	test('markdown 缺失或非字符串', () => {
		for (const m of [undefined, 5, null, ['x']]) {
			const r = validateBlocks([block({ markdown: m })])
			expect(r.ok).toBe(false)
			if (r.ok) throw new Error('不应通过')
			expect(r.issues.some(i => i.field === 'markdown')).toBe(true)
		}
	})

	test('level 非 1~6 整数（0 / 负数 / 小数 / 超界）', () => {
		for (const lv of [0, -1, 1.5, 7]) {
			const r = validateBlocks([block({ type: 'heading', level: lv })])
			expect(r.ok).toBe(false)
			if (r.ok) throw new Error('不应通过')
			expect(r.issues[0]!.field).toBe('level')
		}
		// 合法 level 与"不带 level 的普通块"都要过
		expect(validateBlocks([block({ type: 'heading', level: 6 })]).ok).toBe(true)
		expect(validateBlocks([block()]).ok).toBe(true)
	})

	test('page 为 0 或负数', () => {
		for (const p of [0, -3]) {
			const r = validateBlocks([block({ page: p })])
			expect(r.ok).toBe(false)
			if (r.ok) throw new Error('不应通过')
			expect(r.issues[0]!.field).toBe('page')
		}
	})

	test('bbox 长度不对 / 元素非 number / 坐标倒挂', () => {
		const cases: [number, unknown][] = [
			[0, [0, 0, 1]],
			[0, [0, 0, 1, 2, 3]],
			[0, [0, 0, '1', 1]],
			[0, [10, 0, 5, 20]], // x1 < x0
			[0, [0, 20, 5, 10]], // y1 < y0
		]
		for (const [idx, bb] of cases) {
			const r = validateBlocks([block({ bbox: bb })])
			expect(r.ok).toBe(false)
			if (r.ok) throw new Error('不应通过')
			expect(r.issues[idx]!.field).toBe('bbox')
		}
		expect(validateBlocks([block({ bbox: [0, 0, 10, 20] })]).ok).toBe(true)
	})

	test('block 不是对象（字符串 / null / 数组）', () => {
		for (const bad of ['x', null, []]) {
			const r = validateBlocks([bad])
			expect(r.ok).toBe(false)
			if (r.ok) throw new Error('不应通过')
			expect(r.issues[0]!.field).toBe('$')
		}
	})

	test('html 存在时必须是字符串', () => {
		const r = validateBlocks([block({ type: 'table', html: 5 })])
		expect(r.ok).toBe(false)
		if (r.ok) throw new Error('不应通过')
		expect(r.issues[0]!.field).toBe('html')
	})

	test('一个坏块 → 整体失败，绝不返回"过滤后的好块"（静默入库的另一张皮）', () => {
		const r = validateBlocks([block({ markdown: '好块' }), block({ markdown: 7 })])
		expect(r.ok).toBe(false)
		expect(r.blocks).toHaveLength(0)
	})

	test('错误明细带 下标/字段/实际值，formatIssues 可读', () => {
		const r = validateBlocks([block({ markdown: 'ok' }), block({ markdown: 7 })])
		if (r.ok) throw new Error('不应通过')
		const issue = r.issues[0]!
		expect(issue.index).toBe(1)
		expect(issue.field).toBe('markdown')
		expect(issue.actual).toBe('7')
		expect(formatIssues(r.issues)).toContain('blocks[1].markdown')
	})
})

describe('validateDiag：抽取侧账本的结构契约（字段漂移会红）', () => {
	test('合法 diag：extractor + chars 必填，其余可选', () => {
		const r = validateDiag({ extractor: 'pymupdf4llm+vl', chars: 1234 })
		if (!r.ok) throw new Error(formatIssues(r.issues))
		expect(r.diag.extractor).toBe('pymupdf4llm+vl')
		expect(r.diag.chars).toBe(1234)
	})

	test('全字段合法（页/图/表三组账 + notes）', () => {
		const r = validateDiag({
			extractor: 'markitdown', chars: 10,
			pages_total: 3, pages_via_vl: 1, pages_vl_failed: 0, pages_skipped_by_cap: 2, pages_empty: 1,
			images_total: 4, images_captioned: 3, captions_truncated: 1, captions_failed: 0, images_over_cap: 2,
			sheets_total: 2, sheets_rejected: 1, sheets_truncated: 0,
			notes: ['文本按 gb18030 解码（非 UTF-8）'],
		})
		expect(r.ok).toBe(true)
	})

	test('缺 extractor / chars → 失败（账本不许是空的）', () => {
		expect(validateDiag({ chars: 1 }).ok).toBe(false)
		expect(validateDiag({ extractor: 'text' }).ok).toBe(false)
		expect(validateDiag({ extractor: '  ', chars: 1 }).ok).toBe(false)
	})

	test('计数非法（非整数 / 负数 / 字符串）→ 失败', () => {
		for (const bad of [{ extractor: 'text', chars: -1 }, { extractor: 'text', chars: 1.5 },
			{ extractor: 'text', chars: '1' }, { extractor: 'text', chars: 0, pages_total: -3 }]) {
			expect(validateDiag(bad).ok).toBe(false)
		}
	})

	test('未登记字段 → 失败（先改 schema 与 profile.ts 的 ParseDiag，防账本字段悄悄漂移）', () => {
		const r = validateDiag({ extractor: 'text', chars: 1, pages_via_ocr: 2 })
		expect(r.ok).toBe(false)
		if (r.ok) throw new Error('不应通过')
		expect(r.issues[0]!.field).toBe('diag.pages_via_ocr')
		expect(r.issues[0]!.message).toContain('未登记')
	})

	test('notes 必须是字符串数组', () => {
		expect(validateDiag({ extractor: 'text', chars: 1, notes: 'x' }).ok).toBe(false)
		expect(validateDiag({ extractor: 'text', chars: 1, notes: [1] }).ok).toBe(false)
		expect(validateDiag({ extractor: 'text', chars: 1, notes: [] }).ok).toBe(true)
	})

	test('payload 里 diag 可缺省（老 py 兼容），但吐了就必须合法', () => {
		const ok = validatePyPayload({ blocks: [{ type: 'text', markdown: 'x' }] })
		if (!ok.ok) throw new Error(formatIssues(ok.issues))
		expect(ok.payload.diag).toBeUndefined()

		const withDiag = validatePyPayload({
			blocks: [{ type: 'text', markdown: 'x' }],
			diag: { extractor: 'text', chars: 1, notes: ['后缀 .dat 未登记，内容像文本 → 按文本族收'] },
		})
		if (!withDiag.ok) throw new Error(formatIssues(withDiag.issues))
		expect(withDiag.payload.diag?.notes?.[0]).toContain('内容像文本')

		const bad = validatePyPayload({ blocks: [], diag: { extractor: 'text', chars: 1, extra: true } })
		expect(bad.ok).toBe(false)
	})
})

describe('pythonCandidates：解释器候选（"依赖装了但 python 指到别的解释器"的根治）', () => {
	test('PYTHON_BIN 显式指定 → 只认它（静默换解释器比报错危险）', () => {
		const c = pythonCandidates({ PYTHON_BIN: 'C:\\Python314\\python.exe' } as unknown as NodeJS.ProcessEnv)
		expect(c).toEqual(['C:\\Python314\\python.exe'])
	})

	test('未指定 → 候选含 python3 与 python（Windows 上还含 py 启动器）', () => {
		const c = pythonCandidates({} as unknown as NodeJS.ProcessEnv)
		expect(c).toContain('python3')
		expect(c).toContain('python')
		if (process.platform === 'win32') expect(c[0]).toBe('py')
		expect(new Set(c).size).toBe(c.length) // 不许重复候选（重复=白跑一遍）
	})

	test('空白 PYTHON_BIN 视同未设置', () => {
		const c = pythonCandidates({ PYTHON_BIN: '   ' } as unknown as NodeJS.ProcessEnv)
		expect(c.length).toBeGreaterThan(1)
	})
})

describe('扩展名口径 formats.ts（上传/批量/probe/py 四处唯一来源）', () => {
	// 9/16 扩族：旧断言（"不含 png/pptx/html"）编码的是"有意不纳"的旧决定，已被推翻——
	// 推翻理由：不知道会收到什么文档，收不了也必须给明确理由，不能靠"后缀不在 6 种里"门口拒掉。
	test('能解析的四族都在 ALLOWED_EXT 里（含图片/html/pptx/odf/rtf）', () => {
		for (const e of ['pdf', 'docx', 'xlsx', 'pptx', 'html', 'htm', 'xhtml', 'odt', 'ods', 'odp', 'rtf',
			'txt', 'md', 'csv', 'tsv', 'json', 'yaml', 'xml', 'log', 'png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'tif', 'tiff'])
			expect([e, ALLOWED_EXT.has(e)]).toEqual([e, true])
	})

	test('"认识但吃不下"的不在 ALLOWED_EXT（走转存理由，不走解析）', () => {
		for (const e of ['doc', 'xls', 'ppt', 'wps', 'pages', 'heic', 'zip', '7z', 'rar', 'epub'])
			expect([e, ALLOWED_EXT.has(e)]).toEqual([e, false])
	})

	test('TEXT_FAMILY_EXT = 文本族（probe 无魔数时的后缀判据）', () => {
		expect([...TEXT_FAMILY_EXT].sort()).toEqual([
			'cfg', 'conf', 'csv', 'ini', 'json', 'jsonl', 'log', 'markdown', 'md', 'ndjson',
			'properties', 'rst', 'tex', 'toml', 'tsv', 'txt', 'xml', 'yaml', 'yml',
		])
		// 文本族不许混进 html/odf/rtf —— 它们各有自己的判定路（魔数/zip 结构），混进来只会互相抢
		for (const e of ['html', 'htm', 'odt', 'rtf', 'pptx']) expect(TEXT_FAMILY_EXT.has(e)).toBe(false)
	})

	test('PY_PARSER_EXT === ALLOWED_EXT（py 是主力，每个能收的族 py 侧都要有实现或兜底）', () => {
		expect([...PY_PARSER_EXT].sort()).toEqual([...ALLOWED_EXT].sort())
	})

	test('extOf / familyOfExt：后缀解析与声明家族的单一入口', () => {
		expect(extOf('a/b/c.PDF')).toBe('pdf')
		expect(extOf('samples/硫酸-sop.txt')).toBe('txt')
		expect(extOf('a/.gitignore')).toBe('')     // 只有点开头 = 无扩展名，不是"扩展名是 gitignore"
		expect(extOf('noext')).toBe('')
		expect(familyOfExt('docx')).toBe('docx')
		expect(familyOfExt('webp')).toBe('image')
		expect(familyOfExt('xyz')).toBeUndefined()
	})

	test('unsupportedReason：能解析的给白名单，吃不下给转存理由（都带扩展名）', () => {
		expect(unsupportedReason('xyz')).toContain('.xyz')
		expect(unsupportedReason('xyz')).toContain('可解析')
		expect(unsupportedReason('doc')).toContain('.doc')
		expect(unsupportedReason('doc')).toContain('另存为')   // OLE 老格式：先转存，别指望引擎
		expect(unsupportedReason('heic')).toContain('转存')
		expect(unsupportedReason('zip')).toContain('解包')
		expect(unsupportedReason('')).toContain('无扩展名')
	})

	test('junk 档：临时件/备份件与"不支持"分账（目录扫描跳过它们，但不说它们不支持）', () => {
		for (const e of ['tmp', 'bak', 'crdownload', 'part', 'swp']) expect([e, isJunkExt(e)]).toEqual([e, true])
		for (const e of ['pdf', 'md', 'doc']) expect([e, isJunkExt(e)]).toEqual([e, false])
		expect(JUNK_EXT.has('doc')).toBe(false) // doc 是"能救的"，不是垃圾
	})
})

describe('跨语言一致性：pytools/parse.py 的 PARSERS 必须与 TS 口径一致', () => {
	test('PARSERS 的 key 集合 == PY_PARSER_EXT（改了任一侧都会红）', async () => {
		const src = await Bun.file(fileURLToPath(new URL('../../../pytools/parse.py', import.meta.url))).text()
		const m = src.match(/PARSERS\s*=\s*\{([\s\S]*?)\n\}/)
		expect(m).not.toBeNull()
		const body = m?.[1] ?? ''
		const keys = new Set([...body.matchAll(/"(\.[A-Za-z0-9]+)"/g)].map(x => x[1]!.slice(1).toLowerCase()))
		expect(keys.size).toBeGreaterThan(0) // 正则失效时别假绿
		expect([...keys].sort()).toEqual([...PY_PARSER_EXT].sort())
		// 扩展族后新增的反向断言：**转存档与垃圾档不许出现在 py 侧**（否则"门口拒"与"py 兜底"两套口径会打架）
		for (const e of ['doc', 'xls', 'ppt', 'wps', 'pages', 'heic', 'zip', '7z', 'rar', 'epub', 'bak', 'tmp'])
			expect([e, keys.has(e)]).toEqual([e, false])
	})

	test('py 侧契约含 diag（降级事实的载体，TS 侧 validateDiag 会逐字段校验）', async () => {
		const src = await Bun.file(fileURLToPath(new URL('../../../pytools/parse.py', import.meta.url))).text()
		expect(src).toContain('"diag": DIAG')
		// 未登记字段会红：diag 的字段名表只能有一份（TS 侧 DIAG_INT_FIELDS），py 侧不许自创
		for (const k of ['pages_skipped_by_cap', 'images_over_cap', 'sheets_rejected', 'captions_truncated'])
			expect([k, src.includes(`"${k}"`)]).toEqual([k, true])
	})
})
