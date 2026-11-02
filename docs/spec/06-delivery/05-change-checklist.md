# 05. Change Checklist

> A runnable checklist for finishing a change. Each item links to the owning
> rule in [03-ai-development-workflow.md](03-ai-development-workflow.md); this
> file tracks completion and does not define policy.
> Cross-references: [ai-development-workflow](03-ai-development-workflow.md) · [e2e-test-plan](04-e2e-test-plan.md) · [decisions-log](../08-meta/decisions-log.md) · [ADR index](../../adr/README.md) · [BOARD](../../project/BOARD.md)

Declare the tier from [03 §2](03-ai-development-workflow.md#2-change-tiers)
first; it decides which sections below apply.

---

## 0. GitHub Issue Intake

When the prompt includes a GitHub issue URL or an unambiguous issue number:

- [ ] Issue title, body, labels, comments, and state fetched.
- [ ] Reported problem independently verified against current code.
- [ ] Bug classified as `confirmed regression`, `confirmed existing defect`, `already fixed`, `expected behavior`, `environment-specific failure`, or `insufficient evidence`.
- [ ] Implementation started only after the problem was confirmed.
- [ ] Problem absent: verification comment posted, then closed if conclusive or left open with what was tried.
- [ ] Problem confirmed: smallest coherent fix implemented, then resolution comment posted and the issue closed after integration.
- [ ] Comment written in the issue's language; no unrelated issue touched; no push inferred from the link.

See [R5](03-ai-development-workflow.md#r5--verify-linked-github-issues-before-work-then-reply-and-close).

---

## 0.1 GitHub Pull Request Intake

When the prompt includes a GitHub pull request URL or an unambiguous number:

- [ ] PR title, body, files, commits, comments, checks, draft state, base/head, and linked issues fetched.
- [ ] Root-cause bar verified: real in-scope problem, smallest coherent fix, compatible with baseline, security boundaries, and architecture.
- [ ] Follow-up polish (specs, tests, i18n, E2E docs, style, naming) not treated as a merge blocker unless required to prove the root cause.
- [ ] Root-cause-complete PR merged first, preserving contributor commits and authorship.
- [ ] Landing blockers received only smallest on-top commits; contributor branch not force-pushed.
- [ ] Follow-up started from updated `main` under a new request.
- [ ] Failed bar or harm blocker: no merge, no "direction is fine" approval, evidence comment posted in the PR's language.
- [ ] Draft PR not merged unless explicitly asked; no unrelated PR touched; no unrelated remote publishing inferred from the link.

See [R6](03-ai-development-workflow.md#r6--land-a-linked-pull-request-only-when-it-fixes-the-root-cause-with-a-minimal-diff).

---

## 1. Request Start

- [ ] Tier declared; T0 skips the task record, candidate E2E, and full delivery report.
- [ ] Existing uncommitted work identified and preserved.
- [ ] `origin/main` fetched; dedicated `<type>/<YYYYMMDD>-<task-id>-<slug>` branch and worktree created from it.
- [ ] Worktree under the central root declared in `AGENTS.md`, named for this task; working state, `git worktree list`, and task ownership checked.
- [ ] Current branch is not `main`; no other request's branch or worktree is reused.
- [ ] Host toolchains, package stores, caches, and ignored configuration reused; no separate environment installed for E2E; only mutable or incompatible state stays worktree-local and ignored.
- [ ] Delivery scope recorded: commit-only stays on the request branch; push, PR, merge, and release need explicit authorization.

---

## 2. Task Record and Evidence

T1 and T2 record this; T0 skips it.

- [ ] One authoritative task record exists: the existing plan or a file under `docs/tasks/`.
- [ ] Scope, frozen decisions, branch/worktree/target, acceptance scenarios, and code revision recorded.
- [ ] Actual validation, missing validation, remaining work, and runtime resources recorded.
- [ ] Status set to `未开始`, `实现中`, `待体验`, or `已验收`; only explicit user confirmation sets `已验收`.
- [ ] On resume: path, HEAD, index, uncommitted work, and next action re-checked.

---

## 3. Impact Analysis

- [ ] Observable behavior changes listed.
- [ ] Affected specs listed by path against the [spec update matrix](03-ai-development-workflow.md#10-spec-update-matrix).
- [ ] Architectural boundary, user-visible or protocol-visible behavior, and milestone deliverable assessed.
- [ ] Validation scope chosen by risk, not by diff size.
- [ ] Plan and impacted surfaces recorded in the task record.

---

## 4. Spec Sync

- [ ] Every affected spec updated for the new behavior.
- [ ] Architectural boundary change has an ADR in `docs/adr/`.
- [ ] Implementation default change updates `decisions-log.md`.
- [ ] Baseline frozen decision change has an ADR and version bump.
- [ ] Cross-references and anchors still resolve.
- [ ] Policy files stay within their byte budgets and keep their required anchors; `pnpm check:agent-policy` passes.

---

## 5. Tests and E2E Docs

- [ ] User-visible or protocol-visible behavior: E2E scenario added or updated in [04-e2e-test-plan.md](04-e2e-test-plan.md).
- [ ] Scenario follows the template, and the traceability matrix and generated index are current.
- [ ] Unit or integration tests added or updated when the change's risk requires them.
- [ ] New tests assert behavior or stable contracts, not repository source or CSS text; `pnpm check:test-quality -- --base <base>` passes against the actual base.
- [ ] Retired source assertions lower their checked-in inventory; replacement coverage recorded; obsolete tests and scenario IDs removed.
- [ ] Runtime domain tests and helpers stay within the 800-line budget.
- [ ] Pure copy, i18n, or styling exemption records affected-surface verification and residual risk; it does not cover interaction, responsive, accessibility, runtime-rule, or content-layout changes.
- [ ] T1/T2: the smallest targeted local checks passed, or local validation was assessed as unnecessary.
- [ ] T1/T2: relevant E2E suites ran on a candidate containing latest `origin/main` before merge or commit-only completion; T0 and documentation-only changes are exempt.
- [ ] Hosted exact-SHA lane: an authorized push or PR may precede the gate, but its result is required before merge, and PR integration jobs are observed separately.
- [ ] Local task-candidate E2E reused the host environment; no dependency install or second runtime environment was created solely for E2E, and any missing or incompatible host cause is recorded.
- [ ] Evidence binds the tested SHA, base revision, environment, and (hosted) run URL and job conclusions; affected suites rerun when landed executable content differs from the gated commit.
- [ ] Any required suite not run is recorded as `NOT RUN` with reason, alternative validation, and remaining risk; delivery stays incomplete until it passes.

---

## 6. Commit

- [ ] One logical change, or focused commits for clearly separate units.
- [ ] No secrets, local data, `node_modules/`, build artifacts, release packages, or generated files CI rebuilds.
- [ ] Conventional message `type(scope): description`; subject, blank line, then a body explaining why; issue trailer where relevant.
- [ ] `git diff --stat` reviewed; files staged by explicit path and `git status` re-checked after staging.
- [ ] No force-push and no hard-prohibition command from `AGENTS.md`.

---

## 7. Pull/Merge Request

- [ ] `pnpm check:pr-base` passes before the PR is opened or updated; the PR targets `main` with only this task's changes.
- [ ] Description states impacted specs, E2E scenarios, and validation results.
- [ ] PR self-review, required checks (including the PR-base gate), and reviews passed.
- [ ] Only authorized push, merge, and publish actions were performed; a genuine blocker was reported instead of bypassed.

---

## 8. Merge Cleanup

- [ ] Expected commits or equivalent changes verified in local `main`, and in remote `main` when remote delivery was requested.
- [ ] Request contents archived recoverably before removal; unsaved data and needed ignored artifacts preserved.
- [ ] No running task, service, or needed path still uses the checkout; a retained checkout is reported by exact path.
- [ ] `git worktree remove` succeeded without forcing; `git worktree prune` leaves no stale entry for this request.
- [ ] Merged task branch deleted with `git branch -d`; remote branch deleted only when explicitly authorized.
- [ ] Recovery snapshots live in archive refs or verified files, with no backup branch left under `refs/heads/`.
- [ ] Empty request containers and obsolete integration branches retired; `git worktree list`, local branches, and physical paths agree no redundant request resources remain.
- [ ] Cleanup completed in the same task as the merge, without another approval for this request's own resources.
- [ ] Primary checkout, active work, and other tasks' resources preserved.
- [ ] Launch requested after delivery: app built and started from the integrated `main` checkout.

---

## 9. Release Checklist (Stable Tag)

Skip for documentation-only work and non-release chores; the
[release runbook](06-release-runbook.md#41-mandatory-release-version-surface-gate-d164--d260)
owns the procedure.

- [ ] `packages/shared/src/plus-changelog.ts` has newest-first entries for the version under every shipped locale, with aligned highlight counts and English as the source of truth.
- [ ] Entries are short user-facing product notes, not raw PR or commit lists; pre-release-only versions are omitted unless product explicitly ships in-app notes for that channel.
- [ ] `packages/shared/src/changelog.test.ts` lists the new version first; `pnpm --filter @pi-desktop/shared test` passes.
- [ ] `README.md` and `README.zh-CN.md` state the current release line and no claim the release invalidates.
- [ ] `node scripts/check-release-docs.mjs` passes before tagging; release documentation committed on the release branch.
- [ ] Installers built only on GitHub-hosted Actions, including `pack --dir`; no local packaging fallback.
- [ ] Tag workflow used the clean merged commit with fresh remote ancestry and no existing tag; shared CI and complete asset checks passed; recording which signing lane ran, unsigned output is not Gatekeeper qualification.
- [ ] Evidence retained: `release-manifest.json`, `SHA256SUMS`, source and base SHAs, run URL, and all job conclusions.
- [ ] Formal publication used draft → upload → remote digest and size verification → publish; no published asset overwritten, failed drafts retained, and any retry matched their exact source and manifest identity.
- [ ] Prerelease feeds use their named channel and never become GitHub latest; GitHub release notes are not the in-app source.

---

## 10. Final Definition-of-Done Gate

- [ ] All applicable [Definition of Done](03-ai-development-workflow.md#11-definition-of-done) conditions are true under the delivery scope.
- [ ] T0 records one delivery line; T1/T2 write the delivery report required by `AGENTS.md` (behavior change, files, checks run, checks skipped and marked `NOT RUN`, risks).
- [ ] Linked issue and pull request outcomes recorded per §0 and §0.1.
- [ ] Indexes updated (NAV, delivery README, spec README, docs README, BOARD).
- [ ] A failing gate was reported as a blocker, not weakened.
