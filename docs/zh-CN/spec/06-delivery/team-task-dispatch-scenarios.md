# WP10 团队任务派发场景

> [英文源规格](/spec/06-delivery/team-task-dispatch-scenarios)

以下是语义验收 ID。可执行检查使用隔离数据和 fake runtime/provider 边界；真实付费提供商和用户应用不是默认测试环境。

| ID | 操作序列 | 必须结果 | 自动化证据 |
| --- | --- | --- | --- |
| E2E-TEAM-busy-member-latest-task-dispatch | 确认专家、创建其所有任务，让专家保持在可控的 40 分钟回合中；发送两条互相冲突的显式派发；结束回合。 | 旧 ledger 行保留并取消；只有最新派发会在边界后开始；无关普通 FIFO 邮件仍保留。 | Host `team_dispatch_age_tests`，Desktop `team-dispatch-age.test.mjs` |
| E2E-TEAM-completed-task-retires-queued-dispatch | 启动任务、排入重复派发、声明完成，并成功结算所属回合。 | 声明保持暂定；终态成功取消重复派发；当前运行中的派发以及专家报告/来源证明保留。 | Host `team_dispatch_age_tests`，Desktop 完成/镜像重放 |
| E2E-TEAM-dispatch-age-authenticated-framing | 从 ledger 解析发送时忙碌元数据并提示成员；恢复该成员历史。 | 提示框架与 sentAt/任务身份一致；警告指出消息可能过期；不增加用户权限。 | Host-runtime `session-message-input.test.ts`，runtime collaboration history |
| E2E-TEAM-dispatch-replay-and-validation | 重放已退休键；省略/更改其关联；提交格式错误、过期、已完成或属于其他所有者的派发。 | 已退休键不能复活工作；冲突和无效所有权/修订被拒绝，且不增加队列项。 | Host RPC regression，runtime tool producer regression |

请求工作树中的命令（复用已准备的依赖）：

```sh
CARGO_TARGET_DIR="$PWD/.review-evidence/cargo-target" cargo test -p host-core --locked team
node --test apps/desktop/test/team-delivery.test.mjs apps/desktop/test/team-dispatch-age.test.mjs
node packages/agent-runtime/node_modules/typescript/bin/tsc -p packages/agent-runtime/tsconfig.json --noEmit
node apps/desktop/node_modules/typescript/bin/tsc -p apps/desktop/tsconfig.json --noEmit
node scripts/check-test-quality.mjs --base 144b28bbb
```

为 Host-runtime 输入解析和 Agent Host 队列测试运行 runtime `team-dispatch`、`team-tools`、协作历史的 Vitest。fake 的 40 分钟时钟证明边界行为，不代表提供商真实运行了 40 分钟。真实设备验收应检查实际 Host session/turn 记录，而不是模型的自述。本变更不要求也未授权运行 `verify:ui:*`。

## 生产投递链回放

使用候选已有 JS 构建及 Host 二进制，运行
`node --experimental-strip-types scripts/e2e-team-task-dispatch-lifecycle.mjs`。
隔离的真实 Host、Main 投递服务、bridge、AgentHost 和 sidecar/runtime
通过 loopback 模型 gate 保持成员回合。验证被替代派发的取消会删除 Main
镜像、最新正文恰好一次接纳、无关普通邮件保留 FIFO、任务成功完成后排队
重派在进入 provider 前退休。本路径补齐上表前两个语义 ID；可控四十分钟
年龄仍由领域测试覆盖，不由本次短回放证明。

### Candidate build receipt

Run `node scripts/e2e/build-candidate.mjs` on the stable request candidate before
`node --experimental-strip-types scripts/e2e-team-task-dispatch-lifecycle.mjs`.
The build wrapper reuses the provisioned environment and records source HEAD,
base, dirty/untracked identity and complete executable hashes. Select the
receipt's debug Host with `PI_DESKTOP_HOST_BIN`, or use the request-local default.
Start/end validation refuses stale source, base, modules, binary or a changed
receipt before writing passing evidence; a historical compiled SHA is not proof.
