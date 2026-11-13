/**
 * 结构校验、关系白名单与「指令 / 权限声明」识别。
 *
 * 注意：Schema 校验只证明数据符合结构与类型；事实真实性与授权有效性
 * 由来源校验与权限系统判断（README 安全模型）。这里同时拦截明显的
 * 指令型内容，因为「记忆不承载指令」。
 */

import type { CandidateFact, PolicyConfig, RejectCode } from './types';
import { objectLabel } from './types';

export interface ValidationResult {
  ok: boolean;
  code?: RejectCode;
  reason: string;
}

/** 指令面特征：出现在候选事实中即拒绝写入，无论来源是谁。 */
export const INSTRUCTION_PATTERNS: RegExp[] = [
  /ignore (all |any )?(previous|prior|above|earlier) instructions/i,
  /disregard (all |any )?(previous|prior|above|earlier) instructions/i,
  /system\s*prompt/i,
  /you are now (an? )?(admin|administrator|root|system|superuser)/i,
  /jailbreak|prompt injection|developer mode/i,
  /(忽略|无视|忘掉|忘记)(之前|上面|以上|所有|以前|先前)的?(指令|规则|设定|提示词?)/,
  /(现在|立刻|马上|从此)(你就是|你是|成为).{0,8}(管理员|最高权限|root|系统)/,
  /(执行|调用|运行).{0,6}(工具|命令|shell|脚本|terminal)/,
  /(授予|提升|提权|获得|拥有).{0,6}(管理员|最高|root|全部)?权限/,
  /(请|务必).{0,10}(记住并|保存并).{0,6}(执行|授予|提权)/,
  /\[\s*SYSTEM\s*\]|<\s*system\s*>/i,
];

/** 普通记忆不得表达的角色 / 授权声明。 */
export const PRIVILEGE_PREDICATES = new Set([
  'is_admin',
  'has_role',
  'has_permission',
  'grant_permission',
  'can_execute',
  'is_authorized',
  'is_superuser',
  'has_privilege',
  'owns_credentials',
]);

export function looksLikeInstruction(text: string): boolean {
  return INSTRUCTION_PATTERNS.some((pattern) => pattern.test(text));
}

export function validateCandidate(
  candidate: CandidateFact,
  config: PolicyConfig,
): ValidationResult {
  if (!candidate.id || typeof candidate.id !== 'string') {
    return { ok: false, code: 'schema_invalid', reason: '缺少候选 id' };
  }
  if (!candidate.subject || typeof candidate.subject.id !== 'string' || !candidate.subject.id) {
    return { ok: false, code: 'schema_invalid', reason: '主体缺失或非法' };
  }
  if (typeof candidate.predicate !== 'string' || !candidate.predicate.trim()) {
    return { ok: false, code: 'schema_invalid', reason: '关系缺失或非法' };
  }
  if (candidate.object === undefined || candidate.object === null) {
    return { ok: false, code: 'schema_invalid', reason: '客体缺失' };
  }
  if (!candidate.source || typeof candidate.source.event_id !== 'string') {
    return { ok: false, code: 'schema_invalid', reason: '缺少来源引用' };
  }

  const label = objectLabel(candidate.object);
  if (label.length > config.max_object_chars) {
    return { ok: false, code: 'payload_too_large', reason: '客体超过最大长度' };
  }

  // 指令 / 权限声明：安全语义优先于白名单，结构合法也不代表可以持久化。
  const haystack = `${candidate.predicate} ${label} ${candidate.source.excerpt ?? ''}`;
  if (PRIVILEGE_PREDICATES.has(candidate.predicate) || looksLikeInstruction(haystack)) {
    return {
      ok: false,
      code: looksLikeInstruction(haystack) ? 'instruction_like' : 'privilege_escalation',
      reason: '记忆不承载指令，也不授予权限',
    };
  }

  if (!config.allowed_predicates.includes(candidate.predicate)) {
    return {
      ok: false,
      code: 'predicate_not_allowed',
      reason: `关系 ${candidate.predicate} 不在白名单内`,
    };
  }

  return { ok: true, reason: '结构与关系白名单校验通过' };
}
