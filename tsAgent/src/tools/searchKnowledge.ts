// 路2：向量检索 —— 执行体在 rag/search.ts 的 hybridSearch（与 ragNode 同一口径），这里是工具皮
// payload 约定：{cas_number, section, source_doc, text, page, bbox}（page/bbox 供前端跳原文）
import { tool } from '@langchain/core/tools'
import { z } from 'zod'
import { hybridSearch } from '../rag/search'

/** 图内和工具共用的人话渲染：【分节｜出处】是溯源锚，回答必须点名 */
export function renderHits(hits: Awaited<ReturnType<typeof hybridSearch>>): string {
  if (!hits.length) return '本地文档库未命中（换个关键词试试，或先在知识库页上传对应 SDS 文档）'
  return hits
    .map((h) => `【${(h.section as string) ?? '未分节'}｜${(h.source_doc as string) ?? '?'}】${h.text}`)
    .join('\n---\n')
}

export const searchKnowledge = tool(
  async ({ query, section }) => renderHits(await hybridSearch(query, { top: 6, section })),
  {
    name: 'search_knowledge',
    description: '检索本地文档库：SDS 分节文本、实验室规章、SOP、仪器手册。',
    schema: z.object({
      query: z.string().describe('检索语句'),
      section: z.string().optional().describe('可选：限定 SDS 分节，如 急救措施/消防措施'),
    }),
  },
)
