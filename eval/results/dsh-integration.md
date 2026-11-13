# 本地 deepseek-harness 集成验证记录

- 时间：2026-11-13
- 宿主：`/home/cyrene/codes/deepseek-harness`（v0.2.2-rc.2 本地构建，node v26.7.0 / pnpm 11.22.0）
- 命令：`pnpm dsh --profile web --patch eval/dls-plugin.patch.yml --dump-config`
- 结果：**通过**。`dls-memory` 作为 `insert` 条目进入 profile 组合树，配置合成成功。
- 完整配置树输出为本地文件 `eval/results/dsh-dump-config.txt`（已在 `.gitignore` 中忽略，含用户本机 profile 配置，不提交）。

组合树中的插件条目（摘自输出第 1537 行起）：

```yaml
- id: dls-memory
  name: dsh-graphiti-dls/dls-memory
  inject:
    - agent
  config:
    maxInputTokens: 6000
    memoryBudgetTokens: 1800
    recentTurns: 8
    requireProvenance: true
```

说明：

- `--dump-config` 只做配置合成，不加载插件代码、不启动 app；完整 boot 需要先把本仓库发布或 `link` 进 profile，并配置模型凭据，不在自动化验证范围内。
- 复现：`pnpm run dsh:integration`（可用 `DSH_REPO` / `PROFILE` 环境变量覆盖默认值）。
- 运行期间 dsh 打印的 `patch: entry "..." not found` 警告来自用户 `web` profile 自身的历史 patch 行，与本次新增插件无关。
- 插件行为本身由 `tests/dsh-plugin.test.ts` 在最小 Cordis 上下文契约上验证：`inject` 依赖声明、`ctx.dlsMemory` 服务、`agent/pre-step` waterfall 的 `next()` 调用、decision 保留、`agent.inject()` 消息来源 kind、卸载可逆性。
