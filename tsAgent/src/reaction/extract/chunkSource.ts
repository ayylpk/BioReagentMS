// 试剂禁配/相容性安全知识 —— chunk 数据源（**可注入**，抽取逻辑不许直连向量库）
//
// 为什么必须是接口：
//   ① 本机 Qdrant 常年不在（127.0.0.1:6333 不通），但"取 chunk"是抽取链路上唯一没法绕的一步；
//      把客户端硬编码进抽取逻辑 = 抽取在离线环境里一行都跑不了、一行都测不了。
//   ② 生产读 Qdrant、测试注 fixture、离线调试用本地语料重建 —— 三种来源同一份接口，
//      抽取逻辑只认 Chunk[]，与来源无关。
//   ③ 生产实现只做一件事：**payload → Chunk 的忠实映射**。映射写成纯函数并单测，
//      因为字段名对错在这里看不出来，只在"候选里的 section/page 全空"时才被发现（已经太晚）。
import { readFile } from 'node:fs/promises'
import { QdrantClient } from '@qdrant/js-client-rest'
import { config } from '../../config/env'
import { bySection } from '../../rag/chunk/bySection'
import type { Block, Chunk, TablePart } from '../../rag/inspect/profile'

export interface ChunkSource {
  /** 日志里显示用（"这份文档的 chunk 是从哪来的"） */
  readonly name: string
  loadChunks(docId: string): Promise<Chunk[]>
}

/** 表格分片 payload 是 `"1/2"` 这样的字符串，解析回 TablePart；格式不对就当没有 */
function parseTablePart(v: unknown): TablePart | undefined {
  if (typeof v !== 'string') return undefined
  const m = /^(\d+)\/(\d+)$/.exec(v.trim())
  if (!m) return undefined
  const index = Number(m[1])
  const total = Number(m[2])
  return index >= 1 && total >= 1 ? { index, total } : undefined
}

/**
 * Qdrant payload → Chunk（纯函数，可单测）。
 * 字段口径与 src/rag/store/upsert.ts 的写入 payload 逐字对应；schema_version 变了要一起看
 * （v3 = 加 overlap_chars；v2 的旧点缺这个字段 → 按"没有重叠"处理，语义正确：老切法只在超长拆分时叠）。
 * 缺 doc_id / seq / text 的 point 一律返回 null（宁可少一块，也不造一块 source 定位不全的 chunk ——
 * 那种 chunk 抽出来的候选，source_chunk_seq 会是错的，溯源直接失真）。
 */
export function chunkFromPayload(payload: unknown): Chunk | null {
  if (typeof payload !== 'object' || payload === null) return null
  const p = payload as Record<string, unknown>
  const docId = p.doc_id
  const seq = p.seq
  const text = p.text
  if (typeof docId !== 'string' || !docId) return null
  if (typeof seq !== 'number' || !Number.isInteger(seq) || seq < 0) return null
  if (typeof text !== 'string') return null

  const headingPath = Array.isArray(p.heading_path) ? p.heading_path.filter((h): h is string => typeof h === 'string') : []
  const bbox = Array.isArray(p.bbox) && p.bbox.every(n => typeof n === 'number') ? (p.bbox as number[]) : undefined
  const tableId = typeof p.table_id === 'string' && p.table_id ? p.table_id : undefined
  const tablePart = parseTablePart(p.table_part)
  const overlapChars = typeof p.overlap_chars === 'number' && p.overlap_chars > 0 ? p.overlap_chars : undefined
  const sections = Array.isArray(p.sections) ? p.sections.filter((s): s is string => typeof s === 'string') : []
  const chunk: Chunk = {
    docId,
    seq,
    headingPath,
    text,
    ...(typeof p.section === 'string' && p.section ? { section: p.section } : {}),
    ...(sections.length ? { sections } : {}),
    ...(typeof p.page === 'number' ? { page: p.page } : {}),
    ...(bbox ? { bbox } : {}),
    ...(overlapChars ? { overlapChars } : {}),
    ...(tableId ? { tableId } : {}),
    ...(tablePart ? { tablePart } : {}),
    ...(Array.isArray(p.chunk_flags) && p.chunk_flags.length ? { flags: p.chunk_flags.filter((f): f is string => typeof f === 'string') } : {}),
  }
  return chunk
}

/**
 * scroll 依赖的**结构**接口（不是 QdrantClient 本体）。
 * 这样测试能塞一个纯内存的分页桩，验证"翻页 + 排序 + payload 映射"而完全不碰网络；
 * 生产侧 QdrantClient 结构上满足它（方法参数在 TS 里是双变的）。
 */
export interface ScrollClient {
  scroll(
    collection: string,
    args: Record<string, unknown>,
  ): Promise<{ points?: { payload?: unknown }[]; next_page_offset?: unknown }>
}

/**
 * 生产实现：按 doc_id scroll 出该文档全部 chunk。
 * 用 scroll 而不是 search：抽取要的是**该文档的全部块**（尤其是第 10 节），
 * 向量检索是"按语义找相似"，会漏掉不含查询词的禁配段落 —— 那正是我们最想要的部分。
 */
export class QdrantChunkSource implements ChunkSource {
  readonly name = 'qdrant'
  private readonly client: ScrollClient
  private readonly collection: string

  constructor(client?: ScrollClient, collection?: string) {
    this.client = client ?? new QdrantClient({ url: config.QDRANT_URL, apiKey: config.QDRANT_API_KEY || undefined })
    this.collection = collection ?? config.QDRANT_COLLECTION
  }

  async loadChunks(docId: string): Promise<Chunk[]> {
    const out: Chunk[] = []
    let offset: string | number | null = null
    for (;;) {
      const page = await this.client.scroll(this.collection, {
        filter: { must: [{ key: 'doc_id', match: { value: docId } }] },
        limit: 256,
        with_payload: true,
        with_vector: false,
        ...(offset === null ? {} : { offset }),
      })
      for (const pt of page.points ?? []) {
        const c = chunkFromPayload(pt.payload)
        if (c) out.push(c)
      }
      // 翻页游标：Qdrant 新旧版本对 offset 的形态不一致（可能是对象），只认能原样传回的标量。
      // 认不出的形态就停止翻页并告警 —— 本场景按 doc_id 过滤、单文档 chunk 数远小于一页 256，
      // 静默"假装翻完了"比少翻一页更危险（少翻 = 少抽 = 知识缺失且没人知道）。
      const npo = page.next_page_offset
      if (npo === null || npo === undefined) break
      if (typeof npo === 'string' || typeof npo === 'number') {
        offset = npo
        continue
      }
      console.warn(`[reaction/extract] 无法识别的 scroll offset 形态，停止翻页：${JSON.stringify(npo).slice(0, 120)}`)
      break
    }
    // 顺序必须确定：选择阶段的优先级排序依赖 seq，分页顺序各家实现不保证
    out.sort((a, b) => a.seq - b.seq)
    return out
  }
}

/**
 * markdown → Block[]（**只覆盖 md/txt 的离线重建，不是生产解析器**）。
 * 生产解析走 pytools（L0-py，pymupdf4llm/markitdown），这里刻意只做"标题行 + 正文段"两件事，
 * 认不出表格就按正文处理 —— 目的是让离线环境能拿真实语料跑选择逻辑，不是替代 parse 链。
 * 切块本身仍然复用生产实现 bySection（绝不在抽取侧另写一套分节/切分规则）。
 */
export function markdownToBlocks(md: string): Block[] {
  const blocks: Block[] = []
  const lines = md.replace(/\r\n?/g, '\n').split('\n')
  let buf: string[] = []
  const flush = (): void => {
    const t = buf.join('\n').trim()
    if (t) blocks.push({ type: 'text', markdown: t })
    buf = []
  }
  for (const line of lines) {
    const h = /^(#{1,6})\s+(.*)$/.exec(line)
    if (h) {
      flush()
      blocks.push({ type: 'heading', level: h[1]!.length, markdown: h[2]!.trim() })
      continue
    }
    buf.push(line)
  }
  flush()
  return blocks
}

/**
 * 离线实现：按 doc_id 找到本地语料文件，用生产切块器重建 chunks。
 * 只在"没有 Qdrant 但想用真实语料验证选择逻辑 / 本地试跑"时使用，不进生产路径。
 * docId 必须与 ingest_log 里的口径一致（都来自 docIdOf）—— 不一致就当场抛，
 * 因为 doc_id 错了会让候选的 source_doc_id 指向另一份文档，比"少抽"危险得多。
 */
export class LocalCorpusChunkSource implements ChunkSource {
  readonly name = 'local-corpus'
  constructor(private readonly resolveFile: (docId: string) => Promise<string | null>) {}

  async loadChunks(docId: string): Promise<Chunk[]> {
    const file = await this.resolveFile(docId)
    if (!file) throw new Error(`本地语料重建：ingest_log 里找不到 doc_id=${docId} 对应的文件`)
    const md = await readFile(file, 'utf8')
    const chunks = bySection(file, markdownToBlocks(md))
    const got = chunks[0]?.docId
    if (got && got !== docId) {
      throw new Error(`本地语料重建：docIdOf(${file}) = ${got}，与请求的 doc_id=${docId} 不一致（口径漂移，拒绝继续）`)
    }
    return chunks
  }
}
