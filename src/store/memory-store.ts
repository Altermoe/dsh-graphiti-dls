/**
 * 零依赖的「等价双时态图谱」内存后端。
 *
 * 它不是 Graphiti 的替代品，而是 GraphitiPort 的参考实现：把 README 中
 * 定义的时态语义（valid_time / recorded_time / 失效 / 溯源）用纯内存结构
 * 表达出来，使评测无需外部图数据库与 LLM 即可复现。生产部署换用
 * GraphitiHttpAdapter 即可，上层不改。
 */

import type { FactQuery, FactStatus, MemoryFact } from '../model/types';
import { objectLabel } from '../model/types';
import { scopeAllows } from '../model/facts';
import type { GraphitiPort, StoreStats } from './port';

function tokens(text: string): string[] {
  // 保留 ':'，让 `npc:alice` 成为完整实体标识；
  // 否则所有 `npc:*` 都会因共享前缀 `npc` 被误判为相关。
  const latin = text.toLowerCase().match(/[a-z0-9_:]+/g) ?? [];
  const cjk = text.toLowerCase().match(/[\u4e00-\u9fff]/g) ?? [];
  return [...latin, ...cjk];
}

/** 确定性相关性打分：词重合 + 主体/谓语命中加权（向量检索的确定性替身）。 */
export function relevanceScore(fact: MemoryFact, text: string): number {
  if (!text.trim()) return 1;
  const needle = new Set(tokens(text));
  if (needle.size === 0) return 1;
  const haystack = tokens(
    `${fact.subject.label ?? fact.subject.id} ${fact.subject.id} ${fact.predicate} ${objectLabel(fact.object)}`,
  );
  let hits = 0;
  for (const token of new Set(haystack)) {
    if (needle.has(token)) hits += 1;
  }
  const subjectBonus = needle.has(fact.subject.id.toLowerCase()) ? 2 : 0;
  const predicateBonus = needle.has(fact.predicate.toLowerCase()) ? 1 : 0;
  return hits + subjectBonus + predicateBonus;
}

function timeOk(fact: MemoryFact, query: FactQuery, bitemporal: boolean): boolean {
  if (!bitemporal) return true;
  if (query.at) {
    if (query.at < (fact.valid_time.from ?? '')) return false;
    if (query.at >= (fact.valid_time.to ?? '\uffff')) return false;
  }
  if (query.known_at) {
    if (query.known_at < (fact.recorded_time.from ?? '')) return false;
    if (query.known_at >= (fact.recorded_time.to ?? '\uffff')) return false;
  }
  return true;
}

export class InMemoryBitemporalStore implements GraphitiPort {
  private readonly facts = new Map<string, MemoryFact>();
  private counters: StoreStats = { inserts: 0, updates: 0, deletes: 0 };

  insert(fact: MemoryFact): void {
    if (this.facts.has(fact.id)) {
      this.counters.updates += 1;
      this.facts.set(fact.id, { ...fact });
      return;
    }
    this.facts.set(fact.id, { ...fact });
    this.counters.inserts += 1;
  }

  update(id: string, patch: Partial<MemoryFact>): MemoryFact | undefined {
    const current = this.facts.get(id);
    if (!current) return undefined;
    const next: MemoryFact = { ...current, ...patch, id: current.id };
    this.facts.set(id, next);
    this.counters.updates += 1;
    return next;
  }

  get(id: string): MemoryFact | undefined {
    const fact = this.facts.get(id);
    return fact ? { ...fact } : undefined;
  }

  query(query: FactQuery): MemoryFact[] {
    const isolation = query.isolation ?? true;
    const bitemporal = query.bitemporal ?? true;
    const allowed: Set<FactStatus> = new Set(['accepted']);
    // 带现实时间点的回溯查询必须能看到「当时成立、后来被纠正」的记录：
    // 记录的失效（recorded_time.to）不抹去历史上有效的状态。
    if (query.include_invalidated || query.at) allowed.add('invalidated');
    if (query.include_pending) allowed.add('pending');

    const scored: Array<{ fact: MemoryFact; score: number }> = [];
    for (const fact of this.facts.values()) {
      if (!allowed.has(fact.status)) continue;
      if (!scopeAllows(query.scope, fact.scope, isolation)) continue;
      if (!timeOk(fact, query, bitemporal)) continue;
      if (query.predicates?.length && !query.predicates.includes(fact.predicate)) continue;
      const score = relevanceScore(fact, query.text ?? '');
      if ((query.text ?? '').trim() && score === 0 && !query.predicates?.length) continue;
      scored.push({ fact: { ...fact }, score });
    }
    scored.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return (b.fact.recorded_time.from ?? '').localeCompare(a.fact.recorded_time.from ?? '');
    });
    const limited = query.limit ? scored.slice(0, query.limit) : scored;
    return limited.map((entry) => entry.fact);
  }

  all(): MemoryFact[] {
    return [...this.facts.values()].map((fact) => ({ ...fact }));
  }

  stats(): StoreStats {
    return { ...this.counters };
  }

  reset(): void {
    this.facts.clear();
    this.counters = { inserts: 0, updates: 0, deletes: 0 };
  }
}
