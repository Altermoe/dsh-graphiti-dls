/**
 * 生产接入 dsh 时启用：把注入消息的 source.kind 声明进 dsh 的 MessageSourceMap。
 *
 * session format V4 在消息准入处拒绝退役的 `{ kind: 'plugin', plugin: ... }`
 * 包装，因此 agent.inject() 的消息必须使用自定义 kind。本仓库没有 dsh 的
 * workspace 依赖，这里以 ambient module declaration 给出契约；
 * 接入 dsh 仓库后可直接改为对真实包的模块增强。
 */
declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    'dls-memory': { kind: 'dls-memory'; turn: number };
  }
}
