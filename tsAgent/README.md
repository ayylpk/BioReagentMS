# tsAgent —— BioReagentMS 的 TS 版 Agent + RAG 工程

独立开发，跑通后再替换旧 `agent-BioReagentMS`（py）并接管前端代理。
技术栈：**Bun + TypeScript + LangGraph.js**，py 只作解析能力扩展（`pytools/`，CLI 契约调用）。

## 目录地图（每层职责 = 一个设计决策）

```
langgraph.json          # graph 注册：reagent_assistant → src/agent/index.ts:graph
contracts/              # ★ 跨语言契约单一事实源（doc-profile schema + Block 数组）
src/
├── agent/              # 主图（你的地盘）：echo 占位图可先验证 langgraph dev 起服务
│   ├── graph.ts        #   StateGraph 装配；并发点：Send/并行边 三路检索同发
│   ├── prompts.ts      #   意图路由死规则（分流铁律：WHERE→MySQL，讲什么→Qdrant，兜底→Tavily）
│   └── index.ts        #   langgraph.json 的取图入口
├── tools/              # 三路检索工具（query_reagent_db / search_knowledge / web_search）
├── rag/
│   ├── inspect/        # ★ 三层探测 → DocProfile（"怎么确定它是哪种文件"的全部答案）
│   ├── parse/          # 策略执行：route(switch) + fromDocx/fromPdf(L0直抽) + fromPy(L1 VL)
│   ├── chunk/          # 分节切分：SDS 16 节天然边界，表格=原子 chunk
│   ├── gate/           # 质量闸门：乱码率/页均字数/列数一致/CAS 校验位（代码断言）
│   ├── embed/          # DashScope text-embedding-v4
│   ├── store/          # Qdrant 按 doc_id 幂等 upsert（增量一致性，不全量重建）
│   └── pipeline.ts     # 编排：inspect→route→chunk→gate→embed→store，红灯全转 L2 人审
├── service/            # Hono :8123 周边 HTTP（L2 人审队列；集成期接管 /search）
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
bun run dev            # LangGraph Server :2024（echo 图，验证链路用）
bun run service        # Hono :8123
bun run ingest -- samples/   # 摄取入口（stub 阶段会按 TODO 报错，属预期）
bun run typecheck
```

## 给未来的自己（集成期 TODO 备忘）

- [ ] 前端零改动条件：graph 名保持 `reagent_assistant`，协议 `/runs/stream`（Chat.vue 裸 fetch 已核实）
- [ ] vite proxy `/agent`→2024 不变；`/search`→8123 由本 service 接管（webSearch 暂存/确认路由补齐）
- [ ] 跑通后 `git rm -r ../agent-BioReagentMS`（先审 .gitignore 是否漏过 .env——里面有 BACKEND_PASSWORD）
