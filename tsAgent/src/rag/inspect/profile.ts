// 文档档案类型 —— 全工程形状的唯一户口（②gate ⑦chunk ⑧store ⑨pipeline 都只 import 这里）
// 边界说明：DocProfile/Block 跨 TS↔py 语言界，单一事实源在 contracts/doc-profile.schema.json，
//          改这两个先改 schema 再同步这里；Chunk/GateResult 纯 TS 内部形状，schema 不管
export type DocFamily =
  | 'docx' | 'xlsx' | 'pdf' | 'pptx' | 'html' | 'odf' | 'rtf'
  | 'image' | 'text' | 'legacy-doc' | 'convert-required' | 'unknown'

/** 执行方案：profile 决定，route.ts 只负责照做。L0-py=pytools 主力（失败落回手写 L0-*） */
export type Strategy = 'L0-py' | 'L0-direct' | 'L0-column-sort' | 'L0-cell-join' | 'L1-py-vl' | 'L2-review'

/**
 * 抽取侧诊断（解析泛化第一刀）——"降级事实必须沿管道传下去"，别再烂在 stderr 里。
 * 字段名与 pytools/parse.py 的 stdout `diag` **逐字同名**（snake_case）：少一层映射就少一处口径漂移，
 * 与 payload 的 doc_id/source_doc/schema_version 同款姿势。
 * 纪律：只准记"发生了什么事"的数，不许在这里做判断/给结论（判断在 gate/quality.ts，一处就够）。
 */
export interface ParseDiag {
  /** 实际走通的抽取器：pymupdf4llm | pymupdf4llm+vl | markitdown | mammoth | html-parser | odf-xml | pptx-xml | rtf-strip | text | image-vl */
  extractor: string
  /** 抽出的正文字符数（gate 覆盖率断言的分子；分母来自档案的 paraChars/pages） */
  chars: number
  /** 页级事实（PDF 等分页文档） */
  pages_total?: number
  pages_via_vl?: number
  pages_vl_failed?: number
  /** 超 VL 页数上限被跳过的页 —— 9/16 前是静默 continue（整页内容人间蒸发），现在必须记账 */
  pages_skipped_by_cap?: number
  pages_empty?: number
  /** 图转文事实 */
  images_total?: number
  images_captioned?: number
  captions_truncated?: number
  captions_failed?: number
  images_over_cap?: number
  /** xlsx/odf 表级事实 */
  sheets_total?: number
  sheets_rejected?: number
  sheets_truncated?: number
  /** 人话降级说明（进 ingest_log flags，不参与判死） */
  notes?: string[]
}

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
  /** 前门发现但不足以改变策略的事实（后缀与内容不符、内容嗅探兜底、扩展名不认识…）→ 进台账，人可见 */
  notes?: string[]
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

/** 表格分片标记：index 从 1 起计，total 为总片数；未拆的表 = {index:1,total:1} */
export interface TablePart {
  index: number
  total: number
}

/** chunk payload 的结构版本：字段语义变更时 +1，供下游（检索/评测）判断该 point 是哪一代
 *  v3（9/16 切片泛化）：+ `overlap_chars`（切缝重叠长度）。已有字段语义未变，旧点缺这个字段=按 0 处理 */
export const SCHEMA_VERSION = 3

/** 切块的产出（chunk/bySection.ts 的户口从这里来，那边不许再自己定义）
 *  text 已含语境锚："文档标题（CAS xxx）｜顶层分节 > 当前分节" + 原文
 *  section = 叶子分节名（下游 searchKnowledge/graph 在读，语义不许变）
 *  headingPath = 从最顶层标题到当前叶节点的完整路径，如 ['4 急救措施','4.1 皮肤接触']
 *  ⚠️ summary 只许"索引用摘要"，永远不得存改写后的正文 —— LLM 碰正文=红线 */
export interface Chunk {
  docId: string
  seq: number
  section?: string
  /** 本块**覆盖到的**各叶子分节名（9/16 跨节打包后一块可能横跨数节）。
   *  与 section 的关系：section = 覆盖帧的公共祖先叶子（单节时两者相同）；读侧过滤两者都要看，
   *  否则"过滤消防措施"会漏掉那些"已把消防措施并进去"的块（见 query.ts 的 should 子句） */
  sections?: string[]
  headingPath: string[]
  page?: number
  bbox?: number[]
  text: string
  summary?: string // LLM 摘要位；默认关，开了也只进 payload 供召回
  /** 切缝上下文：本块头部有多少字是**上一块的尾部**（按 10% 比例重叠带过来的）。
   *  记它是为了两件事：① 展示/答案可裁掉这段重复 ② 评估时能区分"真重复"与"重叠"。
   *  ⚠️ text 本身不含任何标记（正文纯原文），所以必须靠这个数才知道头部哪一截不是本块的 */
  overlapChars?: number
  tableId?: string // 来源 block 的稳定标识：`${docId}#${blockIndex}`
  tablePart?: TablePart // 大表按行拆出的第几片；未拆的表为 {index:1,total:1}
  flags?: string[] // 切块侧的结构告警（如"复杂表超限整块保留"），进 payload 供排查
}

/** 后门质检的判定（gate/quality.ts 产出；红灯=直接 L2，黄灯=按 escalate 升级） */
export interface GateResult {
  pass: boolean
  flags: string[] // 亮灯的指标名+证据，进台账也进人审页
  escalate?: 'L1' | 'L2'
}
