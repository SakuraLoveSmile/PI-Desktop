# 团队任务派发、排队回执与消息时效

WP10 为派发添加可选的结构化 `taskDispatch: {taskId, expectedRevision}`。
它只允许 Lead 发送给已批准、精确拥有该活动任务的专家；Host 校验当前任务修订。
研究任务的既有 taskId 保持原语义，普通报告或正文中出现任务 ID 不构成关联。
未带关联的消息保持原 FIFO，不会因正文而被替换或取消。

新派发只替代同任务、同接收方尚未开始的旧派发。任务真正完成后，Host 在同一事务
中取消其未开始的关联派发；尚待成功终态确认的完成声明不会提前清理。
原消息、正文、幂等键、来源证明和发送者 HEAD 均保留；运行中或已消费消息、专家
报告与宿主失败通知不受影响。持久化队列与实时队列镜像同步清理，重复通知无副作用。
已取消消息的幂等重放只返回原回执，不会重新启动任务。

send_message 回执增加 sentAt、targetBusyAtSend、当前 targetState 和 queuePosition。
queuePosition 是接收方团队邮箱中从 1 开始的位置，工具明确标注
queuePositionScope: team_mailbox；它不表示用户输入队列的精确位置，ACK 也不等于
模型已读取。发送时正忙的消息通过认证输入框架提示可能过期，接收方应先查看当前
任务和新指令。实时输入与恢复历史一致，不赋予新用户授权或扩大权限。

不改变 WP5 超时、shell 额度、普通消息 FIFO、执行令牌或已批准执行 inbox。
不实现 WP16 S3 的回合内正文投递。不增加 IPC、数据库迁移、后台队列或依赖。

详细契约：[English contract](../../../spec/03-runtime/team-task-dispatch.md)。
隔离回放与验收：[WP10 scenarios](../../../spec/06-delivery/team-task-dispatch-scenarios.md)。
