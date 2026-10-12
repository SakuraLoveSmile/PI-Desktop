# 团队任务派发、排队回执与消息时效

> [英文源规格](/spec/03-runtime/team-task-dispatch)

WP10 为排队任务派发增加显式关联。它不改变 WP5 shell 超时、权限、执行 inbox 授权，也不改变无关消息的邮箱 FIFO。

## 生产者契约

`send_message({targetMemberName, content, taskDispatch?})` 调用
`team.sendMessage({teamSessionId, callerSessionId, target, content,
idempotencyKey?, taskDispatch?})`。`taskDispatch` 恰好包含
`{taskId: string, expectedRevision: positive integer}`。Host 拒绝格式错误的对象、非 Lead 发送、目标不是该任务精确所有者、已删除或终态任务、过期修订和未经批准的接收方。执行派发与研究派发均可选填该字段。创建任务/提交结果时既有的研究 `taskId` 参数保持原有含义；正文中的任务 ID 不会把邮件关联到任务。报告和后续更新省略此字段。

原始消息正文、类型、来源回合证明、派发 HEAD、权限上限、认证所有权以及
`team-message:<id>` 投递键均保持不变。重放发送键会返回同一行和不可变发送元数据，包括已取消的回执。若使用同一键但目标、正文或关联不同，则返回 `IDEMPOTENCY_CONFLICT`。已取消消息的重放不会发出新的邮件唤醒事件。

## 回执与模型输入

新的 Host 发送会捕获 `sentAt`（ISO UTC）和 `targetBusyAtSend`（目标是否有正在运行的回合）。消息投影增加查询时观测到的 `targetState: running | paused | idle`。忙碌状态优先于暂停状态，因为暂停可能只阻止下一条队列，而不会终止现有回合。

若存在 `queuePosition`，它以 1 为起点，按现有 `(createdAt,id)` 顺序计算，表示该目标已排队的**团队邮箱**消息位置，包括已接受/ACK 但尚未开始的消息。运行中或已结算的消息不提供该字段。它不是普通用户回合队列中的位置；工具会明确返回 `queuePositionScope: team_mailbox`。接受/ACK 不代表已消费，工具仍返回 `delivered:false`。

只有 Host ledger 解析才能向 `SessionMessageOrigin` 提供 `sentAt`、
`targetBusyAtSend` 和 `taskDispatch`。共享提示框架会把 agent 输入标记为任务数据，不赋予新授权；若发送时目标正忙，还会警告消息可能过期，并要求接收者检查当前任务/较新指令。实时输入和恢复后的模型历史使用相同框架。缺少元数据的旧消息保留旧框架。转录追加和改写继续强制执行不可变 Host 来源证明；人工引导不会继承这些元数据。

## 生命周期

在同一次发送事务中，新建的显式派发只会让来自该 Lead、发给该接收者且关联同一看板任务的较旧未开始消息失效，条件为 `kind:message`、`status:queued`、`turnId:null`。其 ledger 状态/投递状态变为 `cancelled`，并带有 `dispatchCancellation:superseded`；原正文、身份和证明仍可查询。其他任务、接收者、普通消息、报告、Host 失败通知以及运行中/已消费邮件均不受影响。邮箱容量限制在事务内替换之后检查，因此即使邮箱已满，也可替换其中一条过期派发而不增加容量。

任务实际进入 `completed` 状态时，会让该任务所有尚未开始的显式 Lead 派发失效，并标记 `dispatchCancellation:task_completed`。此规则适用于直接更新、暂定完成声明后的成功回合结算，以及结构化研究结果提交。尚在进行的声明或失败终态回合不会错误触发成功完成清理。

失效操作在同一事务中只移除这些消息对应的持久回合队列行。现有
`team.changed` 事件让 Main 核对每个实时队列项当前的 Host ledger 状态，并仅从 Agent Host 镜像移除已取消的显式派发。重复通知没有副作用。若派发、通知和出队发生竞争，认证输入解析与现有 queued-to-running 声明会阻止已取消邮件进入模型执行。运行中或已消费邮件绝不会追溯取消。当前 schema 和协议版本不变；可选 KV 记录沿用其所属 session 既有的删除路径清理。

## 验证

RPC 回归从 declare/confirm 开始，依次创建任务、发送、开始回合、更新任务并成功结束所属回合；使用隔离存储，不发起模型网络请求。Main 使用真实 Agent Host、可控的 40 分钟时钟和 fake runtime 边界：保留无关 FIFO 邮件、移除旧派发，并只将最新认证输入发送给 fake 模型。Runtime 与 Host-runtime 测试覆盖工具回执、普通报告省略关联字段、共享提示框架和恢复历史。见 [场景](../06-delivery/team-task-dispatch-scenarios.md)。
