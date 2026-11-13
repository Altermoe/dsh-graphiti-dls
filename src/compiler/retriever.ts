/**
 * 检索器：根据当前任务与作用域检索相关事实，控制邻居扩展深度与返回规模。
 *
 * 排序信号（README「上下文编译器」步骤 3）：相关性、时效性、来源可信程度、
 * 任务重要性与冲突状态。source_ranking 关闭时去掉信任/冲突权重，用于消融。
 */

import type { DlsConfig, FactScope, MemoryFact, TrustLevel } from '../model/types';
import { factCategory } from '../model/facts';
import type { GraphitiPort } from '../store/port';
import { relevanceScore } from '../store/memory-store';

export interface ScoredFact {
  fact: MemoryFact;
  score: number;
  category: string;
  reasons: string[];
  hops: number;
}

export interface RetrieveInput {
  scope: FactScope;
  query: string;
  at?: string;
  known_at?: string;
}

const TRUST_WEIGHT: Record<TrustLevel, number> = {
  system_asserted: 5,
  tool_verified: 4,
  user_asserted: 3,
  model_inferred: 1,
  untrusted_external: 0,
};

/** 评测固定时钟：所有数据集使用同一时间基准，保证时效性打分可复现。 */
export const REFERENCE_NOW = Date.parse('2026-11-13T00:00:00Z');

export class Retriever {
  constructor(
    private readonly store: GraphitiPort,
    private readonly config: DlsConfig,
  ) {}

  retrieve(input: RetrieveInput): ScoredFact[] {
    const flags = this.config.ablation;
    const budget = this.config.context;
    const raw = this.store.query({
      scope: input.scope,
      text: input.query,
      at: input.at,
      known_at: input.known_at,
      isolation: flags.scope_isolation,
      bitemporal: flags.bitemporal,
      limit: budget.max_facts * 2,
    });

    const scored = new Map<string, ScoredFact>();
    for (const fact of raw) {
      const reasons: string[] = [];
      let score = relevanceScore(fact, input.query) * 10;
      reasons.push(`相关性=${score.toFixed(1)}`);

      if (flags.source_ranking) {
        const trust = TRUST_WEIGHT[fact.trust_level] ?? 0;
        score += trust;
        reasons.push(`信任=${trust}`);
        if (fact.status === 'invalidated') {
          score -= 6;
          reasons.push('已失效=-6');
        }
        if (fact.status === 'pending') {
          score -= 4;
          reasons.push('待确认=-4');
        }
      }
      if (flags.bitemporal && fact.recorded_time.from) {
        // 时效性：越晚记录越新，归一化到 0~2 的小幅加权。
        const ageDays = Math.max(0, (REFERENCE_NOW - Date.parse(fact.recorded_time.from)) / 86_400_000);
        const recency = Math.max(0, 2 - ageDays / 180);
        score += recency;
        reasons.push(`时效=${recency.toFixed(2)}`);
      }
      scored.set(fact.id, {
        fact,
        score,
        category: factCategory(fact.predicate),
        reasons,
        hops: 0,
      });
    }

    // 时态回溯查询保持纯时态视图，不做邻居扩展：否则「后来才知道的修订」
    // 会被带进历史状态，造成未来信息泄漏。
    if (input.at) return [...scored.values()].sort((a, b) => b.score - a.score);

    // 受控邻居扩展：沿 supersedes / derived_from 追踪纠错链，最多 max_graph_hops 跳。
    // 已失效 / 已删除的记录只能通过审计接口查看，绝不重新注入模型上下文
    // （README 威胁表「旧事实复活」）。
    const all = this.store.all();
    const byId = new Map(all.map((fact) => [fact.id, fact]));
    for (let hop = 1; hop <= budget.max_graph_hops; hop += 1) {
      const frontier = [...scored.values()].filter((entry) => entry.hops === hop - 1);
      const additions: ScoredFact[] = [];
      for (const entry of frontier) {
        const neighbours = [
          ...entry.fact.supersedes,
          ...entry.fact.derived_from,
          ...all
            .filter((fact) => fact.supersedes.includes(entry.fact.id))
            .map((fact) => fact.id),
        ];
        for (const neighbourId of neighbours) {
          if (scored.has(neighbourId)) continue;
          const neighbour = byId.get(neighbourId);
          if (!neighbour || neighbour.status !== 'accepted') continue;
          additions.push({
            fact: neighbour,
            score: entry.score * 0.3,
            category: factCategory(neighbour.predicate),
            reasons: [`纠错链邻居(${hop}跳)`],
            hops: hop,
          });
        }
      }
      for (const addition of additions) {
        if (!scored.has(addition.fact.id)) scored.set(addition.fact.id, addition);
      }
    }

    return [...scored.values()].sort((a, b) => b.score - a.score);
  }

  /** 消融路径：关闭上下文编译器时取「当前可见的全部事实」，不做检索与预算。 */
  rawAll(input: RetrieveInput): MemoryFact[] {
    return this.store.query({
      scope: input.scope,
      isolation: this.config.ablation.scope_isolation,
      bitemporal: false,
      include_invalidated: true,
      include_pending: true,
      limit: 100_000,
    });
  }
}
