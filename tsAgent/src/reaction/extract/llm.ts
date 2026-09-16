// 试剂禁配/相容性安全知识 —— LLM 结构化抽取（**本目录唯一有网络 IO 的一层**）
//
// 边界（用户明令：本轮不真调 LLM，但调用必须可注入/可 stub）：
//   · 对上游：只暴露 RelationExtractor 这一个窄接口。pipeline 依赖的是接口，
//     测试塞 stub 就能把整条流水线跑完 —— 抽取链路的正确性不再"必须连着模型才能验证"。
//   · 对下游：只吐 LlmExtractionLoose（宽松形状）。**结构化输出不是可信输入**：
//     枚举越界、凭空 CAS、改写引文全由 validate.ts 逐条拦，这一层不做任何业务判断。
//   · 不在模块加载时 new 客户端：createLlmExtractor() 是显式调用，
//     import 本文件不会产生任何连接/调用（离线环境可以安全 import 类型与常量）。
import { ChatOpenAI } from '@langchain/openai'
import { HumanMessage, SystemMessage } from '@langchain/core/messages'
import { config } from '../../config/env'
import type { Chunk } from '../../rag/inspect/profile'
import { HAZARD_VOCABULARY, RELATION_EXTRACT_SYSTEM_PROMPT, RELATION_TYPE_NOTES, buildRelationExtractUserMessage } from './prompt'
import { llmExtractionLooseSchema, type LlmExtractionLoose } from './types'

/** 抽取器的窄接口：pipeline 只认它，不认 ChatOpenAI */
export interface RelationExtractor {
  readonly name: string
  extract(chunk: Chunk): Promise<LlmExtractionLoose>
}

/**
 * 工具名。RL 无关，纯粹是 function-calling 的契约名：
 * 换名字等于换缓存键，别随便动（同一份语料重跑时，名字变了就再也对不上历史调用）。
 */
export const EXTRACT_TOOL_NAME = 'emit_relation_candidates'

/** 系统提示词 = 用户提供的抽取规则 + 词表 + 取值口径（后两段是"减少一次失败"的工程补充） */
export const buildSystemPrompt = (): string =>
  `${RELATION_EXTRACT_SYSTEM_PROMPT}\n\n${HAZARD_VOCABULARY}\n\n${RELATION_TYPE_NOTES}`

/**
 * 生产抽取器。**唯一**的 LLM 出口。
 *
 * ⚠️ withStructuredOutput 必须显式 method: 'functionCalling'：
 *   默认的 json_schema 路 DeepSeek 直接 400（"This response_format type is unavailable now"，9/6 冒烟实录）。
 *   与 src/agent/graph.ts 的三个轻 LLM 完全同款 —— 这是本仓已实测过的唯一可用口径。
 * ⚠️ 任何解析失败（模型没按 schema 填）都会抛到这里；**调用方（pipeline）负责捕获并只丢该 chunk**，
 *   绝不许上抛成"文档抽取失败"——一次 tool-call 解析失败不该让整份文档的其它段落白跑。
 */
export function createLlmExtractor(): RelationExtractor {
  const model = new ChatOpenAI({
    model: config.LLM_MODEL,
    apiKey: config.LLM_API_KEY,
    configuration: { baseURL: config.LLM_BASE_URL },
  }).withStructuredOutput(llmExtractionLooseSchema, { name: EXTRACT_TOOL_NAME, method: 'functionCalling' })

  const system = buildSystemPrompt()
  return {
    name: `llm:${config.LLM_MODEL}`,
    async extract(chunk: Chunk): Promise<LlmExtractionLoose> {
      const out = await model.invoke([new SystemMessage(system), new HumanMessage(buildRelationExtractUserMessage(chunk))])
      // withStructuredOutput 已按 llmExtractionLooseSchema 解析过，这里只做类型收口
      return out as LlmExtractionLoose
    },
  }
}
