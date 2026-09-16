// 扩展名口径的单一事实源 —— 上传白名单(ingest) / 批量 glob(pipeline) / 前门文本族(probe)
// / pytools/parse.py 的 PARSERS 四处必须同一口径，谁都不许再各写一份正则或 Set。
//
// 为什么非并不可：改之前四处各说各话 —— ingestDir 的 glob 只有 pdf/docx/xlsx（1710 份 md 语料全被漏掉）、
// probe 认 txt/md/csv、上传认 6 种、py 认 12 种，同一个文件在四个环节拿到四种"支持与否"的答案。
//
// 9/16 扩族（解析泛化第一刀）：口径从"只收前门能推导策略的 6 种"改成"前门能给出**明确定论**的都收"。
//   新增 pdf/docx/xlsx 之外的 html / pptx / odf(odt,ods,odp) / rtf / 图片全族 / 文本扩展族，
//   理由是"不知道会收到什么文档"：收不了没关系，但必须给出**明确理由**，不许静默跳过或落黑洞。
//   分三档（口径即契约，加扩展名先想清楚落哪档）：
//     ① FAMILY_EXT       —— 能解析进库的（家族 → 扩展名）
//     ② CONVERT_REQUIRED —— 认识但本引擎吃不下，必须转存（给一句人话理由，禁止静默）
//     ③ JUNK_EXT         —— 目录扫描时直接跳过的临时/垃圾件（不是"不支持"，是"不该扫"）
//   ②③ 是"明确拒绝"，不是"未支持"：既往 unknown → L2-review 的写法在 review 无消费者时等于黑洞。
import type { DocFamily } from '../inspect/profile'

/** family → 该族允许的扩展名（不含点，全小写）。DocFamily(profile.ts) 里出现过的都在这登记。 */
export const FAMILY_EXT = {
	/** 数字版/扫描版 PDF（pymupdf4llm，稀页自动升 VL） */
	pdf: ['pdf'],
	/** Word（markitdown 主力 / mammoth 手写兜底） */
	docx: ['docx'],
	/** Excel（openpyxl，台账型 sheet 拒收） */
	xlsx: ['xlsx'],
	/** PowerPoint（markitdown / 手写 pptx XML 直抽） */
	pptx: ['pptx'],
	/** HTML/XHTML（markitdown / 手写 html.parser 直抽）—— 网页另存的 SDS、规章最常见 */
	html: ['html', 'htm', 'xhtml'],
	/** OpenDocument（zip + content.xml 直抽，LibreOffice 系） */
	odf: ['odt', 'ods', 'odp'],
	/** RTF（控制字剥离，纯文本族的上位） */
	rtf: ['rtf'],
	/** 纯文本族：无魔数，靠后缀判定 → 直读（md 顺带块化） */
	text: [
		'txt', 'md', 'markdown', 'csv', 'tsv',
		'json', 'jsonl', 'ndjson', 'yaml', 'yml', 'toml', 'ini', 'cfg', 'conf', 'properties',
		'xml', 'log', 'rst', 'tex',
	],
	/** 图片（整页 VL；非 PNG/JPG 先经 pymupdf/PIL 转 PNG） */
	image: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'tif', 'tiff'],
} as const

/**
 * 认识、能识别、但**本引擎吃不下**的扩展名 → 必须转存。给一句能照着做的人话理由。
 * 注意与 JUNK_EXT 的区别：这里有价值，只是格式不对；JUNK 是压根不该被扫到。
 */
export const CONVERT_REQUIRED_EXT: ReadonlyMap<string, string> = new Map([
	['doc', '老 OLE 版 Word（.doc）：请另存为 .docx 再上传'],
	['xls', '老 OLE 版 Excel（.xls）：请另存为 .xlsx 再上传'],
	['ppt', '老 OLE 版 PowerPoint（.ppt）：请另存为 .pptx 再上传'],
	['wps', 'WPS 专有格式：请导出为 .docx/.xlsx/.pptx'],
	['et', 'WPS 表格专有格式：请导出为 .xlsx'],
	['dps', 'WPS 演示专有格式：请导出为 .pptx'],
	['pages', 'iWork Pages：请导出为 .pdf 或 .docx'],
	['numbers', 'iWork Numbers：请导出为 .pdf 或 .xlsx'],
	['key', 'iWork Keynote：请导出为 .pdf 或 .pptx'],
	['heic', 'HEIC/HEIF 图片：请转存为 .jpg 或 .png'],
	['heif', 'HEIC/HEIF 图片：请转存为 .jpg 或 .png'],
	['epub', 'EPUB 电子书：请解包或转存为 .pdf/.html'],
	['mobi', 'MOBI 电子书：请转存为 .pdf/.html'],
	['msg', 'Outlook 邮件（.msg）：请导出为 .pdf/.html'],
	['djvu', 'DjVu 扫描件：请转存为 .pdf'],
	['chm', 'CHM 帮助文档：请解包或转存为 .html'],
	// 压缩包：内容可能是任意族，逐包猜不如让上层解包后按目录批量摄（batch 入口会逐文件过前门）
	['zip', '压缩包：请解包后按目录批量摄取（上传口一次只吃单个文档）'],
	['7z', '压缩包：请解包后按目录批量摄取'],
	['rar', '压缩包：请解包后按目录批量摄取'],
	['tar', '压缩包：请解包后按目录批量摄取'],
	['gz', '压缩包：请解包后按目录批量摄取'],
	['bz2', '压缩包：请解包后按目录批量摄取'],
	['xz', '压缩包：请解包后按目录批量摄取'],
])

/**
 * 目录扫描时直接跳过的后缀：临时件/半成品/编辑器备份（`.md.bak`、`.xlsx.crdownload` 之类）。
 * 这不是"不支持某格式"，是"这文件本来就不该进语料"——把两件事分开记账，排查时不会互相污染。
 */
export const JUNK_EXT: ReadonlySet<string> = new Set([
	'tmp', 'temp', 'bak', 'old', 'orig', 'rej', 'swp', 'swo', 'part', 'partial',
	'crdownload', 'download', 'filepart', 'lnk', 'url', 'webloc', 'ds_store',
])

/** 能解析进库的扩展名全集（上传口/目录扫描/白名单文案共用的唯一来源） */
export const ALLOWED_EXT: ReadonlySet<string> = new Set(Object.values(FAMILY_EXT).flat())

/** 前门 probe.ts 用：无魔数、只能凭后缀判定的文本族 */
export const TEXT_FAMILY_EXT: ReadonlySet<string> = new Set(FAMILY_EXT.text)

/**
 * python pytools/parse.py 的 PARSERS 必须覆盖的扩展名全集。
 * 扩族后 = ALLOWED_EXT 全量（py 是主力，每个家族都有 py 侧实现或明确兜底）——
 * fromPy.test.ts 用它与 parse.py 源码里的 PARSERS key 做跨语言一致性断言。
 */
export const PY_PARSER_EXT: ReadonlySet<string> = new Set(ALLOWED_EXT)

/** 取小写扩展名（不含点）；无扩展名返回 ''。全工程只此一处，别在各处 split('.') */
export function extOf(file: string): string {
	const base = file.replace(/^.*[\\/]/, '')
	const i = base.lastIndexOf('.')
	return i <= 0 ? '' : base.slice(i + 1).toLowerCase()
}

/** 扩展名 → 声明家族（FAMILY_EXT 的反查表，构造一次；probe 用它比对"后缀声明"与"内容实判"） */
const EXT_FAMILY: ReadonlyMap<string, DocFamily> = new Map(
	(Object.entries(FAMILY_EXT) as [DocFamily, readonly string[]][]).flatMap(([fam, exts]) => exts.map(e => [e, fam] as const)),
)

/** 后缀声明的家族；未登记返回 undefined（注意：undefined ≠ 不支持，可能是内容嗅探兜底的对象） */
export function familyOfExt(ext: string): DocFamily | undefined {
	return EXT_FAMILY.get(ext.toLowerCase())
}

/** 转存理由（拿不到返回 undefined）：CONVERT_REQUIRED 档的统一查询口 */
export function convertRequiredReason(ext: string): string | undefined {
	return CONVERT_REQUIRED_EXT.get(ext.toLowerCase())
}

/** 是否是目录扫描该跳过的垃圾后缀 */
export function isJunkExt(ext: string): boolean {
	return JUNK_EXT.has(ext.toLowerCase())
}

/** 上传/批量拒绝时的统一文案（含白名单与规模提示，便于用户自查） */
export function unsupportedReason(ext: string): string {
	const shown = ext ? `.${ext}` : '（无扩展名）'
	const convert = convertRequiredReason(ext)
	if (convert) return `不支持的格式 ${shown}：${convert}`
	return `不支持的格式 ${shown}（可解析: ${[...ALLOWED_EXT].sort().join('/')}）`
}
