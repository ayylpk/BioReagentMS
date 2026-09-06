// /webSearch/confirm —— 旧 py database.py 的"联网检索确认入向量库"收编（删旧 agent 后 WebSearch.vue 的续命针）
// 契约对齐 WebSearch.vue 现有调用：POST {reagent_name, cas_number, content}；小文本同步走 pipeline，直接回报切片数
// 暂存 CRUD 本来就在 Java（/api/webSearch），这里只管"确认→入库"这一下
import { Hono } from 'hono'
import { join } from 'node:path'
import { writeFile } from 'node:fs/promises'
import { ingestFile } from '../../rag/pipeline'
import { CORPUS } from './ingest'

export const webSearchRoutes = new Hono()

/** 清洗 + 长度封顶：来源是网页文本，别拿 5MB 的粘贴把 corpus 撑爆 */
function sanitize(s: string, max = 60): string {
	return (s ?? '').replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').trim().slice(0, max) || '未命名'
}

webSearchRoutes.post('/confirm', async (c) => {
	const body = (await c.req.json().catch(() => null)) as {
		reagent_name?: string
		cas_number?: string
		content?: string
	} | null
	const content = String(body?.content ?? '').trim()
	const reagentName = String(body?.reagent_name ?? '').trim()
	if (!content || !reagentName) return c.json({ error: 'reagent_name 与 content 均必填' }, 400)
	if (content.length > 100_000) return c.json({ error: '内容超长（>100K 字符），请截取有效部分' }, 400)

	// CAS 头一行：bySection 的锚和 payload.cas_number 都从正文里捞，前缀拼上它就能挂上
	const text = `# ${reagentName} SDS（联网检索确认件）\nCAS：${String(body?.cas_number ?? '').trim() || '未提供'}\n\n${content}\n`
	// doc_id 带时间戳：同一试剂多次确认 = 多份文档并存（人工比对留余地），不互相幂等覆盖
	const docName = `联网检索-${sanitize(reagentName)}-${Date.now()}.txt`
	const dest = join(CORPUS, docName)
	await writeFile(dest, text, 'utf-8')

	const result = await ingestFile(dest) // 同步：小文本秒级，成功失败当场告诉用户
	return c.json({
		ok: result.status === 'done',
		docId: result.file.replace(/^.*[\\/]/, '').replace(/\.[^.]+$/, ''),
		status: result.status,
		chunks: result.chunks,
		flags: result.flags,
	})
})
