// 上传摄取 API：知识库页的进食口（页面只给人工上传/拖拽入口，爬虫不进 UI）
// 契约：upload 立即返回 202+docId，真正解析进进程内串行队列（pipeline 注释定死"并发留给真上量时"）；
//       结果以 ingest_log 台账为唯一真相（进程重启不丢账，重摄幂等覆盖），前端轮询 /list 看状态翻转
import { join, basename } from 'node:path'
import { existsSync, mkdirSync } from 'node:fs'
import { writeFile, rm } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { Hono } from 'hono'
import { pool } from '../../db/mysql'
import { ingestFile } from '../../rag/pipeline'
import { deleteDoc } from '../../rag/store/upsert'

const ROOT = fileURLToPath(new URL('../../../', import.meta.url)) // tsAgent/（本文件在 src/service/routes，爬三层；9/6 冒烟炸出"少爬一层"同款坑）
export const CORPUS = join(ROOT, 'corpus') // webSearch 确认件也落这（routes/webSearch.ts 共用）
mkdirSync(CORPUS, { recursive: true })

// 白名单与 probe 实况对齐（code-over-slip：html/pptx 探测层还没接，别放进门）
const ALLOW_EXT = new Set(['pdf', 'docx', 'xlsx', 'txt', 'md', 'csv'])
const MAX_SIZE = 50 * 1024 * 1024 // 单文件 50MB 顶（SDS 文档几百 KB 到几 MB，留足扫描余量）

/** 落盘名清洗：去路径、干掉文件系统非法字符；同名覆盖 = "重新上传即更新"语义（doc_id 相同，摄取幂等重建） */
function safeName(raw: string): string {
	const name = basename(raw.replace(/\\/g, '/'))
		.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')
		.replace(/^\.+/, '')
		.slice(0, 100)
	return name || 'unnamed'
}
const docIdOf = (file: string) => file.replace(/\.[^.]+$/, '')

// ---------- 进程内串行队列 ----------
const queue: string[] = []
let pumping = false
async function pump(): Promise<void> {
	if (pumping) return
	pumping = true
	while (queue.length) {
		const f = queue.shift()!
		try {
			await ingestFile(f) // pipeline 自己兜状态 + 写台账，这里只保队列不断
		} catch (e) {
			console.error('[ingest] 队列异常（台账会兜 failed）:', f, (e as Error).message)
		}
	}
	pumping = false
}

/** 预写 queued：表在就记排队，MySQL 没起也不挡摄取（与 logIngest 同款旁路化） */
async function markQueued(docId: string, file: string): Promise<void> {
	try {
		await pool.query(
			`INSERT INTO ingest_log (doc_id, file, status, chunks, flags) VALUES (?, ?, 'queued', 0, '')
			 ON DUPLICATE KEY UPDATE status='queued', chunks=0, flags=''`,
			[docId, file],
		)
	} catch (e) {
		console.warn('[ingest] queued 预写跳过:', (e as Error).message.slice(0, 80))
	}
}

export const ingestRoutes = new Hono()

// 上传：multipart（字段名不限，所有 File 条目都收）→ 落盘 corpus/ → 预写台账 → 入队
ingestRoutes.post('/upload', async (c) => {
	const form = await c.req.formData()
	// Bun 的 FormData 值类型标注是 string|File 联合体但过滤谓词不认，整体过 unknown 再收窄
	const files = [...(form.values() as unknown as Iterable<unknown>)].filter((v): v is File => v instanceof File)
	if (!files.length) return c.json({ error: '未收到文件（multipart File 字段）' }, 400)

	const accepted: { docId: string; file: string }[] = []
	const rejected: { name: string; reason: string }[] = []
	for (const f of files) {
		const name = safeName(f.name)
		const ext = name.split('.').pop()?.toLowerCase() ?? ''
		if (!ALLOW_EXT.has(ext)) {
			rejected.push({ name: f.name, reason: `不支持的格式 .${ext}（白名单: ${[...ALLOW_EXT].join('/')}）` })
			continue
		}
		if (f.size > MAX_SIZE) {
			rejected.push({ name: f.name, reason: `超过 50MB 上限（${(f.size / 1048576).toFixed(1)}MB）` })
			continue
		}
		const dest = join(CORPUS, name)
		await writeFile(dest, Buffer.from(await f.arrayBuffer()))
		await markQueued(docIdOf(name), dest)
		queue.push(dest)
		accepted.push({ docId: docIdOf(name), file: name }) // doc_id 口径 = 纯文件名去后缀（pipeline baseName 同款）
	}
	void pump()
	return c.json({ accepted, rejected }, 202)
})

// 台账列表：分页 + 状态/关键字过滤（前端 3s 轮询的就是它，SQL 保持轻）
ingestRoutes.get('/list', async (c) => {
	const page = Math.max(Number(c.req.query('page')) || 1, 1)
	const pageSize = Math.min(Math.max(Number(c.req.query('pageSize')) || 10, 1), 100)
	const status = c.req.query('status') || ''
	const keyword = c.req.query('keyword') || ''

	const where: string[] = []
	const params: unknown[] = []
	if (status) { where.push('status=?'); params.push(status) }
	if (keyword) { where.push('(doc_id LIKE ? OR file LIKE ?)'); params.push(`%${keyword}%`, `%${keyword}%`) }
	const whereSql = where.length ? ` WHERE ${where.join(' AND ')}` : ''

	const countRes = (await pool.query(`SELECT COUNT(*) n FROM ingest_log${whereSql}`, params)) as [{ n: number }[], unknown]
	const listRes = (await pool.query(
		`SELECT doc_id, file, status, chunks, cost_ms, flags, updated_at FROM ingest_log${whereSql}
		 ORDER BY updated_at DESC LIMIT ? OFFSET ?`,
		[...params, pageSize, (page - 1) * pageSize],
	)) as [Record<string, unknown>[], unknown]
	const records = listRes[0].map((r) => ({ ...r, file: String(r.file ?? '').replace(/^.*[\\/]/, '') }))
	return c.json({ records, total: countRes[0][0]?.n ?? 0 })
})

// 重摄：按台账里的原盘路径重跑 pipeline（文件被删则请用户重新上传）
ingestRoutes.post('/:docId/reingest', async (c) => {
	const docId = c.req.param('docId')
	const [rows] = (await pool.query('SELECT file FROM ingest_log WHERE doc_id=?', [docId])) as [{ file: string }[], unknown]
	const row = rows[0]
	if (!row) return c.json({ error: `台账无此文档: ${docId}` }, 404)
	const file = row.file
	if (!existsSync(file)) return c.json({ error: '盘上原文件已不存在，请重新上传' }, 410)
	await markQueued(docId, file)
	queue.push(file)
	void pump()
	return c.json({ ok: true }, 202)
})

// 删除：三删——向量库按 doc_id、台账行、盘上文件（Qdrant 失败不挡台账/文件清理，返回里如实报）
ingestRoutes.delete('/:docId', async (c) => {
	const docId = c.req.param('docId')
	const [rows] = (await pool.query('SELECT file FROM ingest_log WHERE doc_id=?', [docId])) as [{ file: string }[], unknown]
	const problems: string[] = []
	try {
		await deleteDoc(docId)
	} catch (e) {
		problems.push(`向量库删除失败: ${(e as Error).message.slice(0, 100)}`)
	}
	await pool.query('DELETE FROM ingest_log WHERE doc_id=?', [docId])
	if (rows[0]) await rm(rows[0].file, { force: true }).catch((e) => problems.push(`盘上文件删除失败: ${e.message}`))
	return c.json({ ok: true, problems })
})
