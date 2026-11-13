/**
 * 上下文编译器（README「上下文编译器」）：把规则、近期对话和检索事实
 * 排序、按类别分配预算、裁剪并组装成有界上下文，同时记录选择原因。
 */

import type { DlsConfig } from '../model/types';
import { renderFact } from '../model/facts';
import { estimateTokens } from './tokenizer';
import type { RetrieveInput, ScoredFact } from './retriever';
import { Retriever } from './retriever';

export interface SelectionRecord {
  fact_id: string;
  reason: string;
  tokens: number;
  score: number;
  category: string;
}

export interface CategoryUsage {
  used: number;
  budget: number;
}

export interface CompiledContext {
  /** 完整注入文本。 */
  text: string;
  /** 仅长期记忆块。 */
  memory_text: string;
  memory_tokens: number;
  context_tokens: number;
  memory_budget_tokens: number;
  max_input_tokens: number;
  within_budget: boolean;
  selected: SelectionRecord[];
  trimmed: SelectionRecord[];
  excluded: SelectionRecord[];
  categories: Record<string, CategoryUsage>;
}

export interface CompileInput extends RetrieveInput {
  recent_turns: string[];
  system_rules?: string[];
  task_constraints?: string[];
}

export class ContextCompiler {
  private readonly retriever: Retriever;

  constructor(
    private readonly config: DlsConfig,
    retriever: Retriever,
  ) {
    this.retriever = retriever;
  }

  compile(input: CompileInput): CompiledContext {
    const flags = this.config.ablation;
    const budget = this.config.context;

    const systemLines = (input.system_rules ?? []).map((line) => `- ${line}`);
    const systemText = systemLines.length
      ? `[系统规则与安全策略]\n${systemLines.join('\n')}\n`
      : '';
    const taskLines = [
      `[当前任务]\n${input.query}`,
      ...(input.task_constraints ?? []).map((line) => `- 约束: ${line}`),
    ].join('\n');
    const recent = input.recent_turns.slice(-budget.recent_turns);
    const recentText = recent.length
      ? `[近期对话]\n${recent.map((line) => `- ${line}`).join('\n')}\n`
      : '';
    const prefix = `${systemText}${taskLines}\n${recentText}`;

    const selected: SelectionRecord[] = [];
    const trimmed: SelectionRecord[] = [];
    const excluded: SelectionRecord[] = [];
    const categories: Record<string, CategoryUsage> = {};
    const usedPerCategory: Record<string, number> = {};
    const lines: string[] = [];
    let memoryTokens = 0;

    const candidates: ScoredFact[] = flags.context_compiler
      ? this.retriever.retrieve(input)
      : this.unboundedCandidates(input);

    for (const entry of candidates) {
      const line = `- ${renderFact(entry.fact, budget.require_provenance)}`;
      const tokens = estimateTokens(line) + 1;
      const record: SelectionRecord = {
        fact_id: entry.fact.id,
        reason: entry.reasons.join('; '),
        tokens,
        score: entry.score,
        category: entry.category,
      };

      if (flags.context_compiler) {
        const categoryBudget = budget.category_budgets?.[entry.category] ?? Number.POSITIVE_INFINITY;
        categories[entry.category] = { used: usedPerCategory[entry.category] ?? 0, budget: categoryBudget };
        if (!Number.isFinite(categoryBudget)) {
          categories[entry.category].budget = budget.memory_budget_tokens;
        }
        if ((usedPerCategory[entry.category] ?? 0) + tokens > categoryBudget) {
          record.reason = `类别 ${entry.category} 预算不足（上限 ${categoryBudget}）`;
          trimmed.push(record);
          continue;
        }
        if (memoryTokens + tokens > budget.memory_budget_tokens) {
          record.reason = `记忆总预算不足（上限 ${budget.memory_budget_tokens}）`;
          trimmed.push(record);
          continue;
        }
        if (selected.length >= budget.max_facts) {
          record.reason = `超过 max_facts=${budget.max_facts}`;
          excluded.push(record);
          continue;
        }
        if (budget.require_provenance && !entry.fact.source.event_id) {
          record.reason = '缺少来源引用（require_provenance）';
          excluded.push(record);
          continue;
        }
        usedPerCategory[entry.category] = (usedPerCategory[entry.category] ?? 0) + tokens;
        categories[entry.category].used = usedPerCategory[entry.category];
      }

      memoryTokens += tokens;
      lines.push(line);
      selected.push(record);
    }

    const memoryText = lines.length ? `[长期记忆]\n${lines.join('\n')}\n` : '';
    const text = `${prefix}${memoryText}`;
    const contextTokens = estimateTokens(text);
    return {
      text,
      memory_text: memoryText,
      memory_tokens: memoryTokens,
      context_tokens: contextTokens,
      memory_budget_tokens: budget.memory_budget_tokens,
      max_input_tokens: budget.max_input_tokens,
      within_budget:
        flags.context_compiler &&
        memoryTokens <= budget.memory_budget_tokens &&
        contextTokens <= budget.max_input_tokens,
      selected,
      trimmed,
      excluded,
      categories,
    };
  }

  /** 消融路径：关闭编译器时不排序、不裁剪、不设预算，全量注入。 */
  private unboundedCandidates(input: CompileInput): ScoredFact[] {
    const facts = this.retriever.rawAll(input);
    return facts.map((fact) => ({
      fact,
      score: 0,
      category: 'unbounded',
      reasons: ['未启用上下文编译器：全量注入'],
      hops: 0,
    }));
  }
}

/** 供 dsh 插件与评测共用的一次编译结果摘要（日志友好）。 */
export function describeSelection(context: CompiledContext): string {
  return [
    `selected=${context.selected.length}`,
    `trimmed=${context.trimmed.length}`,
    `excluded=${context.excluded.length}`,
    `memory_tokens=${context.memory_tokens}/${context.memory_budget_tokens}`,
    `context_tokens=${context.context_tokens}/${context.max_input_tokens}`,
    `within_budget=${context.within_budget}`,
  ].join(' ');
}
