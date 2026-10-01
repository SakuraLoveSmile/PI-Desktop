# Plan Preview, Quick Archive, Plus Curated Plugins, Team Dispatch, and Completion Reports

Plan revision: 5 — closeout handoff, 2026-10-01 (Asia/Taipei).
Supersedes revision 4's implementation instructions and completion labels.
Repository documentation remains English under AGENTS.md §0.

## 1. Goal, workspace, and evidence

Finish the existing T1–T5 scope: readable Plan artifacts; non-destructive quick
archive/restore; a selectable, version-reviewed Plus source; expert selection
confirmed before dispatch; and durable completion reports with truthful evidence.
This revision is planning only. Only this plan may change in this round.
Implementation requires a subsequent explicit user request; that request permits
local implementation and applicable isolated validation, not remote publishing,
paid models, production data changes, or operation of the user's running app.

- Primary checkout: `/Users/sakurasep/Documents/Code/Project/Fork Project/PI-Desktop`.
- Request worktree: `/Users/sakurasep/Documents/Code/Project/Fork Project/PI-Desktop-worktrees/plan-preview-archive-official-team`.
- Request branch: `codex/plan-preview-archive-official-team`.
- Current request HEAD, local main and remotely checked main:
  `aef7aad669bb12357d58d899516aeec5473e40e4`.
- Worktree contains existing, uncommitted T1/T2 changes, report style extraction,
  shared contracts, partial Plus Host work, specs and repository templates.
  Continue this same request worktree; do not develop in the primary checkout,
  reset it, copy another task's dirty work, or rebuild these changes from scratch.
- Recheck Git state and current origin/main at implementation start. Preserve all
  unrelated changes. Refresh this private branch in its own worktree before
  candidate validation; conflicts in unrelated files require a handoff.

### Verified baseline and status

All five overall features remain **实现中**. The closeout steps below are
**未开始**; no native UI or user acceptance is established.

| Task | Existing work to retain | Remaining acceptance gap |
| --- | --- | --- |
| T1 | Scoped reading CSS, existing Markdown/file toolbar | Narrow query is ineffective; geometry/native comparison absent |
| T2 | Quick row control, shared archive path, focus helper | Executed interaction, repeat-click, failure and reload paths absent |
| T3 | Plus enum/endpoint, Plus update isolation, shared review slot | UI, source pin, manifest matching, review persistence and fixture lane |
| T4 | Strategy/review/decision types and five IPC names | Runtime tool, Host review/approval gates, model binding, UI and dispatch flow |
| T5 | Optional report fields, extracted goal-report.css, asset operation name | Host/runtime/UI/remote integration, read-state fix, evidence and assets |

Evidence from the preceding review in this chat: 26 targeted desktop Node tests,
28 shared Goal/Team tests, Desktop typecheck and diff whitespace passed. The new
layout/sidebar tests mostly inspect source text; these passes do not establish
runtime layout or archive interaction. An isolated Chromium measurement obtained
400px width with padding `16px 20px 24px`, instead of `12px 14px 20px`; the
process later timed out, so this is only a computed-style defect observation.
Historical full desktop counts (2904/2911/2917) are not fresh release evidence.
This planning round ran no business tests and opened no application.

This round re-read the public Plus endpoint: HTTP 200, schemaVersion 2,
providerId `pi-desktop-plus-curated`, zero plugins. It is configured and empty,
not unconfigured or failed. First approved-package publication remains external.

### Mandatory reading at execution start

Read root AGENTS.md and actual applicable scoped rules; currently the renderer
scope is `apps/desktop/src/AGENTS.md`. Do not assume missing package READMEs or
scoped rules exist. Read existing source/tests and the relevant portions of:

- `docs/spec/00-baseline.md`;
- `docs/spec/06-delivery/{03-ai-development-workflow,04-e2e-test-plan,05-change-checklist}.md`;
- T1/T2: `docs/spec/04-ux/09-interaction-patterns.md`, FilesTab/Sidebar and nearby tests;
- T3: `docs/spec/07-plugins/{07-plugin-marketplace,08-plugin-signing-updates,17-plus-curated-channel}.md`;
- T4: `docs/adr/0307-expert-team-collaboration.md`, Team contracts and tests;
- T5: `docs/spec/03-runtime/{04-data-storage,16-tool-result-limits,19-remote-agent-control-protocol}.md`, Goal report code and tests.

Repository workflow rules take precedence over stale delivery prose, including
local-main E2E or inferred commit authorization. Fix affected workflow drift only
when implementation authorizes those documentation changes. Do not make local
main an integration branch. Commit only when explicitly requested.

## 2. Shared contracts and implementation ownership

The existing shared additions are a starting point, not proof of wired behavior.
The main agent alone owns `packages/shared`, locales, all specs/NAV/ADRs,
`crates/host-core/src/rpc/mod.rs` registration, Electron IPC/preload, renderer
`lib/api.ts`, remote backend/RACP/agent-host wiring, shared runtime files and E2E
harnesses. Domain workers own the exclusive files in §3. No concurrent writers.

Freeze the additive request/result types below in shared before dependent workers
start. Keep schemas and serializers aligned across Rust/Node/Electron/remote/UI.
Avoid `any`, unchecked report casts, new SQLite columns or SDK breaks. Use existing
Host-owned kv and report files; version new kv namespaces. If current code proves
a migration indispensable, stop that dependent change and document the actual
compatibility impact before proceeding. New public contracts get contract tests;
new architectural/security ownership requires an ADR under root policy.

Path convention for task ownership below: renderer component/style/lib paths are
relative to `apps/desktop/src/`; desktop test paths to `apps/desktop/`; Rust
plugins/team/sessions/goal_reports paths to `crates/host-core/src/`; Electron
runtime/plans.ts and service/IPC paths to `apps/desktop/electron/main/`.
Node runtime.ts and goal-report-tool.ts are in `packages/agent-runtime/src/`.
All `scripts/` and `docs/` paths are repository-relative. Main also owns shared
style primitive changes (ui.tsx/globals.css/messages.css), if actually necessary;
workers send requests instead of editing those files concurrently.

### C3 — marketplace install identity

`ExpectedMarketplace = {source: PluginMarketSource, catalogUrl: string,
version: string, shasum: string}`; plugin id remains the existing install `id`.
Attach optional `expectedMarketplace` to the current market-install request and
queue request. It is mandatory when the effective source is `plus`, optional for
legacy callers of the four existing sources, and enforced whenever supplied.
Use `source: "plus"`, not the catalog's provider id. URL is the normalized effective
source that produced the displayed version; SHA is lowercase 64-hex.

After fresh metadata resolution and before downloading, compare effective source,
URL, selected version and SHA. A mismatch or missing required Plus pin returns
`PLUGIN_MARKET_CHANGED`, leaves installed bytes intact and requires a new user
review; retry retains the original pin. Internally generated Plus updates carry
the same pin. Compare package manifest id/version against the request before
replacing any installed directory; mismatch also returns `PLUGIN_MARKET_CHANGED`.

Persist optional `marketplace.review` with the existing MarketReview shape.
Plus installability requires a valid approval for the displayed exact version
with `decision: "approved"`, policy `plus-curated-v1`, a valid reviewedAt and
matching catalog version/SHA. A yanked version cannot install. Curated review is
a maintainer assertion over bytes, not publisher authorship, signature verification
or a safety guarantee. Preserve upstream attribution/license and existing trust
resolution; never add Plus to `is_trusted_channel()`.

### C4 — Host-owned approval and dispatch

Keep TEAM_TOOL_NAMES' nine tools, add Lead-only `declare_team_strategy` only in
Agent Team Lead turns. Plan/Goal modes must not advertise or expose Team mutation
or the new declaration. Tool caller identity and turn id come from runtime,
never model arguments. The declaration is a new Agent-facing write; update/
confirm/cancel remain trusted UI writes, outside the sidecar proxy allowlist.

- Declaration input is the existing `DeclareTeamStrategyArgs`.
  `lead_only` records a bounded reason and returns `{decision, review: null}`.
  `delegate` returns `{decision, review}` with status pending and no new member,
  task, mailbox entry or expert call. Identical declaration retries in the same
  turn return the same record and preserve user-edited selections. A differing
  declaration in that turn fails TEAM_REVIEW_REVISION_CONFLICT; a new proposal
  needs a new Lead turn and cannot overwrite a confirmed batch.
- `getExecutionDecision({teamSessionId, leadTurnId}) -> {decision: TeamExecutionDecision | null}`.
- `getLaunchReview({teamSessionId, reviewId?}) -> {review: TeamLaunchReview | null}`;
  omitted id returns that team's latest review; wrong-team ids reveal no body.
- `updateLaunchReview({teamSessionId, reviewId, expectedRevision, selections:
  TeamLaunchReviewSelectionUpdate[]}) -> {review}`. Atomic Host CAS; pending only;
  unique row names; return the complete next revision. No partial-success updates.
- `confirmLaunchReview({teamSessionId, reviewId, expectedRevision}) -> {review, decision}`.
  Revalidate all routes and permissions, then transactionally materialize only
  approved roster members and persist the approval and continuation message.
  Duplicate confirm of that accepted revision returns the same member/message ids.
  No new provider calls occur inside the Host confirmation transaction.
- `cancelLaunchReview({teamSessionId, reviewId, expectedRevision}) -> {review}`.
  Pending transitions to cancelled; confirmed cannot be cancelled through this
  operation (use existing pause/stop lifecycle). Repeated cancel is idempotent.

Store reviews/decisions under versioned `team-launch-review-v1` and
`team-execution-decision-v1` kv namespaces, scoped by team/turn/review. States:
`pending -> confirmed | cancelled | interrupted`. Startup interrupts pending
reviews; confirmed approvals remain historical facts and must not auto-replay a
completed Lead. A new proposal is required after interrupted/cancelled review.
Review freshness is separate from roster/board revision; never use UI equality
as Host CAS. Conflict is `TEAM_REVIEW_REVISION_CONFLICT` with no side effect.

Missing selection snapshots the Lead's effective provider/model/thinking at
proposal creation. A provider/model override must specify the pair; thinking-only
override is allowed. Show the resolved route before confirmation, including when
reusing an existing member. Validate supported thinking levels with existing
provider/model rules; invalid/stale routes fail `TEAM_MODEL_SELECTION_INVALID`,
without fallback. Proposed reused members must belong to the same team.

Confirmation creates a single durable message to the Lead describing approved
members and reviewId, keyed `team-review:<reviewId>:confirmed`. Reuse existing
team-delivery and its `team-message:<messageId>` queue idempotency. The resumed
Lead uses normal task/send tools for the approved members; the UI does not invent
or execute tasks. If paused, hold this message until Resume. Partial coordination
failure records `coordinationError.stage/code/message` and existing ids; Retry
re-enqueues only missing receipts, never repeats successful member creation.

Host gates new member creation, task execution and work-dispatch writes against
confirmed selections, including direct calls to the old tools; otherwise return
TEAM_APPROVAL_REQUIRED with no side effect. Read/cleanup tools
remain available. Pending approval never means queued/delivered. Existing
pre-upgrade durable mail retains its existing recovery semantics and is labelled
historical/unrecorded, not fabricated as approved. Use Host deliveryStatus plus
queue receipts for queued/accepted/acknowledged; the legacy mailbox `delivered`
boolean is not evidence of success.

For Team members, generic session.configure may change provider/model/thinking
only while idle, with no queued dispatch and no pending review referring to that
member, after route validation and an atomic session/roster mirror update.
Otherwise return `TEAM_MEMBER_MODEL_CHANGE_BLOCKED`. Do not allow mode/profile
changes that detach a live Team binding through generic configuration. Roster
reads return the session's actual effective binding; fork applies confirmed
selections rather than merely recording requested values.

### C5 — report envelope, evidence, timing and assets

Keep schemaVersion 1 and all new presentation fields optional. Update both Rust
and TS draft validators; reject Host-owned fields in submitted drafts. Preserve
all valid new fields through runtime tool schema, draft storage, final snapshot,
read normalization and remote transport. Do not rewrite old snapshots.

`goalReports.get` retains its existing envelope/body fields and gains an accurate
shared discriminated read union. Only a ready envelope carries a full GoalReport.
Map every state emitted by `read.rs` explicitly: draft/pending loading, failed
publication error, corrupt/truncated unreadable, not_found unavailable. Clear the
previous ready body when execution/session changes; discard stale async results.
Retain existing reportSha256/fileBytes/maxBytes/integrity/verdict/detail envelope
metadata. Do not cast a state_stub to GoalReport or add fake execution fields to a
stub. Ready reads compare snapshot hash/size with stored publication facts, not
just recompute them; valid-shaped tampering must return corrupt.

After successful session outbox flush and terminal owning-turn persistence,
finalization computes the authoritative session message high-watermark inside
the Host transaction and stores it as durableSeq; replace the default-zero path.
If an optional legacy durableSeq is supplied, validate it against that boundary
rather than trusting it. Barrier failure stays failed, never ready. Retry only
flushes/refinalizes the report and never reruns Goal/Plan/provider execution.
Use owning turn started_at/ended_at for new reports with timingSource `turn`.
For missing turn timestamps set `unavailable`; old snapshots without provenance
show duration unavailable rather than proposal-to-publication elapsed time.

Resolve evidence ids to owning-session/turn durable records with seq <= durableSeq.
For tool_call/tool_result, refId is canonical callId; for message it is message id.
Cross-session/turn, missing, late or unsupported refs remain unresolved.
`recorded` proves record existence, not achievement. Produce checkObservations
only from recorded command/tool results whose command and exit code are available;
keep model claims beside Host observations. Contradictions are visible; absence,
not_run and blocked remain inconclusive. Do not parse free-text "passed" as fact.

Screenshot content is evidence-backed, never Agent-submitted bytes/path/URL in
SubmitGoalReport. Use a persisted tool result image or canonical attachment tied
to the owning call/message. Existing canonical tool_call.result and attachment
blocks are the source. Reuse root/path and content-addressed storage rules from
apps/desktop/electron/main/prompt-attachments.ts and existing session-path helpers;
a new typed image adapter, if needed to retain tool output,
normalizes `{type:"image", assetRef, mimeType, bytes, sha256}` before persistence
without changing model-visible role/tool/error semantics. assetRef must resolve
inside the established Host/session attachment storage; arbitrary filesystem refs,
external URLs and invented paths are unavailable. Inline recorded image blocks
may be materialized into that storage with the same boundary checks. The runtime
worker must cover actual producer -> durable record -> finalizer, not inject a
completed asset manifest into its test fixture.

Host copies resolved bytes into report-owned assets and creates an optional
Host-owned `assets` manifest with screenshotId, opaque assetId, evidenceId,
relativePath, mimeType, bytes and sha256. Drafts reject this field. Limits selected
for this handoff: 12 images, 8 MiB per image, 32 MiB per report; PNG/JPEG/WebP
only, magic-byte validation, regular file and no symlink/path escape. A bad image
adds a bounded limitation and is unavailable; it does not discard the textual
report. Publish assets and JSON before the ready DB transition; file failure
leaves failed with observable diagnostics. Unreferenced staging files owned by
this report can be cleaned without deleting source attachments or user files.

Add local Host `goalReports.getAsset` / RACP `goalReports/getAsset` using:
`{sessionId, executionId, screenshotId, offset, length}`. offset is a nonnegative
raw-byte integer; length is 1..262144. Response is a state union: ready carries
`{assetId,mimeType,totalBytes,offset,length,sha256,dataBase64,eof}`; unavailable,
not_found or corrupt carries no bytes and a bounded reason. Resolve identity and
manifest before reading; wrong session returns not_found. Validate ranges without
overflow; offset==totalBytes may return an empty final chunk. Full-byte hash is
validated before exposure and client verifies the assembled content. Default
RACP maxFrameBytes is 1 MiB, not Host NDJSON's 64 MiB; 256 KiB raw chunks fit the
default. Honor smaller negotiated transport limits and fail explicitly when no
safe chunk fits. Viewer may read; Retry remains owner-only under existing RACP
permissions. Renderer creates/revokes Blob URLs and cancels stale asset loads.

## 3. T1–T5 closeout packages

### T1 — readable Plan preview (closeout 未开始)

Owner: T1 UI worker. Exclusive files: file-viewer rules in
`styles/work-panel.css`, `workpanel/FilesTab.tsx` only if a wrapper is necessary,
`test/file-viewer-layout.test.mjs`. Main owns `scripts/e2e-plan-ui.mjs`.
Read current FilesTab, Markdown, MarkdownTable and nearby prose/layout tests.

1. Keep current scoped headings, table/code radius, toolbar and baseDir behavior.
2. Place `container-name: fileViewer` and inline-size containment on the existing
   parent `.file-viewer-body`; query changes the descendant markdown padding.
   Do not leave the querying target as its own container. Preserve scroll/flex.
3. Retain default padding `16px 20px 24px`, <=480px `12px 14px 20px`, 880px
   centered content cap, existing text tokens and `7px 10px` cells. No prose.css
   global edits or vendored pi.file-manager edits.
4. Add computed-style geometry assertions in the existing Plan UI harness;
   source regex can remain as a guard but is not the layout acceptance.

Acceptance: actual viewer widths 400, 480, 481 and >=960px show correct padding
and cap; heading/body/code/table/relative image render without shell overflow;
long tables scroll in their own shell; toolbar, Plan artifact bytes and relative
links remain unchanged. Main captures isolated light/dark native comparison at
matching widths; no new screenshot platform. Geometry must fail on current CSS.

### T2 — archive/restore that survives navigation and reload (closeout 未开始)

Owner: T2 UI worker. Exclusive files: Sidebar.tsx, sidebar-session-groups.ts,
sessions.css and sidebar quick-archive/component tests. Main owns
`scripts/e2e/sidebar-row-states.mjs` and layout harness.

Keep TooltipButton immediately before More, existing i18n, 24px control boxes,
2px gap and hover/focus/touch reveal. Keep archiveSession orchestration and store
restore; write presentation metadata only. No session/project/transcript deletion,
agent cancellation, re-pinning or batch-archive behavior changes.

Exercise the real handler/store wiring; add a synchronous per-row pending guard
if React's deferred state update allows duplicate calls before repaint. Clear it
on success/failure/disposal. Focus follows the post-operation active row, then
next/previous visible row, then session-sort; restore focuses its visible row or
anchor. Never restore focus after the user moves focus or switches scope during
await. Keep metadata and sessions consistent through existing persistence.

Acceptance: archive inactive and active rows, last active row fallback, pinned
and temporary rows, archived-view restore, keyboard focus, held asynchronous
operation with repeat clicks, user navigation during await, and failed
replacement-session creation rollback.
Reload after archive and restore; transcript and pin metadata remain intact.
Source-text assertions do not replace these executed paths. Integrate a focused
archive/restore sequence into existing isolated sidebar E2E; inspect minimum
sidebar width with both controls visible and long titles.

### T3 — usable Plus source with reviewed-version installs (closeout 未开始)

Owners: T3 Host worker and T3 UI worker, disjoint modules. Host owns
`plugins/marketplace.rs`, its new domain submodule if needed, install.rs,
model.rs, tests.rs. UI owns components/plugins/MarketplaceSourceSettings.tsx,
features/plugins marketplace/detail/install-queue surfaces and their tests.
Main owns shared/IPC/RPC/locale/template/preflight/E2E integration.

1. Implement C3 end-to-end through market detail/search DTOs, install request,
   queueInstall/PluginInstallRequest/usePluginsPage, API, IPC and Host install.
   Preserve the original snapshot through queued retries and source switching.
2. Add optional Rust review persistence, source pin comparisons, manifest pair
   validation before replacement, Plus-specific approved/yanked validation and
   existing Plus cross-source update guard. No rewrite of the four-source update
   policy; record that pre-existing defect separately. Valid old registry records
   still load without review. Failed upgrade preserves prior bytes and grants.
3. Add the fifth localized source option. Fixed endpoint is currently configured:
   enable selection and show a valid empty curated list. Distinguish configured
   empty, stale same-source cache and request failure; never silently replace a
   missing Plus catalog with bundled/upstream data. An unset build endpoint stays
   disabled with no request. Keep existing tabs/search/chips/installed layout.
4. Show exact-version review decision/date/policy and upstream attribution in
   the existing plugin card/detail surface; use existing Badge/description styles.
   Unreviewed and withdrawn versions never get a reviewed badge/install action.
5. Keep signature fields as unverified metadata. No new PKI, public keys or
   signature claims; checksum/review is the existing security scope. Synchronize
   docs so they do not describe manifest/signature checks as already present.
6. In local docs/templates/plus-curated, validate real package existence, hash,
   byte size and manifest id/version against approvals; preserve approved/yanked
   decision instead of hardcoding approved. Extend preflight with an explicit
   `--allow-empty-curated` flag requiring providerId pi-desktop-plus-curated and
   schemaVersion 2; all other empty catalogs still fail. Do not push templates.
7. Build `scripts/e2e-plus-curated.mjs`: isolated data/profile, local fixture
   catalog, real tiny packages and approval records. Host accepts file:// fixture
   catalogs only in a debug/test Host build with
   `PI_DESKTOP_PLUS_CURATED_FIXTURE=1`, `PI_DESKTOP_CAPTURE=1` and an explicit
   fixture data directory created under the OS temp root. The harness writes a
   schema-v1 fixture marker identifying that root; Host canonicalizes/checks it.
   Release Host builds never honor this lane, regardless of flags. The Electron
   fixture launcher selects the request's debug Host binary; packaged apps reject
   overrides. Production must ignore/reject that lane.
   In that same validated fixture process, allow file:// package URLs only for
   regular files below the marker's packages directory, with canonical path and
   symlink checks; run the real hash/size/ZIP/manifest/permission/install path.
   All other file:// catalogs/packages remain rejected. Production HTTPS and host
   allowlist rules remain intact; never add localhost to the production allowlist.

Acceptance: choose Plus -> empty; fixture one reviewed version -> permission
review -> install -> restart -> same exact review; changing source/version/SHA
while the confirmation is open rejects before download. Test wrong manifest
id/version, withdrawal, source-cache isolation, old registry compatibility,
Plus/other-source update isolation and unconfigured/no-network state. Test
fixture flags cannot weaken a normal process. Live package distribution is a
separate owner action, not a prerequisite for the complete local client path.

### T4 — confirmed expert routes and observable dispatch (closeout 未开始)

Owners: T4 Host and T4 UI workers. Host owns team/ modules plus Team-sensitive
sessions.rs edits; UI owns TeamPanel.tsx, OverviewTab.tsx, new review subcomponent
and team-panel.css. Main owns runtime.ts/team tool/prompt catalog and
session-launch.ts/team-delivery.ts integration to prevent shared-file races.

Implement C4 in Host review repository/state machine and a focused RPC module;
register from rpc/mod.rs without adding business logic to the giant dispatcher.
Prevalidate every proposed route and commit roster/approval/message atomically.
Fix fork overrides and session.configure/mirror gates. Reuse existing mailbox,
queue acceptance and receipt/ack machinery. Do not create a second dispatch loop.

Keep new declaration logic inside packages/agent-runtime/src/team/ and only thin
registration in runtime.ts. Wire team-tools.ts and team-prompt.ts with real catalog
filtering. Host rejects direct old-tool bypasses before approval. Wire all five
reserved IPCs, preload/API and event/refetch invalidation. Keep session-launch
strict for approved Team routes while preserving non-Team fallback behavior.

UI reference: existing TeamPanel header/roster and existing model binding/thinking
selectors. Add review above roster: reason, one expert row per proposed name,
provider/model/thinking controls, Confirm and Cancel. Names/context are displayed,
not edited in this scope. Snapshot route is explicit; edits save through Host CAS.
Use shared Select/Button/Field/Badge primitives, current semantic tokens and
--text-sm/--text-xs hierarchy. At <=480px stack member fields/actions vertically;
otherwise one row per expert with wrapping, no page-wide horizontal overflow.
Loading/pending/conflict/route-invalid/cancelled/interrupted and coordination
errors have localized text. Confirmation is disabled while saving/invalid;
conflicts refetch and require deliberate reconfirmation. Preserve existing Team
transcript, task board, panorama, pause/resume and navigation layout.

Acceptance: simple task declares lead_only with reason and no expert call;
delegate shows editable resolved routes with zero expert sessions/calls before
Confirm; Cancel/restart causes no launch; stale revision/route fails; Confirm
creates one roster and Lead continuation, then real task owner/send path reaches
accepted receipt and acknowledgement. Duplicate confirm/reload/restart creates no
extra expert or acknowledged execution. Pause holds queued work, Resume drains
once. Cross-team/member identities fail. Generic configuration cannot bypass
approval or silently replace confirmed models. Fake provider asserts each actual
member uses the confirmed provider/model/thinking, including fork/reuse cases.

### T5 — truthful, readable, durable completion reports (closeout 未开始)

Owners: T5 Host and T5 UI workers. Host owns goal_reports/{mod.rs,read.rs,tests.rs}
and new evidence/assets domain files. UI owns GoalReportTab.tsx,
GoalReportCard.tsx, goal-report.css and focused component tests. Main owns
runtime/plans.ts, goal-report-tool.ts, durable-image normalization if needed,
all shared/IPC/remote/RACP/agent-host wiring and E2E harnesses. Preserve extracted
stylesheet cascade and transcript card ownership in messages.css.

1. First add failing user-interface regressions for corrupt/truncated/not_found
   stubs and fix read union/async scope handling. Do not wait for assets to fix
   the existing crash.
2. Wire C5 validators/finalization/read fields, timing, Host message boundary,
   evidence/check observations and barrier-failure/retry behavior. Preserve the
   already-fixed finalization reliability paths; do not replace them with retries
   or swallow publication errors.
3. Reuse actual canonical recorded tool/attachment blocks to resolve images;
   integrate any required durable normalization before result truncation. Add
   Host-owned manifests, atomic assets/publication and chunk reads. Old report
   without assets is readable; requested screenshot with no valid bytes explicitly
   unavailable. Complete local and remote read paths, permissions and blob cleanup.
4. Keep existing report shell/semantic tokens; change only the report body:
   title + source context; up to four primary metrics; steps/files/checks tables;
   evidence image gallery; limitation callout; conclusion; existing criteria and
   next steps remain available. Additional metrics remain in a details section.
   Cap body at 1040px centered; padding 16px 20px 32px, <=480px 12px 14px 24px.
   Use two metric/gallery columns above 480px and one below, viewer-owned ancestor
   container queries, existing text-size/radius tokens. Tables get named header
   cells and local horizontal scroll; long paths/commands cannot expand the shell.
   Show file groups, check disposition, Agent claim versus Host fact and evidence
   availability explicitly. No screenshot placeholders or invented conclusion;
   absent conclusion reuses summary under a localized summary heading.

Acceptance: Goal execution -> actual report tool submission -> durable finalizer
-> transcript card -> WorkPanel report, all optional fields intact; corrupt states
render actionable errors without crash; interrupted/fallback/old reports readable;
timing shown only with turn provenance; false Agent pass disagrees visibly with
recorded failed command; late/cross-session evidence unresolved. Screenshot source
is persisted production-shaped tool output, copied by Host and retrieved through
actual local/remote API chunks. Validate SHA, range bounds, MIME, limits, symlink
and cross-session rejection; missing asset cannot destroy textual report. Retry
never starts a provider. Test session switching during report/asset awaits and
object URL disposal. Verify native light/dark narrow/wide table/gallery layout.

## 4. Parallel execution, dependencies and deliverables

Planning scouts were actually used read-only for T3, T4 and T5; main independently
checked T1/T2, transport bounds and the live empty catalog. Their reports informed
this handoff but do not count as runtime acceptance.

Execution waves:

1. Main freezes C3/C4/C5 shared types and producers/consumers contract fixtures;
   T1 and T2 can start immediately in parallel, owning disjoint files.
2. With frozen contracts saved in the request working tree, T3 Host, T4 Host and
   T5 Host proceed independently. Host workers
   provide proposed dispatcher registration changes to main; they do not write
   rpc/mod.rs or each other's modules.
3. T3/T4/T5 UI workers may implement rendering against the frozen real DTOs;
   integration starts only after the corresponding Host path exists. No fabricated
   ready/approved DTO adapters in product code. Main integrates IPC, runtime,
   remote and fixtures in sequence where files overlap.
4. Main independently reviews diff, runs integrated user paths, verifies native
   effects, resolves findings and records evidence. Do not accept worker self-report
   as final acceptance. An independent read-only reviewer may inspect final code
   after implementation; this is not a new user approval stage.

Each worker receives this revision, its numbered task/C-contract, mandatory reading,
exclusive files, input DTOs and dependency exit conditions. It must deliver paths,
behavior/compatibility impact, exact targeted checks/results and unresolved issues;
no commits/pushes, source cleanup, package upgrades or writes outside allocation.
Main alone updates this plan/execution log. Shared-file needs go to main.

## 5. Validation and completion gates

Run from the request worktree. Reuse primary host Node/pnpm/node_modules/Electron
and Cargo targets by reference; do not install a second environment solely for
E2E. Rebuild the candidate so it contains this worktree's source, not a stale
primary checkout bundle. Isolate all mutable test profiles, data, ports and logs.
Unset PI_DESKTOP_TEST_API_KEY, PI_DESKTOP_TEST_BASE_URL and
PI_DESKTOP_TEST_MODEL; use loopback fake providers only.
Do not start/attach the user's app or run verify:ui:*.

Targeted workstream checks precede integration; add failing repro first for known
bugs. Existing authoritative commands (select applicable surfaces):

```sh
pnpm build:js
pnpm --filter @pi-desktop/desktop typecheck
pnpm lint
pnpm --filter @pi-desktop/shared test
pnpm --filter @pi-desktop/desktop test
pnpm --filter @pi-desktop/agent-runtime test
pnpm --filter @pi-desktop/host-runtime test
pnpm --filter @pi-desktop/agent-host test
pnpm --filter @pi-desktop/racp test
node --test apps/desktop/test/file-viewer-layout.test.mjs apps/desktop/test/sidebar-quick-archive.test.mjs
cargo fmt --check
cargo test -p host-core --locked
cargo clippy -p host-core --all-targets
pnpm docs:check
```

T3 template/preflight tests are local and must not fetch upstream by default.
Focused component tests exercise actual handlers and shared internal wiring;
mock only external host/provider boundaries. Source regex is supplementary.
Avoid arbitrary sleeps: await named state, accepted queue entry or receipt.

Before candidate E2E fetch origin/main, incorporate it in this private request
branch, and pass `pnpm check:pr-base`. Run existing `pnpm test:e2e:plan-ui`,
`pnpm test:e2e:layout`, `pnpm test:e2e:team`, `pnpm test:e2e:goal-report` with
new cases for T1/T2/T4/T5. Existing focused test entry points include team/team-tools.test.ts in
agent-runtime, team-delivery.test.mjs and team-panel.test.mjs in desktop,
goal_reports/tests.rs and team/tests.rs in Host, and racp.test.ts in racp.
Extend their real public seams plus new contract/component cases rather than
substituting more source regex tests. Current goal-report script is Host-level,
so add
`node scripts/e2e-goal-report-ui.mjs` for the actual Electron report path, and
`node scripts/e2e-plus-curated.mjs` for T3. These two new scripts do not yet exist;
main must implement them using existing boot/fixture harnesses before claiming
these gates. RACP asset contract tests use existing in-process harness, not SSH
or a production remote Host. The isolated Electron fake-provider cases are the
native UI verification environment and must save affected-region screenshots.

Record tested HEAD plus uncommitted candidate diff/content digest, base main,
suites, result, environment and screenshots. A HEAD alone does not identify this
currently dirty candidate. After a requested commit, repeat applicable checks if
executable contents changed. If remote delivery is later authorized, validate the
actual PR integration candidate through repository gates; this plan does not
implicitly authorize commit, push, PR, merge, deployment or cleanup.

### User checks after applicable gates pass

1. Open a Plan artifact; narrow/widen the panel and read a table/code/image.
2. Archive an active chat, restore it from archived view and reload.
3. Choose Plus; see its current empty state or an approved exact fixture version.
4. Propose experts, edit routes, cancel once, then confirm; observe real queue
   receipt states and the selected expert model routes.
5. Open a completed Goal report, inspect evidence/check disagreement and captured
   images; retry an unreadable report without launching the Goal again.

Only after all applicable local gates and native checks pass is a feature
**待体验**. Only explicit user confirmation makes it **已验收**. A blocked required
check remains **实现中**; continue independent authorized work. After two attempts
with different evidence fail on the same blocker, stop blind retries and report
expected/actual/evidence/needed decision without weakening acceptance.

## 6. Boundaries and open external delivery

No implementation-blocking product choice remains for the local closeout under
C3/C4/C5. Internal names/module organization follow repo conventions. If source
changes invalidate a load-bearing premise, main updates only the affected handoff
and informs workers; do not silently invent a different protocol or lower goals.

External Plus distribution remains separate: the owner chooses and reviews the
first exact redistributable plugin, approves bytes and publishes approval/package/
catalog. Current empty catalog is valid; local fixture installs prove client
behavior but not a real curated package or real-provider quality. No claims of
signature verification, paid model performance, published app or user acceptance.

Keep task scope: no global prose restyle, new component library, unrelated runtime
reliability rewrite, all-source update redesign, application identity recovery,
production schema marker edits or user-data cleanup. Update affected behavior
specs and E2E scenario docs with English/Chinese mirrors and NAV consistency
while implementing; architecture/public-boundary decisions get appropriate ADR
context, not ADR prose as a substitute for executable contract tests.

## 7. Execution record

| Task | Closeout status | Required evidence to advance |
| --- | --- | --- |
| T1 | 未开始 | Computed padding/cap and native viewer comparison |
| T2 | 未开始 | Executed archive/restore/failure/reload/focus path |
| T3 | 未开始 | Pinned reviewed install plus source/manifest/cache negative cases |
| T4 | 未开始 | Approval-before-expert-call plus route/receipt/restart path |
| T5 | 未开始 | Typed read states, real finalization/evidence/assets/local+remote UI |

The main agent adds implementation/validation records here using existing T ids.
Record skipped checks honestly; preserve historical evidence as dated history.

## Appendix A. Revision 4 source corrections (historical evidence only)


| # | Revision 3 said | Source says |
| --- | --- | --- |
| 1 | Workspace `~/.codex/worktrees/plan-preview-archive-official-team/PI-Desktop` | Never existed. Created now under `PI-Desktop-worktrees/` on branch `codex/plan-preview-archive-official-team` |
| 2 | Plan lives in the request worktree | Plan was never on disk; this file is that artifact |
| 3 | `session-launch.ts:605` | `apps/desktop/electron/main/runtime/session-launch.ts`; `:605` normalizes the profile, the `TEAM_CONTEXT_UNAVAILABLE` literal is `:618` |
| 4 | AGENTS.md §7 hotspots | Stale: `plugins.rs` 79 LOC, `db.rs` 62, `ChatTranscript.tsx` 1. The real giant is `crates/host-core/src/rpc/mod.rs` (10727) |
| 5 | AGENTS.md §2 scoped rules | Only `apps/desktop/src/AGENTS.md` exists; the electron, ipc, shared, host-core, agent-runtime, plugin-sdk paths are absent |
| 6 | "Do not run `verify:ui:*`" | No such script exists in any `package.json`; the referenced gate is doc residue |
| 7 | ADR 0307 implies nine tools in every mode | It does not: `docs/adr/0307:88-91` scopes them to Team turns and names four tools plus "etc." |
| 8 | Global prose edits would reach "reports" | They do not: the report uses `.goal-report-prose` (`GoalReportTab.tsx:257`, `work-panel.css:1322`). Affected surfaces are chat, Team transcript, subagent transcript, table fullscreen preview, file preview |
| 9 | Preserve file-viewer copy/export/maximize | `FilesTab` has four controls only: back, path+tooltip, size, reveal. Copy/export live in `MarkdownTable`, maximize in the WorkPanel header |
| 10 | `resolvePlanArtifactPath()` resolves the owning project root | It resolves the scratch root only (`lib/plan-artifact.ts:41-43`); project artifacts stay workspace-relative and are joined with `workspace?.path` in `FilesTab.tsx` |
| 11 | `PI_DESKTOP_TEST_CAPTURE=1` gate | That variable does not exist. The real flag is `PI_DESKTOP_CAPTURE=1` (window/shutdown stability) and it does not gate the market URL override. The market fixture gate must be built |
| 12 | `MarketplaceSourceSettings` owns tabs/search/chips/installed | It is 112 lines: source selector plus custom URL input. Tabs are `PluginsPage.tsx:119-144`, chips `features/plugins/MarketplacePanel.tsx:53-80`, installed panel `InstalledPluginsPanel.tsx` |
| 13 | "Catalog schema remains v2" | Structural readiness only: no Rust `schemaVersion` gate, built-in fallback still writes 1, preflight accepts 1 or 2, the only v2 instance is a test fixture |
| 14 | `queueInstall({id, version})` | Real signature `{id, name, permissions, newPermissions?, version?}`; `marketInstall` is `{id, version?, enable?, autoUpdate?, grantedPermissions?}` |
| 15 | Reuse "manifest ID/version checks" | That check does not exist on the install path: `install.rs` uses `manifest.id` as the install id (`:72`, `:94`). Catalog `signature`/`signatureAlg`/`keyId` and `MarketDownloadInfo.signature` are never verified; crc32 is not checked on unpack |
| 16 | `evidence` field | The contract field is `evidences` (plural). `refId` and `evidenceRefs` have no Host validation or resolution |
| 17 | Resolve evidence at or below `durableSeq` | `durableSeq` is 0 in production: the RPC defaults it (`rpc/mod.rs:4368-4371`) and the only caller (`runtime/plans.ts:403-408`) never sends it |
| 18 | Verdict body reports result steps | It reports `report.steps.length` through `chat.resultSteps`; the string is "{{count}} steps", not a completed count |
| 19 | Host hashing "proves snapshot integrity" | The read path recomputes hash and size, but the DB `file_hash` column is not compared. Narrow the claim |

Positioning fixes: `.table-wrap` is produced by `Markdown.tsx:688`, not
`MarkdownTable`; `markdown-table.css` is not sampled by
`test/helpers/styles.mjs` and therefore has no style regression cover.

Additional verified constraints:

- T3 install chain exists (HTTPS restriction, download host allowlist,
  redirect re-check, fresh metadata, SHA-256, size and ZIP limits, `safe_join`,
  upgrade backup) but `trust` is a render-layer downgrade only
  (`marketplace.rs:660-695`), not an install gate.
- T3 gap A: a package whose manifest declares a different id installs under
  that id. Gap B: signatures are unverified.
- T4: `roster.rs` fork omits requested overrides while still recording
  requested values; `sessions.rs:1975-1996` (`session.configure`) updates only
  the session row, so member bindings can be changed without the roster
  mirror and without any Team gate; provider/model fallback in
  `session-launch.ts:295-298` is silent.
- T4 observability: the team mailbox reports `delivered: false` for messages
  that were delivered (reproduced five times this session). Dispatch state
  must therefore be derived from Host queue receipts, never from that field.
- T5: no 1040px content cap exists; report styles live in both
  `work-panel.css:1118-1679` and `messages.css:909+`; metrics breakpoints are
  four separate rules (`:1288`, `:1656`, `:1670`, `:1676`);
  `state_stub` (`read.rs:157-178`) omits `execution`, so
  `GoalReportTab.tsx:71-82` falls through to `:172` and throws `TypeError`
  for `corrupt`/`truncated`/`not_found`.
- `turns` has `started_at`/`ended_at` and `bind_execution_turn` already stores
  `turn_id`; `messages` has a durable `seq` with `UNIQUE(session_id, seq)`.


## Appendix B. Repository selection and initial publication history (2026-09-30)

Historical notes below are not current activation instructions. Section 1 records
the fresh empty-catalog check; C3 and T3 govern current client behavior.


Candidate offered by the user:
`https://github.com/SakuraLoveSmile/pi-desktop-plugins`.

Observed through a public, unauthenticated read: the repository is a **fork**
(`fork: true`, MIT, last pushed 2026-09-20, default branch `main`), and `main`
already serves `catalog.json` (HTTP 200, 355682 bytes) with
`schemaVersion: 1`, `providerId: "official"`, **25 plugins**, every entry
`verified: true`, **no `trust`, no `provenance`, no `review`**, package URLs
relative to `packages/`. `approved/` and `scripts/generate-catalog.mjs` do not
exist; `packages/` and `README.md` do.

Verdict:

- The host is acceptable: `github.com` and `raw.githubusercontent.com` are
  already in `PACKAGE_HOST_ALLOWLIST`, so using this host costs no
  security-boundary change.
- The current content is exactly what a curated channel must not be: it is the
  upstream community catalog, so pointing Plus at it would list 25 unreviewed
  versions with no review metadata. The existing `is_trusted_channel()` rule
  already stops that fork URL from claiming `verified`, because it compares the
  effective URL against the three canonical constants.
- Activation still requires a catalog generated from an approval allowlist plus
  at least one approved exact `(pluginId, version, shasum)` whose license
  permits redistribution.

Accepted shapes, pending the user's choice:

1. A new, initially empty repository, e.g.
   `https://raw.githubusercontent.com/<owner>/pi-desktop-plus-curated/main/catalog.json`.
2. A dedicated branch or subtree of the same repository, e.g.
   `https://raw.githubusercontent.com/SakuraLoveSmile/pi-desktop-plugins/plus/catalog.json`.
   A fork sync would overwrite `main`, so this must not live on `main`.

## 8. Plus endpoint decision (2026-09-30)

Chosen repository: `SakuraLoveSmile/Pi-Desktop-Plus-Plugins`, created empty by
the owner. Observed public state: public, not a fork, default branch `main`,
size 0, no refs, no license file; `main/catalog.json` returns 404.

Endpoint to pin for the curated channel:

```
https://raw.githubusercontent.com/SakuraLoveSmile/Pi-Desktop-Plus-Plugins/main/catalog.json
```

Rules recorded for the implementation:

- Configuring the endpoint is not activation. Until the repository publishes a
  valid catalog, the channel shows its own source state: never an upstream
  snapshot, never bundled demo plugins, and never a silent fall back.
- The first commit should publish a schema v2 catalog with
  `providerId: "pi-desktop-plus-curated"` and an empty `plugins` array, because
  a valid empty catalog is an empty curated list while a missing one is a
  source error.
- Do not add this URL to `is_trusted_channel()`. A curated catalog must not
  promote itself to the `verified` tier; the Plus label comes from per-version
  review metadata and the default tier stays `unknown`.
- Copy-ready repository files live in `docs/templates/plus-curated/`.

Observed while preparing the copy-ready template: a valid **empty** curated
catalog is rejected by `node scripts/check-marketplace-catalog.mjs` with
"catalog.plugins must be a non-empty array", while the client deserializes an
empty list fine. The template's positive path (one approved record) passes that
preflight unchanged. At implementation time either give the checker an explicit
curated-empty allowance or accept that the repository has no catalog until its
first approval.

### Activation status (2026-09-30)

The curated repository is live: `main/catalog.json` serves HTTP 200 with the
empty schema v2 document (`providerId: "pi-desktop-plus-curated"`,
`plugins: []`), published in commit `08df2d818d14` ("chore: initial curated
catalog scaffold"), alongside `README.md`, `scripts/generate-catalog.mjs`,
`approved/` and `packages/`.

So the endpoint is reachable and valid, and the client would render an empty
curated list rather than an error. It is still **not an activated channel**:
activation additionally requires at least one approved exact version whose
license permits redistribution, and the release build pinning the endpoint. The
repository-side preflight tool still rejects the empty catalog (see above);
that is a gate difference, not a client problem.

