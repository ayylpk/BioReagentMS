// 文档身份（doc_id）的唯一定义处 —— ingest / webSearch / bySection / pipeline / reingest 五处共用，谁都不许再自己拼
// 旧口径的病：doc_id = 纯文件名去后缀 → corpus/a/x.md 与 corpus/b/x.md 撞成同一个 id，
//            而入库是按 doc_id 删旧插新 → 后摄的把先摄的删了（同名文件互相覆盖，且不报错）
// 新口径（确定性 + 跨平台 + URL/FS/MySQL 三安全）：
//   ① 文件在 corpus/ 下  → 相对 corpus 根的路径（corpus/chemistry/硫酸.pdf → chemistry__硫酸）
//   ② 否则在 tsAgent/ 下 → 相对工程根的路径（samples/硫酸-sop.txt → samples__硫酸-sop）
//   ③ 否则（工程外临时路径/跨盘）→ 文件名 + "__" + 绝对路径哈希（同名不同盘不撞）
//   路径分隔符统一折成 "__"：Hono :docId path param、Windows 文件名、MySQL 列都安全
//   超长（>120 字符）→ 截 111 + "__" + 8 位哈希
// 迁移兼容：corpus 根下的既有文档 doc_id 与旧口径逐字相同（仍是文件名去后缀），无需重摄；
//          只有原本会互相覆盖的同名场景才拿到新 id（那批本来就没法共存）
import { basename, isAbsolute, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/** tsAgent 工程根（本文件在 src/rag/inspect/ → 上三层） */
export const ROOT = resolve(fileURLToPath(new URL('../../../', import.meta.url)))
/** 语料落盘根：上传 API 与爬虫确认件都写这里（routes/ingest.ts 从这里 re-export，勿再各写一份） */
export const CORPUS = resolve(ROOT, 'corpus')

const MAX_DOC_ID = 120

/** FNV-1a 32 位 → 8 位十六进制。只当消歧后缀用，不做安全用途 */
function fnv8(s: string): string {
	let h = 0x811c9dc5
	for (let i = 0; i < s.length; i++) {
		h ^= s.charCodeAt(i)
		h = Math.imul(h, 0x01000193)
	}
	return (h >>> 0).toString(16).padStart(8, '0')
}

/** 取相对路径：corpus 根优先（保住既有 id），其次工程根，都不沾则退化为 名字__哈希 */
function relPath(abs: string): string {
	for (const root of [CORPUS, ROOT]) {
		const r = relative(root, abs)
		if (r && !r.startsWith('..') && !isAbsolute(r)) return r
	}
	return `${basename(abs).replace(/\.[^.]+$/, '')}__${fnv8(abs)}`
}

/**
 * 文档唯一标识：全工程 doc_id 的唯一来源。
 * 幂等保证：同一路径任何时候算出同一个 id；不同目录同名文件算出不同 id。
 */
export function docIdOf(file: string): string {
	const abs = resolve(file)
	const flat = relPath(abs)
		.replace(/\.[^./\\]+$/, '')            // 去扩展名（只去最后一段）
		.split(/[\\/]+/)
		.filter(Boolean)
		.join('__')                            // 目录层级折进 id，避免同名覆盖
		.replace(/[<>:"|?*\x00-\x1f]/g, '_')
		.replace(/^\.+/, '')
	const id = flat || basename(abs).replace(/\.[^.]+$/, '') || 'unnamed'
	return id.length > MAX_DOC_ID ? `${id.slice(0, MAX_DOC_ID - 9)}__${fnv8(abs)}` : id
}

/** doc_id → 文件系统安全的目录名（当前规则已天然安全；留着当口径变更的兜底闸门） */
export function docDirName(docId: string): string {
	return docId.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_') || 'unnamed'
}
