/**
 * 真实 Graphiti 服务的接入契约（生产路径）。
 *
 * 说明（README「技术与部署边界」）：Graphiti 是 Python 生态，DSH 插件跑在
 * Node.js，二者通过独立服务 / RPC 连接；插件不 import Graphiti 内部结构。
 * 本文件只负责「DLS 逻辑事实 ⇄ Graphiti episode/edge」的字段映射与请求构造。
 *
 * 部署前必须验证：
 *  - Graphiti 的 episode 是否持久化了原始文本或日志（若不注入原文，需确认后端
 *    也没有偷偷保存）；默认 episode_body 只含结构化事实，不含原始对话全文。
 *  - group_id 承担查询级租户隔离，服务端必须按身份校验，不信任客户端声明。
 *  - 超时、重试、幂等键（fact.id）与故障降级由调用方队列实现。
 *  - 升级 graphiti-core 时回归本映射与 tests/。
 */

import type { FactQuery, MemoryFact } from '../model/types';
import { objectLabel } from '../model/types';
import { scopeKey } from '../model/facts';

export interface GraphitiServiceConfig {
  /** 例：http://127.0.0.1:8000（本机 Docker 端口不要用 localhost，见部署说明） */
  endpoint: string;
  apiVersion?: string;
  timeoutMs?: number;
  headers?: Record<string, string>;
}

export interface GraphitiEpisode {
  /** 租户隔离键；服务端须按应用侧身份复核。 */
  group_id: string;
  name: string;
  source: 'json';
  source_description: string;
  reference_time: string;
  /** 结构化事实，不含原始对话全文。 */
  episode_body: {
    fact_id: string;
    subject: { id: string; type: string; label?: string };
    predicate: string;
    object: string;
    scope: Record<string, string | undefined>;
    valid_time: { from: string | null; to: string | null };
    recorded_time: { from: string | null; to: string | null };
    trust_level: string;
    status: string;
    supersedes: string[];
    event_id: string;
  };
}

export interface GraphitiSearchRequest {
  group_id: string;
  query: string;
  max_facts: number;
  valid_at?: string;
  known_at?: string;
  include_invalidated?: boolean;
}

export interface GraphitiEdgeResponse {
  fact_id: string;
  subject: { id: string; type: string; label?: string };
  predicate: string;
  object: string;
  scope: Record<string, string | undefined>;
  valid_time: { from: string | null; to: string | null };
  recorded_time: { from: string | null; to: string | null };
  trust_level: MemoryFact['trust_level'];
  status: MemoryFact['status'];
  supersedes: string[];
  derived_from?: string[];
  source: { type: MemoryFact['source']['type']; event_id: string };
  confidence?: number;
  created_at?: string;
  score?: number;
}

export function toGraphitiEpisode(fact: MemoryFact): GraphitiEpisode {
  return {
    group_id: scopeKey(fact.scope),
    name: `dls:${fact.predicate}:${fact.subject.id}`,
    source: 'json',
    source_description: `dls/${fact.source.type}`,
    reference_time: fact.recorded_time.from ?? fact.created_at,
    episode_body: {
      fact_id: fact.id,
      subject: fact.subject,
      predicate: fact.predicate,
      object: objectLabel(fact.object),
      scope: { ...fact.scope },
      valid_time: { ...fact.valid_time },
      recorded_time: { ...fact.recorded_time },
      trust_level: fact.trust_level,
      status: fact.status,
      supersedes: [...fact.supersedes],
      event_id: fact.source.event_id,
    },
  };
}

export function toGraphitiSearch(query: FactQuery): GraphitiSearchRequest {
  return {
    group_id: scopeKey(query.scope),
    query: query.text ?? '',
    max_facts: query.limit ?? 40,
    valid_at: query.at,
    known_at: query.known_at,
    include_invalidated: query.include_invalidated ?? false,
  };
}

export function fromGraphitiEdge(edge: GraphitiEdgeResponse): MemoryFact {
  return {
    id: edge.fact_id,
    subject: edge.subject,
    predicate: edge.predicate,
    object: edge.object,
    scope: {
      user_id: edge.scope.user_id ?? '',
      project_id: edge.scope.project_id,
      session_id: edge.scope.session_id,
      agent_id: edge.scope.agent_id,
      scene: edge.scope.scene,
    },
    valid_time: edge.valid_time,
    recorded_time: edge.recorded_time,
    source: { type: edge.source.type, event_id: edge.source.event_id },
    trust_level: edge.trust_level,
    status: edge.status,
    confidence: edge.confidence ?? 0.7,
    supersedes: edge.supersedes,
    derived_from: edge.derived_from ?? [],
    created_at: edge.created_at ?? edge.recorded_time.from ?? '',
  };
}

/** 异步客户端：生产接入时用队列把它桥接到同步的 GraphitiPort 契约。 */
export class GraphitiServiceClient {
  private readonly base: string;
  private readonly timeoutMs: number;

  constructor(private readonly config: GraphitiServiceConfig) {
    this.base = `${config.endpoint.replace(/\/$/, '')}/v${config.apiVersion ?? 1}`;
    this.timeoutMs = config.timeoutMs ?? 5000;
  }

  private async request(path: string, body: unknown): Promise<unknown> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await fetch(`${this.base}${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...(this.config.headers ?? {}) },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(`graphiti ${response.status}: ${await response.text()}`);
      return await response.json();
    } finally {
      clearTimeout(timer);
    }
  }

  async addEpisode(fact: MemoryFact): Promise<void> {
    await this.request('/episodes', toGraphitiEpisode(fact));
  }

  async invalidate(factId: string, at: string): Promise<void> {
    await this.request('/edges/invalidate', { fact_id: factId, at });
  }

  async search(query: FactQuery): Promise<MemoryFact[]> {
    const raw = (await this.request('/search', toGraphitiSearch(query))) as {
      edges?: GraphitiEdgeResponse[];
    };
    return (raw.edges ?? []).map(fromGraphitiEdge);
  }
}
