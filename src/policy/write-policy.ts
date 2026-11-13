/**
 * 受控写入策略层（README「记忆写入流程」1~7 步的可执行实现）。
 *
 * 事件接收 → 候选提取（外部完成）→ 结构校验 → 信任与权限判断 →
 * 作用域与冲突判断 → 写入或拒绝 → 审计与纠错。
 *
 * 每个组件都受 ablation 开关控制，便于量化各自贡献。关闭某组件时会走
 * 「无策略」路径，而不是简单地把校验结果丢掉。
 */

import type {
  CandidateFact,
  DlsConfig,
  FactScope,
  MemoryFact,
  WriteAction,
  WriteDecision,
} from '../model/types';
import { validateCandidate } from '../model/schema';
import { classifyConflict, factKey, toMemoryFact } from '../model/facts';
import type { GraphitiPort } from '../store/port';
import type { AuditLog } from '../audit/audit';

export interface WriteContext {
  /** 系统记录时间（由调用方注入，保证评测确定性）。 */
  now: string;
  /** 应用侧判定的当前作用域；不采信候选自带的用户身份。 */
  defaultScope: FactScope;
}

type DecisionDraft = Omit<WriteDecision, 'candidate_id' | 'affected'> & { affected?: string[] };

export class WritePolicy {
  constructor(
    private readonly store: GraphitiPort,
    private readonly config: DlsConfig,
    private readonly audit: AuditLog,
  ) {}

  submit(candidate: CandidateFact, ctx: WriteContext): WriteDecision {
    const { ablation, policy: policyConfig } = this.config;

    const decide = (draft: DecisionDraft): WriteDecision => {
      const full: WriteDecision = {
        candidate_id: candidate.id,
        affected: draft.affected ?? [],
        action: draft.action,
        accepted: draft.accepted,
        reason: draft.reason,
        reject_code: draft.reject_code,
        fact: draft.fact,
      };
      this.audit.record({
        at: ctx.now,
        action: full.action,
        candidate_id: candidate.id,
        fact_id: full.fact?.id,
        reason: full.reason,
        source_type: candidate.source.type,
        accepted: full.accepted,
        affected: full.affected,
      });
      return full;
    };

    // 0. 删除 / 撤销：策略动作，不是普通事实更新。
    if (candidate.deletion_of) {
      return this.handleDeletion(candidate, ctx, decide);
    }

    // 1~3. 结构校验、关系白名单、指令与权限声明、来源信任。
    let status: MemoryFact['status'] = 'accepted';
    if (ablation.write_policy) {
      const validation = validateCandidate(candidate, policyConfig);
      if (!validation.ok) {
        return decide({
          action: 'reject',
          accepted: false,
          reason: validation.reason,
          reject_code: validation.code,
        });
      }
      if (
        (candidate.source.type === 'external_content' && !policyConfig.allow_external_write) ||
        (candidate.source.type === 'model_inference' && !policyConfig.allow_model_inference_write)
      ) {
        status = 'pending';
      }
    }

    // 4. 作用域：用户身份来自应用侧，候选不能自称属于别的用户。
    const scope: FactScope = { ...ctx.defaultScope, ...candidate.scope };
    if (
      ablation.scope_isolation &&
      candidate.scope?.user_id &&
      candidate.scope.user_id !== ctx.defaultScope.user_id
    ) {
      return decide({
        action: 'reject',
        accepted: false,
        reason: '候选事实跨越用户作用域，拒绝写入',
        reject_code: 'cross_scope',
      });
    }

    // 5. 冲突判断：区分补充、纠正、矛盾与幂等重复。
    const supersedes: string[] = [];
    let action: WriteAction = 'insert';
    if (ablation.conflict_resolution) {
      const key = factKey({ subject: candidate.subject, predicate: candidate.predicate, scope });
      const rivals = this.store.all().filter(
        (fact) => fact.status === 'accepted' && factKey(fact) === key,
      );
      for (const rival of rivals) {
        const kind = classifyConflict(candidate, rival, scope);
        if (kind === 'duplicate') {
          return decide({
            action: 'noop',
            accepted: false,
            reason: '幂等：相同事实已存在',
            reject_code: 'duplicate',
          });
        }
        if (kind === 'supersede' && ablation.bitemporal) {
          // 旧事实按 recorded_time 失效，保留可理解的修订轨迹。
          this.store.update(rival.id, {
            status: 'invalidated',
            recorded_time: { from: rival.recorded_time.from, to: ctx.now },
            valid_time: { ...rival.valid_time, to: candidate.valid_time?.from ?? ctx.now },
          });
          supersedes.push(rival.id);
          action = 'supersede';
        } else if (kind === 'supplement') {
          action = 'supplement';
        } else if (kind === 'contradiction') {
          status = 'pending';
        }
      }
    }

    const fact = toMemoryFact(candidate, {
      now: ctx.now,
      defaultScope: ctx.defaultScope,
      status,
      bitemporal: ablation.bitemporal,
      supersedes,
    });
    this.store.insert(fact);

    if (status === 'pending') {
      return decide({
        action: 'pending',
        accepted: false,
        reason: '低信任来源或事实存在矛盾，进入待确认队列',
        fact,
      });
    }
    return decide({
      action,
      accepted: true,
      reason: action === 'supersede' ? '纠正：写入新事实并失效旧状态' : '通过策略校验，写入记忆状态',
      fact,
      affected: supersedes,
    });
  }

  private handleDeletion(
    candidate: CandidateFact,
    ctx: WriteContext,
    decide: (draft: DecisionDraft) => WriteDecision,
  ): WriteDecision {
    if (!this.config.ablation.audit) {
      return decide({
        action: 'reject',
        accepted: false,
        reason: '未启用审计与纠错层，删除请求不执行',
        reject_code: 'not_found',
      });
    }
    const targetId = candidate.deletion_of!;
    const target =
      this.store.get(targetId) ??
      this.store.get(`f:${targetId}`) ??
      this.store.all().find((fact) => fact.id === targetId || fact.id === `f:${targetId}`);
    if (!target) {
      return decide({
        action: 'reject',
        accepted: false,
        reason: '未找到待撤销事实',
        reject_code: 'not_found',
      });
    }

    const affected = [target.id];
    this.store.update(target.id, {
      status: 'deleted',
      recorded_time: { from: target.recorded_time.from, to: ctx.now },
    });
    // 派生事实级联撤销，避免错误事实被后续查询继续引用。
    for (const derived of this.store.all()) {
      if (derived.status === 'accepted' && derived.derived_from.includes(target.id)) {
        this.store.update(derived.id, {
          status: 'deleted',
          recorded_time: { from: derived.recorded_time.from, to: ctx.now },
        });
        affected.push(derived.id);
      }
    }
    return decide({
      action: 'delete',
      accepted: true,
      reason: '按撤销策略标记删除，并记录变更（非普通事实更新）',
      affected,
    });
  }
}
