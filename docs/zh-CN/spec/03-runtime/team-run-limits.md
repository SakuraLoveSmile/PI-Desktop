# Host 管理的团队运行时限（WP8）

> [英文源规格](/spec/03-runtime/team-run-limits)

Host 使用墙上时钟限制专家团队反复验证/修复循环。本规则适用于普通 Agent、Plan 研究以及已批准的 Goal/Plan 执行；标准独立会话保留现有行为。

## 策略与用户路径

设置 → 专家团队 → 用户范围包含**团队运行时限**，使用现有设置控件和 expert-policy compare-and-swap 写入器。可选的附加字段 `expertTeam.runLimits` 为 `{ enabled: boolean, softMs: integer, hardMs: integer }`。缺少该字段的旧策略默认启用，软限额为 21,600,000 ms（6 小时），硬限额为 36,000,000 ms（10 小时）。要求 `0 < softMs < hardMs <= Number.MAX_SAFE_INTEGER`；`null`、小数、未知字段和不完整的显式策略均无效。界面中的小时数转换为整数毫秒。策略实时生效且作用于整个用户，不是成员工具授权。

运行身份是 Host 编写的既有 `team-strategy-scope-v1` Lead 用户回合。新获准的非邮箱 Lead 用户回合会建立新运行。邮箱续接、暂停/恢复、提供商重试和进程重启都不会重置时钟。仅仅排在暂停团队之后的请求不能重置其预算或解除暂停。旧团队首次在新代码下实际执行时才开始计时；不使用历史 `teams.created_at`。

当 Lead/成员回合正在运行、团队邮件已排队或团队拥有待处理的回合队列工作时，运行才算活动。已完成、队列为空且空闲的团队不会收到限额通知，也不会被合成唤醒。硬限额暂停的运行在重启后仍保持暂停。现有 Resume 操作在当前硬策略仍超限时返回 `TEAM_RUN_LIMIT_REACHED`；必须先延长或关闭策略，再显式恢复。恢复保留运行身份和已累计的耗时高水位。新 session 是独立运行；没有重置预算或自动解除暂停的界面。

## 时钟、持久化与影响

`team/run_limits.rs` 管理以 Team id 为键的 `team-run-limits-v1` KV 记录：`{ runId, startedAt, elapsedMs, softMessageId, hardReachedAt }`。墙上时钟在暂停/离线期间继续计时；持久化的 `elapsedMs` 在一次运行内是非递减高水位，因此系统时钟回拨或重启不会退还已耗时间。不需要 SQLite schema/version 变更。RPC server 拥有一个每秒调度器，会跳过错过的 tick，并在关闭时终止。Host 调度延迟可能推迟检测；该边界不是实时进程终止期限。

达到软限额时，在事务中创建一条 Host 编写的邮箱收尾消息，幂等键为 `team-run-limit-soft:<runId>`，并持久化其确切 ID。匹配的 `team.changed` 通知会触发本地化 toast/原生横幅。即使错过瞬时原生通知，团队面板在重启后仍会保留状态。消息使用现有认证 user-role 投递路径。此 Host 编写的通知仍等普通 Agent 回合结束才续接；S3 普通专家报告 inbox 不扩大其来源证明。已批准执行可在其既有 execution inbox 中读取这条绑定特定 Host 证明的消息。模型撰写的正文或幂等键不能伪造证明、权限或执行范围。

达到硬限额时，复用现有持久化团队暂停与队列保持机制。手动暂停队列并不能豁免仍在运行的回合受到硬限额约束。Host 通过现有 Plan manager 将仍在运行的已批准 Goal 执行结束为 `interrupted`，包括令牌失效。Main 在下一个 assistant/tool-batch 边界请求安全停止运行时，使用仅 Host 可用的 `agent.stop({ sessionId, turnId, preserveRunningTools: true })` 扩展。此路径绕过普通用户停止的 peer-abort hook。仅作用于 provider 的 abort signal 会同时阻止请求级重试和外层流重试退避，包括无限重试模式；它绝不会取消 Agent/tool signal。停止准入状态持续到 Host 下次准入回合。显式恢复后重新开放 runtime 准入不会重置 Host 运行时钟。硬限额之后到达的模型响应不能准入新的工具批次；硬限额前已准入的批次会自然完成。前台工具批次自然结算；普通后台命令不会停止；显式 WP14 服务按其[所属生命周期](/zh-CN/spec/03-runtime/team-managed-services)在任何团队暂停时停止。shell 容量/FIFO/普通命令超时不变。待恢复期间，安全边界会先清除恢复状态，再进入下一轮迭代。普通用户 Stop 保留既有行为。团队面板会区分安全收尾与完全暂停，并在关闭或延长策略允许恢复时显示明确的可恢复提示。

如果投递失败或发生重启，调度器会针对同一暂停运行重试安全停止/Goal 结算；重复请求不会启动替代回合。邮件保持持久且暂停。WP8 不虚构费用估算或可选 LLM 调用次数限制；只实现墙上时钟限额。

## 兼容投影与验证

`team.getSnapshot` 和 `team.getRoster` 增加可选 `runLimits`，组合策略与持久化运行状态。旧记录/消费者仍有效；不会扩大 execution token、工具权限、冻结的 shell 额度或公开 renderer IPC。

验收场景为交付 E2E 计划中的 E2E-TEAM-bounded-run-limit。使用可控时钟的 Host 测试覆盖重复循环、单次通知、硬暂停、Goal 中断、令牌失效、重启、显式恢复、新用户范围、空闲团队、关闭策略和时钟回拨。Runtime fake-provider 测试在恢复待处理期间保持前台 Bash 结果，随后验证安全暂停不会中止它，也不会发起后续模型请求。Desktop service 测试断言队列保持、不会普通取消且不会唤醒邮箱；设置测试断言 CAS 保留并发更新。这些确定性测试证明机制，不证明真实提供商遵循行为，也不等价于真实设备运行 10 小时。真实原生界面验证属于集成候选的最终验收。

Lead 可见的 `team_status` 还会在活动、邮箱元数据和独立提示计数旁投影可选 Host `runLimits` 对象。它不会重置或改变预算。
