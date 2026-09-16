// 离线单测：候选/规则的状态机与跨轴守卫（纯函数，不连库）
import { test, expect } from 'bun:test'
import {
  CANDIDATE_REVIEW_TRANSITIONS,
  RULE_SOURCE_AUTO_STATES,
  assertApprovable,
  assertCandidateReviewTransition,
  assertCandidateSourceTransition,
  assertPublishable,
  assertRuleSourceAutoTransition,
  assertRuleSourceTransition,
  assertRuleStatusTransition,
  isRuleTrusted,
} from './lifecycle'
import { ReactionStateError } from './errors'
import {
  CANDIDATE_REVIEW_STATUSES,
  CANDIDATE_SOURCE_STATES,
  RULE_SOURCE_STATES,
  RULE_STATUSES,
} from './types'

test('候选审核：pending 是唯一入口，rejected/superseded 是终态', () => {
  expect(() => assertCandidateReviewTransition('pending', 'approved')).not.toThrow()
  expect(() => assertCandidateReviewTransition('pending', 'rejected')).not.toThrow()
  expect(() => assertCandidateReviewTransition('approved', 'superseded')).not.toThrow()
  expect(() => assertCandidateReviewTransition('rejected', 'approved')).toThrow(ReactionStateError)
  expect(() => assertCandidateReviewTransition('superseded', 'pending')).toThrow(ReactionStateError)
  expect(() => assertCandidateReviewTransition('approved', 'pending')).toThrow(ReactionStateError)
})

test('候选来源：可 stale 可回 active（同证据再次被抽到 = 证据背书）', () => {
  expect(() => assertCandidateSourceTransition('active', 'stale')).not.toThrow()
  expect(() => assertCandidateSourceTransition('stale', 'active')).not.toThrow()
})

test('assertApprovable：来源已失效的候选一律不许通过（人审看到的原文可能已不在文档里）', () => {
  expect(() => assertApprovable({ reviewStatus: 'pending', sourceState: 'active' })).not.toThrow()
  expect(() => assertApprovable({ reviewStatus: 'pending', sourceState: 'stale' })).toThrow(ReactionStateError)
  expect(() => assertApprovable({ reviewStatus: 'rejected', sourceState: 'active' })).toThrow(ReactionStateError)
})

test('assertPublishable：必须 approved 且来源仍在', () => {
  expect(() => assertPublishable({ reviewStatus: 'approved', sourceState: 'active' })).not.toThrow()
  expect(() => assertPublishable({ reviewStatus: 'pending', sourceState: 'active' })).toThrow(ReactionStateError)
  expect(() => assertPublishable({ reviewStatus: 'approved', sourceState: 'stale' })).toThrow(ReactionStateError)
})

test('规则状态：active → superseded，反向与终态出边全禁', () => {
  expect(() => assertRuleStatusTransition('active', 'superseded')).not.toThrow()
  expect(() => assertRuleStatusTransition('superseded', 'active')).toThrow(ReactionStateError)
})

test('规则来源：失效态只能人工复核回 active；自动流程只许往下走', () => {
  expect(() => assertRuleSourceTransition('active', 'source_stale')).not.toThrow()
  expect(() => assertRuleSourceTransition('active', 'source_missing')).not.toThrow()
  expect(() => assertRuleSourceTransition('source_stale', 'source_missing')).not.toThrow()
  expect(() => assertRuleSourceTransition('source_stale', 'active')).not.toThrow() // 人工复核路径
  expect(() => assertRuleSourceAutoTransition('source_stale')).not.toThrow()
  expect(() => assertRuleSourceAutoTransition('source_missing')).not.toThrow()
  expect(() => assertRuleSourceAutoTransition('active')).toThrow(ReactionStateError) // 自动洗回 active = 禁止
  expect(RULE_SOURCE_AUTO_STATES).not.toContain('active')
})

test('isRuleTrusted：只有 active + 来源未降级才算可无条件引用', () => {
  expect(isRuleTrusted({ status: 'active', sourceState: 'active' })).toBe(true)
  expect(isRuleTrusted({ status: 'active', sourceState: 'source_stale' })).toBe(false)
  expect(isRuleTrusted({ status: 'active', sourceState: 'source_missing' })).toBe(false)
  expect(isRuleTrusted({ status: 'superseded', sourceState: 'active' })).toBe(false)
})

test('状态机完备性：状态枚举的每个取值都有转移定义（新增枚举值必须同步补齐）', () => {
  expect(Object.keys(CANDIDATE_REVIEW_TRANSITIONS).sort()).toEqual([...CANDIDATE_REVIEW_STATUSES].sort())
  for (const s of CANDIDATE_SOURCE_STATES) {
    expect(() => assertCandidateSourceTransition(s, s)).toThrow(ReactionStateError)
  }
  expect(RULE_STATUSES).toEqual(['active', 'superseded'])
  expect(RULE_SOURCE_STATES).toEqual(['active', 'source_stale', 'source_missing'])
})
