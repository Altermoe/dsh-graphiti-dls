import assert from 'node:assert/strict';
import { test } from 'node:test';

import defaultPlugin, {
  apply,
  createServiceFromConfig,
  handlePreStep,
  resolveHostConfig,
  resolveScope,
} from '../src/dsh/index';
import type { DlsInjectedMessage, DshContext, PreStepDecision, PreStepPayload } from '../src/dsh/plugin';
import { runConsumerProbe } from '../src/eval/live';
import { cloneConfig } from '../src/model/types';

type Listener = (
  payload: PreStepPayload,
  next: () => Promise<PreStepDecision>,
) => Promise<PreStepDecision>;

class HostMockContext {
  readonly listeners = new Map<string, Listener>();
  readonly services = new Map<string, unknown>();
  [key: string]: unknown;

  provide(name: string, value: unknown): () => void {
    this.services.set(name, value);
    return () => this.services.delete(name);
  }

  on(event: 'agent/pre-step', listener: Listener) {
    this.listeners.set(event, listener);
    return { dispose: () => this.listeners.delete(event) };
  }
}

const CANDIDATE_LINE =
  '[dls] {"id":"c1","subject":{"id":"npc:alice","type":"character"},"predicate":"owns_item","object":"银月长枪"}';

function makePayload(over: Partial<PreStepPayload> = {}): {
  payload: PreStepPayload;
  injected: DlsInjectedMessage[];
  decisions: PreStepDecision[];
} {
  const injected: DlsInjectedMessage[] = [];
  const decisions: PreStepDecision[] = [{ kind: 'accept' }];
  const payload: PreStepPayload = {
    agent: { id: 'session-1', inject: (message) => injected.push(message) },
    messages: [{ content: [{ type: 'text', text: CANDIDATE_LINE }], source: { kind: 'user' } }],
    turn: 3,
    step: 1,
    ...over,
  };
  return { payload, injected, decisions };
}

test('bundle 默认导出是可被 loader 装载的 apply 函数', () => {
  assert.equal(defaultPlugin, apply);
  assert.equal(typeof defaultPlugin, 'function');
});

test('host 插件注册 ctx.dlsMemory 服务并监听 agent/pre-step', () => {
  const ctx = new HostMockContext();
  apply(ctx as unknown as DshContext, {
    identity: { user_id: 'u1', project_id: 'p1' },
    extractExplicit: true,
  });
  assert.ok(ctx.services.get('dlsMemory'));
  assert.ok(ctx.listeners.has('agent/pre-step'));
});

test('真实 UserMessage 形状：id/role/source/content 合法且保留 decision', async () => {
  const ctx = new HostMockContext();
  apply(ctx as unknown as DshContext, {
    identity: { user_id: 'u1', project_id: 'p1' },
    extractExplicit: true,
  });
  const listener = ctx.listeners.get('agent/pre-step')!;
  const { payload, injected, decisions } = makePayload();
  const decision = decisions[0]!;
  const result = await listener(payload, async () => decision);

  assert.equal(result, decision);
  assert.equal(injected.length, 1);
  const message = injected[0]!;
  assert.equal(typeof message.id, 'string');
  assert.ok(message.id.length > 0);
  assert.equal(message.role, 'user');
  assert.equal(message.source.kind, 'dls-memory');
  assert.equal(message.source.turn, 3);
  assert.ok(Array.isArray(message.content));
  assert.match(message.content[0]!.text, /<dls-memory>/);
  assert.match(message.content[0]!.text, /银月长枪/);
});

test('缺少应用侧身份时不写、不注入', async () => {
  const ctx = new HostMockContext();
  apply(ctx as unknown as DshContext, { extractExplicit: true });
  const listener = ctx.listeners.get('agent/pre-step')!;
  const { payload, injected } = makePayload();
  const decision: PreStepDecision = { kind: 'accept' };
  const result = await listener(payload, async () => decision);
  assert.equal(result, decision);
  assert.equal(injected.length, 0);
});

test('reject 轮次不进入写入与注入', async () => {
  const ctx = new HostMockContext();
  apply(ctx as unknown as DshContext, {
    identity: { user_id: 'u1' },
    extractExplicit: true,
  });
  const listener = ctx.listeners.get('agent/pre-step')!;
  const { payload, injected } = makePayload();
  const reject: PreStepDecision = { kind: 'reject' };
  const result = await listener(payload, async () => reject);
  assert.equal(result, reject);
  assert.equal(injected.length, 0);
});

test('作用域解析：显式 dlsScope 优先，否则由配置身份与 session id 派生', () => {
  const { payload } = makePayload({ dlsScope: { user_id: 'explicit' } });
  assert.deepEqual(resolveScope(payload, { identity: { user_id: 'cfg' } }), {
    user_id: 'explicit',
  });
  assert.deepEqual(
    resolveScope(makePayload().payload, { identity: { user_id: 'cfg', project_id: 'proj' } }),
    { user_id: 'cfg', project_id: 'proj', session_id: 'session-1', scene: undefined },
  );
  assert.equal(resolveScope(makePayload().payload, {}), undefined);
});

test('patch config 只覆盖给出的字段，其余落回默认值', () => {
  const defaults = cloneConfig();
  const config = resolveHostConfig({
    context: { memory_budget_tokens: 900 },
    ablation: { audit: false },
  });
  assert.equal(config.context.memory_budget_tokens, 900);
  assert.equal(config.context.max_input_tokens, defaults.context.max_input_tokens);
  assert.equal(config.ablation.audit, false);
  assert.equal(config.ablation.write_policy, true);
});

test('实例内 consumer 探针：注入并持久化显式事实', async () => {
  const probe = await runConsumerProbe();
  assert.equal(probe.ok, true, probe.checks.join(' / '));
  assert.equal(probe.source_kind, 'dls-memory');
  assert.equal(probe.fact_persisted, true);
});

test('handlePreStep 失败被吞掉，不阻断轮次', async () => {
  const service = createServiceFromConfig(cloneConfig());
  const { payload } = makePayload();
  const decision: PreStepDecision = { kind: 'accept' };
  const result = await handlePreStep(service, payload, async () => decision, {
    scope: payload.dlsScope!,
    now: () => '2026-11-13T00:00:00.000Z',
    extractCandidates: () => {
      throw new Error('extractor down');
    },
  });
  assert.equal(result.decision, decision);
  assert.equal(result.injected, undefined);
});
