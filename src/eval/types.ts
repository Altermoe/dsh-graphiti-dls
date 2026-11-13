/**
 * 评测协议类型。
 *
 * 评测边界（重要）：为了让结果可离线复现、且不把「LLM 抽取/生成质量」
 * 混入指标，每个事件都带有预标注的候选事实（等价于一个固定的抽取器输出）。
 * 所有被测系统面对**相同的候选流**，差异只来自写入策略、时态/作用域语义、
 * 检索排序与上下文编译。因此本报告衡量的是「记忆生命周期 + 上下文编译层」，
 * 不是端到端生成质量；README 要求的端到端评测需另接真实模型。
 */

import type { CandidateFact, FactScope, SourceType } from '../model/types';

export type CaseCategory =
  | 'cross_session_recall'
  | 'state_update'
  | 'temporal_query'
  | 'disambiguation'
  | 'scope_conflict'
  | 'deletion'
  | 'injection_direct'
  | 'injection_indirect'
  | 'isolation'
  | 'stale_fact';

export interface EpisodeEvent {
  id: string;
  /** 系统记录时间。 */
  at: string;
  source: SourceType;
  /** 角色扮演语境下的原始话语（近期窗口 / 摘要基线会用到）。 */
  text: string;
  /** 固定抽取器输出的候选事实。 */
  facts: CandidateFact[];
  /** 删除/撤销指令：指向既有事实 id。 */
  deletion_of?: string;
}

export interface EpisodeQuery {
  text: string;
  /** answerer 用它定位主体（结构化字段，不解析自然语言）。 */
  subject: string;
  predicate?: string;
  scope: FactScope;
  at?: string;
  known_at?: string;
}

export interface EpisodeCase {
  id: string;
  category: CaseCategory;
  title: string;
  scope: FactScope;
  events: EpisodeEvent[];
  query: EpisodeQuery;
  expected: {
    answer_contains: string[];
    must_include_fact_ids: string[];
    must_exclude_fact_ids: string[];
    forbidden_answer_terms?: string[];
  };
  /** ground truth，系统不可见。 */
  labels: {
    bad_fact_ids: string[];
    attack_fact_ids?: string[];
  };
}

export interface RenderedFact {
  id: string;
  subject: string;
  predicate: string;
  object: string;
  /** 注入模型上下文的一行文本。 */
  line: string;
  untrusted?: boolean;
}

export interface SystemOutput {
  text: string;
  tokens: number;
  facts: RenderedFact[];
  answer: string;
  /** 可观测的攻击代理指标：注入内容被当成无标记指令面。 */
  tool_effects: string[];
  within_budget: boolean;
  trace: Record<string, unknown>;
}

export interface SystemSnapshot {
  /** 已持久化且可被后续推理使用的事实 id。 */
  persisted_fact_ids: string[];
  /** 被拒绝 / 待确认 / 已失效 / 已删除的事实 id。 */
  inactive_fact_ids: string[];
}

export interface MemorySystemUnderTest {
  id: string;
  label: string;
  kind: 'baseline' | 'market' | 'dls';
  source_note?: string;
  reset(): void;
  ingest(event: EpisodeEvent, scope: FactScope): void;
  compile(query: EpisodeQuery): SystemOutput;
  snapshot(): SystemSnapshot;
}

export interface CaseResult {
  system_id: string;
  case_id: string;
  category: CaseCategory;
  answer: string;
  answer_correct: boolean;
  recall_hits: number;
  recall_total: number;
  state_update_correct: boolean | null;
  temporal_correct: boolean | null;
  stale_misuse: boolean;
  bad_writes: number;
  bad_total: number;
  injection_persisted: boolean | null;
  attack_success: boolean | null;
  tokens: number;
  writes: number;
  latency_ms: number;
  within_budget: boolean;
}

export interface AggregateMetrics {
  system_id: string;
  label: string;
  kind: string;
  cases: number;
  /** 0~1，越高越好。 */
  fact_recall_accuracy: number;
  fact_recall_rate: number;
  state_update_precision: number;
  temporal_query_accuracy: number;
  /** 0~1，越低越好。 */
  stale_fact_misuse_rate: number;
  bad_memory_write_rate: number;
  injection_persistence_rate: number;
  attack_success_rate: number;
  avg_input_tokens: number;
  p50_latency_ms: number;
  p95_latency_ms: number;
  total_cost_usd: number;
  budget_compliance_rate: number;
}

export interface SuiteResult {
  suite: 'compare' | 'ablation';
  generated_at: string;
  dataset_size: number;
  systems: string[];
  results: CaseResult[];
  aggregates: AggregateMetrics[];
}
