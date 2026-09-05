// 摄取 CLI：bun run ingest -- samples/xxx.pdf
//              bun run ingest -- samples/              （目录=批量，按后缀过滤）
// 旁路开关：--dry-run 只出 档案+判分 不入库（M1 验收就跑这个）
import { statSync } from 'node:fs'
import { ingestDir, ingestFile } from '../src/rag/pipeline'

const flags = process.argv.slice(2).filter(a => a.startsWith('--'))
const target = process.argv.slice(2).find(a => !a.startsWith('--'))
const dryRun = flags.includes('--dry-run')

if (!target) {
	console.error('usage: bun run ingest -- <file|dir> [--dry-run]')
	process.exit(1)
}

const results = statSync(target).isDirectory()
	? await ingestDir(target, { dryRun })
	: [await ingestFile(target, { dryRun })]

for (const r of results) {
	console.log(`${r.status.padEnd(12)} ${r.file.replace(/^.*[\\/]/, '')}  chunks=${r.chunks}`)
	for (const f of r.flags) console.log(`    ${f}`)
}
const tally = results.reduce<Record<string, number>>((m, r) => ((m[r.status] = (m[r.status] ?? 0) + 1), m), {})
console.log(`\n共 ${results.length} 份:`, Object.entries(tally).map(([k, v]) => `${k}=${v}`).join('  '))

// 硬退：mysql 连接池/logIngest 悬挂会吊住事件循环让进程死不掉（今日实测血泪）
process.exit(0)
