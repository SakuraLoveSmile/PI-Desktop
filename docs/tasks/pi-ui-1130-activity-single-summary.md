# PI-UI-1130 — 删掉工作面板「概要」页，活动栏成为唯一的会话摘要

- **Tier**: T1（仅渲染层 + E2E 脚本 + 文档）
- **Branch**: `feat/20261127-pi-ui-1130-activity-single-summary`
- **Worktree**: `/Users/sakurasep/Documents/Code/Project/Project Worktree/fork-pi-desktop/20261127-feat-pi-ui-1130-activity-single-summary`
- **Base**: `origin/main` = `27dc6b45a`
- **Status**: 实现中（代码、规格、单测完成并通过门禁；E2E 部分套件通过，其余受环境限制 NOT RUN；6.3 四态几何与 6.5 前后截图未完成）

## 目标

一个会话只有一个摘要界面，放在两个位置：聊天区够宽时是内联活动栏，窄时是工作面板的「活动」标签。

- 删除工作面板「概要」页，及其消息数、恒为空的记忆行、渲染器自建的产物／技能／MCP 清单。
- 待办清单、团队任务摘要、全景入口迁入活动栏；活动栏成为唯一的会话摘要。
- 放置只看 `.chat-surface` 宽度（264px 活动栏算在内）：≥ 820 内联（面板开不开都一样）；< 820 且面板开 → 面板第一个「活动」标签；< 820 且面板关 → 顶部「活动」按钮，点开面板并激活该标签；无会话或不在屏上 → 不显示。
- 规范会话元数据（标题、Team 关系）刷新随摘要迁移，只在摘要可见时运行，失败显示一行 `role="status"` 过期提示。

## 决定

- **D654**：活动栏是会话唯一摘要；移除概要页；按宽度放置；停靠时「活动」标签固定、排第一、不可关闭或移动；保存的分区顺序在「计划」之后新增 `todos`、`teamTasks`；元数据刷新随摘要迁移；仅渲染层，不改 IPC／Host／协议／存储。
- 活动栏**不**重复「批准执行的成员名单等待」：该状态由输入框上方 Goal 胶囊与转录里的 Goal 卡承载（原概要页 Team progress 区块删除后作出的决定；对应 E2E 步骤退役）。
- 不迁：记忆引用（main 上恒为空，字段随页删除）、消息数；产物、技能、MCP 引用沿用活动栏既有分区。

## 提交

- `d864711aa` refactor(workpanel): extract the Overview seams the rail will reuse
- `ebe5342e1` feat(activity): show todos, team tasks and the panorama in the rail
- C3（本次活动栏放置、删除概要页、规格与 E2E 迁移）**尚未提交**，等待检查点确认。

## 实际跑过的检查与结果

| 检查 | 结果 |
| --- | --- |
| `pnpm typecheck` | 通过（含各包 build） |
| `pnpm lint` | 通过（style tokens OK） |
| `node --test apps/desktop/test/*.test.mjs` | 4603 pass / 0 fail / 4 skipped |
| `pnpm --filter @pi-desktop/i18n test` | 30/30 |
| `node scripts/check-test-quality.mjs` | 通过，baseline 由 8081 缩到 8048 |
| `node scripts/generate-scenario-index.mjs --check` | current |
| `pnpm docs:check` | 通过（666 页；仅有既有 ADR 备注） |
| `scripts/e2e-transcript-render.mjs` | **通过**（render → activity-integration 全部阶段） |
| `scripts/e2e-overview-reference.mjs` | **通过**（6 行任务、编号、角色词、任务/看板/全景、计划产物、折叠、待办、实时更新、全景分层与缩放、320/360/570 双主题） |
| `scripts/e2e-goal-team-renderer-ui.mjs` | 通过 |
| `scripts/e2e-todo-checklist.mjs` | 通过（需 `PI_DESKTOP_HOST_BIN`） |
| `scripts/e2e-team-approved-goal.mjs` | 通过 |
| `scripts/e2e-three-column-layout.mjs`、`e2e-work-panel-launcher.mjs`、`e2e-work-panel-reorder.mjs`、`e2e-session-activity.mjs` | NOT RUN |

运行环境：本机 macOS，工作树自带 Host 二进制（`target/debug/pi-desktop-host-core`，`cargo build --offline --locked`）与从主检出克隆的 Electron；`$TMPDIR/pi-e2e/{run.sh,e2e-electron-flag.mjs}` 去环境变量并追加 `-ApplePersistenceIgnoreState YES`。

## NOT RUN 与原因

- `e2e-team.mjs`、`e2e-team-planning.mjs`：**环境/夹具限制**。同一命令在 `origin/main` 对照 worktree（`27dc6b45a`）上同样失败（`Lead runtime lacks strategy declaration`、`structured-only Lead cannot await actual research updates`），与本改动无关。
- `e2e-plan-ui.mjs`：同上，未再单独运行。
- 6.3 四态几何（880/780/725/1100 读回 `.chat-surface.clientWidth`）：未完成（当前由 integration 阶段的窄窗/停靠断言部分覆盖）。
- 6.5 前后截图：before/after 各 6 张已产出，存于仓库外 `$TMPDIR/pi-1130-evidence/{before,after}`（before 为 `origin/main` @ `27dc6b45a` 的最小移植，未提交）。
  - inline（1100／面板关）：通过。活动栏在聊天区右侧，目标／实时状态（含「查看全景」）／后台进程／上下文／产物齐全。
  - button（~725／面板关）：通过。顶部出现「活动」按钮（旧文案「活动概览」已改）。
  - docked（面板开／~780）：**通过**。面板标签栏为 `活动 | state-review | docs.doc…`，「活动」排第一并处于激活态，正文完整呈现活动栏（需要关注／目标／实时状态含「查看全景」／后台进程／上下文／产物）。此前那张「正文空白」是夹具问题：场景只打开了面板、没像窄窗按钮那样激活「活动」标签，面板停在上一次激活的浏览器标签上；已改为调用与按钮相同的入口（`openWorkPanelTabForSession(sessionId, activityWorkPanelTab())`）后复拍确认。
  - button 场景两套主题下转录区偏灰，仍待查（疑似面板关闭后残留的装饰遮罩或过渡帧），不影响放置规则本身。

## 已知风险 / 待办

- `e2e-team.mjs`、`e2e-team-planning.mjs` 的基线失败需要单独处理（本机夹具/环境问题），否则这两个套件无法作为本次改动的证据。
- `e2e-team-planning.mjs` 里仍有两处旧断言待改：活动标签的 active 判断、团队任务计数读取（活动栏分组没有 `data-completed`/`data-total`，改用 `.session-activity-team-count` 文本或给分组补 data 属性）。
- 活动栏在 320px 下的横向溢出已在 `e2e-overview-reference.mjs` 中修正（团队任务行改 `width:100%`，并把 rail 挂到 `.activity-dock-tab` 内测量）。
