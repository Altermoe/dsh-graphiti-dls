/**
 * 事实规范化、作用域隔离、双时态判定与冲突分类。
 *
 * 双时态（README「双时态的使用原则」）：
 * - valid_time：事实在现实/剧情语境中何时成立。
 * - recorded_time：系统何时记录、修正或使该记录失效。
 * 两者分别过滤，互不替代。
 */

import type {
  CandidateFact,
  EntityRef,
  FactScope,
  MemoryFact,
  TimeRange,
  TrustLevel,
} from './types';
import { objectId, objectLabel } from './types';

const OPEN_RANGE: TimeRange = { from: null, to: null };

export function scopeKey(scope: FactScope): string {
  return [
    scope.user_id,
    scope.project_id ?? '*',
    scope.session_id ?? '*',
    scope.agent_id ?? '*',
    scope.scene ?? '*',
  ].join('/');
}

/** 冲突判定键：相同主体 + 相同关系 + 相同作用域。 */
export function factKey(value: {
  subject: EntityRef;
  predicate: string;
  scope: FactScope;
}): string {
  return `${value.subject.id}|${value.predicate}|${scopeKey(value.scope)}`;
}

/**
 * 查询作用域是否允许读取该事实。
 * user_id 永远强制隔离；project/session 在查询侧指定时要求精确匹配。
 * isolation=false 用于消融实验（故意放开，量化隔离组件的贡献）。
 */
export function scopeAllows(
  query: FactScope,
  fact: FactScope,
  isolation: boolean,
): boolean {
  if (!isolation) return true;
  if (query.user_id !== fact.user_id) return false;
  if (query.project_id && fact.project_id && query.project_id !== fact.project_id) return false;
  if (query.session_id && fact.session_id && query.session_id !== fact.session_id) return false;
  if (query.agent_id && fact.agent_id && query.agent_id !== fact.agent_id) return false;
  if (query.scene && fact.scene && query.scene !== fact.scene) return false;
  return true;
}

function lowerBound(value: string | null): string {
  return value ?? '';
}

function upperBound(value: string | null): string {
  return value ?? '\uffff';
}

export function isEffectiveAt(
  fact: MemoryFact,
  at?: string,
  knownAt?: string,
  bitemporal = true,
): boolean {
  if (fact.status !== 'accepted') return false;
  if (!bitemporal) return true;
  if (at) {
    if (at < lowerBound(fact.valid_time.from)) return false;
    if (at >= upperBound(fact.valid_time.to)) return false;
  }
  if (knownAt) {
    if (knownAt < lowerBound(fact.recorded_time.from)) return false;
    if (knownAt >= upperBound(fact.recorded_time.to)) return false;
  }
  return true;
}

export function trustFromSource(type: CandidateFact['source']['type']): TrustLevel {
  switch (type) {
    case 'user_statement':
      return 'user_asserted';
    case 'authorized_tool':
      return 'tool_verified';
    case 'external_content':
      return 'untrusted_external';
    case 'model_inference':
      return 'model_inferred';
    case 'system_confirmed':
      return 'system_asserted';
  }
}

/** 把候选事实投影成可持久化的逻辑事实；此时尚未决定是否写入。 */
export function toMemoryFact(
  candidate: CandidateFact,
  options: {
    now: string;
    defaultScope: FactScope;
    status: MemoryFact['status'];
    bitemporal: boolean;
    supersedes?: string[];
  },
): MemoryFact {
  const scope: FactScope = { ...options.defaultScope, ...candidate.scope };
  const valid: TimeRange = options.bitemporal
    ? {
        from: candidate.valid_time?.from ?? null,
        to: candidate.valid_time?.to ?? null,
      }
    : { ...OPEN_RANGE };
  return {
    id: `f:${candidate.id}`,
    subject: candidate.subject,
    predicate: candidate.predicate,
    object: candidate.object,
    scope,
    valid_time: valid,
    recorded_time: { from: options.now, to: null },
    source: { ...candidate.source },
    trust_level: candidate.trust_level ?? trustFromSource(candidate.source.type),
    status: options.status,
    confidence: candidate.confidence ?? 0.7,
    supersedes: options.supersedes ?? [],
    derived_from: [],
    created_at: options.now,
  };
}

export type ConflictKind = 'none' | 'duplicate' | 'supersede' | 'supplement' | 'contradiction';

/** 区分事实更新、补充、作用域差异和真正的矛盾（README 写入流程第 5 步）。 */
export function classifyConflict(
  candidate: CandidateFact,
  existing: MemoryFact,
  resolvedScope: FactScope,
): ConflictKind {
  if (factKey({ subject: candidate.subject, predicate: candidate.predicate, scope: resolvedScope }) !== factKey(existing)) {
    return 'none';
  }
  if (objectId(candidate.object) === objectId(existing.object)) return 'duplicate';

  const newFrom = candidate.valid_time?.from ?? null;
  const oldTo = existing.valid_time.to;
  const oldFrom = existing.valid_time.from;
  // 区间不重叠：是不同时间段成立的补充，不是矛盾。
  if (newFrom && oldTo && newFrom >= oldTo) return 'supplement';
  if (oldFrom && candidate.valid_time?.to && candidate.valid_time.to <= oldFrom) return 'supplement';
  // 新事实生效时间晚于旧事实：视为纠正 / 更新。
  if (newFrom && oldFrom && newFrom > oldFrom) return 'supersede';
  if (newFrom && !oldFrom) return 'supersede';
  return 'contradiction';
}

/** 渲染成模型可见的一行事实；附来源、信任、状态与时间标记。 */
export function renderFact(fact: MemoryFact, withProvenance = true): string {
  const head = `${fact.subject.label ?? fact.subject.id} ${fact.predicate} ${objectLabel(fact.object)}`;
  if (!withProvenance) return head;
  const valid = fact.valid_time.from ?? '未知';
  const until = fact.valid_time.to ?? '至今';
  return `${head} [来源:${fact.source.type} 信任:${fact.trust_level} 状态:${fact.status} 有效:${valid}~${until}]`;
}

export function factCategory(predicate: string): string {
  if (['prefers', 'dislikes', 'favorite_color', 'favorite_food', 'allergic_to', 'speaks_style'].includes(predicate)) {
    return 'stable_preference';
  }
  if (['works_on', 'uses_backend_language', 'member_of', 'world_rule', 'has_status'].includes(predicate)) {
    return 'project_state';
  }
  return 'task_facts';
}
