// L2 人审队列：漏斗最贵的一级，只接"代码和一分钱模型都拿不准"的
// 存储：MySQL 自建表 rag_review_queue（doc_file, profile_json, blocks_json, flags, status, edited_blocks, reviewed_at）
//   —— 修正后的对照样本永久留存 = 解析层回归评估集的原料
// 前端配合（集成期）：左原页图 右可编辑解析结果的对照页
import { Hono } from 'hono'

export const reviewRoutes = new Hono()

// TODO: GET  /pending     待审列表（含 profile + 解析结果 + 红灯 flags）
// TODO: POST /:id/confirm 人工修正后 → embed+upsert 入库，样本存档
// TODO: POST /:id/reject  废弃（扫描件质量烂到没救）
