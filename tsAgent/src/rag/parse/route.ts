// ⑥ 档案 → 执行方案的分发器：纯 switch，无 LLM、无即兴判断
// 主力 = L0-py（spawn pytools：pymupdf4llm/markitdown/openpyxl + 标准库兜底）；py 挂了落回手写 L0（容灾不中断）
// NeedsUpgrade = "档案判得对但这期没这能力"（L0-column-sort 双栏重排等）→ pipeline 转隔离不转失败
// 9/16：返回值从 Block[] 升成 ParsedDoc{blocks, diag} —— diag 是抽取侧的降级账本，必须沿管道传到 gate 与台账
import type { Block, DocProfile, ParseDiag } from '../inspect/profile'
import { fromDocx } from './fromDocx'
import { fromPdf } from './fromPdf'
import { fromPy, DocReject, DocParseFailed, type ParsedDoc } from './fromPy'
import { plainTextOf } from '../gate/quality' // chars 口径与 gate 的分子同源，别各算一份

export type { ParsedDoc }

export class NeedsUpgrade extends Error {}

/** 手写 fallback 也产同形状 diag：没有 diag 的下游等于"降级了没人知道"，与 py 侧同罪 */
const diagOf = (extractor: string, blocks: Block[]): ParseDiag => ({ extractor, chars: plainTextOf(blocks).length })

/** py 主力路（含 cell-join 的 py 形态）；失败落回手写 */
async function pyFirst(profile: DocProfile): Promise<ParsedDoc> {
	try {
		return await fromPy(profile.file)
	} catch (e) {
		if (e instanceof DocReject) throw e // "不该进库"不是故障，直接上抛
		// 契约结构非法：py 吐了 JSON 但块形状不对。落回手写只会把契约 bug 掩盖成"解析成功"，
		// 必须上抛 → pipeline catch 落 status='failed' 写台账（重摄前先修 py/契约）
		if (e instanceof DocParseFailed && e.contract) throw e
		console.warn(`[route] pytools 解析失败，落回手写版:`, (e as Error).message)
		if (profile.family === 'docx') {
			const blocks = await fromDocx(profile.file, profile.strategy === 'L0-cell-join' ? 'cell-join' : 'direct')
			return { blocks, diag: diagOf('mammoth', blocks) }
		}
		if (profile.family === 'pdf') {
			const blocks = await fromPdf(profile.file)
			return { blocks, diag: diagOf('pdfjs', blocks) }
		}
		throw new NeedsUpgrade(`手写 fallback 未覆盖 ${profile.family}：请修好 pytools 环境（pip install -r pytools/requirements.txt）或用 PYTHON_BIN 指定解释器`)
	}
}

export async function runStrategy(profile: DocProfile): Promise<ParsedDoc> {
	switch (profile.strategy) {
		case 'L0-py':
		case 'L0-cell-join':
			return pyFirst(profile)
		case 'L0-direct': // 手写直抽（probe 本期不再产出该值，留作显式选项）
			if (profile.family === 'docx') {
				const blocks = await fromDocx(profile.file, 'direct')
				return { blocks, diag: diagOf('mammoth', blocks) }
			}
			if (profile.family === 'pdf') {
				const blocks = await fromPdf(profile.file)
				return { blocks, diag: diagOf('pdfjs', blocks) }
			}
			throw new NeedsUpgrade(`L0-direct 未支持的文件族: ${profile.family}`)
		case 'L0-column-sort':
			throw new NeedsUpgrade('双栏重排下期实装（pymupdf4llm 的阅读顺序已顺带解决大半）')
		case 'L1-py-vl':
			// VL 桥已通（pytools 内逐页升 qwen-vl-ocr / 整图解析）；py 挂了才落回手写/隔离
			return pyFirst(profile)
		case 'L2-review':
			return { blocks: [] } // 前门已定人审，pipeline 不会调到这；防御性留空
	}
}
