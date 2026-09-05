// ⑥ 档案 → 执行方案的分发器：纯 switch，无 LLM、无即兴判断
// 主力 = L0-py（spawn pytools：pymupdf4llm/markitdown/openpyxl）；py 挂了落回手写 L0（容灾不中断）
// NeedsUpgrade = "档案判得对但这期没这能力"（L1-VL/双栏重排）→ pipeline 转隔离不转失败
import type { Block, DocProfile } from '../inspect/profile'
import { fromDocx } from './fromDocx'
import { fromPdf } from './fromPdf'
import { fromPy, DocReject } from './fromPy'

export class NeedsUpgrade extends Error {}

/** py 主力路（含 cell-join 的 py 形态）；失败落回手写 */
async function pyFirst(profile: DocProfile): Promise<Block[]> {
	try {
		return await fromPy(profile.file)
	} catch (e) {
		if (e instanceof DocReject) throw e // "不该进库"不是故障，直接上抛
		console.warn(`[route] pytools 解析失败，落回手写版:`, (e as Error).message)
		if (profile.family === 'docx') return fromDocx(profile.file, profile.strategy === 'L0-cell-join' ? 'cell-join' : 'direct')
		if (profile.family === 'pdf') return fromPdf(profile.file)
		throw new NeedsUpgrade(`手写 fallback 未覆盖 ${profile.family}：请先 pip install -r pytools/requirements.txt`)
	}
}

export async function runStrategy(profile: DocProfile): Promise<Block[]> {
	switch (profile.strategy) {
		case 'L0-py':
		case 'L0-cell-join':
			return pyFirst(profile)
		case 'L0-direct': // 手写直抽（probe 本期不再产出该值，留作显式选项）
			if (profile.family === 'docx') return fromDocx(profile.file, 'direct')
			if (profile.family === 'pdf') return fromPdf(profile.file)
			throw new NeedsUpgrade(`L0-direct 未支持的文件族: ${profile.family}`)
		case 'L0-column-sort':
			throw new NeedsUpgrade('双栏重排下期实装（pymupdf4llm 的阅读顺序已顺带解决大半）')
		case 'L1-py-vl':
			// VL 桥已通（pytools 内逐页升 qwen-vl-ocr）；py 挂了才落回手写/隔离
			return pyFirst(profile)
		case 'L2-review':
			return [] // 前门已定人审，pipeline 不会调到这；防御性留空
	}
}
