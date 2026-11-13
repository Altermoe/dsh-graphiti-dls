/** 把评测结果渲染成可提交的 Markdown 报告。 */

import type { AggregateMetrics, CaseCategory, SuiteResult } from './types';
import { COST_MODEL } from './metrics';

const CATEGORY_LABELS: Record<CaseCategory, string> = {
  cross_session_recall: '跨会话回忆',
  state_update: '决策变更',
  temporal_query: '时态查询',
  disambiguation: '同名消歧',
  scope_conflict: '作用域冲突',
  deletion: '删除与撤销',
  injection_direct: '直接注入',
  injection_indirect: '间接注入',
  isolation: '多用户隔离',
  stale_fact: '过期事实',
};

function pct(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function num(value: number, digits = 1): string {
  return value.toFixed(digits);
}

const METRIC_COLUMNS: Array<{ key: keyof AggregateMetrics; label: string; format: (v: number) => string }> = [
  { key: 'fact_recall_accuracy', label: '回忆准确率↑', format: pct },
  { key: 'fact_recall_rate', label: '事实召回率↑', format: pct },
  { key: 'state_update_precision', label: '状态更新↑', format: pct },
  { key: 'temporal_query_accuracy', label: '时态查询↑', format: pct },
  { key: 'stale_fact_misuse_rate', label: '过期误用↓', format: pct },
  { key: 'bad_memory_write_rate', label: '错误写入↓', format: pct },
  { key: 'injection_persistence_rate', label: '注入持久化↓', format: pct },
  { key: 'attack_success_rate', label: '攻击成功率↓', format: pct },
];

export function renderMainTable(result: SuiteResult): string {
  const header = `| 系统 | ${METRIC_COLUMNS.map((c) => c.label).join(' | ')} | 平均Token | 预算合规 | P50/P95(ms) | 成本(USD) |`;
  const divider = `|---|${METRIC_COLUMNS.map(() => '---').join('|')}|---|---|---|---|`;
  const rows = result.aggregates.map((row) => {
    const cells = METRIC_COLUMNS.map((column) => column.format(row[column.key] as number)).join(' | ');
    return `| ${row.label} | ${cells} | ${num(row.avg_input_tokens, 0)} | ${pct(row.budget_compliance_rate)} | ${num(row.p50_latency_ms, 2)} / ${num(row.p95_latency_ms, 2)} | ${row.total_cost_usd.toFixed(6)} |`;
  });
  return [header, divider, ...rows].join('\n');
}

/** 高负载子集：40 条无关记忆下的平均注入量，最能体现上下文编译器的预算价值。 */
export function renderHighLoadTable(result: SuiteResult): string {
  const rows = result.aggregates.map((row) => {
    const subset = result.results.filter(
      (item) => item.system_id === row.system_id && item.category === 'cross_session_recall',
    );
    const avg = subset.length
      ? subset.reduce((sum, item) => sum + item.tokens, 0) / subset.length
      : 0;
    return { label: row.label, avg, id: row.system_id };
  });
  const baseline = rows.find((row) => row.id === 'dls:full')?.avg ?? 0;
  return [
    '| 系统 | 平均输入 Token | 相对 DLS 全量 |',
    '|---|---|---|',
    ...rows.map(
      (row) =>
        `| ${row.label} | ${num(row.avg, 0)} | ${baseline ? `${(row.avg / baseline).toFixed(2)}×` : '-'} |`,
    ),
  ].join('\n');
}

export function renderCategoryTable(result: SuiteResult): string {
  const categories = Object.keys(CATEGORY_LABELS) as CaseCategory[];
  const header = `| 系统 | ${categories.map((c) => CATEGORY_LABELS[c]).join(' | ')} |`;
  const divider = `|---|${categories.map(() => '---').join('|')}|`;
  const rows = result.aggregates.map((row) => {
    const own = result.results.filter((item) => item.system_id === row.system_id);
    const cells = categories
      .map((category) => {
        const subset = own.filter((item) => item.category === category);
        return subset.length ? pct(subset.filter((item) => item.answer_correct).length / subset.length) : '-';
      })
      .join(' | ');
    return `| ${row.label} | ${cells} |`;
  });
  return [header, divider, ...rows].join('\n');
}

/** 消融：以 dls:full 为基准，列出每个变体的关键指标变化（百分点）。 */
export function renderAblationTable(result: SuiteResult): string {
  const baseline = result.aggregates.find((row) => row.system_id === 'dls:full');
  if (!baseline) return '未找到 DLS 全量基准。';
  const keys: Array<{ key: keyof AggregateMetrics; label: string; higherBetter: boolean }> = [
    { key: 'fact_recall_accuracy', label: '回忆准确率', higherBetter: true },
    { key: 'fact_recall_rate', label: '事实召回率', higherBetter: true },
    { key: 'state_update_precision', label: '状态更新', higherBetter: true },
    { key: 'temporal_query_accuracy', label: '时态查询', higherBetter: true },
    { key: 'stale_fact_misuse_rate', label: '过期误用', higherBetter: false },
    { key: 'bad_memory_write_rate', label: '错误写入', higherBetter: false },
    { key: 'attack_success_rate', label: '攻击成功率', higherBetter: false },
    { key: 'avg_input_tokens', label: '平均Token', higherBetter: false },
  ];
  const header = `| 消融变体 | ${keys.map((k) => k.label).join(' | ')} | 主要受损能力 |`;
  const divider = `|---|${keys.map(() => '---').join('|')}|---|`;
  const rows = result.aggregates
    .filter((row) => row.system_id !== 'dls:full')
    .map((row) => {
      const cells = keys
        .map((entry) => {
          const base = baseline[entry.key] as number;
          const value = row[entry.key] as number;
          if (entry.key === 'avg_input_tokens') {
            const delta = value - base;
            return `${delta >= 0 ? '+' : ''}${num(delta, 0)}`;
          }
          const delta = (value - base) * 100;
          return `${delta >= 0 ? '+' : ''}${delta.toFixed(1)}pp`;
        })
        .join(' | ');
      const worst = keys
        .filter((entry) => entry.key !== 'avg_input_tokens')
        .map((entry) => {
          const base = baseline[entry.key] as number;
          const value = row[entry.key] as number;
          const signed = entry.higherBetter ? value - base : base - value;
          return { label: entry.label, loss: -signed };
        })
        .sort((a, b) => b.loss - a.loss)[0];
      return `| ${row.label} | ${cells} | ${worst && worst.loss > 0 ? worst.label : '无明显退化'} |`;
    });
  return [header, divider, ...rows].join('\n');
}

export function renderReport(result: SuiteResult, extra: {
  datasetSummary: Record<string, number>;
  systemNotes: Array<{ label: string; note: string }>;
}): string {
  const isCompare = result.suite === 'compare';
  const lines: string[] = [
    `# ${isCompare ? '对比实验' : '消融实验'}结果`,
    '',
    `- 生成时间：${result.generated_at}`,
    `- 评测集：${result.dataset_size} 个 case，${Object.keys(extra.datasetSummary).length} 类场景`,
    `- 被测系统：${result.systems.length} 个`,
    `- 成本模型：输入 $${COST_MODEL.inputUsdPer1KTokens}/1K tokens，写入 $${COST_MODEL.writeUsdPerFact}/事实（示例参数，仅用于相对比较）`,
    '',
    '## 数据集构成',
    '',
    '| 场景 | case 数 |',
    '|---|---|',
    ...Object.entries(extra.datasetSummary).map(
      ([key, count]) => `| ${CATEGORY_LABELS[key as CaseCategory] ?? key} | ${count} |`,
    ),
    '',
    '## 核心指标',
    '',
    renderMainTable(result),
    '',
    '↑ 越高越好，↓ 越低越好。「攻击成功率」为代理指标：攻击内容进入模型可见上下文且未被标记为不可信。',
    '',
    '## 高负载子集（跨会话回忆，40 条无关记忆）',
    '',
    renderHighLoadTable(result),
    '',
    '## 分场景回忆准确率',
    '',
    renderCategoryTable(result),
    '',
  ];

  if (!isCompare) {
    lines.push('## 消融：相对 DLS 全量的变化', '', renderAblationTable(result), '');
  }

  lines.push(
    '## 被测系统与来源',
    '',
    ...extra.systemNotes.map((item) => `- **${item.label}**：${item.note}`),
    '',
    '## 评测边界',
    '',
    '- 所有系统面对相同的**预标注候选事实流**（等价于固定抽取器），因此衡量的是写入策略、时态/作用域语义、检索排序与上下文编译，不含 LLM 抽取质量与端到端生成质量。',
    '- 答案由统一的确定性 answerer 从「进入上下文的结构化事实」投影得到，避免生成模型差异污染对比。',
    '- 社区插件为基于 dshmarket 官方目录描述的**机制等价适配器**，非插件二进制直跑；下载量取自 npm last-week 公开接口。',
    '- Token 为确定性近似估算（CJK 1 token/字，其余 4 字符/token）；延迟为进程内 ingest+compile 耗时，不含网络与模型推理。',
    '- 真实攻击成功率需在端到端工具执行环境验证；本报告的指标只覆盖「持久化与进入推理面」。',
    '',
  );
  return lines.join('\n');
}
