// LangGraph Server 注册入口：langgraph.json 的 graphs 从这里取 ./src/agent/index.ts:graph
// bun run dev → :2024，暴露 /runs/stream 线协议（与前端将来 /agent 代理对接时同构）
import { graph } from './graph'

export { graph }
