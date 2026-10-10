# 完整会话活动投影

> **翻译说明：** 本页对应 [英文源规格](/spec/03-runtime/session-activity-projection)。代码、协议字段和标识符保持原文；如有歧义，以英文版本为准。

本地 Desktop 概要读取 Host 拥有的完整 canonical 活动转录摘要。
渲染器转录窗口、显示条数和上下文压缩不限制该清单；已归档且未激活的重新生成分支不计入。
Plan/Goal、Team 成员和托管进程继续使用各自既有权威服务，不从本投影重建。

## 读取契约

`sessionActivity.get({sessionId, offset?: 0, limit?: 50})` 返回 `{activity}`。
增量 v1 契约不改变协议 11 或存储 schema：

- `version: 1`、所属 `sessionId` 和完整摘要的 SHA-256 `revision`；
- `subagents`、`changedFiles`、`websites`、`attachments` 和 `references`（`skills`、`memory`、`mcp`）；
- `totals`：七个集合各自的完整数量；
- `hasMore`、`nextOffset`：每个集合贡献相同的有界切片，至多 50 条。调用方读取全部页并检查 revision 一致性；
- `limited`：超过 4096 UTF-8 字节的已记录字面身份/路径/URL，或无效字面身份不能显示。
  这与渲染器读取窗口不同，不得声称加载更早消息可以解决。显示标签/任务摘要最多 1000 个
  Unicode 字符；可执行操作使用的精确路径与 URL 不改写为猜测的别名。

读取器校验版本、会话身份、集合结构、安全数值和 HTTP(S) 来源 URL。
分页结果一次性发布。revision 改变或持久化后通知到达时，丢弃未完成分页并开始读取当前序列，
避免数量拼接不同 canonical 历史。

Host 在访问转录前校验活动的本地 Desktop 会话。远程、原生/导入和缺失/已删除会话被拒绝。
不返回消息正文、工具输出正文、文件/附件内容或凭据；不读取输出路径的文件内容，
不调用模型或网络。没有新增 schema、持久化投影缓存或迁移。

## 证据语义

成功且非错误的 Write/Edit 操作按精确字面路径合并。数量包含所有匹配的 canonical 操作；
最近一次有效记录时间/消息决定导航目标。仅当每次操作都有完整匹配的 ReviewChange v1
事实，且指标非二进制、未截断时，才给出行数合计，否则省略。
附件和已记录 Skill/MCP 引用仍然是使用证据，不是启用扩展的清单。

安全的已采集 HTTP(S) 引用按 hostname 合并；每次采集出现计一次，首个安全 URL 保留为打开目标。
带嵌入凭据、格式错误或非 HTTP(S) URL 排除。

只有 Task/Subagent 启动调用创建委派行。之后的生命周期快照更新状态/时间；刷新后的终态
启动回执优先于旧的运行中生命周期快照。已知终态回执的时间字段优先；生命周期时间仅补缺，
不能抹掉完成时间。每条回执索引中的所属回合决定是否仍活动；后来运行中的另一回合不能复活旧回执。
缺失或遗留 NULL 回合归属保守重建为 aborted。持久化追赶期间，渲染器较新的/待处理 Task 活动
按委派身份或同一 canonical 消息身份合并；复用的提供商 call ID 不能合并不同历史记录。
不能重复行，也不能把已知 Host 终态退回旧的运行中状态。

## Canonical 变化与传递

`sessionActivity.changed({sessionId})` 在 canonical 追加、替换、截断、revision 保存/激活、
回合开始/结束成功后发送。它跟随持久化完成，而不是较早的 agent 消息流。
Electron 转发白名单事件；可见读取器合并通知，在聚焦/Host 重启时刷新，拒绝迟到 generation，
隐藏时解除订阅。

追加路径中有一个范围严格的委派结束更新例外：已索引的 canonical Task/Subagent 启动回执
若含结构化 `details.delegationId` 且状态为 running，可推进到已知委派终态。
消息/调用/委派身份、参数、lineage、创建时间和所属回合必须匹配。已知开始时间冲突时拒绝；
旧回执可补入首次已知开始时间。仅原子替换 canonical 工具 result/text。
原索引位置、回合、调用完成时间/耗时、工具用量和未知 block/meta 扩展保留。
重复终态、迟到 running 或不同终态重放不改写记录。普通工具继续保持不可变/幂等。
跨会话消息 ID 碰撞时，相同结束校验仅作用于所属会话带命名空间的 canonical 回执，
保留原 call ID 和回合，不触碰另一会话。流式有效模型元数据刷新不属于本次仅终态更新。

旧 Host 返回 METHOD_NOT_FOUND 时明确回退到已加载消息投影，逐组显示范围说明/历史控件。
临时错误保留已知完整快照并显示错误/重试；首次错误明确标记已加载消息回退。
Host 摘要限制使用独立提示，不把渲染器分页宣传为解决办法。

## 验证

`session_activity` Host 领域/RPC 测试覆盖最早历史、完整数量、分页 revision、写入/指标、
身份/隐私和重启。渲染器读取器测试覆盖原子分页、变化、陈旧身份/重启/隐藏读取、
不支持/错误/重试和实时终态叠加。委派更新测试走真实追加结束路径，覆盖陈旧重放、
不可变身份、原用量/位置、未知 canonical 扩展和重新打开。
`scripts/e2e-session-activity-aggregate.mjs` 使用真实隔离 Rust RPC、生产 IPC 注册和生产
渲染器读取器，验证尾部窗口读取、canonical 追加事件、委派结束/重放和 Host 重启。
