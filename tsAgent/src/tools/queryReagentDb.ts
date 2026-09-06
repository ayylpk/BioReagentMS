// 路1：结构化查询 —— 执行体在 dbTemplates.ts（SQL 白名单），这里只是 LangChain 工具皮
// （图的 db 分支直接调 runTemplate；这层皮留给将来 ReAct 化或 MCP 暴露用）
import { tool } from '@langchain/core/tools'
import { z } from 'zod'
import { runTemplate, renderCatalog } from './dbTemplates'

export const queryReagentDb = tool(
  async ({ sql_name, params }) => runTemplate(sql_name, params ?? {}),
  {
    name: 'query_reagent_db',
    description: `查询试剂台账结构化数据：库存、存放位置、价格、效期、规格。只能从白名单模板中选。\n${renderCatalog()}`,
    schema: z.object({
      sql_name: z.string().describe('白名单模板名，如 stock_by_name / expiring_soon / low_stock'),
      params: z.record(z.string(), z.string()).optional().describe('模板参数（值，不是 SQL）'),
    }),
  },
)
