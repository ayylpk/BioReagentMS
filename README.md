# BioReagentMS - 生物试剂库存管理系统

面向生物实验室的试剂库存管理系统，支持试剂主数据管理、批次出入库、效期预警、多级审批流程。

## 功能模块

| 模块 | 说明 |
|------|------|
| 试剂管理 | 试剂主数据维护（名称/CAS号/规格/纯度/分类/存储条件） |
| 批次库存 | 批次入库、FEFO出库（先到期先出）、库存扣减、状态跟踪 |
| 入库管理 | 入库单创建、自动生成批次号 |
| 出库审批 | 出库申请 → 审批（通过/拒绝）→ 自动扣库存 |
| 效期预警 | 定时扫描即将过期批次、库存低于安全阈值的试剂，自动生成预警 |
| 供应商管理 | 供应商信息维护 |
| 用户管理 | 多角色权限控制（系统管理员/仓库管理员/实验员/采购员/PI） |
| 操作日志 | 自动记录增删改操作，可追溯 |
| 报表导出 | 库存报表、入库报表 Excel 导出 |
| 智能助手 | AI 对话（流式）：意图路由三路——台账结构化查询 / 知识库混合检索 / 联网兜底 |
| 联网检索 | Tavily 搜索 → 暂存 MySQL → 一键确认入 Qdrant 知识库 |
| 知识库管理 | 上传/拖文件夹摄取 SDS·规章·SOP 长文档（解析九模块+人审漏斗），台账可观测可重摄 |

## 技术栈

| 层级 | 技术 |
|------|------|
| 后端框架 | Spring Boot 3.x |
| 安全认证 | JWT (jjwt 0.12.x) + 拦截器 + AOP 权限校验 |
| ORM | MyBatis + PageHelper |
| 数据库 | MySQL 8.0 + Druid 连接池 |
| 缓存 | Redis（Spring Cache 注解） |
| 定时任务 | Spring Scheduled（预警扫描） |
| 前端框架 | Vue 3 + Vite |
| UI 组件 | Element Plus |
| 状态管理 | Pinia |
| HTTP 客户端 | Axios |
| AI Agent | LangGraph.js（Bun）+ DeepSeek，三工具意图路由，SSE 真流式 |
| Agent 周边服务 | Hono :8123（/ingest 摄取 API + /webSearch 确认 + /agent 流式端点） |
| 向量数据库 | Qdrant（named dense + BM25 稀疏双向量，RRF 融合）+ Ollama bge-m3 |
| 文档解析 | py 三件套（pymupdf4llm/markitdown/openpyxl）+ qwen-vl OCR 桥 |

## 项目结构

```
BioReagentMS/
├── backend-BioReagentMS/          # 后端 Maven 多模块
│   ├── common/                    # 公共模块（工具类、JWT、异常定义）
│   ├── pojo/                      # 实体/DTO/VO/查询参数
│   └── server/                    # 主服务（Controller/Service/Mapper）
├── frontend-BioReagentMS/         # 前端 Vue 3 项目
│   └── src/
│       ├── layout/                # 布局组件
│       ├── router/                # 路由配置
│       ├── stores/                # Pinia 状态管理
│       ├── utils/                 # Axios 封装
│       └── views/                 # 页面组件（含 Chat.vue、WebSearch.vue、Knowledge.vue）
├── tsAgent/                       # AI Agent（LangGraph.js）+ Hono 周边服务 :8123
│   ├── src/agent/                 # 主图：router→{db|knowledge|chat}→(rag/dbQuery/web)→result
│   ├── src/rag/                   # 解析九模块 + 生产读侧 hybridSearch（Qdrant 双向量 RRF）
│   ├── src/tools/                 # 三工具：query_reagent_db(模板白名单)/search_knowledge/web_search
│   ├── src/service/               # Hono：/ingest /webSearch/confirm /agent/runs/stream /review
│   ├── src/pytools/               # L0-py 解析栈（spawn 子进程，末行 JSON 契约）
│   └── corpus/                    # 上传语料落盘（gitignore）
├── env.example                    # 环境变量模板（复制为 .env 使用）
└── .gitignore
```

## 服务端口

| 服务 | 端口 | 说明 |
|------|------|------|
| 后端 API | 8080 | Spring Boot |
| 前端 | 5173 | Vite 开发服务器 |
| Agent 周边服务 | 8123 | Hono（摄取/确认/流式聊天端点，agent 侧唯一常驻进程） |
| Qdrant | 6333 | 向量库（Docker，卷 qdrant-data） |
| Ollama | 11434 | 本地 bge-m3 embedding |

前端代理：`/api` → `localhost:8080`，`/ingest`+`/agent`+`/search` → `localhost:8123`

## License

MIT
