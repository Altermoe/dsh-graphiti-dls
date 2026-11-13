# 本地 deepseek-harness 集成验证记录

- 时间：2026-11-13
- 宿主：`/home/cyrene/codes/deepseek-harness`（v0.2.2-rc.2 本地构建，node v26.7.0 / pnpm 11.22.0）
- 命令：`pnpm dsh --profile web --patch eval/dls-plugin.patch.yml --dump-config`
- 结果：**通过**。`dls-memory` 作为 `insert` 条目进入 profile 组合树，配置合成成功。
- 完整配置树输出为本地文件 `eval/results/dsh-dump-config.txt`（已在 `.gitignore` 中忽略，含用户本机 profile 配置，不提交）。

组合树中的插件条目（摘自输出第 1536 行起）：

```yaml
- id: dls-memory
  name: dsh-graphiti-dls/dls-memory
  inject:
    - agents
  config:
    identity:
      user_id: local-user
      project_id: dsh-graphiti-dls
    extractExplicit: true
```

## 真实实例装载与实例内评测

`--dump-config` 之后，本仓库已作为 bundle 链接进本机 `web` profile：

- 安装方式：dsh `plugin_manager` 的 `install_bundle`（target 为仓库绝对路径），
  profile `package.json` 中出现 `"dsh-graphiti-dls": "link:/home/cyrene/codes/dsh-graphiti-dls"`，
  并选中对应 bundle。
- 装载结果：`include:dls-memory` 与 `include:dls-live-eval` 均为 `active`；
  实例内评测跑完后 `dls-live-eval` 已禁用，记忆插件保持启用。
- 实例内评测运行于 `pid=17183`（`node --import tsx/esm apps/cli/src/bin.ts web --no-open`），
  `profile=web`，`ctx.dlsMemory` 存在，配置 `max_input_tokens=6000` / `memory_budget_tokens=1800`。
- 对比/消融与进程内直跑逐 case 一致（各 540 个判定单元，0 差异）；
  consumer 注入探针 7 项全过。结果见 `eval/results/dsh-live/`。

## 接入缺陷修正

初版 patch 行写 `inject: ['agent']`，安装后条目持续 `pending
(waiting for service: agent)`。dsh 的 AgentRegistry 服务键实际是 `agents`
（`packages/core/agent/src/index.ts` 的 `super(ctx, 'agents')`）。改为
`inject: ['agents']` 后条目激活。配置合成检查无法发现这类问题，必须以真实
装载为准。

## 说明与边界

- 当前 `web` profile 通过 tsx 从源码启动，loader 可直接装载本仓库 `.ts` 导出；
  发布或换成预编译 dsh 前需要构建 JS 产物。
- 实例内评测的 DLS 臂由插件服务工厂构造（与挂载服务同源），使用独立状态实例，
  不把 60 个虚构 case 写入用户记忆；挂载服务只做存在性与配置核对。
- 运行期间 dsh 打印的 `patch: entry "..." not found` 警告来自用户 `web` profile
  自身的历史 patch 行（如 `docker-all`），与本次新增插件无关。
- 插件行为由 `tests/dsh-plugin.test.ts`、`tests/dsh-host.test.ts` 在最小 Cordis
  契约上验证：`inject` 依赖声明、`ctx.dlsMemory` 服务、`agent/pre-step`
  waterfall 的 `next()` 调用、decision 保留、完整 UserMessage 形状、
  `agent.inject()` 消息来源 kind 与卸载可逆性。
