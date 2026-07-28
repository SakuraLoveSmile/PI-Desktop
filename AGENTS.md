# AGENTS.md — Rules for AI Coding Agents

Concise, mandatory rules for any AI agent working in this repository.

## Language

- **English only** for commits, specs, code identifiers, and comments.
- Match the repo's existing English-first policy ([baseline](docs/spec/00-baseline.md)).

## Four Immutable Rules

### 1. Spec-sync

Every behavior change must update the corresponding `docs/spec/` document. Architectural boundary changes also need an ADR (`docs/adr/`).

→ [03-ai-development-workflow.md §R1](docs/spec/06-delivery/03-ai-development-workflow.md#1-core-immutable-rules)

### 2. Commit-per-change

Every completed logical change must be git committed. No large uncommitted piles.

→ [03-ai-development-workflow.md §R2](docs/spec/06-delivery/03-ai-development-workflow.md#1-core-immutable-rules)

### 3. E2E doc update

Every user-visible or protocol-visible behavior change must add or update a scenario in the e2e test plan.

→ [04-e2e-test-plan.md](docs/spec/06-delivery/04-e2e-test-plan.md)

### 4. Request branch + worktree + merge request

Every new request must start in a dedicated worktree on a dedicated branch
created from an up-to-date `main`. Reuse the primary checkout's development
environment where safe; do not duplicate or commit local environment state.
After development, push the branch, open a PR/MR targeting `main`, pass the
required remote checks, and merge it. Local validation is risk-based and may be
skipped when it is not necessary. Direct development or pushes on `main` are
not allowed.

→ [03-ai-development-workflow.md §R4](docs/spec/06-delivery/03-ai-development-workflow.md#r4--request-branch--worktree--merge-gate)

## Development Loop

1. Sync `main` and create a request branch in a dedicated worktree
2. Read baseline + relevant specs
3. Plan change + list impacted specs and necessary validation
4. Implement
5. Update specs / ADR / decisions-log
6. Update or add e2e scenarios when Rule 3 applies
7. Run only the targeted local checks justified by the change's risk; when no
   local validation is necessary, skip it and continue to delivery. Run E2E
   only when the user explicitly requests it
8. Commit with conventional message
9. Update BOARD if milestone-related
10. Push the branch and open a PR/MR to `main`
11. Pass required remote checks, merge, and remove the request worktree and branch

→ [03-ai-development-workflow.md §2](docs/spec/06-delivery/03-ai-development-workflow.md#2-development-loop)

E2E scenario documentation remains mandatory under Rule 3. Agents must not
proactively run local E2E commands or manually dispatch/rerun remote E2E jobs
unless the user explicitly requests E2E validation. Automatically triggered
required remote checks remain part of the merge gate. Skipping unnecessary
local validation does not block commit, push, or PR/MR creation.

## Commit Format

```
type(scope): description
```

Types: `feat` `fix` `docs` `test` `chore` `refactor` `perf` `build` `ci`

English messages only. One logical change per commit.

→ [03-ai-development-workflow.md §4](docs/spec/06-delivery/03-ai-development-workflow.md#4-git-commit-rules)

## Before Finishing Work

Run the [change checklist](docs/spec/06-delivery/05-change-checklist.md):

- [ ] Impact analysis done
- [ ] Request branch and worktree were created from an up-to-date `main`
- [ ] Task environment reuses the primary checkout where safe
- [ ] Specs updated per matrix
- [ ] E2E doc updated if behavior changed
- [ ] Necessary local validation completed, or confirmed unnecessary
- [ ] No secrets / local data in diff
- [ ] Conventional commit message
- [ ] All Definition-of-Done gates pass
- [ ] PR/MR passed required remote checks and was merged into `main`

## Key References

| Doc | Path |
|---|---|
| Baseline | `docs/spec/00-baseline.md` |
| Spec index | `docs/spec/README.md` |
| Decisions log | `docs/spec/08-meta/decisions-log.md` |
| AI dev workflow | `docs/spec/06-delivery/03-ai-development-workflow.md` |
| E2E test plan | `docs/spec/06-delivery/04-e2e-test-plan.md` |
| Change checklist | `docs/spec/06-delivery/05-change-checklist.md` |
| ADR index | `docs/adr/README.md` |
| Project board | `docs/project/BOARD.md` |

## Never Do

- Commit secrets, API keys, or tokens
- Leave large uncommitted diffs at session end
- Change behavior without updating specs
- Skip e2e doc for user-visible changes
- Manually run or dispatch E2E without an explicit user request
- Modify frozen baseline decisions without ADR + version bump
- Develop or push directly on `main`
- Develop a new request in the primary checkout or another request's worktree
- Mark work complete before its PR/MR is merged into `main`
