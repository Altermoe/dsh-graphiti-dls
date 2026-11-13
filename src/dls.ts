/**
 * DLS 门面：把受控写入、双时态图谱、检索、上下文编译与审计组装成
 * 一个可被 DSH 插件和评测框架共用的系统。
 *
 * 替换真实 Graphiti 时只需注入实现了 GraphitiPort 的适配器，
 * 上层（插件、编译器、评测）不改。
 */

import type { CandidateFact, DlsConfig, WriteDecision } from './model/types';
import { cloneConfig } from './model/types';
import { InMemoryBitemporalStore } from './store/memory-store';
import type { GraphitiPort } from './store/port';
import { AuditLog } from './audit/audit';
import { WritePolicy } from './policy/write-policy';
import type { WriteContext } from './policy/write-policy';
import { Retriever } from './compiler/retriever';
import { ContextCompiler } from './compiler/compiler';
import type { CompiledContext, CompileInput } from './compiler/compiler';

export class DlsMemorySystem {
  readonly store: GraphitiPort;
  readonly audit: AuditLog;
  readonly policy: WritePolicy;
  readonly compiler: ContextCompiler;

  constructor(
    readonly config: DlsConfig = cloneConfig(),
    store?: GraphitiPort,
  ) {
    this.store = store ?? new InMemoryBitemporalStore();
    this.audit = new AuditLog(config.ablation.audit);
    this.policy = new WritePolicy(this.store, config, this.audit);
    this.compiler = new ContextCompiler(config, new Retriever(this.store, config));
  }

  ingest(candidate: CandidateFact, ctx: WriteContext): WriteDecision {
    return this.policy.submit(candidate, ctx);
  }

  compile(input: CompileInput): CompiledContext {
    return this.compiler.compile(input);
  }

  snapshot() {
    return this.store.all();
  }

  stats() {
    return this.store.stats();
  }
}
