# PI-TEST-1131: two Electron suites and the session-summary side call

Status: 已验收 (accepted by the user on 2026-11-27; committed on the request branch; both suites pass on this HEAD over `27dc6b45a`; not pushed at acceptance time). Project: `fork-pi-desktop`. Created: 2026-11-27 (Asia/Taipei).
Tier: T1 (test infrastructure only; no product, IPC, Host, protocol, storage or i18n change).
Baseline: `27dc6b45a8c5b5dcb2ea321deed845af378a3f25` (`origin/main`).
Branch: `chore/20261127-pi-test-1131-e2e-side-calls`.
Worktree: `/Users/sakurasep/Documents/Code/Project/Project Worktree/fork-pi-desktop/20261127-chore-pi-test-1131-e2e-side-calls`.
Ids: PI-TEST-1131 (PI-UI-1129 and PI-UI-1130 are taken by open work).

## Problem

`scripts/e2e-team.mjs` and `scripts/e2e-context-insights.mjs` both failed on `main` after PR 110 (D649 session-activity summary, merged 2026-11-26). The summary is a second, tool-free model call on the session's own provider; it wraps the transcript in `<conversation>` and its system prompt starts "You write the status note shown at the top of a coding session's side panel". Neither suite knew about it:

- `e2e-team.mjs` classifies provider requests by user text, so the summary request (same conversation text, zero tools) entered the "Please spawn one teammate" branch and asserted that the Lead advertises `declare_team_strategy`, failing with `Lead runtime lacks strategy declaration`.
- `e2e-context-insights.mjs` records every provider POST as an agent step, so the summary call made `fixture.requests.length === 3` while the Host ledger held two requests, failing `Read user path records two completed provider requests`.

A built `27dc6b45a` worktree reproduced both failures with the same assertions, so this is a stale-fixture problem on `main`, not a regression from any open request. Instrumented requests during the Team failure: two Lead turns with 24 tools (including `declare_team_strategy`), then three tool-free `<conversation>` requests whose system prompt is the summary prompt.

## Change

A — both journeys run with the feature off. Their `settings.set` seeds now pass `autoSummarizeSessions: false`, the same Host setting `session-summary-ipc.ts` reads before any summary work. Neither suite tests summaries; `scripts/e2e-session-activity.mjs` owns that surface.

C — a regression that re-enables the call now names its cause. Each fixture recognises the summary system prompt, answers it plainly instead of treating it as a Team/agent turn, and records that it happened (team: `summaryCalls`, context insights: `summaryRequests`). A final assertion fails with the setting name and the recorded calls instead of an unrelated Team or request-count error: `the journey must run with autoSummarizeSessions: false; saw [{"tools":0},…]`.

Untouched: the product, the summary implementation, both suites' existing assertions, the event log, and the suites' process/timeout structure.

## Validation

Run in the worktree on 2026-11-27 from this HEAD (`27dc6b45a` plus this diff), each Electron suite alone with a throwaway profile and Host data directory, loopback fixtures only, the spawn hook that appends `-ApplePersistenceIgnoreState YES`, the harness variables removed, and a 300s alarm:

- `scripts/e2e-team.mjs`: exit 0. All fourteen PASS lines, including the Team runtime, lifecycle, layout matrix, Chinese reload and French labels.
- `scripts/e2e-context-insights.mjs`: exit 0, including `Read user path records two completed provider requests` and the new `the journey runs without a session-summary side call`.
- Negative test for the new guard: seeding `autoSummarizeSessions: true` in the Team journey makes it fail with `the journey must run with autoSummarizeSessions: false; saw [{"tools":0},{"tools":0},{"tools":0}]`, so the guard is the thing that reports, not a Team branch. The seed was restored to `false` and the suite re-run to green.
- `node --check` on both scripts; Biome lint clean; `check-test-quality` passes (these scripts are outside the source-regex baseline); docs checks pass with this record.

## Residual risks

- The guard only recognises the current summary system prompt and the D649 one-shot shape. A different future side call would still be misread; the fixtures' text classification is unchanged otherwise.
- Both suites remain outside GitHub Actions, so nothing prevents another side call from landing without a run; adding them to CI is a separate decision.

## Not run

- Push, pull request, merge and release (waiting for the user).
- The other Electron suites: this diff touches two scripts only.
