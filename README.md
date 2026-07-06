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
| 智能助手 | AI 对话式查询，支持自然语言问试剂、库存、预警、批次等信息 |

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
| AI Agent | LangGraph + LangChain + DeepSeek |
| Agent 工具 | Tavily Search（联网检索） |

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
│       └── views/                 # 页面组件（含 Chat.vue 智能助手）
├── agent-BioReagentMS/            # AI Agent（LangGraph）
│   ├── app/agent/                 # Agent 定义与 API 客户端
│   ├── app/common/tools/          # 业务工具函数（试剂/库存/预警等）
│   ├── main.py                    # Agent 入口
│   └── langgraph.json             # LangGraph 配置
├── env.example                    # 环境变量模板（复制为 .env 使用）
└── .gitignore
```

## 服务端口

| 服务 | 端口 | 说明 |
|------|------|------|
| 后端 API | 8080 | Spring Boot |
| 前端 | 5173 | Vite 开发服务器 |
| AI Agent | 2024 | LangGraph 服务 |

前端代理：`/api` → `localhost:8080`，`/agent` → `localhost:2024`

## License

MIT
