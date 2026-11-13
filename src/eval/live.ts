/**
 * 实例内评测：在真实 DSH 宿主进程里运行对比与消融实验。
 *
 * 与 `cli.ts` 的区别：
 *  - 运行位置是真实 dsh 实例（Cordis 宿主进程），由 Host 插件在激活后触发；
 *  - DLS 被测系统由插件服务工厂构造（`createServiceFromConfig`），与
 *    实例内挂载的 `ctx.dlsMemory` 同源同实现；
 *  - 不读写实例内挂载服务的状态（避免把 60 个虚构 case 写进用户记忆），
 *    另起独立服务实例跑矩阵；挂载服务只做存在性与配置核对；
 *  - consumer 路径用真实 waterfall 逻辑做探针，验证注入消息的完整
 *    UserMessage 形状与 decision 保留。
 *
 * 指标与数据集完全沿用仓库协议，因此结果应与 `eval/results/*.json`
 * 逐字段一致；不一致即说明插件接入层与进程内直跑存在偏差。
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import type { DlsConfig } from '../model/types';
import { cloneConfig } from '../model/types';
import { createServiceFromConfig, handlePreStep } from '../dsh/host';
import type { DlsInjectedMessage, PreStepDecision, PreStepPayload } from '../dsh/plugin';
import { parseExplicitCandidates } from '../dsh/plugin';
import { buildDataset, datasetSummary } from './dataset';
import { renderMainTable, renderReport } from './report';
import { runSuite } from './runner';
import {
  BASELINE_NOTES,
  buildAblationSystems,
  buildCompareSystems,
  DlsSystem,
} from './systems';
import type { DlsSystemFactory } from './systems';
import type { AggregateMetrics, CaseResult, MemorySystemUnderTest, SuiteResult } from './types';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const OUT_DIR = `${ROOT}eval/results/dsh-live`;

/** 与实例内插件同源：每个被测系统都通过插件服务工厂构造。 */
const pluginDlsFactory: DlsSystemFactory = (id, label, config) =>
  new DlsSystem(id, label, config, (item: DlsConfig) => createServiceFromConfig(item).system);

/** 宿主提供的最小上下文能力（只读取挂载服务，不驱动 agent）。 */
export interface HostContextLike {
  get(name: string): unknown;
}

export interface LiveRunOptions {
  ctx?: HostContextLike;
  profile?: string | null;
}

/**
 * 宿主进程的 profile 名：优先环境变量，其次从启动参数推断
 * （`dsh web` / `dsh --profile web` 都覆盖）。
 */
export function detectProfile(argv: readonly string[] = process.argv): string | null {
  const fromEnv = process.env.DSH_PROFILE;
  if (fromEnv) return fromEnv;
  const args = argv.slice(2);
  const flagIndex = args.indexOf('--profile');
  if (flagIndex >= 0 && args[flagIndex + 1]) return args[flagIndex + 1]!;
  const positional = args.find((argument) => !argument.startsWith('-'));
  return positional ?? null;
}

export interface ConsumerProbe {
  ok: boolean;
  decision_preserved: boolean;
  injected: boolean;
  message_id_present: boolean;
  role_valid: boolean;
  source_kind: string | null;
  content_tagged: boolean;
  fact_persisted: boolean;
  checks: string[];
}

export interface Equivalence {
  baseline_available: boolean;
  suites: Array<{
    suite: 'compare' | 'ablation';
    compared_cases: number;
    mismatched_cases: number;
    mismatches: string[];
  }>;
}

export interface LiveRunSummary {
  host: {
    engine: 'dsh-host';
    pid: number;
    profile: string | null;
    node: string;
    started_at: string;
    completed_at: string;
    mounted_service_present: boolean;
    mounted_config: DlsConfig | null;
  };
  probe: ConsumerProbe;
  equivalence: Equivalence;
  suites: {
    compare: { aggregates: AggregateMetrics[]; dataset_size: number };
    ablation: { aggregates: AggregateMetrics[]; dataset_size: number };
  };
}

function systemNotes(systems: MemorySystemUnderTest[]): Array<{ label: string; note: string }> {
  return systems.map((system) => ({
    label: system.label,
    note:
      system.source_note ??
      BASELINE_NOTES[system.id] ??
      (system.kind === 'dls'
        ? '本项目实现：Graphiti 适配层 + 受控写入 + 双时态 + 上下文编译（实例内插件服务）'
        : '—'),
  }));
}

function write(relative: string, content: string): void {
  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(`${OUT_DIR}/${relative}`, content, 'utf8');
}

function appendLog(line: string): void {
  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(`${OUT_DIR}/run.log`, `${line}\n`, { flag: 'a' });
}

const PROBE_FACT_LINE =
  '[dls] {"id":"probe-fact","subject":{"id":"npc:probe","type":"character"},"predicate":"owns_item","object":"银月长枪"}';

/** 用真实 handlePreStep 驱动一次 consumer 路径（独立服务实例，不污染实例记忆）。 */
export async function runConsumerProbe(): Promise<ConsumerProbe> {
  const service = createServiceFromConfig(cloneConfig());
  const injected: DlsInjectedMessage[] = [];
  const payload: PreStepPayload = {
    agent: {
      id: 'probe-session',
      inject: (message) => injected.push(message),
    },
    messages: [{ content: [{ type: 'text', text: PROBE_FACT_LINE }], source: { kind: 'user' } }],
    turn: 7,
    step: 1,
    dlsScope: { user_id: 'probe-user', project_id: 'probe-project' },
  };
  const decision: PreStepDecision = { kind: 'accept', messages: payload.messages };
  const result = await handlePreStep(service, payload, async () => decision, {
    scope: payload.dlsScope!,
    extractCandidates: parseExplicitCandidates,
    now: () => '2026-11-13T00:00:00.000Z',
  });
  const message = injected[0];
  const sourceKind = (message?.source?.kind as string | undefined) ?? null;
  const text = message?.content?.[0]?.text ?? '';
  const persisted = service.system.store
    .all()
    .some((fact) => fact.id === 'f:probe-fact' && fact.status === 'accepted');
  const checks = [
    result.decision === decision ? 'decision 原样返回' : 'decision 被替换',
    message ? '发生注入' : '未注入',
    message?.id ? 'message id 非空' : 'message id 缺失',
    message?.role === 'user' ? 'role=user' : 'role 非法',
    sourceKind === 'dls-memory' ? 'source.kind=dls-memory' : `source.kind=${sourceKind}`,
    text.includes('<dls-memory>') ? '内容带 dls-memory 标记' : '内容缺标记',
    persisted ? '事实已持久化' : '事实未持久化',
  ];
  const ok =
    result.decision === decision &&
    Boolean(message) &&
    Boolean(message?.id) &&
    message?.role === 'user' &&
    sourceKind === 'dls-memory' &&
    text.includes('<dls-memory>') &&
    persisted;
  return {
    ok,
    decision_preserved: result.decision === decision,
    injected: Boolean(message),
    message_id_present: Boolean(message?.id),
    role_valid: message?.role === 'user',
    source_kind: sourceKind,
    content_tagged: text.includes('<dls-memory>'),
    fact_persisted: persisted,
    checks,
  };
}

interface BaselineSuite {
  results: CaseResult[];
  aggregates: AggregateMetrics[];
}

function readBaseline(suite: 'compare' | 'ablation'): BaselineSuite | null {
  try {
    const parsed = JSON.parse(
      readFileSync(`${ROOT}eval/results/${suite}.json`, 'utf8'),
    ) as BaselineSuite;
    if (!Array.isArray(parsed.results)) return null;
    return parsed;
  } catch {
    return null;
  }
}

/** 逐 case 比对（忽略延迟：实例内跑在活跃宿主里，计时不可比）。 */
function compareSuite(
  suite: 'compare' | 'ablation',
  actual: SuiteResult,
  baseline: BaselineSuite | null,
): Equivalence['suites'][number] {
  if (!baseline) {
    return { suite, compared_cases: 0, mismatched_cases: 0, mismatches: ['baseline missing'] };
  }
  const key = (item: { system_id: string; case_id: string }) => `${item.system_id}\u0000${item.case_id}`;
  const baselineByKey = new Map(baseline.results.map((item) => [key(item), item]));
  const mismatches: string[] = [];
  const mismatchedCases = new Set<string>();
  let compared = 0;
  for (const item of actual.results) {
    const expected = baselineByKey.get(key(item));
    if (!expected) continue;
    compared += 1;
    const fields: Array<keyof CaseResult> = [
      'answer',
      'answer_correct',
      'recall_hits',
      'recall_total',
      'state_update_correct',
      'temporal_correct',
      'stale_misuse',
      'bad_writes',
      'bad_total',
      'injection_persisted',
      'attack_success',
      'tokens',
      'writes',
      'within_budget',
    ];
    for (const field of fields) {
      if (JSON.stringify(item[field]) !== JSON.stringify(expected[field])) {
        mismatches.push(`${item.system_id}/${item.case_id}/${String(field)}`);
        mismatchedCases.add(key(item));
      }
    }
  }
  return {
    suite,
    compared_cases: compared,
    mismatched_cases: mismatchedCases.size,
    mismatches: mismatches.slice(0, 20),
  };
}

export async function runLiveSuites(options: LiveRunOptions = {}): Promise<LiveRunSummary> {
  const startedAt = new Date().toISOString();
  mkdirSync(OUT_DIR, { recursive: true });
  appendLog(`[${startedAt}] live eval start pid=${process.pid} profile=${options.profile ?? 'n/a'}`);

  const mounted = options.ctx?.get('dlsMemory') as
    | { system?: { config?: DlsConfig } }
    | undefined;
  const mountedConfig = mounted?.system?.config ? cloneConfig(mounted.system.config) : null;

  const probe = await runConsumerProbe();
  const cases = buildDataset();

  const compare = runSuite('compare', buildCompareSystems(pluginDlsFactory), cases);
  const ablation = runSuite('ablation', buildAblationSystems(pluginDlsFactory), cases);

  const equivalence: Equivalence = {
    baseline_available: readBaseline('compare') !== null,
    suites: [
      compareSuite('compare', compare, readBaseline('compare')),
      compareSuite('ablation', ablation, readBaseline('ablation')),
    ],
  };

  const completedAt = new Date().toISOString();
  const summary: LiveRunSummary = {
    host: {
      engine: 'dsh-host',
      pid: process.pid,
      profile: options.profile ?? detectProfile(),
      node: process.version,
      started_at: startedAt,
      completed_at: completedAt,
      mounted_service_present: mounted !== undefined,
      mounted_config: mountedConfig,
    },
    probe,
    equivalence,
    suites: {
      compare: { aggregates: compare.aggregates, dataset_size: cases.length },
      ablation: { aggregates: ablation.aggregates, dataset_size: cases.length },
    },
  };

  write('compare.json', `${JSON.stringify(compare, null, 2)}\n`);
  write(
    'compare.md',
    renderReport(compare, {
      datasetSummary: datasetSummary(cases),
      systemNotes: systemNotes(buildCompareSystems(pluginDlsFactory)),
    }),
  );
  write('ablation.json', `${JSON.stringify(ablation, null, 2)}\n`);
  write(
    'ablation.md',
    renderReport(ablation, {
      datasetSummary: datasetSummary(cases),
      systemNotes: systemNotes(buildAblationSystems(pluginDlsFactory)),
    }),
  );
  write('summary.json', `${JSON.stringify(summary, null, 2)}\n`);
  write('summary.md', renderSummary(summary, compare, ablation));

  appendLog(
    `[${completedAt}] live eval done probe=${probe.ok ? 'ok' : 'fail'} compare_mismatch=${equivalence.suites[0]!.mismatched_cases} ablation_mismatch=${equivalence.suites[1]!.mismatched_cases}`,
  );
  return summary;
}

function renderSummary(
  summary: LiveRunSummary,
  compare: SuiteResult,
  ablation: SuiteResult,
): string {
  const { host, probe, equivalence } = summary;
  const full = compare.aggregates.find((row) => row.system_id === 'dls:full');
  return [
    '# 真实 DSH 实例内对比与消融实验',
    '',
    '> 由 Host 插件在 dsh 宿主进程激活后自动运行；数据集与指标与 `src/eval` 协议完全一致。',
    '',
    '## 运行环境',
    '',
    '| 项 | 值 |',
    '|---|---|',
    `| 运行载体 | ${host.engine}（Cordis 宿主进程） |`,
    `| pid | ${host.pid} |`,
    `| profile | ${host.profile ?? '—'} |`,
    `| node | ${host.node} |`,
    `| 开始 | ${host.started_at} |`,
    `| 完成 | ${host.completed_at} |`,
    `| 挂载服务 ctx.dlsMemory | ${host.mounted_service_present ? '存在' : '缺失'} |`,
    `| 挂载配置 | memory_budget=${host.mounted_config?.context.memory_budget_tokens ?? '—'} / max_input=${host.mounted_config?.context.max_input_tokens ?? '—'} |`,
    '',
    '## Consumer 路径探针',
    '',
    probe.checks.map((check) => `- ${check}`).join('\n'),
    '',
    `结论：**${probe.ok ? '通过' : '失败'}**。`,
    '',
    '## 与进程内直跑的一致性',
    '',
    '| 套件 | 比对 case | 不一致 case |',
    '|---|---|---|',
    ...equivalence.suites.map(
      (item) => `| ${item.suite} | ${item.compared_cases} | ${item.mismatched_cases} |`,
    ),
    '',
    equivalence.suites.some((item) => item.mismatched_cases > 0)
      ? `差异样例：\n\n${equivalence.suites
          .flatMap((item) => item.mismatches)
          .slice(0, 10)
          .map((line) => `- ${line}`)
          .join('\n')}`
      : '所有 case 的判定字段逐项一致（延迟除外，实例内计时不可比）。',
    '',
    '## 对比实验（DLS 行）',
    '',
    renderMainTable({ ...compare, aggregates: full ? [full] : [] }),
    '',
    '## 消融实验（全量 + 组合消融）',
    '',
    renderMainTable({
      ...ablation,
      aggregates: ablation.aggregates.filter((row) =>
        ['dls:full', 'dls:no_defense_in_depth'].includes(row.system_id),
      ),
    }),
    '',
    '完整表格见 [compare.md](./compare.md) 与 [ablation.md](./ablation.md)，原始结果见同名 JSON。',
    '',
  ].join('\n');
}
