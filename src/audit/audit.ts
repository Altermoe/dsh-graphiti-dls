/**
 * 审计与纠错层：记录每一次写入决策，支持来源追溯、撤销、修订与删除。
 * 关键点（README）：删除是独立的策略动作，不能误当成普通事实更新。
 */

import type { SourceType } from '../model/types';

export interface AuditEntry {
  id: string;
  at: string;
  action: string;
  candidate_id: string;
  fact_id?: string;
  reason: string;
  source_type: SourceType;
  accepted: boolean;
  affected: string[];
}

export type AuditRecord = Omit<AuditEntry, 'id' | 'at'> & { at?: string };

export class AuditLog {
  private readonly entries: AuditEntry[] = [];
  private sequence = 0;

  constructor(private readonly enabled = true) {}

  record(entry: AuditRecord): AuditEntry | undefined {
    if (!this.enabled) return undefined;
    this.sequence += 1;
    const full: AuditEntry = {
      id: `a:${this.sequence}`,
      at: entry.at ?? new Date(0).toISOString(),
      action: entry.action,
      candidate_id: entry.candidate_id,
      fact_id: entry.fact_id,
      reason: entry.reason,
      source_type: entry.source_type,
      accepted: entry.accepted,
      affected: [...entry.affected],
    };
    this.entries.push(full);
    return full;
  }

  trace(factId: string): AuditEntry[] {
    return this.entries.filter((entry) => entry.fact_id === factId || entry.affected.includes(factId));
  }

  all(): AuditEntry[] {
    return [...this.entries];
  }

  get size(): number {
    return this.entries.length;
  }
}
