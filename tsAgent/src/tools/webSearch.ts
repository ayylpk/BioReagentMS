// 路3：联网兜底 —— Tavily（前两路都未命中才走到这，路由规则见 prompts.ts）
// 官方 JS SDK：@tavily/core
import { tool } from '@langchain/core/tools'
import { z } from 'zod'

export const webSearch = tool(
  async ({ query }) => {
    // TODO: const { tavily } = await import('@tavily/core')
    //       client({ api_key }).search({ query, max_results: 5, topic: 'general' })
    return `TODO: ${query}`
  },
  {
    name: 'web_search',
    description: '本地结构化库与文档库都查不到时的联网兜底。回答必须注明来自联网。',
    schema: z.object({ query: z.string() }),
  },
)
