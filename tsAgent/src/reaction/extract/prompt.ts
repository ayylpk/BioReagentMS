// 试剂禁配/相容性安全知识 —— 抽取提示词（纯常量 + 纯拼装函数，无 IO）
//
// 与 schema 的分工（这份文件是"约束模型"的那一半，validate.ts 是"不信模型"的那一半）：
//   提示词负责**提高一次通过率**（少烧钱、少失败）；类型与校验负责**兜底正确性**。
//   所以提示词里的任何一条规则，在 validate.ts 里都必须有对应的确定性实现 ——
//   提示词是写给模型的，校验是写给自己的，两者不许互相替代。
import type { Chunk } from '../../rag/inspect/profile'

/**
 * 系统提示词（用户提供版本，逐字落地，不许增删改写）。
 *
 * 与结构化输出 schema 的取舍（为什么提示词里说"返回 JSON"而我们其实是 function-calling）：
 *   末尾第 8 条"只返回符合 schema 的 JSON"在 function-calling 模式下由框架转成"只填工具参数"，
 *   语义完全一致（都是"只出结构化结果、不许夹带解释"）。保留这句原文是因为它同时约束了
 *   "不解释、不总结"这一行为面 —— 删掉它，模型会开始在说明里补写它自己推断出来的结论。
 */
export const RELATION_EXTRACT_SYSTEM_PROMPT = `你是化学安全文档中的关系抽取器，只提取原文明确表达的关系。

禁止使用外部知识或化学常识补充信息。禁止推断原文未明确说明的兼容性、反应物、产物、CAS、危险等级。

允许关系：
- incompatible
- storage_separate
- hazardous_reaction
- conditionally_compatible

要求：
1. subject 和 object 必须能在原文中找到，或是文档标题明确标识的主体化学品。
2. CAS 只有在原文明确出现并能对应到实体时才能填写，否则为 null。
3. evidence_quote 必须逐字复制原文中的连续片段。
4. 原文只说"避免氧化剂"时，object_kind=category，object_name=氧化剂。
5. 原文有"在高温下""遇水时"等条件时，必须写入 conditions。
6. 原文没有明确关系时返回空数组。
7. "没有发现危险反应"不能抽取为 compatible。
8. 不解释、不总结，只返回符合 schema 的 JSON。`

/**
 * 危害取值词表（提示词附加段）。
 * 为什么必须显式给出：hazards 是**枚举**，不给词表模型就会自由写"腐蚀性/刺激性"这类词，
 * 结果全被 z.enum 拒掉（整条 relation 判 SCHEMA_INVALID），白烧一次调用。
 * 词表本身与 src/reaction/types.ts 的 HAZARDS 逐字一致（由测试断言，不由注释保证）。
 */
export const HAZARD_VOCABULARY = `hazards 只能从这个词表里选（原文没写到对应结果就不要填）：
- heat 放热（原文出现"放热/发热/放出大量热/产生热量"）
- fire 燃烧/着火
- explosion 爆炸
- toxic_gas 有毒气体/有毒烟雾
- flammable_gas 易燃气体
- pressure 压力/爆沸
- polymerization 聚合
- decomposition 分解
- other 其它（原文明确写了危害但不在上面任何一类）`

/** 关系取值的语义说明（附加段）。不给的话模型会把"分开存放"和"禁配"混着用。 */
export const RELATION_TYPE_NOTES = `relation_type 的判定口径：
- incompatible：原文说"混合/接触就危险"（剧烈反应、着火、爆炸、放出有毒气体）
- storage_separate：原文说"必须分开存放/隔离储存/不得同库存放"，但没描述混合后的后果
- hazardous_reaction：原文描述了具体反应（生成什么、分解什么、是否剧烈）
- conditionally_compatible：原文说"在某个条件下可以共存"——此时 conditions 必须有内容`

/**
 * 用户消息：把 chunk 原文整段交给模型。
 *
 * 为什么带上下文而不只喂 text：
 *   · section / headingPath 是**确定性**的位置信息（来自 chunker），能让模型分清"第 10 节说的"与
 *     "第 7 节说的"，否则同一文档里两节的关系会被混在一起；
 *   · 仍然只喂这一个 chunk 的 text —— 跨 chunk 拼素材就等于让模型做"跨段合并"，
 *     而证据连续性校验（evidence_quote 必须是本 chunk 连续子串）会当场把这些结果全拒掉。
 * 明确告知文档主体化学品，是为了落实提示词第 1 条（"或是文档标题明确标识的主体化学品"）：
 *   主体名会被 validate.ts 用**同一份 chunk.text**做 includes 校验，而 chunker 已把文档标题
 *   拼进锚（`标题（CAS xxx）｜分节路径`），所以这里给的名字本来就在原文里，不存在"放水"。
 */
export function buildRelationExtractUserMessage(chunk: Chunk): string {
  const where: string[] = []
  if (chunk.section) where.push(`分节：${chunk.section}`)
  if (chunk.headingPath.length) where.push(`标题路径：${chunk.headingPath.join(' > ')}`)
  const loc = where.length ? `\n【本文档位置】${where.join('　')}` : ''
  return `【待抽取的原文片段】（evidence_quote 只能是下面这段文字里的连续子串，不许改写、不许跨段拼接）
"""
${chunk.text}
"""
${loc}

请按 schema 输出 relations 数组；本片段没有明确关系时输出 {"relations": []}。`
}
