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
    EMBED_BACKEND: z.enum(['ollama', 'dashscope']).default('ollama'), // 上线五哨①的切换位
    // 注：联网搜索（Tavily）已整体移除 —— 本地未命中改为"缺口问答"：生成参考 → 进 MySQL 待办 → 人工确认
    MYSQL_HOST: z.string().default('127.0.0.1'),
    MYSQL_PORT: num(3306),
    MYSQL_USER: z.string().default('root'),
    MYSQL_PASSWORD: z.string().default(''),
    MYSQL_DB: z.string().default('bioreagentms'),
    QDRANT_URL: url('http://127.0.0.1:6333'),
    QDRANT_COLLECTION: z.string().default('reagent_knowledge'),
    QDRANT_API_KEY: z.string().default(''), // 公网部署必设（Qdrant 侧 QDRANT__SERVICE__API_KEY 同值）；本机留空
    // 人审端点鉴权用的 JWT secret：**与 Java 后端同一个值**（compose 两边都注入 JWT_SECRET_KEY）。
    // 故意不设成必填：缺它只关掉人审端点（返回 503 并说明），不该让整个服务起不来 ——
    //   但绝不"自动放行"，人审端点能改知识库内容，开放比不可用危险得多（见 service/auth.ts）
    JWT_SECRET_KEY: z.string().default(''),
    VL_MODEL: z.string().default('qwen-vl-ocr-latest'),
    SERVICE_PORT: num(8123),
  })
  .parse(process.env)
