// 路1：结构化查询 —— BioReagentMS 主库 MySQL，只读
// 纪律：只允许 SELECT；预置"查询模板白名单"（sql_name→参数化语句），用户输入永远是 params 不是 SQL 本体
// （Java 类比：MyBatis 的 #{} 预编译，${} 拼接在这里等于零容忍事故）
import { tool } from '@langchain/core/tools'
import { z } from 'zod'

export const queryReagentDb = tool(
  async ({ sql_name, params }) => {
    // TODO: 白名单模板表 + src/db/mysql.ts 执行 + 结果裁剪（行数上限）
    return `TODO: ${sql_name} ${JSON.stringify(params)}`
  },
  {
    name: 'query_reagent_db',
    description: '查询试剂台账结构化数据：库存、存放位置、价格、效期、规格。按 sql_name 选查询模板。',
    schema: z.object({
      sql_name: z.string().describe('白名单模板名，如 stock_by_cas / expiring_soon'),
      params: z.record(z.string(), z.string()).optional().describe('模板参数（值，不是 SQL）'),
    }),
  },
)
