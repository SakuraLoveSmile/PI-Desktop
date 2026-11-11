# 03. AI-Assisted Development Workflow

> Scope: AI agents and human collaborators working on PI-Desktop
> Status: Accepted
> Cross-references: [00-baseline](../00-baseline.md) · [decisions-log](../08-meta/decisions-log.md) · [acceptance-criteria](02-acceptance-criteria.md) · [e2e-test-plan](04-e2e-test-plan.md) · [change-checklist](05-change-checklist.md) · [ADR index](../../adr/README.md)

This spec owns development workflow: change tiers, delivery order, branch and
worktree mechanics, validation staging, commit rules, GitHub intake, merge
cleanup, and release gating. `AGENTS.md` states the
non-negotiables and routes here; the [change checklist](05-change-checklist.md)
is the runnable form.

---

## 1. Core rules

These rules govern every change and are the single definition: no other policy
file keeps a second copy, and only an explicit human override relaxes one. R5
and R6 are the GitHub intake rules in §8.

### R1 — Spec-first / Spec-sync

> **No behavior change without updating the corresponding spec.**

- Any code, config, or UX change that alters observable behavior updates the relevant `docs/spec/` document before or alongside it.
- Architectural boundary changes (process model, IPC contract, storage ownership, security boundary) also need an ADR — see `docs/adr/README.md`; a behavior-preserving refactor needs no spec update but is still committed (R2).
- Workflow or validation-policy changes update the relevant `docs/spec/06-delivery/` document and leave no contradictory workflow instruction in the repository.

### R2 — Commit-per-change

> **Every completed logical change is git committed.**

- Each logical unit — feature, fix, spec update, chore — gets its own commit; no large uncommitted piles, and no uncommitted work at session end.
- An incomplete change is committed as a draft with a `WIP:` prefix or rolled back.

### R3 — E2E coverage doc

> **Every feature or fix that changes user-visible or protocol-visible behavior updates the E2E test documentation.**

- Document the scenario in `04-e2e-test-plan.md` even before the automated test exists, and link acceptance criteria IDs (A–H). "User-visible" is UI, CLI output, dialogs and notifications; "protocol-visible" is IPC messages, RPC methods, plugin API surfaces and event payloads.
- Internal-only changes (logging format, internal rename) need no E2E doc update.

### R4 — Request branch + worktree + merge gate

> **Every development request starts from current `origin/main` in a dedicated branch and worktree, and a pull request head contains the latest `origin/main`.**

- One request = one short-lived branch + one dedicated worktree from the fetched `origin/main`. Never develop on `main` or in the primary checkout, never push `main` directly, and never reuse or modify another request's branch or worktree.
- Branch `<type>/<YYYYMMDD>-<task-id>-<slug>`: conventional type, creation date in Asia/Taipei, project-unique lowercase task ID, kebab-case slug (for example `chore/20261101-pi-rel-01511-macos-release`).
- Worktree under the central worktree root declared in `AGENTS.md`, named `<YYYYMMDD>-<type>-<task-id>-<slug>`, including subagent and temporary ones; check working state, `git worktree list`, and task ownership first; use a quoted absolute path with `git worktree add`; sibling, in-repository, and tool-default directories are not allowed.
- Preserve existing work in the primary checkout — never move, stash, or overwrite it to start a request; local `main` is a coordination surface, not a development or E2E workspace. Reuse the primary checkout's toolchains, package stores, caches, and ignored configuration; only mutable or incompatible state stays worktree-local and ignored, and environment state is never copied into tracked files.
- Commit authorization and remote publishing are separate: a commit request stops at the request-branch commit, while push, PR, merge, and release need explicit authorization. Never merge a task into local `main` to create an E2E candidate.
- Before opening or updating a PR/MR, fetch `origin/main` and make it an ancestor of the request head (`git merge-base --is-ancestor origin/main HEAD`, or `pnpm check:pr-base`), refreshing inside the task worktree; never open or update a PR behind `origin/main`. Resolve conflicts only in the task worktree and hand back to the user when one lands in a file this task did not touch.
- Local-only and remote delivery retain the same validation, security, and conflict gates; a blocked gate, authentication, permission, or review is reported as the actual blocker — the integration is not Done. Post-merge cleanup is mandatory (§7), and a requested launch builds and starts from the integrated `main` checkout and its environment.

### R7 — Code-bearing changes need relevant candidate E2E

> **Every code-bearing change passes relevant E2E on a candidate that already contains the latest `origin/main`, before merge or commit-only completion. Hosted validation may follow an authorized branch push or PR.**

- Code-bearing means `apps/`, `packages/`, `crates/`, runtime scripts, build or CI configuration, packaging, protocol behavior, or persisted data; documentation-only changes that do not alter executable behavior are exempt. An E2E run on a branch behind `origin/main` is exploratory and does not satisfy this rule, and the task is never merged into local `main` to create the candidate.
- Select suites from `04-e2e-test-plan.md`: build, typecheck, lint, unit and integration tests, manual review, and source inspection do not replace relevant E2E, and required validation needs no separate user request.
- A suite that cannot run is recorded as `NOT RUN` with reason, alternative validation, and remaining risk; the gate stays unsatisfied until it passes on a candidate containing latest `origin/main`. A failed required suite blocks merge until classified and fixed, and a hosted retrigger counts only on the intended candidate.

See §5 for the two stages, evidence fields, and rerun rules.

---

## 2. Change tiers

Every request declares one tier; it sets which records, evidence, and checklist
items apply, and the [change checklist](05-change-checklist.md) follows it.

| Tier | Trigger | Task record | Candidate E2E | Delivery note |
|---|---|---|---|---|
| **T0** | Docs, copy, i18n text, comments, or visual styling; no runtime, rule, interaction, responsive-usability, accessibility, content-layout, or user-path change | Not required | Not required | One line |
| **T1** | Normal code or config change | Required | Only when user-visible or protocol-visible | Full report |
| **T2** | Architecture, public contract, persistence, security, or release change | Required with full evidence | Required | Full report plus cleanup archive |

- T0 still uses a dedicated branch and worktree and passes repository CI, but skips the task record, candidate E2E, and full delivery report.
- A change that straddles tiers takes the higher tier; a would-be T0 change that alters a rule, interaction, responsive usability, accessibility, or content layout is T1.

---

## 3. Delivery order

Every request follows this order; steps may iterate when implementation reveals
new requirements. It never inserts `merge task → local main` between steps 6 and
8: after incorporating `origin/main`, the request branch itself is the local
integration candidate.

| # | Step | Gate or output |
|---|---|---|
| 1 | Create a dedicated branch and worktree from current `origin/main` | Isolated files; state, worktree list, and ownership checked |
| 2 | Implement in the request worktree | Planned change complete |
| 3 | Run targeted static, unit, and integration checks | Risk-based results |
| 4 | Review the full task diff | Nothing unexpected, unrelated, or secret |
| 5 | Commit the task | Conventional commit (§6) |
| 6 | Refresh against latest `origin/main` (`pnpm check:pr-base`) | `origin/main` is an ancestor of the request head |
| 7 | Resolve conflicts inside the task worktree | Candidate contains both sides |
| 8 | Run local task-candidate E2E, or select exact-SHA hosted validation | Candidate result, or recorded `NOT RUN` (§5) |
| 9 | Push the request branch when authorized | Published branch |
| 10 | Open or update the pull request targeting `main` | Only this task's changes; PR-base passes |
| 11 | Pass hosted candidate gates, then PR integration gates | Run URL, tested SHA, base revision, job conclusions |
| 12 | Merge into remote `main` through repository gates | Authorized merge verified |
| 13 | Synchronize local `main` with the landed change | Local `main` contains the merge |
| 14 | Remove the worktree and merged local branch | Cleanup verified (§7) |

Steps 1–8 apply to every request; a linked issue or pull request is verified
per §8 before step 1. A commit-only request stops after step 5, or after step 8
when the user asks for a validated candidate. Steps 9–14 need explicit
remote-delivery authorization, and branch-only or draft-only limits narrow the
scope. Before step 2, read `00-baseline.md` and the change area's specs, and
record the plan in the task record (§4).

```bash
# From the primary checkout; the worktree path uses the central root from AGENTS.md.
git fetch origin main
git worktree add -b <type>/<YYYYMMDD>-<task-id>-<slug> <central-worktree-root>/<YYYYMMDD>-<type>-<task-id>-<slug> origin/main

# Inside the request worktree before candidate E2E and before PR creation or update.
git fetch origin main
git rebase origin/main   # private branch; never force-push a shared branch
pnpm check:pr-base
```

Start directly from the fetched `origin/main`; do not synchronize, merge, or
resolve unrelated local divergence to begin request work, and refresh without
rewriting history when a rebase would be unsafe. Authorized delivery: push, open
the PR, pass the hosted gates, merge with a permitted strategy, fast-forward
local `main`, remove the worktree, delete the merged local branch with `git
branch -d` (never `-D`), prune stale registrations, and delete the remote branch
only when authorized. Use a short-lived `main` worktree when the primary
checkout cannot take the synchronization.

---

## 4. Task record and status

- Keep one authoritative task record per request: reuse the existing plan or task file, otherwise create one under `docs/tasks/`; linked evidence supplements it. Record scope, frozen decisions, branch/worktree/target, acceptance scenarios, code revision, actual and missing validation, remaining work, and runtime resources.
- On resume, verify the task path, HEAD, index, uncommitted work, and next action; old passing results are not current evidence.
- Status uses only `未开始` (not started), `实现中` (in progress), `待体验` (ready for user experience), and `已验收` (user accepted). Missing required validation keeps the task in progress, and only explicit user confirmation grants acceptance; track merge and release separately and retain the verified-cleanup rules.
- T0 needs no task record; a one-line delivery note replaces it.

---

## 5. Validation and E2E stages

### 5.1 Stages and evidence

Task-candidate validation runs the request's commits plus latest `origin/main`
and conflict resolutions, in the request worktree or on its exact SHA on
GitHub-hosted Actions. PR integration validation verifies the code about to land
through the GitHub PR merge ref, a merge queue candidate, an equivalent
synthetic merge commit, or another trusted integration candidate from target
`main`.

- E2E validates executable integration state, not a branch name: `latest applicable main + task changes = candidate executable state`. A result is valid only when its tested commit and base revision are known; the PR integration gate then protects against `main` changing before merge.
- A PR head and an integration candidate are equivalent only when they produce the same executable tree against the target `main`; if `main` changed after candidate validation, the earlier result stays evidence but does not prove the new candidate.
- Hosted candidate validation may follow an authorized branch push and PR, but its result and the separate PR integration jobs are both required before merge; neither stage merges the task into local `main`.
- Evidence binds the tested SHA, base revision, and environment: record `Task candidate / Base main / E2E suites / Result / Environment` plus run URL and job conclusions.
- A pending, failed, or missing hosted result is not passing evidence; a recorded `NOT RUN` still allows the branch push and PR so validation can happen in a capable environment. After the merge, rerun affected suites when the landed executable content differs from the gated commit.

### 5.2 Risk-based local checks

- Local validation is risk-based, not an automatic prerequisite: documentation-only and low-risk mechanical changes normally need no local tests, without a separate approval or waiver. Security boundaries, protocol contracts, data migrations, build configuration, and widely shared behavior need the smallest targeted non-E2E validation; a full local suite is not the default.
- E2E documentation and execution are separate: R3 still requires scenario updates, while every code-bearing change runs at least one relevant suite plus the union for its affected surfaces, with commands from the root `package.json` and `04-e2e-test-plan.md`.
- Local task-candidate E2E uses the request worktree's source and the host environment described in R4 and `04-e2e-test-plan.md`, never a second dependency environment installed solely for E2E; record any missing or incompatible host dependency that forced an install or rebuild, keep temporary profiles, data, sockets, ports, logs, and artifacts isolated, and treat a stale-branch run as debugging evidence only.

### 5.3 Marketplace and update diagnosis gate

Plugin update incidents need an evidence-first flow before any code change:

1. Capture the exact plugin ID, installed version, displayed version, expected release, catalog URL, and observation time, then inspect the live catalog entry, the local catalog cache, and the installed registry independently.
2. Classify the boundary: publisher/catalog data, fetch/cache fallback, host version comparison, IPC propagation, or renderer presentation.
3. Run `pnpm check:marketplace -- --url <catalog-url> --plugin <id>`. Missing `shasum`, `url`, positive `sizeBytes`, or `permissions`, or a catalog `author` that is not a string (for example `{ name, url }` copied from a plugin manifest), is a release-data failure, not evidence of a stale renderer; incomplete releases remain non-installable.
4. Reproduce with a fixture of unsorted versions and incomplete metadata before changing host or renderer code.

State which boundary failed and what evidence rules out the others; a client-side fallback may preserve safe discovery but never conceals an invalid marketplace release.

---

## 6. Git commit rules

Conventional Commits: `type(scope): description`, English only. Types:
`feat`, `fix`, `docs`, `test`, `chore`, `refactor`, `perf`, `build`, `ci`;
scope is optional but encouraged (`feat(host-core):`, `docs(spec):`).

- Subject, then a blank line, then a body; single-line commits are rejected. The body is 1–3 short paragraphs explaining **why**, not a diff listing, wrapped around 72 columns.
- Do not add `Co-Authored-By` or `Signed-off-by` unless requested; a related issue goes as a trailer after a blank line (`fixes #N`, `closes #N`).
- One logical change per commit; tightly coupled spec updates share the code commit, and a pure docs change may be an adjacent `docs:` commit. Never commit secrets, API keys, tokens, passwords, local-only data, `node_modules/`, build artifacts, release packages, or generated files CI rebuilds.
- Stage files by explicit path, re-run `git status` to confirm what is staged, and inspect the staged diff for unrelated work. Do not force-push, and never force-push a contributor's branch; the hard-prohibition command list in `AGENTS.md` applies.
- Pre-commit check: one logical unit; no secrets or local data; specs and E2E docs updated per §10; `git diff --stat` reviewed; conventional message.

---

## 7. Integration and cleanup

Merge authorization belongs to the user. After an authorized merge is verified,
post-merge cleanup is mandatory and part of delivery; it covers only this
request's own resources and needs no further approval for them.

1. Verify the expected commits or equivalent integrated changes are present in the intended `main` and the required integration checks passed. Local-only delivery verifies local `main`; remote delivery also verifies remote `main` and safely synchronizes local `main`.
2. Before removal, preserve dirty/untracked work and needed ignored artifacts (packages, screenshots, local configuration) in a verified recoverable archive; never discard unsaved data or force-delete an unmerged branch. Retain and report the exact blocker when a running task, service, or needed path still uses the checkout, and resolve a dirty or locked worktree without forcing removal.
3. Remove or archive this request's worktrees, prune stale Git registrations, and remove empty container directories only after verifying they hold nothing beyond worktree-name markers. Use the managed archive operation for managed worktrees, run removal from outside the checkout, and preserve the shared worktree root, other tasks, and recovery archives.
4. Delete the verified merged task branch and obsolete integration branches. Do not keep backup snapshots as normal local branches; keep recovery snapshots in archive refs outside `refs/heads/` or verified backup files, preserving their commits before retiring visible temporary refs.
5. Verify `git worktree list`, the local branch list, and the physical request paths. Report cleanup separately from the merge; cleanup is incomplete while a task worktree, empty container, or temporary backup branch remains in place.

Preserve the primary checkout, active/unmerged work, needed archives, and
resources outside this request; another task's resources need an explicitly
user-authorized batch cleanup, and remote-branch deletion is never implied.
Report a blocked cleanup with the exact remaining path/ref and recovery state.

---

## 8. GitHub issue and pull request intake

A linked issue or pull request is intake, not proof: fetch it, verify the claim
against current code, and never implement before the investigation concludes.

### R5 — Verify linked GitHub issues before work, then reply and close

> **A linked GitHub issue is not a task until the reported problem is shown to exist. After the outcome is conclusive, reply on that issue and close it.**

Applies when the user prompt includes a GitHub issue URL or an unambiguous issue
number for this repository.

- Fetch the issue (title, body, labels, comments, state) before creating a worktree or changing files, and independently verify the claim against current code. For a bug, reproduce it or cite concrete code/spec evidence and classify it as `confirmed regression`, `confirmed existing defect`, `already fixed`, `expected behavior`, `environment-specific failure`, or `insufficient evidence`; for a feature, confirm the requested behavior is missing or incomplete and in scope.
- Problem does not exist: comment the verification evidence and close when the conclusion is clear, or comment what was tried and leave it open when inconclusive. For a confirmed problem, follow R4 with the smallest coherent change and, after the integration, comment the resolution and close.
- Write the comment in the language of the original issue title and body; code, commits, specs, and repository documentation stay English. An issue link authorizes commenting on and closing **that** issue only, not a git push, and unrelated issues are never touched or reopened unless the user asks.
- Public intake uses `.github/ISSUE_TEMPLATE` only (`blank_issues_enabled: false`); English is the source label language with Chinese on the same fields, bug reports require description, reproduction steps, expected and actual behavior, app version, and OS (Settings → Info prefills them, D313), feature requests require the problem and proposed change, and these fields are not weakened.

### R6 — Land a linked pull request only when it fixes the root cause with a minimal diff

> **A linked GitHub pull request lands only when it actually removes the reported failure mode at the root, with the smallest coherent change. A sound direction is not enough. Completeness nits may follow after merge; an incomplete fix may not.**

Applies when the user prompt includes a GitHub pull request URL or an
unambiguous pull request number for this repository.

- Fetch the pull request (title, body, files, commits, comments, checks, draft state, base/head, linked issues) before creating a replacement or requesting a rewrite.
- Independently verify all three: (1) the problem is real and in scope (same bar as R5); (2) the change fixes that root cause with the smallest coherent change — not a nearby symptom, a docs-only rewrite, a config contract test, or a partial workaround that leaves the original path intact; (3) extra files, refactors, and spec theater do not compensate for an incomplete fix, and the approach stays compatible with the baseline, security boundaries, and architecture, or is a justified spec-backed amendment.
- When verified, merge **that** pull request first with a permitted strategy that preserves the contributor's commits and authorship. Missing tests, documentation, i18n, naming, and formatting are follow-up only when they are not required to prove the root-cause fix. A landing blocker that would break `main` — build, typecheck, test or required E2E failure, merge conflict, head behind `origin/main`, data-corruption risk, security violation, secret leakage, privilege or sandbox bypass, incompatible protocol change, unfixed root cause, or an oversized diff without reason — may receive the smallest commits **on top of** the author's work; never squash away the author, rewrite the design, or expand the diff. Follow up from updated `main` under a new R4 request and comment in the pull request's language.
- When verification fails or a harm blocker exists — secrets, sandbox or privilege bypass, malicious or destructive change, out-of-scope reversal of a frozen decision, unrelated drive-by payload — do not merge, do not approve as "direction is fine, follow up later", and comment with the evidence in the pull request's language. Prefer a minimal completion of the author's approach when it can reach the root cause; never silently reimplement the same idea unless the user asks to take the work over.
- Do not merge an unready draft unless the user explicitly asks; comment with the review and wait until it is ready. The link authorizes reviewing, commenting on, and merging **that** pull request only — never force-pushing the contributor's branch or publishing unrelated branches, and unrelated pull requests are neither commented on nor merged. An already-merged pull request is not reopened.
- When an issue and a pull request are both linked, R6 governs the pull request and R5 still governs the issue after the merged outcome.

#### R6.1 — Temporary pull-request type restriction

> **While this subsection is in force, outside contributions are limited to `perf` and `fix` pull requests; maintainer-planned work keeps every type.**

- Effective 2026-09-26 until a maintainer removes this subsection.
- The restriction governs outside contributions. Maintainers — accounts with write access to this repository, plus the branches and automated agent work they direct — keep every change type, including `feat`.
- An outside pull request of any other change type — `feat`, `refactor`, `docs`, `test`, `chore`, `build`, or `ci` — is not a landing candidate: comment the policy in the pull request's language, close it without merging, and do not reimplement it while the restriction is in force. The type is read from the title and commits; relabelling as `fix` or `perf` does not qualify it.
- Feature intent goes to a feature request issue, not a pull request; `fix` and `perf` pull requests still carry the full R6 bar.
- Closing an out-of-scope-type pull request does not violate R6's "do not discard contributor work" clause, which protects an in-scope root-cause fix. Removing this subsection lifts the restriction; it is not a permanent narrowing.

---

## 9. Cloud packaging and release

Installer and release packages are built only on GitHub-hosted Actions runners,
including unpacked `pack --dir` output. Local `pnpm dev`, JavaScript builds,
Rust development builds, and targeted checks remain available; installer
wrappers reject local and self-hosted execution, and `scripts/release-macos.sh`
is retired. Do not bypass the guard or fall back to a local package when a cloud
gate fails.

Follow `.github/workflows/release.yml` and the
[release runbook](06-release-runbook.md) for a manual candidate or formal
version tag. Manual candidates produce verified Actions artifacts only; a
verified formal tag already contained in remote `main` can publish a GitHub
Release after shared CI, every nightly fixture family on the same pinned SHA,
and asset checks pass. Both lanes block packaging on incomplete nightly results;
Actions summaries expose failures. Signing is required by
default, `ALLOW_UNSIGNED_MACOS_RELEASE=true` opts into a personal-use unsigned
release requiring manual download and installation, and published releases are
immutable.

---

## 10. Spec update matrix

| Change type | Spec update | ADR | Decisions-log | E2E doc | BOARD |
|---|---|---|---|---|---|
| New feature (user-visible) | Related domain spec | If architectural boundary | — | New scenario | If milestone deliverable |
| Bug fix (user-visible) | Related spec if behavior clarified | — | — | New or updated scenario | — |
| Internal bug fix or refactor | — | — | — | — | — |
| Architectural change | Related specs + baseline | **New ADR** | Update entry if default changes | Update affected scenarios | — |
| New IPC/RPC method | `03-runtime/01-ipc-protocol.md` or `06-host-rpc-protocol.md` | If contract boundary | — | New protocol scenario | — |
| Plugin API addition | `07-plugins/03-plugin-api.md` | If boundary change | — | New plugin scenario | If M4 deliverable |
| Security change | `05-security/01-security.md` | If boundary change | Update if D001–D010 touched | New security scenario | — |
| UX change | Related `04-ux/` spec | — | — | New UI scenario | — |
| Spec-only update | The spec itself | — | — | — | — |
| Chore (deps, tooling) | — | — | If tooling decision | — | — |
| App version release / stable tag | `06-delivery/06-release-runbook.md` version-surface gate (§11) | — | If release policy changes | Confirm E2E-067B still accurate | If milestone ship |

---

## 11. Definition of Done

A change is **Done** when all applicable conditions are true under the user's
delivery scope; T0 uses the reduced set in §2.

1. A dedicated request branch and worktree were created from an up-to-date `origin/main`, reusing the primary environment where safe.
2. The planned change is implemented, impacted specs are updated (R1), and E2E scenarios are documented or confirmed not needed (R3).
3. Targeted local validation passes. For a code-bearing change the relevant E2E gate ran on a candidate containing latest `origin/main`, locally or hosted, or the limitation is recorded as `NOT RUN`; triggered remote gates pass, including the PR-base check.
4. The change is committed with a conventional message, contains no secrets or local data, and `BOARD` is updated if a milestone deliverable completed.
5. For authorized remote delivery, the PR/MR passed its gates and merged into remote `main`, local `main` includes the landed change, and affected suites were rerun when the landed executable content differs from the gated commit.
6. The expected commits are verified in `main`, and the request worktree and merged local branch are removed (§7).
7. A linked issue was verified before implementation and commented and closed when conclusive; a linked pull request passed the R6 bar and its contributor work was not discarded.
8. A requested launch was built and started from the integrated `main` checkout, and the delivery report required by `AGENTS.md` is written (T0 records one line in the task note or pull request description).

### Release and version-tag gate

A **stable app version release** (version bump + tag) additionally requires,
**before** the tag, that every version-bearing surface describes the new
version: shipped-locale in-app Plus changelog entries in
`packages/shared/src/plus-changelog.ts`, merged by `changelog.ts` (English and
every shipped product locale, aligned highlight counts) with its
`changelog.test.ts` list; every app `package.json` (root, `apps/*`, and
`docs/package.json`, with `packages/*` keeping the upstream-synced version, ADR
plus-version-line); the Cargo workspace version and `host-core` lockfile entry;
`APP_VERSION`; and the release line in `README.md` + `README.zh-CN.md`.
`node scripts/check-release-docs.mjs` must pass, `scripts/release.mjs` runs it
and refuses to tag otherwise, and GitHub release notes are not a substitute. See
[06-release-runbook.md §4.1](06-release-runbook.md#41-mandatory-release-version-surface-gate-d164--d260),
D164, and D260.

---

## 12. Forbidden practices

Rule violations:

- Changing behavior without a spec update (R1); accumulating uncommitted work or leaving a logical change uncommitted (R2); skipping E2E docs for user-visible changes (R3).
- Developing or pushing `main` directly, in the primary checkout, or another request's worktree; reusing a request branch; opening or updating a PR/MR behind `origin/main`; leaving a merged worktree on disk (R4).
- Stopping at a task-branch commit or push when the user requested remote delivery, unless delivery was explicitly limited to a branch or draft (R4).
- Implementing a linked issue without verifying the problem, or closing one without a comment in the issue language (R5).
- Discarding a root-cause-complete pull request for nits, blocking it solely for follow-up polish, merging one with only a sound direction or a harm blocker, or force-pushing its branch (R6).
- Declaring a code-bearing change delivered before required E2E passes against a candidate containing latest `origin/main`, or treating the full local suite as an automatic pre-push requirement (R7).

Release, baseline, and repository violations:

- Tagging a stable release without updating `packages/shared/src/plus-changelog.ts` for every shipped locale (D164/D345), while either README states an older release line, bypassing the final cloud documentation gate (D260), or substituting a local package build for a failing cloud gate.
- Modifying baseline frozen decisions without an ADR and version bump; committing secrets, local data, generated artifacts CI rebuilds, or unrelated changes in one commit.

---

## 13. Test quality and inventory

Test the behavior or stable contract, never repository source text. The
assertion inventory and `pnpm check:test-quality` ratchet, runtime-test budget,
quarterly audit, CI tiers, fixture boundaries, and the generated index are owned
by [07-test-maintenance](07-test-maintenance.md) and
[test plan §10](04-e2e-test-plan.md#10-ci-tiers-and-fixture-boundaries). Never
count a skipped, excluded, or catalog-only scenario as passed acceptance;
document-only cases need no ID, and replaced behavior removes its obsolete tests
and IDs in the same change.

---

## 14. Workflow acceptance criteria

This workflow spec is accepted when:

- [ ] R1–R7 are stated once and cross-linked to the owning specs.
- [ ] Delivery order, branch/worktree mechanics, validation staging, and merge cleanup are documented, and `AGENTS.md` routes here.
- [ ] The spec matrix covers every change type in the baseline, and commit rules match the repository commit style.
- [ ] Change tiers are defined and referenced by the change checklist, and Definition of Done and forbidden practices are complete and actionable.
- [ ] `AGENTS.md` points to this document, `04-e2e-test-plan.md`, and `05-change-checklist.md`.
- [ ] Policy files stay within their byte budgets and keep their required anchors; `pnpm check:agent-policy` enforces both.
- [ ] Intake rules apply, including the temporary scope while R6.1 is in force, and all indexes (NAV, delivery README, spec README, docs README, BOARD) are updated.
