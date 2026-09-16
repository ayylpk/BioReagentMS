// 路2：向量检索 —— 执行体在 rag/search.ts 的 hybridSearch（与 ragNode 同一口径），这里是工具皮
// payload 约定：{doc_id, source_doc, section, cas_number, page, bbox, text}（page/bbox 供前端跳原文）
//
// 过滤只暴露 4 个白名单维度（cas_number / section / source_doc / doc_id），全部 optional：
// 模型只能"在这些维度上给值"，不能自由拼 Qdrant filter / SQL / 正则 ——
// 值的合法性（CAS 校验位、分节别名归一化）统一在 search.ts 的 buildPayloadFilter 里把闸，
// 非法值不施加过滤并在服务端日志说明（工具这层不做半真半假的过滤）。
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
  async ({ query, section, cas_number, source_doc, doc_id }) =>
    renderHits(
      await hybridSearch(query, {
        top: 6,
        section,
        casNumber: cas_number,
        sourceDoc: source_doc,
        docId: doc_id,
      }),
    ),
  {
    name: 'search_knowledge',
    description: '检索本地文档库：SDS 分节文本、实验室规章、SOP、仪器手册。',
    schema: z.object({
      query: z.string().describe('检索语句'),
      section: z.string().optional().describe('可选：限定 SDS 分节，支持口语别名（急救/着火了/储存/怎么扔），如 消防措施'),
      cas_number: z.string().optional().describe('可选：限定 CAS 号（须为合法 CAS，含校验位，如 7664-93-9）'),
      source_doc: z.string().optional().describe('可选：限定来源文件名（payload.source_doc 精确匹配，含扩展名）'),
      doc_id: z.string().optional().describe('可选：限定文档 id（payload.doc_id 精确匹配）'),
    }),
  },
)
