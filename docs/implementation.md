# 实施说明：DLS 如何挂到 DeepSeek Harness

> 结论先行：**DLS 是一个新的能力接缝（capability seam），不是对 agent loop 打补丁。**
> 三角色落点：Service Definition = `ctx.dlsMemory`；Service Provider = `src/dsh/plugin.ts` 的
> `DlsMemoryService`；Consumer = `agent/pre-step` 监听器 + `agent.inject()`。
> 插件只依赖 `@deepseek-ai/dsh-agent` 的事件与服务，**不依赖 `@deepseek-ai/dsh-agent-loop`**。
> 本文中的文件路径均相对仓库根目录。

## 一、为什么是「挂插件」而不是改循环

dsh 的底座是 Cordis：产品的每一部分都是插件，包括模型适配器、工具注册表、会话日志和
agent loop 本身。README「添加模型可见上下文」在 `docs/architecture.zh.md` 的「新行为的归属位置」
表里给出的机制是 **`agent.inject()`**——它会落到下一次获准的请求中。因此 DLS 没有改动
`packages/core/agent-loop`，只在已有的扩展点上注册服务与监听器。

本次复核的是 WSL2 本地工作区副本（`v0.2.2-rc.2`），以下结论均回到源码与中文文档验证：

| 结论 | 依据 |
|---|---|
| `inject(input: UserMessage)` 把消息投递为 `next-step`、且不唤醒 agent | `packages/core/agent-loop/src/agent.ts:188`；`packages/core/agent/src/runtime-types.ts:271` |
| `agent/pre-step` 是 waterfall，签名带 `next(): Promise<PreStepDecision>` | `packages/core/agent/src/runtime-types.ts:351` |
| waterfall 监听器必须调用 `next()`，否则静默掐断后续监听器 | `docs/architecture.zh.md:112` |
| 「模型可见即已记录」：注入的消息会进会话日志 | `docs/architecture.zh.md:118`；`docs/cookbook/adding-a-tool.zh.md:50` |
| 注入消息必须用自定义 `MessageSourceMap` kind（V4 拒绝退役的 `{kind:'plugin'}` 包装） | `docs/cookbook/adding-a-tool.zh.md:50` |
| Service 通过 `declare module '@deepseek-ai/cordis' { interface Context { ... } }` 声明 | `packages/core/system-prompt/src/index.ts:14` |
| `insert` 才新增 profile 条目，`- id:` 只覆盖已有行 | `packages/bundle/base/cordis.patch.yml` |

## 二、三角色（capability seam = 完整能力）

> seam 是完整能力，不是其中任何一个角色，也不是 TypeScript `interface`——Definition 是
> Cordis `Service`（抽象类或具体注册表）。只谈 Service Definition 就说「这是个 seam」是错的。

| 角色 | 落点 | 职责 |
|---|---|---|
| Service Definition | `ctx.dlsMemory`（插件声明的新 `Context` 键） | 向共享上下文贡献一个可供其它插件注入的服务 |
| Service Provider | `src/dsh/plugin.ts` → `DlsMemoryService` → `DlsMemorySystem` | 持有受控写入、双时态图谱、检索、编译、审计 |
| Consumer | `agent/pre-step` 监听器（消费已领取消息）+ `agent.inject()`（消费编译结果） | 在轮次边界刷新记忆并注入下一次请求 |

> 注册方式：Host 入口（`src/dsh/host.ts`）用 `ctx.provide('dlsMemory', service)`
> 注册服务，归属当前 fiber；`createDlsPlugin` 里对 `childCtx` 的属性赋值只是
> 最小契约测试的替身，不代表真实注册路径。

Cordis 习惯（本仓库首次涉及，给出准确含义）：

- **`ctx.inject([...], callback)` 声明依赖**，不是 import：插件声明 `inject: ['agents']`
  （AgentRegistry 的真实服务键），等服务就绪才启动，加载顺序由依赖表达，而非手动编排。
- **`ctx.<key>` 才是服务容器**：插件不直接 import 别的插件，而是声明注入后从 `ctx` 取。
- **注册是可逆副作用**：`ctx.inject` 回调内的服务与监听器随插件卸载自动撤销，
  不写「手动清理注册表」这种反模式。
- **scope 只有两层且不继承**：本插件不做作用域化注册，隔离靠 `FactScope` 数据表达
  （`user_id` / `project_id` / `session_id` / `agent_id` / `scene`），不靠 scope 结构。

## 三、事件域与持久性（最易说错的部分）

| 项 | 分类 | 说明 |
|---|---|---|
| `agent/pre-step` | **实时扩展点**（waterfall） | 监听器必须 `await next()`；包装时用 `{ ...decision, messages }` 保留 `startsRequestSeries` 等声明 |
| `agent.inject()` 注入的消息 | **模型可见输入 → 自动成为持久会话事件** | 满足「模型可见即已记录」不变量；**不要再写一份 `SessionEventMap`** |
| DLS 事实本身 | **外部状态**（Graphiti），不是会话事件 | 不放进 Session 日志，不扩展 `SessionEventMap`，不改变已发布 Session 格式代际 |
| 消息来源 | `source.kind = 'dls-memory'`，需在 `MessageSourceMap` 声明 | 见 `src/dsh/message-source.d.ts`；V4 会拒绝 `{kind:'plugin'}` 旧包装 |
| 权限判断 | 应用侧工具边界 | 身份作用域由 host 注入 `payload.dlsScope`，不采信对话文本自称的身份 |

插件在 `decision.kind === 'reject'` 或缺少应用侧身份时直接返回，**不写、不注入**；
记忆路径异常被吞掉，不阻断轮次（生产应在此上报可观测事件）。

## 四、模块结构

```
src/
├── model/          逻辑记忆模型、来源/信任/状态枚举、Schema 校验、关系白名单、冲突分类
├── policy/         受控写入：结构 → 信任与权限 → 作用域 → 冲突 → 写入/拒绝 → 审计
├── store/          GraphitiPort 契约；InMemoryBitemporalStore（参考实现）；GraphitiHttpAdapter
├── compiler/       检索器（相关性/信任/时效/冲突排序 + 受控邻居扩展）、Token 预算编译器
├── audit/          审计日志、来源追溯、撤销与级联删除
├── dsh/            Cordis 插件适配层（三角色）
├── eval/           评测集、9 个对比系统、9 个消融系统、指标、运行器、报告、CLI
└── dls.ts          门面：DlsMemorySystem（插件与评测共用）
```

### 关键设计决策

1. **默认后端是 `InMemoryBitemporalStore`，不是真实 Graphiti 服务。**
   它是 `GraphitiPort` 的参考实现，用纯内存结构表达 README 定义的双时态语义
   （`valid_time` / `recorded_time` / 失效 / 溯源），使评测无需 Neo4j + LLM 即可离线复现。
   这不是「简化掉 Graphiti」，而是把「逻辑事实 ⇄ 图谱后端」的映射集中到适配层：
   生产注入实现 `GraphitiPort` 的适配器即可，上层（插件、编译器、评测）不改。
   `src/store/graphiti-http.ts` 给出真实服务的 episode/edge 字段映射与异步客户端契约。
2. **评测协议确定性**：固定抽取器输出（预标注候选事实）+ 统一 answerer，
   把 LLM 抽取/生成质量从指标中隔离出去。详见 `docs/experiment-report.md`「已知偏差」。
3. **消融开关是一等配置**：`DlsConfig.ablation` 的 7 个开关控制各组件走「无策略」路径，
   用于量化每个组件的贡献；关闭某组件不是把校验结果丢掉，而是替换整条路径。
4. **旧事实不复活**：检索器的邻居扩展跳过 `invalidated` / `deleted` 事实，
   且带现实时间点的回溯查询不做邻居扩展，避免把「后来才知道的修订」带进历史状态。
   这是实施过程中通过实验发现并修复的真实缺陷（见实验报告）。

## 五、生产接入清单（README「技术与部署边界」）

接入真实 Graphiti 服务前必须确认：

- API 版本与兼容策略：`GraphitiServiceConfig.apiVersion`；升级 `graphiti-core` 时回归 `tests/` 与字段映射。
- 身份传递：`group_id` 由 `scopeKey()` 派生，**服务端必须按应用侧身份复核**，不信任客户端声明。
- episode 保存行为：默认 `episode_body` 只含结构化事实、不含原始对话全文；需验证后端没有
  在日志里偷偷持久化原文（README「来源记录与原始文本保留」）。
- 超时、重试、幂等键（`fact.id`）与故障降级：由调用方队列实现，
  `GraphitiServiceClient` 只给请求构造与超时。
- 日志中的敏感数据处理与保留期限。
- 完整 boot：先 `dsh plugin --profile <name> add <package>` 安装（需发布或 `link` 本仓库），
  再正常启动；`--dump-config` 只验证配置合成。本机 `web` profile 已完成这一步，
  见第六节。

## 六、真实 DSH 实例接入与实例内评测

本仓库现在是一个可安装的 profile bundle：`package.json` 的 `dsh.bundle.patch`
指向根目录 `cordis.patch.yml`，其中插入两个 Host 行：

| 行 id | 模块 | 作用 |
|---|---|---|
| `dls-memory` | `dsh-graphiti-dls/dls-memory` | 注册 `ctx.dlsMemory`，监听 `agent/pre-step` |
| `dls-live-eval` | `dsh-graphiti-dls/dls-eval` | 在宿主进程内跑对比/消融并写回 `eval/results/dsh-live/` |

安装（本机 web profile）：

```bash
# 方式一：GUI 的 Plugins 面板选择本地目录（等价于 agent 工具的 install_bundle）
# 方式二：命令行分两步
dsh plugin --profile web add /home/cyrene/codes/dsh-graphiti-dls
# 再把 dsh-graphiti-dls 加入 profile 的 dsh.profile.bundles
```

本次实际使用的是 dsh 的 `plugin_manager` 工具（`install_bundle`，target 为
仓库绝对路径）：它同时完成 pnpm link 与 bundle 选中，并在当前实例内 HMR 激活。

安装后 `dsh-graphiti-dls` 以 `link:` 依赖进入 `~/.dsh/profiles/web`，loader
从 profile 解析 bundle patch。验证结果：

- `plugin_manager` 的 `list_plugins` 中 `include:dls-memory` 为 `active`；
- 实例内评测以 `pid=17183`（`dsh web --no-open` 宿主进程）、`profile=web` 运行，
  `eval/results/dsh-live/summary.json` 记录了宿主 pid、profile、挂载服务与配置；
- `dls-live-eval` 跑完后已禁用，避免每次启动重复执行；记忆插件保持启用。

### 接入过程中修正的真实缺陷

初版 patch 行写的是 `inject: ['agent']`，安装后两个条目一直 `pending
(waiting for service: agent)`。回到 dsh 源码核对：AgentRegistry 的服务键是
`agents`（`packages/core/agent/src/index.ts` 的 `super(ctx, 'agents')`），
`agent` 并不是服务。改为 `inject: ['agents']` 后条目正常激活。这说明
`--dump-config` 只能验证配置合成，不能替代真实装载。

### 运行时前提

当前 web profile 用 `node --import tsx/esm apps/cli/src/bin.ts` 从源码启动，
因此 loader 能直接装载本仓库的 `.ts` 导出；发布或换成预编译 dsh 时需要先
构建 JS 产物。`--dump-config` 集成检查（`pnpm run dsh:integration`）仍保留，
用于验证 profile 组合树，结果见 `eval/results/dsh-integration.md`。

## 七、运行命令

```bash
pnpm install
pnpm run typecheck                 # tsc --noEmit
pnpm run test                      # node --import tsx --test tests/*.test.ts
pnpm run eval:compare              # 对比实验
pnpm run eval:ablation             # 消融实验
pnpm run eval:all                  # 两者 + 导出评测集
pnpm run dsh:integration           # 本地 dsh 配置合成验证（不改 profile）
pnpm run market:catalog            # 重新采集 dshmarket 下载量
```

## 八、版本状态说明

- 本仓库：`0.1.0` 工作区实现，P0 闭环；已作为 bundle 链接进本机 web profile，
  并在真实宿主进程内完成对比/消融复跑。P1（写入审计队列、派生撤销 UI、调试追踪）与
  P2（多 Agent 私有/共享记忆、混合检索、缓存与批处理）未实现。
- dsh 宿主：本地工作区 `v0.2.2-rc.2`；插件按该版本的事件签名与 profile patch 格式编写。
- Session 格式：本实现**不触碰**已发布的 Session generation 路径，
  注入内容由 dsh 自身的 `agent.inject()` 记录，无破坏性变更。
