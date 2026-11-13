/** 评测运行器：对每个系统在每个 case 上重置 → 摄入 → 编译 → 计时 → 判定。 */

import { performance } from 'node:perf_hooks';

import type {
  CaseResult,
  EpisodeCase,
  MemorySystemUnderTest,
  SuiteResult,
} from './types';
import { aggregate, evaluateCase } from './metrics';

export function runSuite(
  suite: 'compare' | 'ablation',
  systems: MemorySystemUnderTest[],
  cases: EpisodeCase[],
): SuiteResult {
  const results: CaseResult[] = [];

  for (const system of systems) {
    for (const caseItem of cases) {
      system.reset();
      for (const event of caseItem.events) {
        system.ingest(event, caseItem.scope);
      }
      const snapshot = system.snapshot();
      const started = performance.now();
      const output = system.compile(caseItem.query);
      const latencyMs = performance.now() - started;
      results.push({
        system_id: system.id,
        ...evaluateCase(caseItem, output, snapshot, latencyMs),
      });
    }
  }

  return {
    suite,
    generated_at: new Date().toISOString(),
    dataset_size: cases.length,
    systems: systems.map((system) => system.id),
    results,
    aggregates: systems.map((system) =>
      aggregate(
        system.id,
        system.label,
        system.kind,
        results.filter((item) => item.system_id === system.id),
      ),
    ),
  };
}
