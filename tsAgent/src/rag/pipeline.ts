// ⑨ 总装线：probe(前门) → runStrategy(抽取) → bySection(切块) → gate(后门) → store(入库) + 台账
// 铁律：单文件失败只标记自己、绝不中断整批（旁路化降级）；每步产出都进台账，可观测不控制
import { probe } from './inspect/probe'
import { runStrategy, NeedsUpgrade } from './parse/route'
import { DocReject } from './parse/fromPy'
import { bySection } from './chunk/bySection'
import { gate } from './gate/quality'
import { upsertChunks, logIngest } from './store/upsert'
import type { DocProfile } from './inspect/profile'

export interface IngestResult {
	file: string
	profile?: DocProfile
	status: 'done' | 'review' | 'quarantined' | 'failed'
	chunks: number
	flags: string[]
}
export interface IngestOptions { dryRun?: boolean }

const baseName = (file: string) => file.replace(/^.*[\\/]/, '').replace(/\.[^.]+$/, '') // 与 bySection 的 docId 同口径

export async function ingestFile(file: string, opts: IngestOptions = {}): Promise<IngestResult> {
	const t0 = performance.now() // 单档全链耗时进台账，供"每文档解析耗时"计时表用
	const result: IngestResult = { file, status: 'failed', chunks: 0, flags: [] }
	// ⚠️ 必须 await：ingest CLI 打印完就 process.exit(0)，fire-and-forget 的台账写库赶不上死亡
	const finish = async () => {
		await logIngest({ docId: baseName(file), file, status: result.status, chunks: result.chunks, flags: result.flags, costMs: Math.round(performance.now() - t0) })
		return result
	}
	try {
		// 前门：档案。判死（L2）的连抽都不抽
		const profile = await probe(file)
		result.profile = profile
		if (profile.strategy === 'L2-review') {
			result.status = 'review'
			result.flags.push(`[前门] ${profile.reason}`)
			return finish()
		}

		// 抽取：本期未实现的路（L1-VL/双栏）→ NeedsUpgrade → 隔离（不是失败，是排队等能力）
		let blocks
		try {
			blocks = await runStrategy(profile)
		} catch (e) {
			if (e instanceof DocReject) {
				// py 判定"不该进向量库"（如台账型 xlsx）：转人审，理由进台账
				result.status = 'review'
				result.flags.push(`[拒收] ${e.message}`)
				return finish()
			}
			if (e instanceof NeedsUpgrade) {
				result.status = 'quarantined'
				result.flags.push(`[隔离] ${e.message}`)
				return finish()
			}
			throw e
		}

		// 切块 + 后门质检
		const chunks = bySection(file, blocks)
		const verdict = gate(profile, blocks)
		result.flags.push(...verdict.flags)
		if (!verdict.pass) {
			// 红灯=人审；黄灯本应升 L1 重抽——L1 未接，先按隔离存放（升级路径：接 fromPy 后黄灯自动变重跑）
			result.status = verdict.escalate === 'L2' ? 'review' : 'quarantined'
			return finish()
		}

		// 入库（dry-run 只出档案与判分到为止）
		if (!opts.dryRun) await upsertChunks(profile, chunks)
		result.status = 'done'
		result.chunks = chunks.length
		if (opts.dryRun) result.flags.push('[info] dry-run 未入库')
		return finish()
	} catch (e) {
		result.status = 'failed'
		result.flags.push(`[failed] ${(e as Error).message.slice(0, 200)}`)
		return finish()
	}
}

/** 批量：顺序跑但互不牵连（并发留给真上量时，台账按文件各自记账） */
export async function ingestDir(dir: string, opts: IngestOptions = {}): Promise<IngestResult[]> {
	const files: string[] = []
	for await (const f of new Bun.Glob('**/*.{pdf,docx,xlsx}').scan({ cwd: dir, absolute: true })) files.push(f)
	files.sort()
	const results: IngestResult[] = []
	for (const f of files) results.push(await ingestFile(f, opts))
	return results
}
