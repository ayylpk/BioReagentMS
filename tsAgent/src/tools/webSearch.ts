// 路3：联网兜底 —— Tavily（前两路都未命中才走到这，路由规则见 graph.ts 的 routerNode）
// 官方 JS SDK @tavily/core；延迟 import：不走兜底就不加载，也绕开 bun 下静态解析的兼容问题
import { tool } from '@langchain/core/tools'
import { z } from 'zod'
import { config } from '../config/env'

/** 执行体：图内 web 节点和工具皮共用。失败不抛异常——兜底路挂了也只回一句人话 */
export async function webSearchRun(query: string): Promise<string> {
  try {
    const { tavily } = await import('@tavily/core')
    const client = tavily({ apiKey: config.TAVILY_API_KEY })
    const res = await client.search(query, { maxResults: 5, topic: 'general', includeAnswer: true })
    const lines = (res.results ?? []).map((r) => `【${r.title}｜${r.url}】\n${r.content ?? ''}`)
    if (!lines.length) return '联网也没有搜到相关结果。'
    return [res.answer ? `Tavily 综合回答：${res.answer}` : '', lines.join('\n---\n')]
      .filter(Boolean)
      .join('\n\n')
  } catch (e) {
    return `联网检索失败：${(e as Error).message.slice(0, 120)}`
  }
}

export const webSearch = tool(
  async ({ query }) => webSearchRun(query),
  {
    name: 'web_search',
    description: '本地结构化库与文档库都查不到时的联网兜底。回答必须注明来自联网。',
    schema: z.object({ query: z.string() }),
  },
)
