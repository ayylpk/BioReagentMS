// ═══ 主图装配（这里开始就是你的地盘）═══
// 推荐骨架：createReactAgent(模型 + 三工具 + SYSTEM_PROMPT)
//   import { createReactAgent } from '@langchain/langgraph/prebuilt'
//   import { ChatOpenAI } from '@langchain/openai'   // OpenAI 兼容口，DeepSeek/DashScope 都走它
//
// 并发要点（这次改造的目的之一）：
//   ① 图内并发：三路检索用并行分支 / Send API 同时打 MySQL+Qdrant+Tavily 再汇总
//   ② 会话并发：Node 事件循环全异步，多用户流式互不阻塞
//      （对照 py 老版：main.py 拿 threading 把 uvicorn 塞守护线程，丑且脆）
import { StateGraph, START, END, Annotation, messagesStateReducer, MemorySaver, Graph, type GraphNode } from '@langchain/langgraph'
import { AIMessage, BaseMessage, HumanMessage, SystemMessage } from '@langchain/core/messages'
import { messageToOpenAIRole, ChatOpenAI } from '@langchain/openai'
import { z } from 'zod'
import { config } from '../config/env'
import { searchDoc, type Retrieved } from '../rag/embed/ollama'
import { searchSparse } from '../rag/sparse/bm25'

// ── 会话层：短期记忆窗口 / 多用户线程键 ──
const MEMORY_WINDOW = 20 // 短期记忆只留最近 20 条（≈10 轮问答），谁再往里塞都当场截

/** 会话标识：当前时间 + 4 位随机数字 —— 前端开聊时生成一次，之后每条消息带上它
 *  ⚠️ 走 langgraph server 时它的 thread_id 要求 UUID，接线日二选一：
 *     要么前端直接收 server 分配的 thread UUID，要么我们自己存 会话键→thread UUID 映射 */
export function newThreadId(): string {
	const rand = String(Math.floor(Math.random() * 10000)).padStart(4, '0')
	return `${Date.now()}${rand}`
}

/** 组装 invoke/stream 的 config：按 thread_id 隔离多用户上下文 */
export function ragConfig(threadId: string) {
	return { configurable: { thread_id: threadId } }
}


const AgentState = Annotation.Root({
	messages: Annotation<BaseMessage[]>({
		default: ()=>[],
		// 维护职责在这：先走 langgraph 官方 append 语义（按 id 去重/合并），再切窗口
		// 不截 = channel 无界增长，每步 checkpoint 全量写盘越来越肥，最后爆的是存档不是 prompt
		reducer: (x, y) => messagesStateReducer(x, y).slice(-MEMORY_WINDOW),
	}),
	question: Annotation<string>({
		default: ()=>"",
		reducer: (x,y)=>y,
	}),
	RAGcontents:Annotation<string[]>({
		default: ()=>[],
		reducer: (x,y)=>y,
	}),
	querys: Annotation<string[]>({
		default: ()=>[],
		reducer: (x,y)=>y,
	}),
	llmCalls: Annotation<number>({
        default: () => 0,
        reducer: (x, y) => x + y,
    }),
});

// ══ 节点：getQuerys —— question 改写为 RAG 检索查询 ══
// 模型在这里只是"单次函数调用"（输入问题→输出查询数组），无循环无工具，不是 agent 行为

// 结构化输出：直接吐 { querys: string[] }，不用手写 JSON 解析（deepseek 支持 tools；
// 若换的中转站不支持 tool call，withStructuredOutput 第二参加 { method: 'jsonMode' as any } 降级）
const queryRewriter = new ChatOpenAI({
	model: config.LLM_MODEL,
	apiKey: config.LLM_API_KEY,
	configuration: { baseURL: config.LLM_BASE_URL },
}).withStructuredOutput(
	z.object({
		querys: z
			.array(z.string().min(1))
			.min(1)
			.max(3)
			.describe('1~3 条给向量检索用的查询语句'),
	}),
	{ name: 'rag_querys' },
)

const QUERY_REWRITE_PROMPT = `你是试剂库 RAG 的查询改写模块，把用户问题转成向量库的检索查询。只做改写，不回答问题。
规则：
1. 去掉口语成分（礼貌语/假设语气/称呼），只留核心实体+意图
2. 化学品名、CAS 号、规格数字原样保留，不要把俗称改成学名
3. 术语靠拢 SDS 分节用词，例如"着火了怎么办"→"火灾应对措施"，"洒了"→"泄漏应急处理"，"能不能放一起"→"储存条件 禁配物"
4. 产出 1~3 条互补查询（原问题改写版 + 同义术语版），措辞彼此有差异以扩大召回`

const getQuerys: GraphNode<typeof AgentState.State> = async (state) => {
	const question = state.question.trim()
	if (!question) return { querys: [], llmCalls: 0 }

	try {
		const { querys } = await queryRewriter.invoke([
			new SystemMessage(QUERY_REWRITE_PROMPT),
			new HumanMessage(question),
		])
		// 兜底清洗：模型偶尔吐空白串
		const cleaned = querys.map((q) => q.trim()).filter(Boolean)
		return { querys: cleaned.length ? cleaned : [question], llmCalls: 1 }
	} catch (e) {
		// 旁路化降级：改写服务挂了不杀对话，拿原问题直检（召回差一点，但链路活着）
		console.warn('[getQuerys] 改写失败，降级为原问题查询:', (e as Error).message)
		return { querys: [question], llmCalls: 1 }
	}
}

// ══ 节点：ragNode —— 每条查询 稠密(searchDoc) + 稀疏(searchSparse) 双路并发 → RRF(k=60) 融合 ══
// 检索编排收口在这一层：embed/ 只管稠密、sparse/ 只管稀疏，本节点是唯一同时碰两路的地方
const RRF_K = 60        // 论文正统常数：平滑头名差距，防止单路把榜首包场
const ROUTE_LIMIT = 10  // 每路各捞几条（RRF 吃的是名次，给后面的人留点候选）

const ragNode: GraphNode<typeof AgentState.State> = async (state) => {
	const querys = state.querys.filter(q => q.trim())
	if (!querys.length) return { RAGcontents: [] }

	// ① 2N 路同时发：每条查询 ×（稠密路 + 稀疏路）；一路挂只丢一路，其余照要
	const routes = await Promise.all(
		querys.flatMap(q => [
			searchDoc(q, ROUTE_LIMIT).catch(e => {
				console.warn('[ragNode] 稠密路失败，忽略:', (e as Error).message)
				return [] as Retrieved[]
			}),
			searchSparse(q, ROUTE_LIMIT).catch(e => {
				console.warn('[ragNode] 稀疏路失败，忽略:', (e as Error).message)
				return [] as Retrieved[]
			}),
		]),
	)

	// ② RRF：score(text) = Σ 各路 1/(k + 名次) —— 只用名次不用分数（余弦和 BM25×IDF 量纲本就不通）
	//    searchDoc/searchSparse 返回即按名次排好，rank = index + 1；两函数不回传 id，用 text 原文当合并键
	const rrf = new Map<string, number>()
	const itemOf = new Map<string, Retrieved>()
	for (const list of routes)
		for (let i = 0; i < list.length; i++) {
			const hit = list[i]!
			rrf.set(hit.text, (rrf.get(hit.text) ?? 0) + 1 / (RRF_K + i + 1))
			if (!itemOf.has(hit.text)) itemOf.set(hit.text, hit)
		}

	// ③ 融合分降序取 top8，分节/出处拼成语境锚喂下游生成
	const RAGcontents = [...rrf.entries()]
		.sort((a, b) => b[1] - a[1])
		.slice(0, 3)
		.map(([text]) => {
			const item = itemOf.get(text)!
			return `【${(item.section as string) ?? '未分节'}｜${(item.source_doc as string) ?? '?'}】${text}`
		})
	return { RAGcontents }
}

// ══ 节点：getResult —— question + 检索素材 → 生成回答（链尾，答案写进 messages）══
const answerModel = new ChatOpenAI({
	model: config.LLM_MODEL,
	apiKey: config.LLM_API_KEY,
	configuration: { baseURL: config.LLM_BASE_URL },
})

const ANSWER_PROMPT = `你是实验室试剂管理助手，依据下方"检索素材"回答用户问题。
规则：
1. 只依据素材作答；闪点、浓度、禁配物、急救步骤这类安全数据严禁用模型常识编造或补全
2. 引用素材时点名出处，如"据《硫酸SDS·消防措施》"
3. 素材为空或与问题相关性不足：直说"本地试剂库未检索到相关内容"，建议换关键词重试或查阅纸质 SDS，不要硬答
4. 中文、简洁，关键安全信息用列表`

const getResult: GraphNode<typeof AgentState.State> = async (state) => {
	const ragContents = state.RAGcontents
	const querys = state.querys
	const question = state.question

	// 素材截断：8 条 chunk 不控字数会撑爆上下文，切 6000 字符封顶
	const material = ragContents.length
		? ragContents.join('\n---\n').slice(0, 6000)
		: '(本轮未检索到任何素材)'

	try {
		const res = await answerModel.invoke([
			new SystemMessage(
				`${ANSWER_PROMPT}\n\n## 检索素材（RRF 融合排序 top${ragContents.length}，【分节｜出处】为锚）\n${material}` +
				`\n\n## 本轮实际使用的检索查询\n${querys.join(' / ') || '(无)'} —— 仅供你判断检索角度是否跑偏，不必复述`,
			),
			// 短期记忆：把窗口内历史对话原样带上（messages channel 已被 reducer 截到 20 条）
			// 多轮指代（"刚才那个酸"）全靠这一行接住
			...state.messages,
			new HumanMessage(question),
		])
		return { messages: [res], llmCalls: 1 }
	} catch (e) {
		// 链尾也旁路化：生成挂了至少回一句人话，不给前端留黑洞
		console.warn('[getResult] 回答生成失败:', (e as Error).message)
		return {
			messages: [new AIMessage(`回答生成失败：${(e as Error).message.slice(0, 100)}（检查 LLM 服务后重试）`)],
			llmCalls: 1,
		}
	}
}

// ══ 主图装配：START → getQuerys（改写查询）→ rag（双路检索+RRF）→ result（生成回答）→ END ══
// checkpointer 两幅面孔：
//   ▸ 生产 `bun run dev`（langgraph server）→ 服务端自带磁盘存档（.langgraph_api/）+ thread 管理，
//     多用户持久化归它管，我们这个注入只在下面这种场景生效
//   ▸ 脚本直调 graph.invoke（现在的冒烟路）→ MemorySaver 内存档：窗口/线程隔离语义一致，但重启不留存
//     （想用磁盘版 bun 直调：node 跑 or 等 bun 修 better-sqlite3，包已装着没删）
export const checkpointer = new MemorySaver()

export const graph = new StateGraph(AgentState)
	.addNode("getQuerys",getQuerys)
	.addNode("rag",ragNode)
	.addNode("result",getResult)
	.addEdge(START,"getQuerys")
	.addEdge("getQuerys","rag")
	.addEdge("rag","result")
	.addEdge("result",END)
	.compile({ checkpointer });
