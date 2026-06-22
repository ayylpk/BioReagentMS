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

## 技术栈

| 层级 | 技术 |
|------|------|
| 后端框架 | Spring Boot 3.x |
| 安全认证 | JWT (jjwt 0.12.x) + 拦截器 + AOP 权限校验 |
| ORM | MyBatis + PageHelper |
| 数据库 | MySQL 8.0 + Druid 连接池 |
| 缓存 | Redis（Spring Cache 注解） |
| 定时任务 | Spring Scheduled（预警扫描） |
| 文件存储 | 阿里云 OSS |
| 前端框架 | Vue 3 + Vite |
| UI 组件 | Element Plus |
| 状态管理 | Pinia |
| HTTP 客户端 | Axios |

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
│       └── views/                 # 页面组件
├── env.example                    # 环境变量模板（复制为 .env 使用）
└── .gitignore
```

## 快速开始

### 1. 数据库

执行 SQL 脚本初始化数据库：

```bash
mysql -u root -p < backend-BioReagentMS/server/src/main/resources/template/All.sql
```

### 2. 后端启动

```bash
cd backend-BioReagentMS

# 配置环境变量（参考 env.example）
# 或直接修改 application.yml 填入真实值

mvn clean install -DskipTests
cd server
mvn spring-boot:run
```

服务默认运行在 `http://localhost:8080`。

### 3. 前端启动

```bash
cd frontend-BioReagentMS
npm install
npm run dev
```

前端开发服务器默认运行在 `http://localhost:5173`，已配置代理转发 `/api` 到后端。

### 4. 默认账号

| 用户名 | 密码 | 角色 |
|--------|------|------|
| admin | 123456 | 系统管理员 |
| warehouse | 123456 | 仓库管理员 |
| labuser | 123456 | 普通实验人员 |
| purchaser | 123456 | 采购人员 |
| pi | 123456 | 课题负责人 |

## 环境变量

复制 `env.example` 为 `.env`，按实际环境填写：

| 变量名 | 说明 | 默认值 |
|--------|------|--------|
| DB_HOST | 数据库地址 | localhost |
| DB_PORT | 数据库端口 | 3306 |
| DB_NAME | 数据库名 | BioReagentMS |
| DB_USERNAME | 数据库用户 | root |
| DB_PASSWORD | 数据库密码 | - |
| REDIS_HOST | Redis 地址 | localhost |
| REDIS_PORT | Redis 端口 | 6379 |
| REDIS_PASSWORD | Redis 密码 | - |
| REDIS_DATABASE | Redis 库号 | 0 |
| JWT_SECRET_KEY | JWT 签名密钥（Base64，≥256bits） | - |
| OSS_ENDPOINT | 阿里云 OSS Endpoint | - |
| OSS_ACCESS_KEY_ID | 阿里云 AccessKey ID | - |
| OSS_ACCESS_KEY_SECRET | 阿里云 AccessKey Secret | - |
| OSS_BUCKET_NAME | OSS Bucket 名称 | - |

## License

MIT
