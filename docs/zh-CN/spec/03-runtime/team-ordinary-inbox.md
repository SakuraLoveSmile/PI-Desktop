# 普通 Agent 团队的等待边界邮箱（WP16 S3）

> [英文源规格](/spec/03-runtime/team-ordinary-inbox)

## 用户路径与边界

普通 Agent Lead 在当前确认的专家发送报告时调用 `wait_for_updates`。支持该能力的 Host 将认证报告持久化至同一个运行中 Lead 回合，runtime 保留专家 SessionMessageOrigin，接纳认证 role=user buffer 后单独 ACK，再重验捕获生命周期并同步放入内部 Pi 队列。下一次 provider 请求可读取全文，不需要产生中间最终回复或另开回合。工具只返回 reason:"ordinary_inbox"、updated、新 count/messageIds、pendingMessageSenders、oldestPendingMessageAgeSeconds 及 ackPendingMessageIds，不带正文/proof/token。明确 ACK 传输失败时整批 FIFO 正文继续缓冲，摘要为 updated:false、新 count 为 0、messageIds 为空并列出 pending ACK IDs；后续同一精确回合的等待必须按原边界重新 ACK 整批，并取得 Host 对当前来源权限的明确成功验证，才可注入正文。authority/未知错误也不允许 flush，不确定 ACK 不能充当授权证明。`team_status` 仍是不消费的积压摘要。

专家正文是任务资料，不是新的人工授权。此路径不授 Goal token、批准执行工具或更高权限，也不重置用户范围或团队计时。普通 Plan 让出和获批 Plan/Goal execution inbox 保持独立。读取或接收失败必须可见，不能伪装成零封邮件。

## 内部协议

模型工具目录不暴露以下内部操作：

| Host 方法 | 参数 | 返回 |
| --- | --- | --- |
| `team.getOrdinaryInboxCapability` | 无正文参数 | `{capability:"ordinary-team-inbox-v1"}` |
| `team.readOrdinaryInbox` | `teamSessionId`、`callerSessionId`、`leadTurnId`、`boundaryId` | capability 与 `messages` |
| `team.ackOrdinaryInbox` | 同一绑定加 `messageIds` | `{ok:true, acknowledgedIds}` |
| `team.getOrdinaryInboxProof` | `teamSessionId`、`messageId` | 无正文的 `proof` 或 `null` |

每条 delivery 带 `messageId`、稳定 `userMessageId`、`teamSessionId`、`leadTurnId`、`scopeTurnId`、原 `boundaryId`、`phase:"persisted"` 及认证 `message:UiMessage`。ACK 按原边界分组；匹配重试幂等，错误身份、回合、边界或证明状态拒绝。

Host 核验精确运行中的普通 Agent Lead、当前确认的 delegate 决策和团队运行、未暂停及未 hard pause、当前专家/源派遣/源回合和权限上限。批准执行不能复用此路径。Host 不把 payload epoch 当权威；Main、AgentHost、Runtime 在异步边界后各自校验捕获的 epoch、精确回合、取消、暂停和释放状态。

正文走独立内部接收操作，不能走清除专家来源的 public human `steer`。真实用户 steer 优先；专家报告按邮箱 `(createdAt,id)` FIFO；旧范围头项不能被静默越过。Main 只在逐条 Host proof 为 `persisted` 或 `acked` 后删除 live queue mirror，不能从 ledger completed 推断。`team-message:<id>` 幂等键不变，runtime echo 不得重复追加转录。

`team.ordinaryInboxPersisted({teamSessionId,leadTurnId,messageIds})` 仅为提示，read/ack 或部分批次已提交后后续失败都可发出；收件者逐条重查证明。proof 查询不要求旧回合仍运行，用于恢复清理，仍校验团队/邮件身份且不返回正文。

## 持久化与崩溃切点

Plus P6 新增 `team_ordinary_inbox`，以消息身份为主键，绑定稳定 user-message、Lead 回合、用户范围、等待边界及不可变源 session/turn/权限上限。协作邮件的 `turn_id` 保持 `null`，允许一个 Lead 回合接收多条报告，不占用一邮件一续接回合的唯一绑定。

1. 先持久化 `prepared` 证明。
2. 认证 user 行先写入并 fsync canonical JSONL。
3. 在同一 SQLite 提交中修复/写入索引，证明转 `persisted`，完成邮箱 ledger 并退休 durable queue receipt。
4. runtime 接纳验证 buffer 后单独 ACK，证明转 acked，再校验生命周期并同步 flush 内部队列。

JSONL 和 SQLite 不是一个事务。启动时先做普通 inbox 恢复，再做普通协作恢复：没有文件行的 prepared 删除证明、保留邮件排队；已有认证文件行则修复索引和队列退休；已持久/ACK 正文保留为认证历史。恢复不启动新回合或 provider、不重放执行，也不接管旧运行。persisted 证明持久输入，ACK 证明 runtime 接收；都不能证明 provider 注意力、模型遵循或崩溃后的模型恰好一次消费。

## 兼容与验收

附加 Plus 迁移不改 upstream schema 或协议版本，保留旧邮件/历史。Host 返回 `METHOD_NOT_FOUND` 或不支持 capability 时继续排队续接及 S1 摘要指导，不能降级成未授权读取。

`E2E-TEAM-agent-lead-wait-boundary-ordinary-inbox` 使用隔离真 Host/Main/AgentHost/runtime 和确定性 provider，分别记录报告持久化、队列退休、runtime ACK 和 provider 输入，要求进程记录专家 2、Lead 0。覆盖重复提示、并发用户 steer、暂停/取消/替换/释放、崩溃切点与重启；Host/RPC/runtime 契约补伪造来源、FIFO、错误 ACK、无自动重放和 Plan/Goal 隔离。场景定义不是已通过记录，也不代表真实 provider 或用户验收。

Host 编写的 run-limit/失败通知保留原专有来源证明及投递路径；普通专家报告能力不能从通知正文推断专家身份或扩大可消费范围。
