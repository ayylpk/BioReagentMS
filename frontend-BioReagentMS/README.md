# BioReagentMS 前端

基于 Vue 3 + Vite + Element Plus 的生物试剂库存管理系统前端。

## 技术栈

| 组件 | 技术 |
|------|------|
| 框架 | Vue 3 (Composition API) |
| 构建 | Vite |
| UI 组件 | Element Plus |
| 状态管理 | Pinia |
| HTTP | Axios |
| 图表 | ECharts + vue-echarts |
| Markdown 渲染 | marked |

## 项目结构

```
frontend-BioReagentMS/
├── src/
│   ├── layout/
│   │   └── MainLayout.vue        # 主布局（侧边栏+顶栏+内容区）
│   ├── router/
│   │   └── index.js              # 路由配置
│   ├── stores/
│   │   └── auth.js               # 用户认证状态
│   ├── utils/
│   │   └── request.js            # Axios 封装（拦截器/错误处理）
│   └── views/
│       ├── Dashboard.vue         # 工作台
│       ├── Reagents.vue          # 试剂管理
│       ├── Inventory.vue         # 库存管理
│       ├── Inbounds.vue          # 入库管理
│       ├── Outbounds.vue         # 出库管理
│       ├── Warnings.vue          # 效期预警
│       ├── Suppliers.vue         # 供应商管理
│       ├── Reports.vue           # 统计报表
│       ├── Operations.vue        # 操作日志
│       ├── Users.vue             # 用户管理
│       ├── Profile.vue           # 个人信息
│       └── Chat.vue              # 智能助手（AI 对话）
├── package.json
├── vite.config.js                # Vite 配置（含代理转发）
└── index.html
```

## 端口

| 模式 | 端口 |
|------|------|
| npm run dev | 5173 |

## 代理

`vite.config.js` 中已配置代理：

| 前缀 | 转发到 | 说明 |
|------|--------|------|
| `/api` | `http://localhost:8080` | 后端 API |
| `/agent` | `http://localhost:2024` | AI Agent 服务 |
