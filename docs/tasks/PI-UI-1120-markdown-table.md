# PI-UI-1120 聊天 Markdown 表格视觉升级

- 状态：待体验（本地门禁全绿，提交在分支上，未推送、未开 PR）
- Tier：T1（用户可见 UI 行为变化，推翻 PR #195 的「表格永不横向滚动」策略；D653 记录该修订）
- 分支：`feat/20261120-pi-ui-1120-markdown-table`
- 工作树：`/Users/sakurasep/Documents/Code/Project/Project Worktree/fork-pi-desktop/20261120-feat-pi-ui-1120-markdown-table`
- 基线：`origin/main @ 786179c99`（2026-11-26 从原基线 `3a709f373` rebase 上来）
- 提交：`feat(chat): rebuild the Markdown table block for readable columns`（本分支唯一提交）
- 关联规格：`docs/spec/04-ux/08-component-spec.md` 与 zh-CN 镜像、`docs/spec/06-delivery/04-e2e-test-plan.md` 与 zh-CN 镜像、`docs/spec/08-meta/decisions-log.md`（D653）

## 范围

修复聊天 Markdown 表格的排版失败：表头逐字竖排、inline code 词内断行、列互相挤压、
工具栏与表格脱节。用户已拍板三项方向：

1. 列宽优先：列宽地板（`th` 7rem、`td` 5rem，`td` 上限 26rem），`max-content` +
   `min-width: 100%`；超宽时在圆角 wrap 内横向滚动，并用 `data-overflow` 边缘渐隐。
2. 代码块式 32px 头部条：左侧 mono 小标签（`chat.tableLabel`），右侧复制/导出/展开；
   预览对话框的复制/导出移入头部。
3. 数字列自动右对齐 + `tabular-nums` 次级色；显式 GFM 对齐优先。

## 实现要点

- `apps/desktop/src/lib/table-overflow.ts`（新）：纯函数 `tableOverflowState` +
  `useTableOverflow`（scroll + ResizeObserver，`content-visibility` 零宽跳过）。
- `apps/desktop/src/lib/markdown-table.ts`：新增 `tableColumnKinds`。
- `apps/desktop/src/components/Markdown.tsx`：`Table` 挂 overflow ref 与列类型 context，
  `tr` 覆盖给单元格注入 `data-kind`。
- `apps/desktop/src/components/MarkdownTable.tsx`：头部条；预览动作入头。
- `apps/desktop/src/styles/{prose,markdown-table,work-panel}.css`：表格块重写、头部条、
  预览 mask 关闭、文件预览 shell 圆角覆盖。
- i18n 9 个语言包新增 `chat.tableLabel`。

## 验收场景

`E2E-MARKDOWN-table-actions` 扩展：`exitCode` 表头单行、数字列右对齐、代码不在词内断、
宽表滚动并渐隐。`scripts/test-markdown-table.mjs` 新增四条内联断言与宽表截图。

## 验证记录

| 检查 | 结果 |
| --- | --- |
| `node --test`（markdown-table / markdown-table-kinds / table-overflow / markdown-prose-style） | 19/19 pass |
| `apps/desktop` 全量单测（`node --test test/*.test.mjs`） | 4570 tests：4566 pass / 0 fail / 4 skipped |
| `tsc -p tsconfig.json --noEmit` | exit 0 |
| `node scripts/check-style-tokens.mjs` | OK |
| `packages/i18n` vitest（catalogs / renderer-keys / user-facing-copy） | 3 files / 30 tests pass |
| `node scripts/check-test-quality.mjs` | OK（`markdown-prose-style.test.mjs` 45→43 条：3 条断言随旧策略退役，改由 Electron rig 覆盖） |
| `node scripts/test-markdown-table.mjs`（真实 Electron + 真实 CSS） | 28/28 checks pass（含四条新内联断言与预览两种主题） |
| `pnpm test:e2e:transcript` | pass（`TRANSCRIPT_RENDER_PROBE` 顶层 `ok:true`，无 `ok:false`） |
| 依赖与构建 | 本工作树已装真实本地依赖树（不再软链主库），`pnpm -r build` 通过，renderer 输出到 `apps/desktop/out/renderer` |

## 本次修掉的两个测试脚手架问题

1. `scripts/test-markdown-table.mjs` 只链接 `index.html` 里的入口 CSS；Markdown 是懒加载
   renderer chunk，`markdown-table.css` 不在入口 CSS 里，于是预览对话框的尺寸/滚动断言一直
   跑在无样式页面上（此前被记为 NOT RUN 才没暴露）。现在把 `assets/Markdown-*.css` 一并链接，
   预览相关断言才真正生效。
2. `markdown-table-runner.cjs` 里新增的内联宽表段覆盖了 `window.tableFixture.source`，让后面的
   预览循环拿到 3 行小表。现在先把长表存进 `longTable`，并在预览循环前还原。

## 剩余

- push、开 PR、合并需用户显式授权；合并后按收尾流程清掉本工作树。
- 真机体验口径：浅色/深色下聊天里的宽表滚动与边缘渐隐、数字列对齐、预览标题栏动作。