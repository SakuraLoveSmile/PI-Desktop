下面这版保留核心约束，删除重复说明，更适合作为仓库根目录的 `AGENTS.md`。

# AGENTS.md

Mandatory rules for AI coding agents working in this repository.

## Language

Use English for code, identifiers, comments, commits, specifications, and documentation.

Follow the repository baseline:

* [Baseline](docs/spec/00-baseline.md)

## Immutable Rules

### 1. Keep Specs Synchronized

Every behavior change must update the relevant document under `docs/spec/`.

Add an ADR under `docs/adr/` when changing architectural boundaries, public interfaces, data ownership, security boundaries, or frozen design decisions.

### 2. Commit Every Logical Change

Every completed logical change must be committed.

* One logical change per commit
* No large uncommitted diffs
* No unrelated cleanup
* Leave the working tree clean

### 3. Keep E2E Documentation Synchronized

Every user-visible or protocol-visible behavior change must add or update a scenario in:

* [E2E test plan](docs/spec/06-delivery/04-e2e-test-plan.md)

Updating E2E documentation is mandatory.

Do not run local E2E commands or manually trigger remote E2E jobs unless the user explicitly requests E2E validation.

### 4. Use a Branch and Dedicated Worktree

Every new request must:

1. Start from an up-to-date local `main`
2. Use a dedicated branch
3. Use a dedicated worktree
4. Be committed on that branch
5. Be merged into local `main`

Do not:

* Develop directly on `main`
* Develop in the primary checkout
* Reuse another request's worktree
* Push branches or `main` to remote
* Open a PR or MR unless explicitly requested

Remote publishing is the user's responsibility.

## Development Workflow

1. Update local `main`
2. Create a request branch and worktree
3. Read the baseline and relevant specs
4. Identify affected specs, ADRs, E2E scenarios, and validation
5. Implement the smallest coherent change
6. Update specs, ADRs, decisions log, and E2E documentation as required
7. Run targeted, risk-based checks
8. Review the complete diff
9. Commit each logical change
10. Update `docs/project/BOARD.md` when milestone-related
11. Merge the branch into local `main`
12. Do not push

Local validation may be skipped when it provides no meaningful value, but the reason must be reported.

Automatically triggered required remote checks remain part of the merge gate.

## Commit Format

```text
type(scope): description
```

Allowed types:

```text
feat fix docs test chore refactor perf build ci
```

Requirements:

* English only
* Concise, imperative description
* One logical change per commit

Example:

```text
fix(auth): prevent expired session reuse
```

## Stable Release Rule

Before creating a stable application version tag, ensure the version has both English and Simplified Chinese entries in:

```text
packages/shared/src/changelog.ts
```

See:

* [Release runbook](docs/spec/06-delivery/06-release-runbook.md#41-mandatory-in-app-changelog-gate-d164)

## Completion Checklist

Before finishing:

* [ ] Impact analysis completed
* [ ] Branch and worktree created from updated `main`
* [ ] Relevant specs updated
* [ ] ADR added when required
* [ ] E2E scenarios updated when required
* [ ] Targeted validation passed or was documented as unnecessary
* [ ] No secrets, local data, or unrelated changes in the diff
* [ ] Conventional commits created
* [ ] Definition-of-Done gates passed
* [ ] Changes merged into local `main`
* [ ] Nothing pushed to remote

## Final Report

Report:

* What changed
* Documentation updated
* Validation performed or skipped
* Commit hashes and messages
* Confirmation that changes were merged into local `main`
* Confirmation that nothing was pushed

## Key References

| Document        | Path                                                  |
| --------------- | ----------------------------------------------------- |
| Baseline        | `docs/spec/00-baseline.md`                            |
| Spec index      | `docs/spec/README.md`                                 |
| Decisions log   | `docs/spec/08-meta/decisions-log.md`                  |
| AI workflow     | `docs/spec/06-delivery/03-ai-development-workflow.md` |
| E2E plan        | `docs/spec/06-delivery/04-e2e-test-plan.md`           |
| Checklist       | `docs/spec/06-delivery/05-change-checklist.md`        |
| Release runbook | `docs/spec/06-delivery/06-release-runbook.md`         |
| ADR index       | `docs/adr/README.md`                                  |
| Project board   | `docs/project/BOARD.md`                               |

相比上一版，这版去掉了规则优先级、变更分类和大量解释，只保留 Agent 真正需要执行的内容。
