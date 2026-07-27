# 05. Change Checklist

> A practical checklist agents must run before finishing work.  
> Cross-references: [ai-development-workflow](03-ai-development-workflow.md) · [e2e-test-plan](04-e2e-test-plan.md) · [decisions-log](../08-meta/decisions-log.md) · [ADR index](../../adr/README.md) · [BOARD](../../project/BOARD.md)

---

## 1. Request Start Checklist

Before editing any file for a new request:

- [ ] Existing uncommitted work is identified and preserved.
- [ ] Local `main` is fast-forwarded from `origin/main`.
- [ ] A dedicated `<type>/<short-description>` request branch is created from
  that updated `main` commit.
- [ ] The current branch is not `main` before implementation begins.

---

## 2. Impact Analysis

Before starting implementation, answer these questions:

- [ ] What behavior changes does this change introduce?
- [ ] Which specs are affected? (list file paths)
- [ ] Does this change touch an architectural boundary? (process model, IPC, storage, security, plugin API)
- [ ] Does this change affect user-visible or protocol-visible behavior?
- [ ] Which milestone deliverable does this relate to? (M1–M5, or none)

Reference the [spec update matrix](03-ai-development-workflow.md#3-spec-update-matrix) to determine required doc updates.

---

## 3. Spec Sync Checklist

After implementation (or alongside it):

- [ ] Every affected spec file is updated with the new behavior.
- [ ] If architectural boundary changed: ADR is written or updated in `docs/adr/`.
- [ ] If an implementation default changed: `decisions-log.md` entry updated.
- [ ] If baseline frozen decisions are affected: baseline bump + explicit ADR (not MVP-normal).
- [ ] Cross-references between specs are still correct (no stale links).

---

## 4. E2E / Test Doc Checklist

- [ ] If user-visible or protocol-visible behavior changed: new or updated scenario in [04-e2e-test-plan.md](04-e2e-test-plan.md).
- [ ] Scenario follows template (ID, title, preconditions, steps, expected, specs, acceptance, milestone, status).
- [ ] Traceability matrix in §8 updated with new scenario.
- [ ] Unit tests added or updated for the changed module (when code exists).
- [ ] Integration tests added or updated for IPC/RPC contract changes (when code exists).

---

## 5. Git Commit Checklist

- [ ] Change is one logical unit (or split into focused commits).
- [ ] No secrets, tokens, or local data in the diff.
- [ ] No `node_modules/`, build artifacts, or release packages in the diff.
- [ ] Commit message follows conventional format: `type(scope): description` (English only).
- [ ] Spec updates committed with code when tightly coupled, or adjacent `docs:` commit for pure docs.
- [ ] `git diff --stat` reviewed — nothing unexpected.

---

## 6. Pull/Merge Request Checklist

Before marking the request complete:

- [ ] Request branch is pushed to the remote.
- [ ] PR/MR targets `main` and contains only the request's logical changes.
- [ ] PR description lists impacted specs and e2e scenarios.
- [ ] PR self-review checklist completed.
- [ ] Required remote checks and reviews pass.
- [ ] PR/MR is merged into `main` using a permitted merge strategy.
- [ ] Remote request branch is deleted after merge.
- [ ] Issue reference is included when applicable (e.g. `Refs #12` or
  `Closes #12`).

---

## 7. Final Definition-of-Done Gate

Before marking work complete, verify **all** of the following:

| # | Gate | Source |
|---|---|---|
| 1 | Request branch created from an up-to-date `main` | [R4 — Request branch + merge gate](03-ai-development-workflow.md#r4--request-branch--merge-gate) |
| 2 | Code/doc implements the planned change | Step 4 of [development loop](03-ai-development-workflow.md#2-development-loop) |
| 3 | All impacted specs updated | [R1 — Spec-sync](03-ai-development-workflow.md#r1--spec-first--spec-sync) |
| 4 | E2E scenarios documented (or confirmed not needed) | [R3 — E2E coverage doc](03-ai-development-workflow.md#r3--e2e-coverage-doc) |
| 5 | Local and required remote checks pass or skip is justified | Steps 7 and 11 of development loop |
| 6 | Change committed with conventional message | [R2 — Commit-per-change](03-ai-development-workflow.md#r2--commit-per-change) |
| 7 | BOARD updated if milestone deliverable completed | Step 9 of development loop |
| 8 | No secrets or local data in commit | [§4.4 Never commit](03-ai-development-workflow.md#44-never-commit) |
| 9 | PR/MR merged into `main` and request branch deleted | [R4 — Request branch + merge gate](03-ai-development-workflow.md#r4--request-branch--merge-gate) |

If any gate fails, the change is **not Done**.
