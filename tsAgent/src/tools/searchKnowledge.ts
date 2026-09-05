// 路2：向量检索 —— Qdrant collection=reagent_knowledge
// payload 约定：{cas_number, section, source_doc, text, page, bbox}（page/bbox 供前端跳原文）
import { tool } from '@langchain/core/tools'
import { z } from 'zod'

export const searchKnowledge = tool(
  async ({ query, section }) => {
    // TODO: embed(query)（src/rag/embed/dashscope.ts）→ qdrant search(top_k=6, filter.section?)
    //       返回带 source_doc+section 的片段列表，让回答可溯源
    return `TODO: ${query} / ${section ?? '全部分节'}`
  },
  {
    name: 'search_knowledge',
    description: '检索本地文档库：SDS 分节文本、实验室规章、SOP、仪器手册。',
    schema: z.object({
      query: z.string().describe('检索语句'),
      section: z.string().optional().describe('可选：限定 SDS 分节，如 急救措施/消防措施'),
    }),
  },
)
