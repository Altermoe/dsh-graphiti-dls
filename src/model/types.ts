/**
 * DLS 逻辑记忆模型与配置类型。
 *
 * 设计约束（README「记忆模型」「安全模型」）：
 * - 记忆是「不可信数据面」，只表达事实，不承载指令，也不授予权限。
 * - 区分 valid_time（现实有效时间）与 recorded_time（系统记录时间）。
 * - 实际存储结构由 GraphitiPort 映射，本文件只定义 DLS 侧的逻辑契约。
 */

export type SourceType =
  | 'user_statement'
  | 'authorized_tool'
  | 'external_content'
  | 'model_inference'
  | 'system_confirmed';

export type TrustLevel =
  | 'user_asserted'
  | 'tool_verified'
  | 'untrusted_external'
  | 'model_inferred'
  | 'system_asserted';

export type FactStatus =
  | 'candidate'
  | 'accepted'
  | 'pending'
  | 'invalidated'
  | 'rejected'
  | 'deleted';

export interface EntityRef {
  id: string;
  type: string;
  label?: string;
}

/** ISO-8601 区间；null 表示未知（不编造时间）或开放区间。 */
export interface TimeRange {
  from: string | null;
  to: string | null;
}

export interface FactScope {
  user_id: string;
  project_id?: string;
  session_id?: string;
  agent_id?: string;
  scene?: string;
}

export interface Provenance {
  type: SourceType;
  event_id: string;
  /** 来源引用片段，不是原始全文；原文归档是独立的存储决策。 */
  excerpt?: string;
  recorded_by?: string;
}

export interface MemoryFact {
  id: string;
  subject: EntityRef;
  predicate: string;
  object: EntityRef | string;
  scope: FactScope;
  valid_time: TimeRange;
  recorded_time: TimeRange;
  source: Provenance;
  trust_level: TrustLevel;
  status: FactStatus;
  /** 仅用于排序与筛选，不参与权限判断。 */
  confidence: number;
  /** 本事实使哪些既有事实失效（纠错轨迹）。 */
  supersedes: string[];
  /** 派生来源，支持级联撤销。 */
  derived_from: string[];
  created_at: string;
}

/** 模型/工具提交的「候选事实」——提取成功不代表可信。 */
export interface CandidateFact {
  id: string;
  subject: EntityRef;
  predicate: string;
  object: EntityRef | string;
  scope?: Partial<FactScope>;
  valid_time?: Partial<TimeRange>;
  source: Provenance;
  trust_level?: TrustLevel;
  confidence?: number;
  /** 撤销/删除指令：指向既有事实 id，不写成普通事实。 */
  deletion_of?: string;
}

export type WriteAction =
  | 'insert'
  | 'supersede'
  | 'supplement'
  | 'pending'
  | 'reject'
  | 'delete'
  | 'noop';

export type RejectCode =
  | 'schema_invalid'
  | 'predicate_not_allowed'
  | 'payload_too_large'
  | 'instruction_like'
  | 'privilege_escalation'
  | 'untrusted_source'
  | 'cross_scope'
  | 'duplicate'
  | 'not_found';

export interface WriteDecision {
  candidate_id: string;
  action: WriteAction;
  accepted: boolean;
  reason: string;
  reject_code?: RejectCode;
  fact?: MemoryFact;
  /** supersede / delete 影响的既有事实 id。 */
  affected: string[];
}

export interface FactQuery {
  scope: FactScope;
  /** 查询的现实时间点；用于 valid_time 过滤。 */
  at?: string;
  /** 查询的系统知悉时间点；用于 recorded_time 过滤（双时态的第二个维度）。 */
  known_at?: string;
  /** 检索词（用于相关性排序）。 */
  text?: string;
  predicates?: string[];
  include_invalidated?: boolean;
  include_pending?: boolean;
  /** 是否执行用户/项目/会话隔离；消融实验可关闭。 */
  isolation?: boolean;
  /** 是否执行双时态过滤；消融实验可关闭。 */
  bitemporal?: boolean;
  limit?: number;
}

export interface BudgetConfig {
  max_input_tokens: number;
  memory_budget_tokens: number;
  recent_turns: number;
  max_graph_hops: number;
  max_facts: number;
  require_provenance: boolean;
  /** 按类别分配预算；未列出的类别共用 memory_budget_tokens 余量。 */
  category_budgets?: Record<string, number>;
}

export interface PolicyConfig {
  /** 关系白名单：拒绝任意自由格式的持久化内容。 */
  allowed_predicates: string[];
  max_object_chars: number;
  /** 外部内容是否可以直接进入可被推理使用的记忆状态。 */
  allow_external_write: boolean;
  allow_model_inference_write: boolean;
}

/**
 * 消融开关：true 表示启用该组件。关闭后对应能力由「无策略」路径替代，
 * 用于量化每个组件的贡献。
 */
export interface AblationFlags {
  write_policy: boolean;
  bitemporal: boolean;
  scope_isolation: boolean;
  source_ranking: boolean;
  context_compiler: boolean;
  conflict_resolution: boolean;
  audit: boolean;
}

export interface DlsConfig {
  context: BudgetConfig;
  policy: PolicyConfig;
  ablation: AblationFlags;
}

export const DEFAULT_PREDICATES: string[] = [
  'has_name',
  'is_role',
  'has_trait',
  'prefers',
  'dislikes',
  'allergic_to',
  'favorite_color',
  'favorite_food',
  'owns_item',
  'located_in',
  'relationship_with',
  'knows',
  'current_goal',
  'decided_to',
  'world_rule',
  'uses_backend_language',
  'works_on',
  'member_of',
  'speaks_style',
  'has_pet',
  'remembers_event',
  'uses_weapon',
  'holds_title',
  'has_status',
  'schedule',
];

/** README「上下文编译器」给出的示例预算。 */
export const DEFAULT_CONFIG: DlsConfig = {
  context: {
    max_input_tokens: 6000,
    memory_budget_tokens: 1800,
    recent_turns: 8,
    max_graph_hops: 2,
    max_facts: 40,
    require_provenance: true,
    category_budgets: {
      system_rules: 600,
      recent_dialogue: 1600,
      stable_preference: 500,
      project_state: 500,
      task_facts: 1200,
    },
  },
  policy: {
    allowed_predicates: DEFAULT_PREDICATES,
    max_object_chars: 500,
    allow_external_write: false,
    allow_model_inference_write: false,
  },
  ablation: {
    write_policy: true,
    bitemporal: true,
    scope_isolation: true,
    source_ranking: true,
    context_compiler: true,
    conflict_resolution: true,
    audit: true,
  },
};

export function allOnFlags(): AblationFlags {
  return { ...DEFAULT_CONFIG.ablation };
}

export function cloneConfig(config: DlsConfig = DEFAULT_CONFIG): DlsConfig {
  return {
    context: { ...config.context, category_budgets: { ...config.context.category_budgets } },
    policy: { ...config.policy, allowed_predicates: [...config.policy.allowed_predicates] },
    ablation: { ...config.ablation },
  };
}

export function objectLabel(object: EntityRef | string): string {
  return typeof object === 'string' ? object : object.label ?? object.id;
}

export function objectId(object: EntityRef | string): string {
  return typeof object === 'string' ? object : object.id;
}
