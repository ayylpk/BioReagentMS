# tsAgent —— BioReagentMS 的 TS 版 Agent + RAG 工程

BioReagentMS 的 agent 侧全部家当（旧 py 版 `agent-BioReagentMS` 已于 9/6 删除）。
技术栈：**Bun + TypeScript + LangGraph.js**，py 只作解析能力扩展（`pytools/`，CLI 契约调用）。

## 目录地图（每层职责 = 一个设计决策）

```
langgraph.json          # graph 注册：reagent_assistant → src/agent/index.ts:graph
contracts/              # ★ 跨语言契约单一事实源（doc-profile schema + Block 数组）
src/
├── agent/              # 主图：router→{db|knowledge|chat}→(dbQuery/rag/web)→result 三路路由
│   ├── graph.ts        #   StateGraph 装配 + 判空降级全在代码（分流铁律）
│   ├── prompts.ts      #   提示词归档（图内自带现行版本，此文件是历史参考）
│   └── index.ts        #   langgraph.json 的取图入口（可选调试路）
├── tools/              # 三路检索：query_reagent_db(模板白名单)/search_knowledge/web_search + dbTemplates
├── rag/
│   ├── inspect/        # ★ 三层探测 → DocProfile（"怎么确定它是哪种文件"的全部答案）
│   ├── parse/          # 策略执行：route(switch) + fromDocx/fromPdf(L0直抽) + fromPy(pytools三件套+VL)
│   ├── chunk/          # 分节切分：SDS 16 节天然边界，表格=原子 chunk
│   ├── gate/           # 质量闸门：乱码率/页均字数/列数一致/CAS 校验位（代码断言）
│   ├── embed/          # Ollama bge-m3（embed 同签名，可换 DashScope v4，见 deploy/DEPLOY.md 五哨①）
│   ├── sparse/         # jieba+TF 稀疏向量（Qdrant 服务端 idf）
│   ├── store/          # Qdrant 按 doc_id 幂等 upsert（增量一致性，不全量重建）+ ingest_log 台账
│   ├── search.ts       # 生产读侧唯一入口：named dense+sparse 双路 RRF + 相关性地板
│   └── pipeline.ts     # 编排：probe→route→chunk→gate→store 四状态落账
├── service/            # Hono :8123 —— agent 侧唯一常驻进程
│   ├── routes/ingest.ts    #   /ingest 上传/台账/重摄/删除（Knowledge.vue 的后端）
│   ├── routes/webSearch.ts #   /webSearch/confirm（WebSearch.vue 确认入库）
│   ├── routes/stream.ts    #   /agent/runs/stream —— SSE 最小子集（前端不再依赖 :2024）
│   └── routes/review.ts    #   /review L2 人审队列（二期，空壳）
├── db/                 # mysql2 只读池 + SELECT 断言
└── config/             # zod 环境校验，缺 key 启动即死
pytools/                # py 能力扩展：parse.py CLI（stdout=契约 JSON，失败=非零码，TS 侧旁路降级）
scripts/ingest.ts       # bun run ingest -- <file|dir> 摄取入口
samples/                # 五类靶子（README 列了清单，真 SDS 别造玩具）
eval/qa50.jsonl         # 三路路由+命中率评估集骨架
resources/              # 解析资产落盘（图片/隔离件），不入库
```

## 三级成本漏斗（解析层宪法）

```
L0 免费直抽(direct/栏重排/列拼接) ──过闸门──→ 入库
L1 pytools VL(qwen-vl-ocr, ~¥0.001/页)──过闸门──→ 入库    整库 < ¥5
L2 人审队列(service /review) → 人工确认才入库，修正样本=回归评估集原料
```

## 快速开始

```bash
cp .env.example .env   # 填 key（LLM 走 OpenAI 兼容口，DeepSeek/DashScope 均可）
bun install
bun run service        # Hono :8123 —— 本地/线上唯一常驻进程（摄取+确认+聊天流式端点）
bun run ingest -- samples/   # CLI 摄取入口（走 pipeline，和上传 API 同一台发动机）
bun run typecheck
bun run scripts/smoke-graph.ts  # 三路路由冒烟（需 LLM key 有余额）
bun run dev            # 可选：langgraph server :2024 调试图结构用，前端已不依赖
```

## 集成期 TODO（9/6 结账）

- [x] graph 名保持 `reagent_assistant`；`/runs/stream` 协议两端自写（stream.ts + Chat.vue），:2024 从关键路径摘除
- [x] vite proxy：`/ingest` `/agent` `/search` → 8123 全收编（webSearch 确认入库 = Hono routes/webSearch.ts）
- [x] `git rm -r ../agent-BioReagentMS`（9/6 完成；.env 键已核对，新工程无缺失）
- [ ] L2 人审队列实装（review.ts 空壳 + 前端对照页）
- [ ] qa50 灌题跑命中率（地板值 0.35 等参数等它回调）
- [ ] 爬虫 fetch-sds 走 /ingest/upload 喂料（UI 无爬虫入口，脚本直连 API）
