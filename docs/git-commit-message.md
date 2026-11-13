# Git 提交信息规范（Gitmoji）

本规范遵循 [gitmoji 官方规范](https://gitmoji.dev/specification)，适用于本仓库的所有提交，包括人类开发者与 AI Agent。

## 一、提交格式

```text
<emoji> [(scope)][:] <message>

[body]

[footer]
```

- **emoji**：必填，从下方速查表中选一个最贴切的表情，使用 Unicode 形式，不写 `:shortcode:`。
- **scope**：可选，用英文小写表示受影响的模块、目录或领域，如 `(graphiti)`、`(compiler)`、`(docs)`、`(deps)`、`(ci)`。
- **message**：必填，简明描述本次变更，默认使用中文，专有名词保留英文。
- 有 scope 时使用英文冒号，无 scope 时不加冒号（与官方示例一致）。

## 二、标题规则

- 长度不超过 50 个字符，硬上限 72 个字符。
- 使用祈使或陈述语气，描述“做了什么”，不写“我修改了”。
- 结尾不加句号、不加感叹号。
- 一次提交只表达一个主要意图，只用一个 emoji。
- 一个提交包含多类变更时，优先拆分提交；无法拆分时选择占比最大、最核心的意图。

## 三、正文与脚注

- 标题不足以说明原因或影响时，空一行后写正文，说明动机、方案和影响，每行不超过 72 个字符。
- 破坏性变更、关联 issue 写在脚注，与正文之间空一行：
  - `BREAKING CHANGE: 说明不兼容变更及迁移方式`
  - `Closes #123` / `Refs #456`

## 四、Emoji 选择规则

| 变更类型 | 推荐 emoji |
|---|---|
| 新增功能 | ✨ |
| 修复缺陷 | 🐛（紧急 → 🚑️，非关键小修 → 🩹） |
| 重构 | ♻️（结构调整/格式化 → 🎨） |
| 性能优化 | ⚡️ |
| 文档 | 📝 |
| 测试 | ✅（先补失败用例 → 🧪） |
| 构建 / CI | 👷（修复 CI → 💚） |
| 配置 / 脚本 | 🔧（开发脚本 → 🔨） |
| 依赖 | ➕ / ➖ / ⬆️ / ⬇️ / 📌 |
| 样式 / UI | 💄 |
| 类型定义 | 🏷️ |
| 回滚 | ⏪️ |
| 合并分支 | 🔀 |
| 破坏性变更 | 💥 |

## 五、Gitmoji 速查表

### 功能与修复

| Emoji | Shortcode | 含义 |
|---|---|---|
| ✨ | `:sparkles:` | 新增功能 |
| 🐛 | `:bug:` | 修复缺陷 |
| 🚑️ | `:ambulance:` | 紧急修复 |
| 🩹 | `:adhesive_bandage:` | 非关键问题的简单修复 |
| 🥅 | `:goal_net:` | 捕获错误 / 补充错误处理 |
| ✏️ | `:pencil2:` | 修正拼写错误 |
| 🚸 | `:children_crossing:` | 改善用户体验 / 可用性 |
| 👔 | `:necktie:` | 新增或更新业务逻辑 |

### 重构与代码质量

| Emoji | Shortcode | 含义 |
|---|---|---|
| ♻️ | `:recycle:` | 重构代码（不改变外部行为） |
| 🎨 | `:art:` | 改进代码结构 / 格式 |
| 💡 | `:bulb:` | 新增或更新源码注释 |
| 🔥 | `:fire:` | 删除代码或文件 |
| ⚰️ | `:coffin:` | 删除死代码 |
| 🗑️ | `:wastebasket:` | 标记废弃代码，待清理 |
| 💩 | `:poop:` | 写入需要改进的坏代码 |
| 🚨 | `:rotating_light:` | 修复编译器 / linter 警告 |
| 🧵 | `:thread:` | 多线程 / 并发相关 |
| 🦺 | `:safety_vest:` | 校验 / 验证相关 |
| 🦖 | `:t-rex:` | 添加向后兼容代码 |
| 🏗️ | `:building_construction:` | 架构层面变更 |
| 🧑‍💻 | `:technologist:` | 改善开发者体验 |

### 性能与交互

| Emoji | Shortcode | 含义 |
|---|---|---|
| ⚡️ | `:zap:` | 提升性能 |
| ♿️ | `:wheelchair:` | 改善可访问性 |
| 📱 | `:iphone:` | 响应式设计 |
| 💫 | `:dizzy:` | 新增或更新动画与过渡 |
| 💄 | `:lipstick:` | 新增或更新 UI 与样式文件 |
| 🌐 | `:globe_with_meridians:` | 国际化与本地化 |
| ✈️ | `:airplane:` | 改善离线支持 |
| 🔍️ | `:mag:` | 改善 SEO |

### 测试与 CI

| Emoji | Shortcode | 含义 |
|---|---|---|
| ✅ | `:white_check_mark:` | 新增、更新或通过测试 |
| 🧪 | `:test_tube:` | 添加一个失败的测试 |
| 📸 | `:camera_flash:` | 新增或更新快照 |
| 👷 | `:construction_worker:` | 新增或更新 CI 构建系统 |
| 💚 | `:green_heart:` | 修复 CI 构建 |
| 🤡 | `:clown_face:` | Mock 相关 |

### 依赖与构建

| Emoji | Shortcode | 含义 |
|---|---|---|
| ➕ | `:heavy_plus_sign:` | 新增依赖 |
| ➖ | `:heavy_minus_sign:` | 移除依赖 |
| ⬆️ | `:arrow_up:` | 升级依赖 |
| ⬇️ | `:arrow_down:` | 降级依赖 |
| 📌 | `:pushpin:` | 将依赖固定到指定版本 |
| 📦️ | `:package:` | 新增或更新编译产物 / 包 |
| 🔨 | `:hammer:` | 新增或更新开发脚本 |
| 🧱 | `:bricks:` | 基础设施相关变更 |

### 配置、部署与安全

| Emoji | Shortcode | 含义 |
|---|---|---|
| 🔧 | `:wrench:` | 新增或更新配置文件 |
| 🚀 | `:rocket:` | 部署 |
| 🔖 | `:bookmark:` | 发布 / 版本标签 |
| 🔐 | `:closed_lock_with_key:` | 新增或更新密钥 |
| 🔒️ | `:lock:` | 修复安全或隐私问题 |
| 🛂 | `:passport_control:` | 授权、角色与权限相关 |
| 🚩 | `:triangular_flag_on_post:` | 新增、修改或移除功能开关 |
| 🔀 | `:twisted_rightwards_arrows:` | 合并分支 |
| ⏪️ | `:rewind:` | 回滚变更 |
| 💥 | `:boom:` | 引入破坏性变更 |
| 🎉 | `:tada:` | 初始化项目 |
| 🚧 | `:construction:` | 进行中的工作 |

### 数据、资源与文案

| Emoji | Shortcode | 含义 |
|---|---|---|
| 🗃️ | `:card_file_box:` | 数据库相关变更 |
| 🌱 | `:seedling:` | 新增或更新种子数据 |
| 🍱 | `:bento:` | 新增或更新资源文件 |
| 🚚 | `:truck:` | 移动或重命名文件 / 路径 / 路由 |
| 🏷️ | `:label:` | 新增或更新类型定义 |
| 🙈 | `:see_no_evil:` | 新增或更新 .gitignore |
| 📄 | `:page_facing_up:` | 新增或更新许可证 |
| 👥 | `:busts_in_silhouette:` | 新增或更新贡献者信息 |
| 📝 | `:memo:` | 新增或更新文档 |
| 💬 | `:speech_balloon:` | 新增或更新文案 / 字面量 |
| 🍻 | `:beers:` | 醉醺醺地写代码 |
| 🥚 | `:egg:` | 新增或更新彩蛋 |
| 💸 | `:money_with_wings:` | 赞助或资金相关基础设施 |

### 日志、观测与兼容

| Emoji | Shortcode | 含义 |
|---|---|---|
| 🔊 | `:loud_sound:` | 新增或更新日志 |
| 🔇 | `:mute:` | 移除日志 |
| 📈 | `:chart_with_upwards_trend:` | 新增或更新分析 / 埋点 |
| 🩺 | `:stethoscope:` | 新增或更新健康检查 |
| 🧐 | `:monocle_face:` | 数据探索 / 检查 |
| ⚗️ | `:alembic:` | 实验性变更 |
| 👽️ | `:alien:` | 因外部 API 变更而更新代码 |

## 六、示例

```text
✨ 新增记忆候选抽取接口与 schema 校验
```

```text
🐛 (graphiti): 修复边失效时间未写回图谱的问题
```

```text
♻️ (compiler): 拆分上下文编译器的预算计算逻辑
```

```text
📝 补充 DLS 与原生 Graphiti 的评测基线说明
```

```text
⬆️ (deps): 将 graphiti-core 升级到 0.5.0
```

```text
✨ (compiler): 支持按类别分配 Token 预算

将单一预算改为按系统规则、近期对话、长期记忆分档配置，
并记录被裁剪事实及原因。

Closes #42
```

```text
💥 (api): 调整记忆写入接口的返回结构

BREAKING CHANGE: `POST /memory/candidates` 由返回候选 ID 改为返回完整状态对象。
```

## 七、禁止事项

- 不使用 `feat:`、`fix:`、`chore:` 等 Conventional Commits 类型前缀，意图由 emoji 表达。
- 不堆叠多个 emoji，不在正文中重复标题。
- 不使用“更新”、“修改”、“优化一下”等无信息量的描述。
- 不在标题末尾加句号，不使用 `update files`、`fix bug` 这类空泛表述。
- 不把无关变更塞进同一个提交。

## 八、输出要求（面向 AI Agent）

生成提交信息时，只输出最终提交信息文本，不使用代码块包裹，不附加解释、前缀或“以下是提交信息”之类的说明。
