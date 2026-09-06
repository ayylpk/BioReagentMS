// embed 门面：EMBED_BACKEND 一个环境变量选后端（ollama=本机免费 | dashscope=云端省内存）
// 分工线：本目录两个实现文件互不认识，组合只发生在这层 —— 与 store/upsert"组合只在入库层"同款姿势
import { config } from '../../config/env'
import { embed as embedOllama } from './ollama'
import { embed as embedDashscope } from './dashscope'

export type { Retrieved } from './ollama' // 返回形状仍借 ollama.ts 的定义（纯类型，无运行时依赖）

export async function embed(texts: string[]): Promise<number[][]> {
	return (config.EMBED_BACKEND === 'dashscope' ? embedDashscope : embedOllama)(texts)
}
