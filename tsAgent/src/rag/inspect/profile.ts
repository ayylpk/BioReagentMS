// 文档档案类型 —— 全工程形状的唯一户口（②gate ⑦chunk ⑧store ⑨pipeline 都只 import 这里）
// 边界说明：DocProfile/Block 跨 TS↔py 语言界，单一事实源在 contracts/doc-profile.schema.json，
//          改这两个先改 schema 再同步这里；Chunk/GateResult 纯 TS 内部形状，schema 不管
export type DocFamily = 'docx' | 'xlsx' | 'pdf' | 'image' | 'text' | 'legacy-doc' | 'unknown'

/** 执行方案：profile 决定，route.ts 只负责照做。L0-py=pytools 主力（失败落回手写 L0-*） */
export type Strategy = 'L0-py' | 'L0-direct' | 'L0-column-sort' | 'L0-cell-join' | 'L1-py-vl' | 'L2-review'

export interface DocxProbe {
  columns: number
  tableCount: number
  layoutTables: number // 单行多格大段文字 = 排版假表格（双栏伪装）
  textBoxes: number // 浮动文本框（抽取顺序隐患）
  drawingCount: number
  paraChars: number
}

export interface PdfProbe {
  hasTextLayer: boolean
  pages: number
  charsPerPage: number
  columns: 1 | 2 | 'multi' | 'unknown'
  gapConsistentRatio: number // 栏间隙在页间的稳定度 0~1
  lineDensity: number // 线框密度 → 表格探测
  garbledRatio: number
}

export interface DocProfile {
  file: string
  family: DocFamily
  magic: string
  docx?: DocxProbe
  pdf?: PdfProbe
  strategy: Strategy
  reason: string
}

/** 一切解析的出口形状（$defs.Blocks）：pipeline 之后没人再关心源格式 */
export interface Block {
  type: 'heading' | 'text' | 'table' | 'image'
  level?: number
  page?: number
  bbox?: [number, number, number, number]
  markdown: string
  html?: string // 合并单元格等复杂表原文
}

/** 切块的产出（chunk/bySection.ts 的户口从这里来，那边不许再自己定义）
 *  text 已含语境锚："试剂名（CAS xxx）｜第N节" + 原文
 *  ⚠️ summary 只许"索引用摘要"，永远不得存改写后的正文 —— LLM 碰正文=红线 */
export interface Chunk {
  docId: string
  seq: number
  section?: string
  page?: number
  bbox?: number[]
  text: string
  summary?: string // LLM 摘要位；默认关，开了也只进 payload 供召回
}

/** 后门质检的判定（gate/quality.ts 产出；红灯=直接 L2，黄灯=按 escalate 升级） */
export interface GateResult {
  pass: boolean
  flags: string[] // 亮灯的指标名+证据，进台账也进人审页
  escalate?: 'L1' | 'L2'
}
