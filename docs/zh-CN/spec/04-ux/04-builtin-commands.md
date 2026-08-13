# 04. 内置命令

> **翻译说明：** 本页是与 [英文源规格](/spec/04-ux/04-builtin-commands) 一一对应的机器辅助翻译。代码、协议字段和标识符保持原文；如翻译与英文源事实有歧义，以英文版本为准。


## 1. Goal

定义无需插件即可使用的第一方命令选项板条目。

快捷键：**Cmd/Ctrl + Shift + P** (D014)

## 2. 命令ID约定

```text
builtin.<domain>.<action>
```

## 3. MVP内置目录

| 编号 | 标题 | 关键词 | 类别 | 风险 | 行为 |
|---|---|---|---|---|---|
| `builtin.session.new` | 新任务 | 新任务、会话 | 会议 | 低 | 创建会话并聚焦输入框 |
| `builtin.session.delete` | 删除当前会话 | 删除、会话 | 会议 | 中等 | 确认然后删除活动会话 |
| `builtin.session.rename` | 重命名当前会话 | 重命名、会话 | 会议 | 低 | 打开重命名 UI |
| `builtin.mode.plan` | 切换到 Plan | 模式、计划、规划 | 模式 | 低 | 设置空闲会话模式=计划 |
| `builtin.mode.goal` | 切换到 Goal | 模式、目标、目标、自主 | 模式 | 低 | 设置空闲会话模式=目标 |
| `builtin.mode.agent` | 切换到 Agent | 模式、代理、执行 | 模式 | 低 | 设置空闲会话模式=代理 |
| `builtin.agent.abort` | 中止主动转向 | 中止，停止 | Agent | 低 | 中止当前的 turn/permission 等待 |
| `builtin.agent.compact` | 紧凑的对话环境 | 紧凑、上下文、标记 | Agent | 低 | 为空闲活动会话创建模型上下文检查点 |
| `builtin.project.open` | 开放项目 | 打开、项目、文件夹 | 项目 | 低 | 打开文件夹选择器并绑定工作区 |
| `builtin.project.clear` | 清除项目 | 明确、项目 | 项目 | 低 | 取消绑定工作区 |
| `builtin.settings.open` | 打开设置 | 设置、首选项 | 应用程序 | 低 | 导航设置根目录 |
| `builtin.settings.providers` | 打开提供商设置 | 提供商、模型、密钥 | 设置 | 低 | 导航设置 → Agent → 提供商卡 |
| `builtin.plugins.open` | 打开插件 | 插件、扩展 | 插件 | 低 | 导航插件页面 |
| `builtin.plugins.loadDev` | 加载开发插件 | 加载、开发、插件 | 插件 | 中等 | 选择本地插件目录 |
| `builtin.commandPalette.show` | 显示命令面板 | 调色板、命令 | 应用程序 | 低 | 打开调色板 |
| `builtin.app.reloadWindow` | 重新加载窗口 | 重新加载，窗口 | 应用程序 | 低 | 渲染器重新加载 |
| `builtin.app.toggleDevtools` | 切换开发工具 | 开发工具、调试 | 调试 | 低 | 切换开发工具 (dev/nightly) |
| `builtin.logs.open` | 打开日志 | 日志、诊断 | 诊断 | 低 | 打开日志 panel/path |

> 将 MVP 设置得较小。插件命令动态扩展此列表。

## 4. 可见性规则

- 调试命令可能隐藏在生产版本中
- 插件管理命令始终可用
- 即使没有活动会话，项目命令也可用
- `SubmitPlan` 和 `SubmitGoal` 是模型工具，而不是调色板命令。模式
  命令是
  仅在空闲会话时接受；没有聊天模式或请求更改
  别名。
- 模式命令使用与 Composer 相同的活动会话配置路径
  Agent/Plan/Goal 芯片。当没有会话处于活动状态时，它们会更新持久的
  默认
  下一届会议；正在运行的会话或待批准的会话不会更改。

## 5. 执行结果

命令返回：

```ts
type CommandExecutionResult =
  | { ok: true; navigation?: string; message?: string }
  | { ok: false; error: AppError }
```

## 6. 验收

1.所有内置ID都是唯一的并且有前缀
2. 调色板搜索匹配 title/keywords
3. 模式切换命令立即更新空闲会话模式； Plan、Goal、
   和 Agent 引用相同的 pi Agent
4. 中止命令在流和权限挂起期间有效
5.即使自动上下文保护被禁用，Compact也会在空闲时工作
   并在 turn/checkpoint 有效期间返回 `AGENT_BUSY`

## 7. Composer 斜杠别名 (D123, ADR 0024)

内置命令通过短别名显示在输入框 `/` 菜单中
在提供调色板搜索的同一注册表中定义
（`electron/main/builtin-commands.ts`）；执行重用渲染器开关。

| 别名 | 调色板 ID |
|---|---|
| `/new` | `builtin.session.new` |
| `/delete-task` | `builtin.session.delete` |
| `/abort` | `builtin.agent.abort` |
| `/compact` | `builtin.agent.compact` |
| `/agent-mode` | `builtin.mode.agent` |
| `/plan-mode` | `builtin.mode.plan` |
| `/goal-mode` | `builtin.mode.goal` |
| `/open-project` | `builtin.project.open` |
| `/clear-project` | `builtin.project.clear` |
| `/settings` | `builtin.settings.open` |
| `/providers` | `builtin.settings.providers` |
| `/import` | `builtin.settings.import` |
| `/plugins` | `builtin.plugins.open` |
| `/load-plugin` | `builtin.plugins.loadDev` |
| `/logs` | `builtin.logs.open` |

别名与模板和插件命令名称共享一个命名空间；内置的
别名赢得冲突，然后是项目模板，然后是用户模板，然后
插件命令。选择别名插入 `/alias `；发送执行它
单独发送别名时，无需在本地创建会话或提示。
Agent/Plan/Goal 别名还支持提示正文：`/agent-mode <prompt>`，
`/plan-mode <prompt>` 或 `/goal-mode <prompt>` 切换空闲会话（或
下一个会话默认值）
并通过正常提示路径发送 `<prompt>`。提示体仍然存在
可见的用户回合；失败的发送不会清除输入框草稿。
