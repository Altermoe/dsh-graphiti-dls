/** 评测 CLI：导出数据集、运行对比/消融实验、写出 JSON 与 Markdown 报告。 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildDataset, datasetSummary } from './dataset';
import { BASELINE_NOTES, buildAblationSystems, buildCompareSystems } from './systems';
import { runSuite } from './runner';
import { renderReport } from './report';
import type { MemorySystemUnderTest, SuiteResult } from './types';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));

function write(relative: string, content: string): void {
  const path = `${ROOT}${relative}`;
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content, 'utf8');
}

function systemNotes(systems: MemorySystemUnderTest[]): Array<{ label: string; note: string }> {
  return systems.map((system) => ({
    label: system.label,
    note:
      system.source_note ??
      BASELINE_NOTES[system.id] ??
      (system.kind === 'dls'
        ? '本项目实现：Graphiti 适配层 + 受控写入 + 双时态 + 上下文编译'
        : '—'),
  }));
}

function runSuiteAndWrite(
  suite: 'compare' | 'ablation',
  systems: MemorySystemUnderTest[],
  cases: ReturnType<typeof buildDataset>,
): SuiteResult {
  const result = runSuite(suite, systems, cases);
  write(`eval/results/${suite}.json`, `${JSON.stringify(result, null, 2)}\n`);
  write(
    `eval/results/${suite}.md`,
    renderReport(result, { datasetSummary: datasetSummary(cases), systemNotes: systemNotes(systems) }),
  );
  return result;
}

function printSummary(result: SuiteResult): void {
  console.log(`\n=== ${result.suite}: ${result.systems.length} systems × ${result.dataset_size} cases ===`);
  console.log(
    ['system', 'acc', 'recall', 'state', 'temporal', 'stale↓', 'bad↓', 'attack↓', 'tok', 'cost'].join('\t'),
  );
  for (const row of result.aggregates) {
    console.log(
      [
        row.system_id,
        row.fact_recall_accuracy.toFixed(3),
        row.fact_recall_rate.toFixed(3),
        row.state_update_precision.toFixed(3),
        row.temporal_query_accuracy.toFixed(3),
        row.stale_fact_misuse_rate.toFixed(3),
        row.bad_memory_write_rate.toFixed(3),
        row.attack_success_rate.toFixed(3),
        row.avg_input_tokens.toFixed(0),
        row.total_cost_usd.toFixed(6),
      ].join('\t'),
    );
  }
}

function main(): void {
  const mode = process.argv[2] ?? 'all';
  if (!['compare', 'ablation', 'all', 'dataset'].includes(mode)) {
    console.error('用法: tsx src/eval/cli.ts <compare|ablation|all|dataset>');
    process.exitCode = 1;
    return;
  }

  const cases = buildDataset();
  write('datasets/roleplay-memory.json', `${JSON.stringify(cases, null, 2)}\n`);
  console.log(`数据集: ${cases.length} cases -> datasets/roleplay-memory.json`);

  if (mode === 'compare' || mode === 'all') {
    printSummary(runSuiteAndWrite('compare', buildCompareSystems(), cases));
  }
  if (mode === 'ablation' || mode === 'all') {
    printSummary(runSuiteAndWrite('ablation', buildAblationSystems(), cases));
  }
  if (mode === 'all') {
    console.log('\n报告: eval/results/compare.md, eval/results/ablation.md');
  }
}

main();
