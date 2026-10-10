# 测试维护与退役

> **翻译说明：** 本页对应 [英文源规格](/spec/06-delivery/07-test-maintenance)。代码、协议字段和标识符保持原文；如有歧义，以英文版本为准。

测试保护可观察行为、公共契约、数据安全和有意义的状态变化。数量不是验收目标。
源码表达式匹配正则不能证明用户能完成预期操作。

## 源码/CSS 断言只降不增

`pnpm check:test-quality -- --base <revision>` 使用既有 TypeScript parser，
从仓库字面路径和读源码 helper 识别来源，包括命名导入、别名和重新导出。
实际夹具读取不计入；对实际执行输出做正则断言允许。
清单统计语法层面的 `assert.match`/`doesNotMatch`、源码 `match`/`matchAll`/`search`
以及正则 `test`/`exec` 调用，不统计运行时循环次数。不得把这个清单描述成所有读文件测试，
或实测的已执行断言数量。

版本控制中的 `scripts/test-quality-baseline.json` 记录文件/用例数量和绑定用例的断言签名。
新增文件、断言、替换断言或增加预算都会失败。已有预算只能下降；门禁将 baseline 改动与
真实 base revision 比较。同一改动必须删除已移除断言对应的额度，额度不可再利用。
转换或退役断言后使用 `--write-baseline --base <revision>`；写入器同样拒绝增长。
缺失或不可用 base revision 时失败关闭，不能把 base 换成 `HEAD` 为新增断言背书。

baseline 记录不可修改的 `initialSourceRevision`：
`c9b2aad7496048f64d94c2b135389f72a52d93da`。门禁固定相同可信的治理前版本，
不接受 CLI 或环境变量覆盖。目标 base 尚无 baseline 且历史从未引入时，
只用这个历史源码快照初始化预算，不使用更旧的目标树或当前工作文件。
快照必须存在、不含 baseline、属于候选 HEAD 的祖先，并早于所有可达的 baseline 引入提交。
核查完整 Git 历史及各个 merge parent 的差异；日期或任意日志首尾不能代替祖先关系。

目标历史已经引入过 baseline 后，删除文件不会重新开放初始化：门禁失败，
不能恢复已退役额度。目标已有 baseline 时，继续校验既有预算与不可修改的 anchor，
不再要求旧快照对象或祖先关系，后续正常 squash/rebase 不依赖私有快照对象。

首次引入必须保留可信快照的提交历史，直到 baseline 进入目标分支。
若首次 squash 丢掉 `c9b2aad7496048f64d94c2b135389f72a52d93da`，初始化会明确失败。
目标已经包含 baseline 后的改动不受这项首次落地限制。

首次可信扫描基准为治理改动之前的 `c9b2aad74`：239 个文件、8,468 个语法层面
断言/提取、1,259 个源码正则用例。首批退役后为 239 个文件、8,437 次调用、1,256 个用例。
本次从这个较低清单启动只降不增机制，不宣称其余存量已经转换。
parser 是有界静态分析而非解释器；动态路径和外部 helper 仍需评审。
不能通过动态路径、`includes`、包装函数或重命名 API 隐藏源码断言。

`packages/agent-runtime/src/runtime-tests/*.ts`（包括共用 harness）和已退役单体
`runtime.test.ts` 的单文件上限为 800 行。按职责拆分，不按任意行切片，也不建立持续增长的豁免清单。

## 首批热点退役

| 既有热点 | 改动 | 替代证据 |
| --- | --- | --- |
| `work-panel.test.mjs` | 移除 launcher 替换及指针/键盘重排的两项源码检查 | `work-panel-tabs.test.mjs` 实际执行 launcher 替换/标签顺序；`work-panel-tab-reorder.test.mjs` 执行阈值/边缘滚动；`scripts/e2e-work-panel-reorder.mjs` 验证真实组件的指针/键盘与取消绑定 |
| `settings-general.test.mjs` | 替换日期 formatter 实现检查，保留页面当前语言 wiring 契约 | 固定时间戳/无效日期下实际执行 `formatMoment`、`formatRelativeMoment`，检查英/法语输出；保留 ScheduledPage 与模型配置页的语言传递检查 |
| `thinking-ui.test.mjs` | 替换仅思考转录 predicate 的源码检查 | 对有效思考、空白和启动错误实际执行 `messageHasTranscriptContent` |
| `transcript-style.test.mjs` | 替换结果格式源码检查，保留懒加载/权限 wiring 约束 | Vite 加载生产 `buildToolPresentation`、`ToolDetailBlocks`；SSR 验证 stdout/stderr 内容、可访问复制控件、纯文本模式和没有原始载荷 JSON |

其他高频变更用例保持冻结。不宣称 SSR effects 已替代权限/懒加载 wiring 源码检查；
既有行为和原生测试仍拥有这些验收路径。源码文本测试退役本身不会使功能场景过时：
行为/原生替代测试继续覆盖时保留功能 ID，只在行为或场景确实被替代时删除 ID。

## 季度评审

`pnpm audit:test-maintenance` 报告滚动 90 天 Git 测试变更次数。
季度/手动 `test-maintenance-audit.yml` workflow 归档报告。
文件在至少五个提交中发生变更才成为评审候选，而非删除候选。
比较维护成本、实际捕获的缺陷和替代覆盖，从高变更频率、少量已核实回归信号的文件开始。

有真实证据时传入 `--evidence <json>`；workflow 在存在时使用
`docs/testing/regression-evidence.json`：

```json
{
  "coverage": { "from": "2026-07-01T00:00:00Z", "to": "2026-10-01T00:00:00Z", "complete": false },
  "regressions": [
    { "path": "apps/desktop/test/example.test.mjs", "caughtAt": "2026-09-01T00:00:00Z", "evidence": "CI run URL and confirmed bug reference" }
  ]
}
```

仅使用已确认捕获的回归，不能把每次失败 CI 都计入。标记完整必须有覆盖该时间段的穷尽审计记录。
缺失/不完整证据返回 `unknown`，不代表没有捕获回归。仅完整时间段没有记录时允许
`none-recorded`，但它仍不能证明覆盖没用。不得编造历史；脚本不采集私密日志、不调用提供商。

每项退役提案记录行为/契约、替代测试和场景，并实际运行。旧测试和过时 ID 在同一 PR 中替换/删除。
纯文档、文案、i18n 和视觉变更，仅满足根政策的交互/响应式/辅助功能/布局条件时才可不新增测试；
仍需验证受影响区域并记录剩余风险。
