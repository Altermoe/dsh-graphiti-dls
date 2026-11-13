/**
 * Graphiti 适配层的端口（Port）契约。
 *
 * DSH 插件侧只依赖这个接口，不 import Graphiti 的任何内部结构
 * （README「技术与部署边界」）。真实 Graphiti 是 Python 生态的时态图谱，
 * 由独立服务 / MCP / RPC 承载；这里定义 DLS 侧需要的最小能力。
 */

import type { FactQuery, MemoryFact } from '../model/types';

export interface StoreStats {
  inserts: number;
  updates: number;
  deletes: number;
}

export interface GraphitiPort {
  /** 幂等写入：同一 id 重复插入不产生新边。 */
  insert(fact: MemoryFact): void;
  update(id: string, patch: Partial<MemoryFact>): MemoryFact | undefined;
  get(id: string): MemoryFact | undefined;
  /** 按作用域、双时态、状态与检索词返回相关事实。 */
  query(query: FactQuery): MemoryFact[];
  /** 全量快照，仅用于审计、纠错与评测统计。 */
  all(): MemoryFact[];
  stats(): StoreStats;
  reset(): void;
}
