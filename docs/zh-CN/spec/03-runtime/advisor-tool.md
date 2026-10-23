# Advisor 工具

> **翻译说明：** 本页是与 [英文源规格](/spec/03-runtime/advisor-tool) 一一对应的机器辅助翻译。代码、协议字段和标识符保持原文；如翻译与英文源事实有歧义，以英文版本为准。

Advisor 工具允许主会话在任务过程中向一个已配置的第二模型请求指导。执行者以无参数方式调用 `Advisor`。运行时把到目前为止的对话发送给 advisor 模型，并把其回复作为工具结果返回。advisor 没有工具，因此它的回复无法直接作用于宿主。该回复只是建议：工具结果会提示执行者在行动前先验证。

## 范围

- 仅限主会话，在 Agent、Plan 和 Goal 模式中可用（ADR 0319）。团队角色和子代理运行从不接收该工具，Electron 启动也不会为团队 profile 解析固定项。
- 在 Plan 和 Goal 中，咨询保持只读：它不写入任何内容，advisor 模型也不获得工具。该调用在运行时内部执行，永不到达 Host，因此没有权限规则会对其分类，任何权限模式下都不会出现审批弹窗。设置中的固定项即为同意。
- 在用户选择模型之前处于关闭状态。没有内置 advisor。

## 设置

- `advisorProviderId` 和 `advisorModelId` 是 `AppSettings` 字段。缺省或为 `null` 时表示关闭。
- 设置 → AI 中，Prompt 增强之后有一个 Advisor 卡片。其行使用共享的模型选择器（`ModelPinMenu`），列出 Composer 提供的模型。菜单第一行 `Off` 用于清除固定项。
- 清除时两个 id 都写入 `null`。`settings.set` 会合并到已保存的对象中，因此删除键会保留旧的固定项。空的 provider id 不指向任何 provider，配置同步会拒绝它（见配置同步）。
- 选择器无法列出的固定项（provider 已删除或已禁用，或模型未提供）会被保留。该行会以 `Unavailable` 提示显示它。

## 启动

- `resolveAdvisorProvider` 按子代理绑定规则（`bindProviderModel`）解析固定项。API key provider 需要已保存的 key。厂商账号（OAuth）provider 需要已登录的目录绑定，由 Electron 主进程提供。无头 host 会把此类固定项报告为不可用。
- 结果为关闭、就绪（向 sidecar 传递一个 provider 绑定）或不可用。不可用会以 `advisor model unavailable` 及原因写入日志，会话在没有该工具的情况下启动。过期的固定项从不阻止会话。
- 运行时的配置匹配包含 advisor 绑定。更改或清除固定项会使空闲的运行时退役。

## 工具契约

- 名称 `Advisor`。无参数。顺序执行。
- 每个用户回合最多 5 次调用（`ADVISOR_MAX_CALLS_PER_TURN`）。下一回合开始时计数重置。超过上限的调用返回 `Advisor failed: the limit of 5 advisor calls for this turn was reached`，且不发出 provider 请求。
- advisor 请求是一次补全，使用内置的审查系统提示词，对话记录放在 `<transcript>` 块中。思考级别为 `medium`。输出上限为 8,192 个 token。系统提示词要求回复不超过 400 个词。
- 成功时返回的文本以 `Advisor guidance (advisory output from another model; verify it before acting):` 开头，且 `details.ok` 为 true。
- 失败时返回 `Advisor failed: <reason>`，`details.ok` 为 false，回合继续。原因包括 provider 错误、空回复（`ADVISOR_EMPTY_REPLY`），以及对话记录放不下。
- 来自会话的中止会被重新抛出，因此 agent 循环停止。它永远不会被转换为工具结果。

## 对话记录

- advisor 读取执行者下一次请求所携带的对话，并将其序列化为纯文本。私有推理会被移除。尚无结果的工具调用也会被移除，包括请求审查的那次 `Advisor` 调用。
- 如果对话记录超过 advisor 模型的输入上限（即其上下文硬上限减去为 advisor 自身提示词保留的 1,024 个 token），长的工具结果会用压缩所用的同一缩减器缩短。如果仍然放不下，调用会在发出任何 provider 请求之前失败，并报错 `the conversation is larger than the advisor model's input window`。

## 隐私

- 一次调用会把对话记录发送给所选的 advisor provider，它可以与会话的 provider 不同。该设置默认关闭。卡片描述会说明对话将发送给用户所选的 provider。
- 思考块不会被发送。

## 配置同步

- 两个 advisor 字段都是可移植的应用字段。非空的 `advisorProviderId` 若不指向任何 provider，则是一个延后的配置同步依赖（`CONFIG_SYNC_DEPENDENCY`）。`null` 固定项没有依赖。

## 范围之外

- 没有逐次调用的卡片。一次调用显示为名为 `Advisor` 的普通工具行。
- 模型在调用时无法选择 advisor。固定项是唯一的 advisor。
- 没有面向子代理或团队角色的工具。

## 验证

- 场景 `E2E-ADVISOR-off-until-a-model-is-picked`、`E2E-ADVISOR-clear-row-returns-to-off` 和 `E2E-ADVISOR-stale-pin-keeps-the-session-running` 已在 `scripts/e2e-advisor.mjs` 中自动化（`pnpm test:e2e:advisor`，nightly 层级），如 [英文源 E2E 测试计划](/spec/06-delivery/04-e2e-test-plan) 所记录。该运行是完整的 Electron 应用，使用回环夹具：会话 provider 与 advisor 固定项是同一服务器上的两个端点。它断言：未选择模型或所选模型不可用时，会话请求声明 `Read` 而从不声明 `Advisor`；任何场景中都没有聊天请求到达 advisor 端点；清除固定项后存储的是显式 `null`，并在重启后保持；应用日志记录了 `advisor model unavailable`。
- 单元与集成覆盖：`packages/agent-runtime` 中的 `advisor-tool.test.ts`、`advisor-provider.test.ts` 和 `fixed-tool-runtime.test.ts`；`runtime-configuration.test.ts` 中的配置匹配；`packages/host-runtime` 中的启动解析器；`crates/host-core` 中的配置同步引擎；以及 `apps/desktop/test` 中的 `advisor-pin.test.mjs` 和 `advisor-card.test.mjs`。
