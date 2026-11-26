# PI-UI-1123: pinned session summary in the activity rail

Status: 待体验 (committed on the branch, rebased onto `origin/main` `786179c99`, pushed as a draft pull request; merge waits for the user). Project: `fork-pi-desktop`. Created: 2026-11-22 (Asia/Taipei).
Tier: **T2**. The change adds a model call over conversation text (a new egress of up to about 6,000 characters per refresh), a Host storage namespace with a compare-and-set RPC, two IPC channels and a setting. ADR `session-activity-session-summary` (Accepted); D649 amends D645.
Baseline: `origin/main @ 786179c99` (the branch was rebased onto it on 2026-11-26; Batches A to C are merged).
Branch: `feat/20261122-pi-ui-1123-activity-session-summary`.
Worktree: `/Users/sakurasep/Documents/Code/Project/Project Worktree/fork-pi-desktop/20261122-feat-pi-ui-1123-activity-session-summary`.
Code revision: one commit on the branch (65 files, 3,679 insertions and 22 deletions against `origin/main`), after the rebase; the conflict resolution touched only the E2E plan and both decisions logs.
Commit, push, merge and release wait for the user's explicit word.

## Request and source

The user asked in the activity-rail redesign thread for 「在侧边栏的最上方 加一个会话总结 类似于实时状态」. The approved canvas v6 draws it as one pinned card above every section: a sparkle glyph, 「更新于 2026-11-21 09:50」 in a small monospace face, a refresh icon and a multi-line paragraph on a plate one tint lighter than the pane, clamped to four lines with 展开 / 收起. This is Batch D of that redesign; Batches A, A2, B, Reconnect and C are merged (PR 101).

Because the card adds a model call, Host storage and IPC, the batch waited at a briefing: the ADR draft and eight open decisions were put to the user, who answered 「全按推荐，开始实现」 on 2026-11-22. That makes every recommendation below a frozen decision. The user has not asked to commit, push or merge.

## Frozen decisions

| # | Decision |
| --- | --- |
| D1 | One-shot on the session's own provider and model, thinking off, no tools. The agent runtime owns the call (synthetic launch id `session-summary:<sessionId>`); never Host, never the renderer. |
| D2 | Automatic update when a turn of the shown session ends while the rail pane is visible, the Host reports `behind >= 2` and the last attempt is over 60 s old. The refresh control forces a run: it skips the threshold and the interval, never the single flight, and may run mid-turn. |
| D3 | Host kv namespace `session-summary-v1`, at most 2,000 bytes UTF-8, compare-and-set, removed with the session on all three delete paths. No schema version bump. |
| D4 | Budgets: 6,000 input characters (each message at most 1,200, the previous note at most 480), 400 output characters, `maxOutputTokens` 320, a 45 s limit, one flight per session. |
| D5 | The card sits above the "Needs attention" block, above every section. |
| D6 | The refresh icon forces a run. |
| D7 | Setting `autoSummarizeSessions` (absent means on). Off: no automatic or manual refresh and no card; the stored note is kept. |
| D8 | Merely opening a session never calls a model; a session gets its first note after its next finished turn. |

## Behavior change

- **Card.** One pinned card above the attention block and every section: sparkle glyph, 「Updated YYYY-MM-DD HH:mm」 in local time (small monospace), a refresh control at the right edge and the note as one paragraph clamped to four lines. Expand / Collapse appears only while the text is cut off. It is one plate in the `--ds-bg-hover` tint with no stroke (D297) and no hairline of its own; it has no grip and is not part of the saved section order (`pi-desktop:activity-section-order:v1` is untouched).
- **When the card is absent.** No stored note yet (a first run shows nothing until it finishes; there is no placeholder), the session was rewound past the note, a `native-pi:` or `remote:` session, a Team member session, a Host without the RPC (older Host: no card, no error), or the setting is off.
- **When a note is written.** At the end of a turn of the shown session while the rail pane is visible, when the Host counts at least two messages since the stored note (tool rows count) and the last attempt is over a minute old; or when the refresh control is pressed. The attempt time is recorded before the call, so a failed or timed-out call also counts toward the minute. A hidden pane, another session, a closed pane, a switched-off setting or a lower revision never receives or replaces anything.
- **Refresh control.** A spinner and `aria-busy` while a run is under way; it stays focusable (`aria-disabled`, not `disabled`) and a second press starts nothing. A failed manual refresh raises one error toast; a failed automatic one is silent and the previous text stays.
- **What the model sees.** The newest 60 transcript rows from the Host, reduced to top-level user and assistant text (tool and subagent rows dropped), newest first up to 6,000 characters; a long message keeps its head and tail. The previous note is sent only when the session was not rewound past it. Forged `<conversation>` and `<previous_summary>` tags in the text are neutralized.
- **What it may return.** One inert plain paragraph of at most 400 characters (1,800 bytes): fences, markup, links, list markers, a label prefix and wrapping quotes are stripped, a URL-only or path-only answer is rejected, and a longer answer is cut at a sentence end. The renderer never supplies text; the note is shown only as a text node.
- **Storage.** Host kv `session-summary-v1`, value `{version, text, revision, basedOnMessageCount, updatedAt}`. A write is a compare-and-set in one immediate transaction that also checks the session is live. The record is removed with its session by `delete_session`, `delete_session_with_team_cleanup` and the plugin-session delete (trash and purge). It never enters the transcript, search, export or a fork; an unreadable or newer-version record reads as absent.
- **RPC (additive, protocol 11 unchanged).** `sessionSummary.get` returns `{summary, messageCount}`; `sessionSummary.set` takes `{sessionId, text, basedOnMessageCount, expectedRevision}`. Errors: 1002 `SESSION_SUMMARY_UNSUPPORTED` / `LIMIT_EXCEEDED` / `INVALID_ARGUMENT`, 1007 `NOT_FOUND`, 1008 `SUMMARY_CONFLICT` (carries the winner), 1000 `INTERNAL`, -32601 for an older Host.
- **IPC.** `pi-desktop/sessionSummary/get` and `pi-desktop/sessionSummary/refresh({sessionId, force?})`. A refresh answers `updated` or `skipped` with one reason: `disabled`, `no-content`, `not-behind`, `too-soon` or `conflict`.
- **Setting.** Settings, AI, Conversation and display, "Session summary" (`autoSummarizeSessions`). Its description says what is sent and that it may use quota. It is deliberately not part of the portable configuration that config sync captures.
- **Unchanged.** Every existing rail section, its counts and order, the attention block, the Goal, Plan and Servers sections, and every transcript, search and export path.

## Implementation notes

- Host: `crates/host-core/src/session_summary.rs` (record, validation, compare-and-set), `rpc/session_summary_rpc.rs`, the route and the setting validation in `rpc/mod.rs`; the delete lists in `sessions.rs` and `plugin_sessions.rs` name the namespace.
- Runtime: `packages/agent-runtime/src/session-summary.ts` holds the prompt builder, the output cleaner and `summarizeSession` over `completeOneShot`. No model call exists anywhere else.
- Electron main stays thin: `electron/main/ipc/session-summary-ipc.ts` (registered from `register.ts`) reads the setting and the transcript window, decides skip or run, calls the runtime with a 45 s race, writes the result through the Host and logs only error codes (plus provider, model and message count on success).
- Shared: `packages/shared/src/session-summary.ts` (types and guards), three error codes, two IPC channels, the setting type.
- Renderer: `stores/runtime/session-summary-runtime.ts` (controller: epoch-tagged answers, single flight, monotonic revision adoption), `use-session-summary.ts`, `ActivitySummaryCard.tsx`, `session-activity-summary.css`, wiring in `SessionActivity.tsx` and `SessionActivityRail.tsx`, the settings toggle and search entry, nine locales.
- Every new module is below the size guidance (the largest, `session_summary.rs`, is 460 lines including its tests). None of the ratcheted files (`electron/main/index.ts`, `app-store.ts`, `ChatTranscript.tsx`, `Composer.tsx`, `plugins.rs`, `db.rs`, `providers.rs`, `plans.rs`) is touched.
- The deliberate non-feature: no placeholder is shown while the first note is being written, so no dead DOM and no hidden-state "no summary" card ships.

## Validation

Run in this worktree on macOS arm64 with a real local dependency tree (the hybrid
overlay was replaced by a clone of the main checkout's tree), a rebuilt renderer and a
debug Host binary built from this branch, on the rebased commit.

| Check | Result |
| --- | --- |
| `cargo test -p host-core --locked --offline` | 1319 passed, 0 failed, 1 ignored (136.7 s); includes the 7 Host record tests, the per-path delete tests (ordinary, Team cleanup, plugin trash and purge) and the setting validation |
| `cargo fmt --all -- --check`, `cargo clippy -p host-core --all-targets --all-features` | clean; the 2 `host-core` warnings are pre-existing |
| agent-runtime vitest (full) | 203 files, 1947 tests passed; `session-summary.test.ts` 20 tests |
| shared vitest (full) | 112 files, 1342 tests passed; `session-summary.test.ts` 4 tests |
| i18n vitest | 30 tests passed; nine locales carry the new keys |
| desktop node tests (full) | 4602 total, 4598 passed, 0 failed, 4 skipped; includes the 14 main-process refresh tests, 17 controller tests, 6 card and rail tests and the settings round trip |
| desktop `tsc --noEmit` | clean |
| Style tokens, test quality, architecture ratchet, agent policy, release docs | passed (the test-quality baseline was not touched) |
| Docs `check-locales` / `check-docs` (662 pages), scenario index (138 suites, 169 ids) | current |
| Electron renderer E2E `e2e-transcript-render` | overall ok; the summary stage reports 39 checks, and the rail, workspace, servers, integration and readability stages pass |
| Electron renderer E2E `e2e-goal-blocked-ui`, `e2e-goal-team-renderer-ui` | `ok:true` |
| Real isolated Host: `e2e-session-activity` | 6/6 passed, including `E2E-ACTIVITY-SUMMARY` (empty read, exact trimmed UTF-8 write, behind count, compare-and-set conflict, size/blank/unsupported refusals, restart, fork, delete); binary SHA256 `29ba928d08b37712d3396d0747ceb961963a24e2165813d243ad9cf012c7d19c`; no provider calls |

Two things a re-run needs:

- `scripts/e2e-session-activity.mjs` resolves its Host from `git rev-parse
  --git-common-dir`, which points at the **primary checkout** for a worktree. Run it with
  `PI_DESKTOP_HOST_BIN=<worktree>/target/debug/pi-desktop-host-core`, or it silently
  exercises the main checkout's older Host and stops at
  `sessionSummary.get: method not found`.
- This shell exports `NODE_USE_ENV_PROXY` plus `http(s)_proxy`/`ALL_PROXY`; with them set
  two unrelated `node-proxy` cases in the agent-runtime suite fail. The Node and Electron
  runs above were made with those variables unset.

Electron E2E ran with `CLAUDE*` variables unset and `-ApplePersistenceIgnoreState YES`.

## Acceptance scenarios

- `E2E-CHAT-session-activity` (spec `docs/spec/06-delivery/04-e2e-test-plan.md`): the summary steps, expectations, specs and automation were added; automation is the session summary probe (`scripts/e2e/session-activity-summary.tsx`, stage `activity-summary` of `scripts/e2e-transcript-render.mjs`) with a fake one-shot, never a real model.
- `E2E-ACTIVITY-SUMMARY` in `scripts/e2e-session-activity.mjs`: the Host record against a real isolated production Host.

## Visible evidence

Acceptance is canvas parity, not plan text: the approved v6 canvas (its own markup, CSS and script, rendered offline) beside the real `SessionActivity` rail (production CSS from the build, real store and controller, only the Host edge faked), same state, a 264px pane with its padding, device pixel ratio 2, dark and light. Frames are not committed; they are in the review session's notes folder (`pi-ui-1123-evidence/`, with a README that explains the rig).

| State | Canvas: card / body / Expand | Real: card / body / Expand |
| --- | --- | --- |
| Long text, collapsed | 158.56 / 80.56 / shown | 158.56 / 80.56 / shown |
| Long text, expanded | 218.98 / 140.98 / shown | 218.98 / 140.98 / shown |
| Short text | 126.56 / 80.56 / none | 126.56 / 80.56 / none |

The numbers are identical in both themes. Differences that remain: the canvas pane is 265px (a 0.5px frame) so its card is 1px narrower than the real 232px card and the first line of the long text fits one more character; the canvas draws its own rounded frame and different content below the card; the canvas icons were swapped for the app's Lucide glyphs, so icon shapes are not evidence. A before / after pair shows the rail top with and without the card; with no note the card is not rendered, so "before" is the rail on `main`.

## Decisions left to the user

1. **The timestamp at large text.** At font scale 1.4 in the 264px pane the 「Updated …」 line is ellipsised (`2026-11-2…`), exactly as the canvas's single-line stamp is. The full time is only in `<time dateTime>`. Keeping parity costs the time at that scale; letting the stamp wrap, or adding a tooltip, costs a deviation from the canvas. Nothing was changed.
2. **A real-provider measurement.** Latency, cost and the quality and language of real summaries have not been measured (see NOT RUN). It needs an explicit go, because a real provider call is outside the default test environments.
3. **Merge.** Commit, push and a draft pull request were done at the user's word; merge still waits for the user.

## NOT RUN and risks

- NOT RUN: any real provider or model (cost, latency, summary quality, output language), the installed app, Windows and Linux rendering, a touch device, `verify:ui:*` (only on the user's request) and the hosted CI gates (they run on the PR).
- New egress: up to about 6,000 characters of recent conversation go to the session's own provider on each refresh, at most once a minute per session while the rail pane is visible, plus every press of the control. The setting turns it off; the description says so.
- The 60-row window can hold few text rows in a tool-heavy session, so the note may describe a thin slice; `behind >= 2` counts tool rows, so a long tool-only stretch can trigger a run whose input barely changed (the minute interval bounds the cost).
- A session gets its first note only after its next finished turn with the pane visible (D8); until then the rail has no card, and there is no control to ask for one.
- Failure handling: a failed or empty answer keeps the old note; an automatic failure is silent by design, so a persistently failing provider shows as a stale 「Updated」 time, not as an error.
- Numbering: D648 is claimed by the unmerged PI-BG-1122 worktree (draft PR 109) and this change takes D649; both sit between D647 and D650, so either merge order keeps the sequence.
- Changelog: not changed; release notes are written by the release-prep step.
- Runtime resources: no process, server or watcher from this task is left running; the isolated Host and Electron runs exited and removed their temporary directories.
