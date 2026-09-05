// py 能力扩展桥：spawn python pytools/parse.py → stdout 契约 JSON → Block[]
// 失败姿势（全在 route.ts 消费）：
//   DocReject      = py 判定"这文件不该进向量库"（台账 xlsx/不支持格式）→ pipeline 转人审
//   DocParseFailed = 环境/解析炸了（没装依赖、python 不在 PATH…）→ route 落回手写解析器（容灾）
import { spawn } from 'bun'
import { fileURLToPath } from 'node:url'
import type { Block } from '../inspect/profile'

export class DocReject extends Error {}
export class DocParseFailed extends Error {}

const ROOT = new URL('../../../', import.meta.url) // src/rag/parse → 上三层 = tsAgent 根
const TIMEOUT_MS = 5 * 60_000 // 与 CrewForge 工位同款 300s：PDF 批量推理给足余量

export async function fromPy(file: string): Promise<Block[]> {
	// 图转文的落盘位：resources/<docId>/media —— 与 pipeline 台账的 docId 同口径（文件名去扩展名）
	const docKey = file.replace(/^.*[\\/]/, '').replace(/\.[^.]+$/, '')
	const mediaDir = fileURLToPath(new URL(`resources/${docKey}/media`, ROOT))
	const proc = spawn({
		cmd: [process.env.PYTHON_BIN ?? 'python', fileURLToPath(new URL('pytools/parse.py', ROOT)), '--in', file, '--media-dir', mediaDir],
		stdout: 'pipe',
		stderr: 'pipe',
	})
	// 超时兜底：kill 后 exited 自然落地
	const timer = setTimeout(() => { try { proc.kill() } catch { /* 已退出 */ } }, TIMEOUT_MS)
	let stdout: string
	let stderr: string
	try {
		;[stdout, stderr] = await Promise.all([
			new Response(proc.stdout).text(),
			new Response(proc.stderr).text(),
		])
		await proc.exited
	} finally {
		clearTimeout(timer)
	}

	if (stderr.trim()) for (const line of stderr.trim().split('\n')) console.log(`  [py] ${line}`)

	// 契约：stdout 最后一行 JSON；非零退出且没契约 → 环境级失败
	const lastLine = stdout.trim().split('\n').pop() ?? ''
	let payload: { blocks?: Block[]; reject?: string | null }
	try {
		payload = JSON.parse(lastLine)
	} catch {
		throw new DocParseFailed(`parse.py 无契约输出（exit=${proc.exitCode}），检查 python/pytools 依赖`)
	}
	if (payload.reject) throw new DocReject(payload.reject)
	if (proc.exitCode !== 0 && !(payload.blocks?.length ?? 0)) {
		throw new DocParseFailed(`parse.py exit=${proc.exitCode} 且无块产出`)
	}
	return payload.blocks ?? []
}
