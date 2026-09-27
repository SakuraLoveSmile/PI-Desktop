# Temporary Goal execution repair — implementation handoff

- Revision: F-r1, 2026-09-25.
- Current authorization: planning only. This turn may write this plan; source, tests, runtime data and existing drafts remain read-only. A later explicit implementation request authorizes the implementation tasks below, not publication or a paid-provider test.
- User decision: temporary sessions must support Goal, with contracts and execution outputs in their own session workspace.
- Numbering: retain F1–F4 from the repair discussion. These are prerequisites for the separately planned Canvas report, not a replacement for its T1–T6. This document is self-contained for the repair; Canvas implementation is not a dependency or an acceptance requirement.
- Document language: English, per repository policy. The user-facing delivery is Chinese.

## 1. Result and scope

A user can create a temporary conversation, negotiate a Goal, inspect its exact contract, approve it, and obtain output in that conversation's own directory. Another open project is never used implicitly. A failed submission is visibly an error, never a successful task completion. Contract files and outputs survive application restart and age-based scratch cleanup for the lifetime of the owning session.

Included: local Desktop Host-owned temporary Goals, the shared runtime submission semantics used by Plan and Goal, Host persistence/retention, existing artifact preview, and the existing headless runtime's error-event consumer. No new RACP or remote-file feature is introduced; preserve existing remote behavior and never resolve a remote artifact against a local scratch directory.

Excluded: implementing the calculator from the reported conversation, retrying that live conversation, completing or publishing Canvas, enabling temporary Plan execution, native Pi sessions, arbitrary TSX execution, a new report framework, automatic background model retries, release/build installation, production data repair, and unrelated cleanup.

## 2. Checkout, evidence and existing drafts

### 2.1 Working directories

- Primary coordination checkout: `/Users/sakurasep/Documents/Code/Project/Fork Project/PI-Desktop`.
- Repair worktree: `/Users/sakurasep/Documents/Code/Project/Fork Project/PI-Desktop-worktrees/fix-temporary-goal`.
- Repair branch: `codex/fix-temporary-goal`.
- Inspected repair HEAD and local `origin/main`: `35d69037422492db38ed0c816966122e61989b8c`. The remote was fetched in the earlier diagnostic turn, not again in this planning turn.
- Primary HEAD: `1c355b5faf508ab3101ca52cc84efbdadffa8372`; the primary is dirty and behind its local remote-tracking ref. Do not develop there or update it as part of this repair.
- Separate Canvas worktree: `/Users/sakurasep/Documents/Code/Project/Fork Project/PI-Desktop-worktrees/feat-goal-completion-report`. Its source and branch are outside this repair's ownership. Do not copy its uncommitted implementation or alter its artifacts.

All source paths below are relative to the repair worktree. The implementation lead must recheck status and current base after receiving implementation authorization. Continue this request's worktree; do not create a second competing implementation. Preserve the existing edits before any authorized base refresh. If a safe refresh is blocked by overlapping or unowned changes, report that blocker rather than stash, reset, or force a rebase.

### 2.2 Confirmed failure, from the earlier diagnostic turn

Only the named conversation was read. Session `22f97d3d-219f-4043-8743-876958cacd59` had no project binding, remained in Goal mode and had no `plan_approvals` rows. Two otherwise valid `SubmitGoal` results returned `PLAN_WORKSPACE_REQUIRED`, `isError: true`, and `terminate: true`. Their outer tool records said success, and their turns ended as completed. Approval and implementation never began.

There were earlier model argument mistakes (an asktool option shape and a missing SubmitGoal question), but the model corrected them before the repeated workspace rejection. They are not the root cause and do not justify loosening tool schemas.

The installed app's version was read as 0.15.7 in that turn. The repair source declares 0.15.6. Do not claim the source build is the exact installed binary. Reproduce the failure with synthetic inputs against the candidate.

### 2.3 Current source inspection and unfinished work

Implementation was mistakenly started before the user clarified the planning-only boundary. It was stopped. Existing source, test and documentation edits remain uncommitted. They are inputs to review, not accepted implementation.

| Task | Current status | What exists and what remains |
|---|---|---|
| F1 | 实现中 | Host workspace and retention drafts exist. Original-root persistence, session movement/deletion boundaries, migration and final integration still require the plan below. |
| F2 | 实现中 | Draft outcome-hook propagation exists. It does not yet prove failure-first turn settlement, steering-safe termination, or extension non-override. |
| F3 | 实现中 | Artifact resolver and openers exist. Origin is still inferred from the current project; several tests are source regexes; translations are incomplete. |
| F4 | 未开始 | An unexecuted E2E script draft exists. Complete candidate acceptance has not begun or passed. |

Earlier subagents reported some focused passing tests. Those reports are historical and incomplete, and were not rerun in this planning turn. The earlier Desktop dependency build log ended in i18n TS2739 errors after new English keys were added without all locale entries. Some draft regex assertions still expect the helper's earlier return shape. Do not label these as unrelated baseline failures without comparing the untouched base with the same environment.

No UI session, build, test, model request or migration runs as part of this planning revision. Only this Markdown is written.

## 3. Required reading and verified entry points

All executors read `AGENTS.md` and the nearest applicable instruction file. UI ownership additionally reads `apps/desktop/src/AGENTS.md`. Package-specific README/AGENTS files must be verified to exist; root references to missing files are not evidence that they were read. Existing summaries are `crates/README.md`, `packages/README.md`, and the root README.

Product/validation reading, restricted to relevant sections:

- `docs/spec/00-baseline.md`.
- `docs/spec/03-runtime/02-agent-runtime.md`: contract modes and execution.
- `docs/spec/03-runtime/03-tools-and-permissions.md`: session roots and scratch lifecycle.
- `docs/spec/03-runtime/04-data-storage.md`: proposals, migrations, session deletion.
- `docs/spec/03-runtime/06-host-rpc-protocol.md`: submit/resolve identity and errors.
- `docs/spec/06-delivery/03-ai-development-workflow.md`, `04-e2e-test-plan.md`, `05-change-checklist.md`: relevant change/test policy.
- `docs/adr/0053-plan-checkpoint-artifact-and-execution-epoch.md` and `0124-temporary-session-scratch-workspace.md`.
- Existing draft `docs/adr/temporary-goal-scratch-workspace.md` must be revised to match this plan; it currently claims no migration is needed, which this revision supersedes.

| Flow | Entry points |
|---|---|
| Host submit/approve | `crates/host-core/src/rpc/mod.rs`: `resolve_plan_workspace`, `plans.submit`, `plans.resolve`; `plans/approval.rs`: `PlanManager::enter/submit/resolve` |
| Persisted proposal | `crates/host-core/src/plans/model.rs`, `plans/repository.rs`: `PROPOSAL_COLUMNS`, `proposal_from_row`, `get_proposal` |
| Session directory/lifetime | `crates/host-core/src/scratch.rs`, `main.rs`; `sessions.rs`: `move_session_project`, `delete_session`; `db/migrations.rs`: `boot_maintenance` |
| Runtime tool/turn | `packages/agent-runtime/src/runtime.ts`: `buildSubmitTool`, `afterToolCall`, Agent `finishTurn`, `handleAgentEvent`, `reportMutationTermination`, turn reset/dispose |
| Execution decoder | `packages/shared/src/types/plans.ts`; `packages/host-runtime/src/plan-execution.ts`: `planExecutionFromUnknown` |
| Desktop settlement | `apps/desktop/electron/main/runtime/event-persistence.ts`, `plans.ts`, `session-coordination.ts`; `main/ipc/session-ipc.ts` |
| Preview | `apps/desktop/src/components/PlanApprovalBar.tsx`; `stores/app-store.ts`: `openPlanArtifact`; `stores/slices/events-slice.ts`, `session-slice.ts`, `work-panel-slice.ts`; draft `lib/plan-artifact.ts` |
| Safe file reading | `apps/desktop/src/components/workpanel/FilesTab.tsx`; `apps/desktop/electron/main/ipc/workspace-ipc.ts`; existing `api.getSessionScratchPath` |
| Existing verification | `packages/agent-runtime/src/runtime.test.ts`; `packages/host-runtime/src/runtime-service.test.ts`; `apps/desktop/test/queued-turn-finalization.test.mjs`; `scripts/e2e-plan.mjs`; draft `scripts/e2e-temporary-goal.mjs` |

Current code is authoritative when an old plan/spec contradicts it. In particular, Host boot interrupts pending approvals and queued/running executions before serving requests; it does not replay queued Goal work after restart.

## 4. Frozen shared specification — F-r1

This section is the single authority for all F tasks. No executor may substitute a different root, status or retry policy. Internal names and organization can follow repository conventions.

### 4.1 Original workspace identity

Resolve new submissions as follows:

| Proposal kind and session binding | Artifact root | Normal execution root |
|---|---|---|
| Goal, project-bound | Existing session project | Existing session project |
| Goal, temporary | Host-owned `scratch/<sessionId>` | Same existing Host tool workspace |
| Plan, project-bound | Existing session project | Existing session project |
| Plan, temporary | Reject submission with `PLAN_WORKSPACE_REQUIRED` | No execution |

Keep the existing mode-selector/EnterPlanMode behavior; the retained restriction is temporary Plan **submission/execution**, not a newly invented ban on selecting Plan. EnterGoalMode retains its current active-turn, mode and live-execution checks. It does not create a contract or approval.

Do not set `RuntimeSession.projectPath` or launch `projectPath` to scratch. Tools already obtain that workspace from Host. This prevents accidental project instruction, memory, plugin, skill and MCP activation.

**Amendment to the prior chat plan: persist origin.** The previous no-migration design cannot keep a temporary contract's origin after a completed session moves to a project. Inferring origin from current `project_id` also drops retention protection. Introduce one durable origin discriminator rather than probing candidate directories or inferring ownership from file presence.

Proposed additive contract (not implemented or verified yet):

```ts
// Extend the existing PlanArtifact; all other fields retain their meaning.
type ArtifactWorkspaceKind = "project" | "scratch";
// PlanArtifact.workspaceKind?: ArtifactWorkspaceKind
// Missing on legacy wire records means "project".
```

- Add `artifact_workspace_kind TEXT NOT NULL DEFAULT 'project'` to `plan_approvals`, constrained to `project|scratch`.
- Host chooses the value at submission. Do not accept it, an absolute root or a scratch path from model arguments or approval request input.
- New artifact descriptors include the value in proposal, execution and planning events. The execution decoder must preserve it. Missing legacy values decode as project; an explicitly invalid value is rejected at the boundary, not silently defaulted.
- The persisted discriminator is authoritative on approval, preview and retention even after mode becomes Agent or the session moves to a project.
- A scratch root is derived only from the validated owning session ID and Host data directory. No persisted absolute machine path is necessary.
- Keep the original exact Markdown, relative `.pi/<kind>/<unique-name>.md`, hash, size, approval identity and permission vocabulary.
- Project-origin contracts preserve their existing root/preview behavior. This repair does not redesign movement of historical project-origin contracts.
- Unknown-session requests and cross-session proposals fail before filesystem access; the mutable global workspace is never a fallback.

Current actual Host schema is 19 while the shared schema constant is stale at 16. For the inspected base, migrate Host 19 to 20 using existing migration/backup infrastructure and align the shared schema constant to the resulting actual Host schema. Update schema assertions and direct consumers. Do not migrate from 16 based on the stale constant. If the base advances, append to its actual schema version rather than collide with another migration. The Host RPC protocol remains 11: this is an additive field with a defined legacy interpretation; do not change protocol version merely to hide a decoder omission.

Migration defaults all previously valid rows to project: the pre-feature Host could not persist a temporary Goal contract. Use synthetic v19 fixtures including pending and completed Plan/Goal rows and sessions with real history. Preserve file bytes, IDs, approvals and data. Do not open the user's production DB with the new binary. Follow existing newer-schema rejection behavior; do not promise old binaries can downgrade the new database.

### 4.2 Approval, identity, movement and deletion

- Pending approve/reject must match proposal/session/turn/tool-call and existing version rules.
- Resolve kind and workspace kind from the stored proposal, not current session mode or caller hints.
- Require an explicit valid permission mode for approve, including duplicates. Do not loosen the current API to accept missing permissions.
- Repeating the same already-committed resolution with the same identity/action/permission returns its original execution identity. Preserve the current terminal-duplicate/version behavior. Do not revalidate a deleted file, create a directory, rewrite a contract or queue a new execution for this idempotent response.
- Conflicting terminal action/permission returns `PLAN_APPROVAL_CONFLICT`; invalid identity remains stale; pending version mismatch remains stale. First approval still verifies the immutable artifact before committing.
- For a **scratch-origin Goal** with pending approval or queued/running execution, `session.moveProject` and `session.delete` return existing `PLAN_CONFIGURATION_BLOCKED` before changing anything. This narrow guard prevents a live contract from changing execution roots or losing its workspace. Do not broaden it to unrelated session deletion workflows.
- The user rejects a pending contract or stops an active execution before moving/deleting. A queued execution must be cancellable through the existing Goal/session abort path; if that path lacks queue cancellation, F1 adds it to that path rather than adding a new recovery API.
- After completed/rejected/expired/interrupted state and no remaining active execution, existing move/delete operations work. Moving preserves the original scratch-origin marker and all scratch files; subsequent new ordinary turns follow the new project binding. Deleting removes the session and its associated scratch through existing cleanup.
- Host serializes admission against move/delete; do not rely solely on Renderer disabled controls or Electron's active-turn map. Failed mutations leave rows and files unchanged.

### 4.3 Retention and restart

Protect the whole scratch directory while a live session has any persisted **scratch-origin Goal** record, regardless of current project binding or proposal status. Pending, rejected, expired, interrupted and completed contracts all remain user data until session deletion. A project-origin Goal alone does not exempt its unrelated scratch from the ordinary TTL.

- Existing seven-day age cleanup remains for unprotected scratch directories.
- Orphan directories are removed even if a stale protection identity appears in memory.
- If live-session or origin-protection queries fail, skip the affected scratch deletion and log the failure; never substitute an empty set. Do not fail application startup solely because cleanup could not run.
- Renderer reload with the same live Host restores a still-pending approval without extending its deadline.
- Host restart interrupts previous pending approvals and queued/running executions under the existing boot fence. Preserve their files; no model, tool, queue or approval replay occurs.
- Completed work stays completed; interrupted work does not resume without a new user request and the applicable approval.
- A failed submission that published a file but failed its database transaction follows the existing rollback cleanup. Do not grant permanent retention solely because an unreferenced `.pi/goal` directory exists.
- No automatic historical-card rehydration or report generation is added. Retained files remain available through the session directory; existing live transcript/card references must open their original scratch root.

### 4.4 Submission outcome and turn termination

| Outcome | Tool result | Turn/approval behavior |
|---|---|---|
| Correct Submit succeeds | Success; authoritative terminate | Exactly one pending proposal; negotiation ends; no further model request or execution until approval |
| Invalid arguments, rejected before submit | Error | Existing model-correctable behavior; no proposal; do not force fatal termination |
| Confirmed rejection before Host commit | Error with original Host code | Visible failed turn, no proposal or execution, no success notification |
| Transport failure or malformed response with unknown commit outcome | Error with original transport code or `PLAN_SUBMIT_FAILED` | Visible failed turn; preserve any committed Host proposal; no fabricated local proposal, automatic resubmission, execution or success notification |
| User cancellation | Existing abort semantics | Abort remains authoritative; do not restate it as an ordinary submission failure |

Implementation direction is fixed:

1. Preserve the existing per-tool failure/termination hooks, but record fatal submission errors and successful submission stop decisions in the current turn/epoch.
2. The Agent `finishTurn` decision must end that submission turn even when steering arrived while Host was responding. Tool-result `terminate` alone does not guarantee the pi loop stops before steering consumption.
3. In `agent_end`, process this terminal submission state before any pending-steering early return. Retain unconsumed user input in the existing buffer/queue; do not drop it, auto-approve, or run it through a pending approval.
4. A fatal submission emits the existing structured error event before the existing terminal agent event. Reuse the visible-error pattern of `reportMutationTermination`; preserve Host code and diagnostic context without exposing secrets.
5. Desktop/headless existing settlement owns the final turn. Confirm the first error claim cannot be restated as completed by the following agent_end; no new finalizer or status projection is needed.
6. Only for SubmitPlan/SubmitGoal, trusted extension result processing cannot clear runtime-authoritative error/termination flags. Preserve other tools' established extension semantics.
7. Clear new turn-scoped submission state on the existing reset/dispose paths. A user retry must not inherit the old failure.

For an unknown commit outcome, the Host may already have one durable pending proposal. Keep that contract and use the existing pending-query/Renderer reconciliation as authority. Do not clear a known pending state, compensate by deleting a contract, or automatically submit again. A recovered pending contract can be inspected and approved once through the normal explicit user action; no new model request is needed to recover it. The runtime error describes uncertainty about the response, not proof that persistence failed.

Do not mark every tool error as a failed turn, introduce unlimited retries, replace schemas with permissive arguments, or infer failure by scanning arbitrary nested tool JSON at persistence time.

### 4.5 Artifact preview and UI scope

- For `artifact.workspaceKind === 'scratch'`, use `proposal.sessionId` with the existing `api.getSessionScratchPath`, join the validated Host-relative artifact path, and open the built-in file tab. Do not depend on a plugin being installed or active in a project.
- For missing/project origin, preserve the existing preferred file-manager/plugin fallback behavior. Do not read entire transcripts just to infer a root.
- Use one shared helper/service for automatic open, pending restore and manual artifact click. Keep the central store and component as wiring.
- Capture proposal/session identity before await. Use `openWorkPanelTabForSession` with that captured session; a background result cannot change the current session or focus. Coalesce simultaneous opens of the same artifact so delayed duplicate responses do not repeatedly replace the active tab.
- If the session was deleted while resolving, do not recreate a retained panel context. A failed scratch lookup is visible through existing localized error UI and does not open a guessed path.
- After movement of a settled temporary Goal to a project, the saved scratch marker still opens the old contract in its original directory.
- Do not turn remote session IDs into local paths. New remote temporary-Goal browsing is outside this repair; unsupported existing routes must return a visible capability error rather than local fallback.

**Visual baseline, from source inspection only:** `PlanApprovalBar.tsx`, `styles/composer.css`, `components/workpanel/FilesTab.tsx`, `styles/work-panel.css`, `styles/tokens.css`. No current native UI was launched or visually verified in this planning turn.

Preserve:

- The approval title/file link/reject/split-approve arrangement and remembered permission choice.
- `.plan-approval-bar`: current two-column grid, 10px/14px gap, 7px/9px padding, 8px bottom margin, `--radius-md`, composer background/shadow tokens.
- Title `--text-md-plus`, strong weight and compact leading; file link `--text-xs-plus`, existing muted/secondary colors, mono path and ellipsis.
- The existing 520px composer-container one-column change and 360px compact actions; existing hover/focus states.
- File header 6px/8px padding, mono `--text-xs-plus` path, existing Markdown rendering and internal scrolling.
- Existing light/dark themes, user font scale, panel widths, maximize controls and keyboard activation. No new shortcut or global token.

The only UI differences are correct scratch-file content and actionable localized failure feedback. Reuse the current loading/error file-view states and toast primitive; no new design system or page. Translate added keys for every locale in `supportedLocales` (`en`, `zh-CN`, `zh-TW`, `de`, `es`, `tr`, `fr`, `ko`, `pt-BR` at this base). New English keys without typed translations are a build failure, not a baseline exemption.

## 5. Ownership, implementation order and deliverables

Only after explicit implementation authorization:

1. Lead reviews this worktree's drafts against F-r1, refreshes the base safely, and establishes the additive shared artifact type/fixtures described in §4.1. This is implementing an already frozen contract, not postponing its design.
2. Start F1 Host, F2 Runtime and F3 UI workers concurrently against those shared fixtures. They may mock external boundaries while awaiting the Host implementation; they must not replace real internal wiring in final acceptance.
3. Integrate producers/decoders/UI and complete F4. Verification and read-only review may run in parallel in separate fixture profiles; the lead continues documentation and integration inspection.
4. Return review findings to the file owner. No simultaneous edits to a shared file, no worker commits, and no creation of user-facing Codex tasks.

The lead exclusively owns `packages/shared/src/types/plans.ts`, `packages/shared/src/protocol.ts`, shared contract tests, root `package.json` if a command is registered, and all docs (including this plan, ADR and `docs/project/unreleased.md`). Workers request edits to these files through the lead. F1 owns the actual Rust schema version; lead mirrors its finalized version into shared after confirming the migration.

### F1 — Reliable temporary Goal ownership

- **Owner:** Host worker.
- **Exclusive files/modules:** affected files under `crates/host-core/src/plans/`; thin exports in `plans.rs`; relevant handlers/resolvers and RPC tests in `rpc/mod.rs`; `scratch.rs`; scratch startup wiring in `main.rs`; narrow move/delete guards in `sessions.rs`; `db.rs` version wiring and `db/{schema,migrations,model,tests}.rs` as required by the actual migration path.
- **Required inputs:** §§3–4, shared origin fixture, current v19 schema and existing artifact verification tests.
- **Steps:** replace draft current-binding inference with persisted origin; add the additive migration and row serializer; resolve submit/approve from correct identities; keep terminal duplicates filesystem-independent; add narrow mutation admission guards; protect scratch by stored origin; preserve restart fence and deletion cleanup.
- **Structural boundary:** queries belong in `plans/repository.rs`, filesystem checks in `plans/artifact.rs`/scratch ownership, thin entry points only. Do not add domain logic to the `plans.rs` facade.
- **Parallelism:** independent of F2/F3 after the shared fixture is available.
- **Deliverable:** code, migration, synthetic repro/regression tests, exact changed-file list and red/green evidence. No live DB migration.
- **Acceptance:** V1–V8 and migration/isolation checks below; Host build and appropriate Rust checks pass.

### F2 — Correct Submit errors and one-shot approval boundary

- **Owner:** Runtime worker.
- **Exclusive files/modules:** `packages/agent-runtime/src/runtime.ts` and relevant runtime tests or narrowly extracted submit-outcome helper; `packages/host-runtime/src/plan-execution.ts` and decoder/runtime-service tests. Do not modify Desktop finalization implementation unless independent evidence proves it cannot consume the correct error sequence; route such a finding to the lead.
- **Required inputs:** §4.4, shared origin type, `runtime.test.ts` fake stream helpers, `@earendil-works/pi-agent-core` installed implementation at the lockfile version (0.87.1 here).
- **Steps:** complete turn-scoped outcomes, stop before steering continuation, protect Submit decisions against extension override, emit visible failure before terminal success candidate, clear state, preserve artifact origin through descriptor decoding. Remove the abandoned temporaryGoal launch flag if any remnants appear; it is not part of F-r1.
- **Parallelism:** F1/F3 independent; runtime tests mock only Host/provider boundaries and do not require UI.
- **Deliverable:** real pi-loop regression tests, outcome ordering evidence, decoder compatibility tests and runtime check results.
- **Acceptance:** V2/V3/V9/V10; no second provider request after successful Submit, failure is not completed, ordinary tools and cancellation retain semantics.

### F3 — Correct session-owned preview

- **Owner:** UI worker.
- **Exclusive files/modules:** draft `apps/desktop/src/lib/plan-artifact.ts`; `components/PlanApprovalBar.tsx`; thin artifact-open wiring in `stores/app-store.ts`, `stores/slices/{events,session,work-panel}-slice.ts`; related `apps/desktop/test/plan-*.test.mjs` and preview behavioral tests; affected keys in `packages/i18n/src/locales/*/index.ts`.
- **Required inputs:** §§4.1/4.5, shared origin fixture, scoped UI rules and listed visual baseline.
- **Steps:** resolve by stored origin, use existing scratch API and built-in file preview for scratch contracts, keep project behavior, preserve session identity across awaits, avoid recreating deleted contexts, localize failures, replace draft regex-only checks with executable behavioral tests. Leave unrelated settings/layout source contracts intact.
- **Parallelism:** can build against frozen host-return fixtures while F1 runs.
- **Deliverable:** integration-ready preview, all locale keys, meaningful delayed-resolution tests, list of native UI states for lead review.
- **Acceptance:** V1/V6/V8/V11; correct content and ownership, no style redesign, all affected i18n/type checks pass.

### F4 — Integrated user journey, review and evidence

- **Owner:** lead integrates; verification worker owns `scripts/e2e-temporary-goal.mjs` and `apps/desktop/test/queued-turn-finalization.test.mjs` additions; reviewer is read-only. No ownership overlap with F1–F3.
- **Required inputs:** F1–F3 diffs and results, actual candidate HEAD/base/diff identifier, existing isolated E2E utilities under `scripts/e2e/`.
- **Steps:** repair the existing E2E draft to use real Desktop/preload/Host/sidecar and a loopback model; verify API admission and actual UI preview/approve; run normal Plan regression; verify error-first finalization; collect native screenshots; review security/compatibility; synchronize docs and release-note draft.
- **Parallelism:** verification and review use independent resources after integration; lead reviews screenshots and docs while they run. Failures go back to their owner.
- **Deliverable:** result table for V1–V12, commands/exit codes, tested versions, screenshots, remaining limitations. Logs are supporting material, not the user-facing result.
- **Acceptance:** no unresolved required check, no false success, no access to real providers/data. Lead independently confirms the complete user effect rather than accepting worker self-report.

## 6. Acceptance matrix and fixtures

Use synthetic session S1 (temporary Goal), S2 (another temporary session), and P1 (an unrelated visible project). No real conversation contents are needed. Contract: `# Temporary Goal` with an acceptance item requiring `goal-result.txt` to contain `GOAL_OK`.

| ID | Path/condition | Observable result |
|---|---|---|
| V1 | S1 Goal -> SubmitGoal -> open artifact -> explicit approve -> normal Write | Exact contract bytes/hash; one pending proposal; normal execution only after approval; marker under S1 scratch; S2/P1 untouched; projectPath stays absent. |
| V2 | Confirmed pre-commit rejection, then a separate committed-but-response-lost/malformed fixture | Tool error and visible assistant error; original code or PLAN_SUBMIT_FAILED; error precedes agent_end; durable turn is error; no success notice or automatic execution. Confirmed rejection creates no proposal. Unknown outcome preserves the one committed pending proposal and reconciles it; no compensating deletion or duplicate submission. |
| V3 | Submit while steering is queued; extension tries to clear stop/error | At most the intended submission request; pending user text is retained, not run through approval; runtime Submit decision wins; no extra tool/model execution. |
| V4 | Same valid resolution delivered twice, including after contract file becomes unavailable | Original execution identity returned with no filesystem mutation or duplicate dispatch; different action/permission conflicts; original required permission/identity checks remain. |
| V5 | Scratch-origin Goal pending/queued/running -> move/delete | PLAN_CONFIGURATION_BLOCKED; rows/root unchanged; reject/stop using the normal flow, then move/delete succeeds. Pending re-entry and wrong-kind submission remain rejected. |
| V6 | Completed scratch Goal -> move to P1 -> reopen its existing reference and age sweep | Saved scratch origin still locates the contract; original outputs remain; new ordinary turns can use P1; no contract/output migration. |
| V7 | Controlled directory mtimes >7 days | Live scratch-origin Goal protected for every terminal/pending status; ordinary scratch still expires; project-origin alone does not protect; orphan deleted; query failure deletes nothing. Use FileTimes/controlled clock, not sleeping days. |
| V8 | Renderer reload, then separate Host restart tests | Renderer reload restores pending approval/deadline; Host restart interrupts pending/queued/running without replay; files remain. Deleted-session errors are visible and don't reopen a panel context. |
| V9 | Retry in a new turn after failed Submit | No stale termination/error flags; a valid submission succeeds and waits for approval. Cancellation remains aborted. |
| V10 | Legacy/project fixtures | Missing origin defaults to project; explicit invalid origin rejected; decoder retains scratch marker; existing project Plan/Goal and temporary Plan submission restriction remain. |
| V11 | Slow scratch lookup; switch S1->S2; concurrent open; missing file | Result stays with S1, S2 focus/content unchanged, no duplicate active-tab jumps; file-read failure uses existing error surface; plugin absent still previews. |
| V12 | v19 database upgrade; path attacks; stopped/deleted session | Rows/history and artifact bytes preserved; new root field correct; no path or symlink escape; session deletion removes associated scratch after active work is stopped. |

The E2E mock replaces only the model API. It must not create the output marker itself or substitute for approval/Write handling. Assert actual request count, pending approval, UI content, stored mode and filesystem output. For the failure path, route a controlled Host submission failure through production runtime hooks and real finalization; do not merely fabricate a red UI card.

## 7. Validation environment and commands (future execution only)

Run from the repair worktree, after implementation authorization and safe base preparation. These are instructions, not results from this planning turn.

- Use Node/pnpm versions from `package.json`; the system `pnpm` was 8.15.4 while the repository requires 10.34.5. Use `corepack pnpm` for direct commands. For scripts that themselves invoke `pnpm`, prepend a worktree/scratch-local Corepack shim directory to PATH; do not change the system installation.
- The primary checkout's installed pi dependencies were 0.86.1 and incompatible with this base's 0.87.1. The repair worktree has links to compatible third-party dependency/cache resources; workspace package links must resolve to this repair worktree, not the Canvas worktree's source/build outputs.
- Cargo cache was APFS-cloned into this worktree to avoid sharing mutable output binaries with the Canvas task. Reuse it, then rebuild the changed Host. Never run an old or another task's binary as proof of this candidate.
- Do not reinstall dependencies merely for E2E. If a dependency is truly missing/incompatible, record the evidence and repair only that prerequisite after implementation authorization.
- Use unique profile/data/ports/artifacts. Explicitly remove inherited live-provider test variables and confirm all fixture endpoints are loopback. Do not launch or attach to the user's installed Desktop. Do not run `verify:ui:*`.

First establish the focused regression baseline; after implementation, build workspace dependencies before consumer tests. Final candidate commands follow, with filters extended only for relevant new files:

```bash
corepack pnpm --filter '@pi-desktop/desktop...' build
corepack pnpm --filter @pi-desktop/shared test
corepack pnpm --filter @pi-desktop/agent-runtime exec vitest run src/runtime.test.ts
corepack pnpm --filter @pi-desktop/host-runtime test
corepack pnpm --filter @pi-desktop/i18n test

node --test apps/desktop/test/plan-artifact-resolution.test.mjs \
  apps/desktop/test/plan-approval-settings.test.mjs \
  apps/desktop/test/plan-renderer-flow.test.mjs \
  apps/desktop/test/plan-mode-source-contract.test.mjs \
  apps/desktop/test/queued-turn-finalization.test.mjs

cargo fmt --check
cargo test -p host-core --locked
cargo clippy -p host-core --all-targets
cargo build -p host-core --locked

corepack pnpm --filter @pi-desktop/desktop typecheck
corepack pnpm --filter @pi-desktop/agent-runtime typecheck
corepack pnpm --filter @pi-desktop/host-runtime typecheck
corepack pnpm lint

node scripts/e2e-plan.mjs
node scripts/e2e-temporary-goal.mjs
corepack pnpm docs:check
git diff --check
```

Use the local pnpm shim for nested commands above. Build shared/workspace dependencies before consumer typechecks. `docs:check` may need the existing compatible docs dependency links; do not misreport a missing prerequisite as a passed check. Do not run all unrelated E2E suites or build a new test platform.

New behavioral tests must fail against the relevant pre-fix behavior or use the explicit confirmed baseline. Existing unfinished regex tests are not sufficient red/green evidence. Reproduce alleged unrelated baseline failures with matching dependencies before classifying them. Keep required gates failing until relevant defects are fixed; do not weaken assertions to match implementation drift.

Native UI checks: local fixture app, 1024x768 and 1440x900 windows; dark/light theme; English/zh-CN; long contract filename; scratch file loading/error; keyboard activate the file link and approve/reject controls. Check the existing 520px/360px composer-container arrangements. Capture pending approval with rendered contract and the completed marker result; the lead views the images and checks clipping, focus and session ownership. These are targeted evidence screenshots, not a permanent screenshot framework.

Record candidate HEAD, base main, uncommitted diff identifier if applicable, exact suites, exit codes and environment. Refresh against current origin/main before candidate acceptance using repository-safe rules. A tested uncommitted snapshot is not a tested commit; if later authorized to commit and the executable tree changes, rerun affected gates. Do not commit or publish without explicit authorization.

## 8. Documentation, Canvas coordination and completion

Lead updates the relevant English specs listed in §3, error semantics, storage schema/migration, origin field, scratch retention, and E2E scenario/traceability entry. Amend the draft ADR and ADR 0124's Goal exception; retain Plan behavior and the original no-replay decision. Update `docs/project/unreleased.md` without inventing a release version or tagging a release. Synchronize corresponding maintained translated pages required by the docs checks. Do not rewrite the historical accepted Plan implementation plan as though it were current work.

Canvas coordination boundary: this repair establishes correct execution/approval identity, a stable artifact origin, and truthful failure events. The separate Canvas implementation should consume them later. F1–F4 do not create report APIs, report UI, report tables or a SubmitGoalReport tool. Do not edit or synchronize the separate Canvas branch as part of this plan.

There are no unresolved user-experience choices required to start this repair after implementation authorization. The origin discriminator/migration is a deliberate revision justified by the confirmed session-movement and retention defect; it replaces the earlier no-migration draft. Local naming and helper extraction remain executor choices. If current source contradicts these frozen rules, the lead supplies evidence and revises only the affected specification before dependent work; do not silently guess or lower acceptance.

The lead reviews scope and diff, integrates all consumers, and reports user-visible outcome, real checks, UI evidence and limitations. Necessary verification missing or blocked means 实现中; all applicable verification complete means 待体验; only explicit user confirmation permits 已验收. Stop after two materially different unsuccessful attempts at the same blocker, state expected/actual/evidence and the decision needed, and continue independent authorized work. No production retry, data rewrite, paid call, commit, push, merge, app replacement or cleanup is implied by this planning document.
