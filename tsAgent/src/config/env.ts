// 环境配置统一入口：启动即校验，缺 key 当场报错（Java 类比：@ConfigurationProperties + 启动 validation）
import { z } from 'zod'

const req = (name: string) => z.string().min(1, 'missing ' + name)
const url = (d: string) => z.string().url().default(d)
const num = (d: number) => z.coerce.number().int().default(d)

export const config = z
  .object({
    LLM_API_KEY: req('LLM_API_KEY'),
    LLM_BASE_URL: url('https://api.deepseek.com/v1'),
    LLM_MODEL: z.string().default('deepseek-chat'),
    DASHSCOPE_API_KEY: req('DASHSCOPE_API_KEY'),
    EMBEDDING_MODEL: z.string().default('text-embedding-v4'),
    EMBED_DIM: num(1024),
    TAVILY_API_KEY: req('TAVILY_API_KEY'),
    MYSQL_HOST: z.string().default('127.0.0.1'),
    MYSQL_PORT: num(3306),
    MYSQL_USER: z.string().default('root'),
    MYSQL_PASSWORD: z.string().default(''),
    MYSQL_DB: z.string().default('bioreagentms'),
    QDRANT_URL: url('http://127.0.0.1:6333'),
    QDRANT_COLLECTION: z.string().default('reagent_knowledge'),
    VL_MODEL: z.string().default('qwen-vl-ocr-latest'),
    SERVICE_PORT: num(8123),
  })
  .parse(process.env)
