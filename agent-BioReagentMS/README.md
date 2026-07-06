# BioReagentMS AI Agent

基于 LangGraph 的智能实验室助手，支持自然语言查询试剂信息、库存、预警记录、批次等。

## 技术栈

| 组件 | 技术 |
|------|------|
| Agent 框架 | LangGraph |
| LLM | DeepSeek (langchain-deepseek) |
| 工具检索 | Tavily Search |
| 对话记忆 | SQLite Checkpoint |
| 后端通信 | httpx (调用 BioReagentMS 后端 API) |

## 项目结构

```
agent-BioReagentMS/
├── app/
│   ├── agent/
│   │   ├── reagent_assistant.py   # Agent 图定义
│   │   └── api_client.py          # 后端 API 客户端
│   └── common/
│       ├── client.py              # HTTP 客户端封装
│       └── tools/                 # Agent 工具函数
│           ├── reagent.py         # 试剂查询
│           ├── warehouse.py       # 库存查询
│           ├── warning.py         # 预警查询
│           ├── batch.py           # 批次查询
│           ├── delivery.py        # 出入库查询
│           ├── supplier.py        # 供应商查询
│           ├── report.py          # 报表查询
│           └── operation.py       # 操作日志查询
├── main.py                        # Agent 入口
├── langgraph.json                 # LangGraph 配置
├── pyproject.toml                 # 项目依赖
└── .env                           # 环境变量（不进 git）
```

## 端口

| 模式 | 端口 |
|------|------|
| langgraph dev | 2024 |
