// 试剂禁配/相容性安全知识 —— 状态机（**纯函数，无 IO**，可脱库单测）
// 两条轴各自独立演进，绝不互相改写：
//   审核维度 review_status / rule.status   —— 由人决定
//   来源维度 source_state                   —— 由文档摄取/删除决定
// 禁止的语义：来源失效不等于审核结论失效，审核通过也不等于来源还在。
import type {
  CandidateReviewStatus,
  CandidateSourceState,
  RuleSourceState,
  RuleStatus,
} from './types'
import { ReactionStateError } from './errors'

/** 候选审核：pending 是唯一入口，rejected/superseded 是终态（不许从终态悄悄改回 pending） */
export const CANDIDATE_REVIEW_TRANSITIONS: Readonly<Record<CandidateReviewStatus, readonly CandidateReviewStatus[]>> = {
  pending: ['approved', 'rejected'],
  approved: ['superseded'],
  rejected: [],
  superseded: [],
}

/** 候选来源：重摄标 stale；同一证据再次被抽到（同 candidate_key）可以回到 active —— 那是证据背书，不是猜的 */
export const CANDIDATE_SOURCE_TRANSITIONS: Readonly<Record<CandidateSourceState, readonly CandidateSourceState[]>> = {
  active: ['stale'],
  stale: ['active'],
}

/** 规则状态：superseded 是终态 */
export const RULE_STATUS_TRANSITIONS: Readonly<Record<RuleStatus, readonly RuleStatus[]>> = {
  active: ['superseded'],
  superseded: [],
}

/**
 * 规则来源：
 *   → source_stale   文档被重摄（chunk 可能漂移，证据未必还在原位）
 *   → source_missing 文档被删除
 * 回到 active 只允许"再次核对过来源确实还在"的显式动作（store.reconfirmRuleSource），
 * 绝不允许重摄流程自动把 source_stale 洗回 active。
 */
export const RULE_SOURCE_TRANSITIONS: Readonly<Record<RuleSourceState, readonly RuleSourceState[]>> = {
  active: ['source_stale', 'source_missing'],
  source_stale: ['source_missing', 'active'],
  source_missing: ['active'],
}

/** 自动来源降级允许的目标态：摄取/删除流程只许走这条窄路（active → 失效态），反向一律人工 */
export const RULE_SOURCE_AUTO_STATES: readonly RuleSourceState[] = ['source_stale', 'source_missing']

function assertIn(table: readonly string[], to: string, what: string): void {
  if (!table.includes(to)) throw new ReactionStateError(`${what} 非法状态转移`)
}

export function assertCandidateReviewTransition(from: CandidateReviewStatus, to: CandidateReviewStatus): void {
  assertIn(CANDIDATE_REVIEW_TRANSITIONS[from], to, `候选审核 ${from} → ${to}`)
}

export function assertCandidateSourceTransition(from: CandidateSourceState, to: CandidateSourceState): void {
  assertIn(CANDIDATE_SOURCE_TRANSITIONS[from], to, `候选来源 ${from} → ${to}`)
}

export function assertRuleStatusTransition(from: RuleStatus, to: RuleStatus): void {
  assertIn(RULE_STATUS_TRANSITIONS[from], to, `规则状态 ${from} → ${to}`)
}

export function assertRuleSourceTransition(from: RuleSourceState, to: RuleSourceState): void {
  assertIn(RULE_SOURCE_TRANSITIONS[from], to, `规则来源 ${from} → ${to}`)
}

/** 自动降级专用（摄取流程调用）：只允许把 active 打成失效态，回到 active 一律拒绝 */
export function assertRuleSourceAutoTransition(to: RuleSourceState): void {
  if (!RULE_SOURCE_AUTO_STATES.includes(to)) {
    throw new ReactionStateError(`规则来源自动降级不允许转到 ${to}：回到 active 只能走人工复核（reconfirmRuleSource）`)
  }
}

/**
 * 可审核通过的前提：来源必须还在。
 * 为什么卡这一条：证据所在 chunk 已被重摄/删除，人审看到的原文可能已经不在文档里了，
 * 此时通过等于把一条来源不明的结论写进正式规则表。
 */
export function assertApprovable(c: { reviewStatus: CandidateReviewStatus; sourceState: CandidateSourceState }): void {
  assertCandidateReviewTransition(c.reviewStatus, 'approved')
  if (c.sourceState !== 'active') {
    throw new ReactionStateError(`候选来源已失效（source_state=${c.sourceState}），不许审核通过`)
  }
}

/** 可发布规则的前提：候选已 approved 且来源仍在 */
export function assertPublishable(c: { reviewStatus: CandidateReviewStatus; sourceState: CandidateSourceState }): void {
  if (c.reviewStatus !== 'approved') throw new ReactionStateError(`候选未通过审核（review_status=${c.reviewStatus}），不许发布规则`)
  if (c.sourceState !== 'active') throw new ReactionStateError(`候选来源已失效（source_state=${c.sourceState}），不许发布规则`)
}

/** 规则当前是否可被无条件引用（status=active 且来源未被降级） */
export function isRuleTrusted(r: { status: RuleStatus; sourceState: RuleSourceState }): boolean {
  return r.status === 'active' && r.sourceState === 'active'
}
