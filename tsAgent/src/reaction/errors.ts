// 试剂禁配/相容性安全知识 —— 领域错误类型
// 单独放一个文件：keys.ts 与 lifecycle.ts 都要用，且都必须是纯模块（无 IO、无循环依赖）。
// 立场：这些错误一律**向上抛**，绝不被降级成空列表/跳过——"数据库/契约出错"与"没有记录"
// 在调用方必须是两个可分辨的结果（把前者当成后者，就是拿"安全"去回答一个未知问题）。
export class ReactionKeyError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ReactionKeyError'
  }
}

export class ReactionStateError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ReactionStateError'
  }
}
