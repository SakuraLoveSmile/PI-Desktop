# 03. AI-Assisted Development Workflow

> Scope: AI agents and human collaborators working on PI-Desktop  
> Status: Accepted  
> Cross-references: [00-baseline](../00-baseline.md) · [decisions-log](../08-meta/decisions-log.md) · [acceptance-criteria](02-acceptance-criteria.md) · [e2e-test-plan](04-e2e-test-plan.md) · [change-checklist](05-change-checklist.md) · [ADR index](../../adr/README.md)

---

## 1. Core Immutable Rules

These four rules govern every change to the PI-Desktop codebase and documentation. They cannot be relaxed by an agent without explicit human override.

### R1 — Spec-first / Spec-sync

> **No behavior change without updating the corresponding spec.**

- Every code, config, or UX change that alters observable behavior must update the relevant `docs/spec/` document before or alongside the change.
- Architectural boundary changes (process model, IPC contract, storage ownership, security boundary) also require an ADR — see `docs/adr/README.md`.
- Pure refactor that preserves behavior and API contracts does not require spec updates, but must still be committed (R2).

### R2 — Commit-per-change

> **Every completed logical change must be git committed.**

- No large uncommitted piles of work. Each logical unit of work — a feature, a fix, a spec update, a chore — gets its own commit.
- Uncommitted work at session end is a violation of this rule.
- If a change is incomplete, either commit it as a draft with a `WIP:` prefix or roll it back.

### R3 — E2E coverage doc

> **Every feature/fix that affects user-visible or protocol-visible behavior must update e2e test documentation.**

- "User-visible": anything the end-user sees or interacts with (UI, CLI output, dialogs, notifications).
- "Protocol-visible": IPC messages, RPC methods, plugin API surfaces, event payloads.
- Document the scenario in `06-delivery/04-e2e-test-plan.md` — even before the automated test exists.
- Internal-only changes (logging format, internal variable rename) do not require e2e doc updates.

### R4 — Request branch + merge gate

> **Every new request starts from `main` on a dedicated branch and finishes only after its PR/MR is merged into `main`.**

- Before editing, preserve any existing uncommitted work, update local `main`
  from `origin/main` with a fast-forward-only pull, and create a new request
  branch from that commit.
- Use one short-lived branch per request. Name it
  `<type>/<short-description>`, where `type` matches the conventional change
  type when practical, for example `feat/provider-import` or
  `docs/request-branch-workflow`.
- Development commits and direct pushes on `main` are forbidden.
- After development and local validation, push the request branch, open a
  pull/merge request targeting `main`, and complete all required remote checks
  and reviews.
- Merge the approved PR/MR into `main` and delete the request branch. If
  authentication, permissions, required checks, or required reviews prevent
  the merge, report the blocker; the request is not Done.

---

## 2. Development Loop

Every change follows this sequence. Steps may be iterated if the implementation reveals new requirements.

```
1. Sync main + create a request branch
2. Read baseline + relevant specs
3. Plan change + list impacted specs/tests
4. Implement
5. Update specs / ADR / decisions-log if needed
6. Update or add e2e scenarios
7. Run checks (lint, typecheck, tests — when code exists)
8. Commit with conventional message
9. Update BOARD if milestone-related
10. Push branch + open PR/MR to main
11. Pass remote gates + merge + delete branch
```

### Step-by-step

| Step | Action | Output |
|---|---|---|
| **1. Branch** | Preserve existing work, switch to `main`, fast-forward from `origin/main`, and create a dedicated request branch. | Cleanly isolated branch based on current `main`. |
| **2. Read** | Read `00-baseline.md` and any specs relevant to the change area. | Mental model of constraints. |
| **3. Plan** | Describe the intended change. List every spec, ADR, and e2e scenario that will need updates. | Change plan + impact list. |
| **4. Implement** | Write code, config, or assets. | Changed files. |
| **5. Spec-sync** | Update specs per the impact list. Add ADR if architectural. Update `decisions-log.md` if an implementation default changes. | Updated docs/spec/\* and/or docs/adr/\*. |
| **6. E2E doc** | Add or update scenario entries in `04-e2e-test-plan.md`. Link to acceptance criteria IDs (A–H). | Updated e2e test plan. |
| **7. Run checks** | Lint, typecheck, unit tests, build. Skip if only docs changed. | Passing CI (or known skip reason). |
| **8. Commit** | Git commit with conventional message (see §4). | One or more commits. |
| **9. BOARD** | If the change completes a milestone deliverable, update `docs/project/BOARD.md`. | Updated board. |
| **10. Open PR/MR** | Push the request branch and open a pull/merge request targeting `main`. | Reviewable remote change with impacted specs and tests listed. |
| **11. Merge** | Pass required checks and reviews, merge into `main`, and delete the request branch. | Change integrated into `main`; request branch removed. |

---

## 3. Spec Update Matrix

Which change types require which doc updates.

| Change type | Spec update | ADR | Decisions-log | E2E doc | BOARD |
|---|---|---|---|---|---|
| New feature (user-visible) | Related domain spec | If architectural boundary | — | New scenario | If milestone deliverable |
| Bug fix (user-visible) | Related spec if behavior clarified | — | — | New or updated scenario | — |
| Bug fix (internal) | — | — | — | — | — |
| Refactor (behavior preserved) | — | — | — | — | — |
| Architectural change | Related specs + baseline | **New ADR** | Update entry if default changes | Update affected scenarios | — |
| New IPC/RPC method | `03-runtime/01-ipc-protocol.md` or `06-host-rpc-protocol.md` | If contract boundary | — | New protocol scenario | — |
| Plugin API addition | `07-plugins/03-plugin-api.md` | If boundary change | — | New plugin scenario | If M4 deliverable |
| Security change | `05-security/01-security.md` | If boundary change | Update if D001–D010 touched | New security scenario | — |
| UX change | Related `04-ux/` spec | — | — | New UI scenario | — |
| Spec-only update | The spec itself | — | — | — | — |
| Chore (deps, tooling) | — | — | If tooling decision | — | — |

---

## 4. Git Commit Rules

### 4.1 Conventional Commits

Format: `type(scope): description`

| Type | Use for |
|---|---|
| `feat` | New feature |
| `fix` | Bug fix |
| `docs` | Documentation-only change |
| `test` | Adding or updating tests |
| `chore` | Build, deps, tooling, CI |
| `refactor` | Code restructuring, no behavior change |
| `perf` | Performance improvement |
| `build` | Build system or external dependency change |
| `ci` | CI/CD configuration change |

**Scope** is optional but encouraged — e.g. `feat(host-core):`, `fix(ui):`, `docs(spec):`.

### 4.2 Language

- Commit messages: **English only** (matches baseline language policy).
- Body: optional; use for non-obvious context.

### 4.3 One logical change per commit

- Prefer small, focused commits.
- Spec updates that are tightly coupled to the code change should be in the same commit.
- Pure doc changes (spec rewrite, ADR) may be a separate adjacent `docs:` commit.

### 4.4 Never commit

- Secrets, API keys, tokens, passwords
- Local-only data (user configs, session data, logs)
- `node_modules/`, build artifacts, release packages
- Generated files that should be rebuilt per CI

### 4.5 Pre-commit checklist

Before committing, verify:

1. Change is one logical unit (or clearly split).
2. No secrets or local data in the diff.
3. Specs updated per §3 matrix.
4. E2E doc updated if behavior changed.
5. `git diff --stat` review — nothing unexpected.
6. Commit message follows conventional format.

---

## 5. Branching Model

The repository uses a mandatory request-branch workflow:

- **`main`** is always deployable and is the protected integration target. Do
  not develop, commit, or push directly on it.
- **Request branches** are mandatory for every new request, including docs,
  chores, and small fixes. Create each branch from an up-to-date `main` and
  delete it after merge.
- **Branch names** use `<type>/<short-description>` with a lowercase,
  kebab-case description. Allowed type prefixes mirror §4.1.
- **No long-lived development branch** exists. Each request gets a new branch;
  an old request branch must not be reused for unrelated work.
- **PR/MR delivery** is mandatory. Push the branch, open a PR/MR targeting
  `main`, pass required checks and reviews, then merge using a repository-
  permitted merge strategy.

Typical request start:

```bash
git status --short
git switch main
git pull --ff-only origin main
git switch -c <type>/<short-description>
```

If the worktree is not clean, preserve and resolve the existing work before
switching branches; never discard or overwrite it to satisfy this sequence.

Typical GitHub delivery (use the hosting platform's equivalent when needed):

```bash
git push -u origin <type>/<short-description>
gh pr create --base main --head <type>/<short-description>
gh pr checks --watch
gh pr merge --delete-branch
```

---

## 6. Definition of Done

A change is **Done** when all of the following are true:

1. A dedicated request branch was created from an up-to-date `main`.
2. Code (or doc) implements the planned change.
3. All impacted specs are updated.
4. E2E scenarios are documented (or confirmed not needed per §3).
5. Local and required remote checks pass, or an allowed skip is documented.
6. Change is committed with a conventional message.
7. BOARD is updated if a milestone deliverable completed.
8. No secrets or local data are present in the commit.
9. The branch was pushed and its PR/MR was reviewed and merged into `main`.
10. The merged request branch was deleted.

---

## 7. Forbidden Practices

| Practice | Why |
|---|---|
| Committing secrets | Security violation |
| Large uncommitted diffs | Violates R2; loss of granularity |
| Changing behavior without spec update | Violates R1; specs become unreliable |
| Skipping e2e doc for user-visible changes | Violates R3; traceability gap |
| Developing, committing, or pushing directly on `main` | Violates R4; bypasses isolation and review gates |
| Reusing a request branch for unrelated work | Mixes request scope and weakens traceability |
| Marking work Done before its PR/MR is merged | Violates R4; change is not integrated into `main` |
| Modifying baseline frozen decisions without ADR + version bump | Baseline is frozen; changes need formal process |
| Committing generated artifacts that CI should rebuild | Repo bloat, merge conflicts |
| Mixing multiple logical changes in one commit without clear message | Loss of history granularity |

---

## 8. Acceptance Criteria for This Workflow

This workflow spec itself is accepted when:

- [ ] R1/R2/R3/R4 are stated clearly and cross-linked to relevant specs.
- [ ] Development loop is documented and referenced by `AGENTS.md`.
- [ ] Spec update matrix covers all change types in the baseline.
- [ ] Git commit rules match existing repo commit style (`docs:`, `chore:`).
- [ ] Every request is required to use a branch created from current `main`.
- [ ] PR/MR creation, remote gates, merge, and branch cleanup are mandatory.
- [ ] Definition of Done is complete and actionable.
- [ ] Forbidden practices list covers known risk areas.
- [ ] `AGENTS.md` points to this doc, `04-e2e-test-plan.md`, and `05-change-checklist.md`.
- [ ] All indexes updated (NAV, delivery README, spec README, docs README, BOARD).
