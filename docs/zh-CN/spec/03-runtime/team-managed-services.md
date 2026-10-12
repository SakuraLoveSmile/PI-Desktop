# 显式 Host 管理的团队服务（WP14）

> [英文源规格](/spec/03-runtime/team-managed-services)

## 启动与权限

Bash 新增可选 `backgroundKind:"command"|"service"`。缺省及旧值仍为 command，默认 60 秒及有限 timeout 覆盖不变。service 必须 `run_in_background:true`，禁止同时传 `timeout`/`timeoutMs`；固定 Host TTL 为 21,600,000 ms（6 小时）。正文、stdout 或后续 PID 声明不能把普通命令升级为服务或认领进程。

服务 owner 必须是当前已确认 Agent 团队/运行中的 Lead 或批准成员，且处于精确运行中 Agent 回合。研究成员、暂停/hard pause、被替换成员、过期路由和超出权限上限都拒绝。普通 Bash、工作区、shell、权限和模式门禁仍适用；批准/额度等待后，Host 在插入进程的同一锁下重验捕获范围。

`starting/running/stopping` 服务计入 Host 最多 2、每团队 1、每 owner session 1；全生命周期继续占既有 global 16/session 4/shell 4 permit。不新增 WP12 后台池，不扩大 shell 额度，不改 FIFO 或审批。

## 生命周期与停止

Host 持有活 child/process-group handle 及团队运行；数字 PID 仅展示，不能作为停止/认领权威。任何团队暂停（含自动 hard）都请求停止显式服务；普通后台命令保留 WP8 行为，已准入前台批次仍安全完成。切换查看其他会话/项目或 renderer reload 不停止服务。

显式停止、owner 取消/移除、owner 工作区变化/会话删除、团队/运行替换或结束、捕获的 Goal 执行终态、TTL 和 Host shutdown 都清理服务。普通团队结束指无运行中参与者回合、队列工作、未结算邮件或未完成共享任务；服务自身不保持团队活动。成员 phase completed 单独不能判团队完成；Goal 使用捕获的 execution 身份。

Unix 对 owned group 发 TERM，最多等 5 秒，再 KILL 并 reap；Windows 使用原 JobObject force，界面如实显示。正常应用关闭为 Host 保留最多 8 秒完成 TERM 升级和 reap，然后 transport 才强制结束 Host。崩溃导致 runner 丢失 Host 控制管道时走安全强制清理，不宣称优雅退出。owned tree 实际终结后才释放 permit；重复清理幂等，输出与失败可见；不能为删除成功而丢弃活 owner 证据。

保留首次停止原因与时间：`explicit_stop`、`team_paused`、`run_replaced`、`member_removed`、`owner_workspace_changed`、`session_deleted`、`team_ended`、`goal_ended`、`ttl_expired`、`host_shutdown`、`host_restart`、`owner_cancelled`。生命周期停止与普通命令超时/意外崩溃不同；无自动重启。

## 存储、元数据和界面

Plus P7 新增以原 process ID 为键的 `background_service_ownership`，捕获 Team/run、启动 turn、deadline、可选 Goal execution、owner 持久项目路径快照、stop intent 和实际 escalation。合法命令 cwd 位于项目已登记的另一个根目录，不等于 owner 项目变化。旧行仍是普通命令；重启将未结算服务记 interrupted，不查询/认领 PID，不重新启动。upstream schema/protocol 不变。

list/read/launch 可选增加 `backgroundKind:"service"`、`teamSessionId`、`teamRunId`、RFC3339 `deadlineAt`/`stopRequestedAt`、`stopReason`、`stopMode:"unix-term-then-kill"|"windows-job-force"` 和终态 `serviceStopEscalated:boolean`。原 session owner 读/停权限与输出/result 语义保持权威。

现有 Activity 进程面板本地化展示服务类别、owner、deadline 和停止原因，保留布局、分组状态、读输出和 stop 控件；不能把生命周期停止伪装成命令超时、成功退出或 Windows 优雅停止。

## 验收

`E2E-TEAM-managed-service-lifecycle` 用隔离 production Host/runtime 与真实本地 child/grandchild：service 超过 60 秒仍活，普通命令约 60 秒超时；覆盖原 permit 与新 caps、手动/hard 暂停、owner cancel/end/delete/workspace、Goal end、受控时钟 TTL、TERM escalation/tree exit、输出拒写、重复清理、重启零重放。分开记录平台结果，Unix 不能证明 Windows JobObject/tree 行为。组件与原生候选截图检查本地化 metadata；不将用户 profile、生产服务或付费 provider 作为默认夹具。

新服务将 `stopMode` 写入既有 KV namespace `background-service-stop-mode-v1`，与 process/ownership 行同一事务。历史缺失仍省略 `stopMode`，重开不从当前操作系统推断停止机制。
