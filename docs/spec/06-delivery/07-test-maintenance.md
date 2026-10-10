# Test maintenance and retirement

Tests protect observable behavior, public contracts, data safety and meaningful
state transitions. Quantity is not an acceptance target. A source expression
matching a regex does not establish that a user can perform its intended action.

## Source/CSS assertion ratchet

`pnpm check:test-quality -- --base <revision>` uses the existing TypeScript parser
to identify source provenance from literal repository paths and source-reading
helpers (including named imports, local reader/callable aliases, exported arrow
functions, function expressions and re-exports). Concrete fixture
reads do not count. Regex matches/assertions on executed output are allowed.
It inventories syntax-level `assert.match`/`doesNotMatch`, source
`match`/`matchAll`/`search`, and regex `test`/`exec` calls, not the number of loop
iterations at runtime. This inventory must not be described as all tests that
read a file or as a measured count of executed assertions.

The checked-in `scripts/test-quality-baseline.json` records file/case counts and
case-bound assertion signatures. New files, new assertions, swapped assertions,
and increased budgets fail. A change may only decrease an existing budget; the
gate compares baseline edits with the actual base revision. Removed allowances
must be removed from the inventory in the same change and cannot be reused.
Use `--write-baseline --base <revision>` after converting or retiring assertions;
the writer refuses growth too. Missing/unavailable base revisions fail closed.
Do not replace the base with `HEAD` to bless new assertions.

The baseline records immutable `initialSourceRevision`:
`c9b2aad7496048f64d94c2b135389f72a52d93da`. The checker pins the same trusted
pre-governance revision; there is no CLI/environment override. If the target
base has no baseline and has never introduced one, bootstrap compares budgets
with that historical source snapshot, rather than an older target tree or
current working files. It verifies that the snapshot exists, contains no
baseline, is an ancestor of candidate HEAD, and precedes every reachable
baseline introduction. The full Git history includes merge-parent diffs; dates
or a single arbitrary first/last log entry do not establish ancestry.

If the target base history has already introduced a baseline, removing the file
does not reopen bootstrap. The gate fails instead of restoring retired
allowances. Once the target carries a baseline, its inventory and immutable
anchor govern the normal ratchet; the historical source object and ancestry are
no longer required. This allows later squash/rebase integration without
requiring the original private snapshot object in every clone.

The first introduction must preserve the trusted snapshot's ancestry until the
baseline reaches the target branch. Squashing that initial history into a
candidate without `c9b2aad7496048f64d94c2b135389f72a52d93da` intentionally fails
bootstrap. This initial-landing limitation does not apply to later changes
whose target already contains the baseline.

The initial trusted scan is commit `c9b2aad74`, before test-governance changes:
239 files, 8,468 syntax-level assertions/extractions and 1,259 source-regex cases.
The first retirement reduces it to 239 files, 8,437 calls and 1,256 cases. This
change starts the ratchet below that inventory; it does not claim that the
remaining stock was converted. The parser is a bounded static analysis, not an interpreter: dynamic
file paths and externally supplied helpers still require review. Do not hide
source assertions behind dynamic paths, `includes`, wrappers or renamed APIs.

`packages/agent-runtime/src/runtime-tests/*.ts` (including shared harnesses)
and the retired monolithic `runtime.test.ts` have an 800-line file maximum.
Split by responsibility, not by arbitrary line slices; no growing waiver list.

## First hotspot retirement

| Existing hotspot | Change | Replacement evidence |
| --- | --- | --- |
| `work-panel.test.mjs` | Remove two source checks for launcher replacement and pointer/keyboard reorder | `work-panel-tabs.test.mjs` executes launcher replacement and tab ordering; `work-panel-tab-reorder.test.mjs` executes thresholds/edge scrolling; `scripts/e2e-work-panel-reorder.mjs` exercises the real component pointer/keyboard and cancellation bindings |
| `settings-general.test.mjs` | Replace date formatter implementation check; retain ScheduledPage and model-settings locale wiring constraints | Execute `formatMoment` and `formatRelativeMoment` with English/French output, fixed timestamps and invalid dates; existing consumer checks protect current-locale propagation |
| `thinking-ui.test.mjs` | Replace thinking-only transcript predicate source checks | Execute `messageHasTranscriptContent` for meaningful thinking, whitespace and launch errors |
| `transcript-style.test.mjs` | Replace result-formatting source checks, retain lazy/permission wiring constraints | Vite loads production `buildToolPresentation` and `ToolDetailBlocks`; SSR verifies stdout/stderr content, accessible copy controls, plain mode and absence of raw payload JSON |

Other high-churn cases remain frozen. Source checks for permission/lazy-render
wiring are not claimed to be replaced by SSR effects. Existing behavioral and
native tests still own those acceptance paths. No feature scenario becomes
obsolete solely because its source-text test is retired: keep the feature IDs
when their behavioral/native replacements remain. Delete IDs only when the
underlying behavior or scenario has actually been superseded.

## Quarterly review

`pnpm audit:test-maintenance` reports a rolling 90-day Git test-change count.
The quarterly/manual `test-maintenance-audit.yml` workflow archives the report.
Five or more changing commits makes a file a review candidate, not a deletion
candidate. Compare maintenance burden with actual bugs caught and replacement
coverage; start with high churn and little verified regression signal.

When real evidence is available, pass `--evidence <json>` (the workflow uses
`docs/testing/regression-evidence.json` when present):

```json
{
  "coverage": { "from": "2026-07-01T00:00:00Z", "to": "2026-10-01T00:00:00Z", "complete": false },
  "regressions": [
    { "path": "apps/desktop/test/example.test.mjs", "caughtAt": "2026-09-01T00:00:00Z", "evidence": "CI run URL and confirmed bug reference" }
  ]
}
```

Use only confirmed regression catches, not every failed CI run. A complete flag
requires a documented exhaustive audit of the stated interval. Missing or
partial evidence yields `unknown`; it never implies no regressions caught.
`none-recorded` is permitted only for a complete interval with zero recorded
catches, and is still not proof that coverage is unnecessary. Never fabricate
history. This script does not collect private logs or call providers.

For each proposed retirement, record the behavior/contract, replacement test and
scenario, and actually run it. Replace or remove the old test and obsolete ID
in the same PR. Pure document, copy, i18n and visual changes may omit new tests
only under the root policy's interaction/responsiveness/accessibility/layout
conditions; verify the affected surface and record the remaining risk.
