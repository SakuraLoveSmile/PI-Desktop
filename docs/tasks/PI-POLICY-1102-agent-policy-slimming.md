# PI-POLICY-1102: Agent policy becomes a single source with enforceable budgets

- Project: `fork-pi-desktop`; task ID: `PI-POLICY-1102`; status: 待体验
  (implemented, validated and merged; user acceptance pending).
- Created: 2026-11-02 (Asia/Taipei).
- Authoritative record: this file. Linked evidence only supplements it.
- Goal / authorization: the user asked to optimize the project policy because it
  is redundant, then explicitly authorized three decisions on 2026-11-02:
  (1) delete the `CLAUDE.md` mirror and its `check:agent-policy` sync gate and
  replace it with a size/anchor gate; (2) keep task records for T1/T2 and waive
  them for T0; (3) implement directly instead of producing a draft first.
- Baseline: `9c09758ba3d2b590a8154e1eb2f772b347f9fca4` (`origin/main`).
- Branch: `docs/20261102-pi-policy-1102-agent-policy-slimming`.
- Worktree: `/Users/sakurasep/Documents/Code/Project/Project Worktree/fork-pi-desktop/20261102-docs-pi-policy-1102-agent-policy-slimming`.
- PR: [#74](https://github.com/SakuraLoveSmile/PI-Desktop/pull/74), merged as `0450f9ae208c8b554ca360534d9fb13eaf492c7c`.
- Target: remote `main`.

## Problem statement

The agent policy corpus had grown to roughly 195 KB across five English
documents plus two Chinese mirrors, with about 300 normative statements:

| Surface | Before (bytes) | Loaded how |
| --- | --- | --- |
| `AGENTS.md` | 42,705 (working tree) / 40,109 (HEAD) | agent session entry |
| `CLAUDE.md` | 25,238 / 22,642 | mirror of AGENTS.md |
| `CONTRIBUTING.md` | 9,584 | human entry |
| `docs/spec/06-delivery/03-ai-development-workflow.md` | 48,310 / 46,455 | linked workflow spec |
| `docs/spec/06-delivery/05-change-checklist.md` | 19,566 / 18,336 | linked checklist |

Concrete failure modes:

1. The agent session instruction budget is 64 KiB. `AGENTS.md` plus
   `CLAUDE.md` first exceeded it in the working tree (67,943 bytes); the
   authoritative file was omitted while the mirror was loaded.
2. PI-Desktop loads project instructions with `MAX_INSTRUCTION_BYTES = 32 KiB`
   (`packages/agent-runtime/src/project-instructions.ts`). `AGENTS.md` alone
   exceeded it, so every section from §13 onward was truncated when the product
   ran an agent on this repository.
3. `docs/spec/06-delivery/03-ai-development-workflow.md` §1 stated that
   R1–R6 "restate" rules owned by `AGENTS.md`; the same workflow was written in
   five places (global guidance, `AGENTS.md`, `CLAUDE.md`, spec 03, checklist
   05, `CONTRIBUTING.md`).
4. Drift had already occurred: `AGENTS.md` §2 routed to seven scoped
   `AGENTS.md` files and six did not exist; `CONTRIBUTING.md` still created
   worktrees under `../PI-Desktop-worktrees/`; the two documents disagreed on
   the worktree root.

## Scope

1. `AGENTS.md` becomes a single authoritative index: non-negotiables,
   architecture/security/data constraints, testing bar, ratchet, routing, and
   maintenance budget. It no longer restates workflow mechanics.
2. `CLAUDE.md` becomes a three-line entry point that imports `AGENTS.md`
   instead of mirroring it. The old mirror always duplicated the authority and
   was never read by PI-Desktop itself, because `AGENTS.md` wins the first
   non-empty candidate rule in ADR 0037.
3. `docs/spec/06-delivery/03-ai-development-workflow.md` becomes the single
   owner of the workflow: delivery order, branch/worktree mechanics, commit
   rules, E2E stages, issue/PR intake, merge cleanup, cloud packaging, DoD and
   the new T0/T1/T2 change tiers.
4. `docs/spec/06-delivery/05-change-checklist.md` becomes checklist-only.
5. `CONTRIBUTING.md` becomes a short human on-ramp pointing at the canonical
   documents, with the stale worktree path corrected.
6. `scripts/check-agent-policy-sync.mjs` is deleted. `scripts/check-agent-policy.mjs`
   replaces it with enforced budgets, required anchors in `AGENTS.md`, the
   `@AGENTS.md` import in `CLAUDE.md`, and a machine-path restriction.
7. Chinese mirrors of spec 03 and 05 are updated with the same structure, as
   `docs/scripts/check-locales.mjs` requires table and fence parity.
8. CI references, `scripts/README.md`, and the workflow spec references to the
   retired gate are updated.

Out of scope: architecture, runtime behavior, application code, ADR 0037, the
global `~/.codex` guidance files, and any release action. The uncommitted
policy edits in the primary checkout are the user's work and stay untouched.

## Confirmed decisions

- One authority; tools adapt through `@AGENTS.md`. No mirrored policy text.
- A mechanical gate replaces the mirror gate: file budgets plus required
  anchors, so deleting a non-negotiable or regrowing the file fails CI.
- Change tiers: T0 (docs/copy/i18n/comments with no runtime, rule or user-path
  change) keeps the worktree and CI but needs no task record, candidate E2E or
  delivery-report block; T1 (normal code) keeps the record and targeted checks,
  with candidate E2E only for user-visible or protocol-visible changes; T2
  (architecture, public contract, persistence, security, release) keeps the
  full evidence and cleanup archive path.
- Keep the concrete worktree root only in `AGENTS.md`; no other policy file may
  hard-code `/Users/` paths.

## Implementation and acceptance

| Step | Surface | Acceptance | Result | Status |
| --- | --- | --- | --- | --- |
| T1 | `AGENTS.md` | single-source index, every non-negotiable anchor, no workflow mechanics | 12,120 B / 275 lines; 15/15 anchors; workflow mechanics moved out | 完成 |
| T2 | `CLAUDE.md`, `CONTRIBUTING.md` | import stub plus short on-ramp; no duplicated workflow | 196 B / 4,002 B; no Policy-Sync, no machine paths | 完成 |
| T3 | spec 03 + 05 (English) | single owner, tiers table, no duplication | 46,455 -> 32,551 B; 18,336 -> 11,311 B; 14 sections / 12 checklist stages | 完成 |
| T4 | Chinese mirrors | locale check passes, same table/fence structure | in progress | 实现中 |
| T5 | gate script, CI, package scripts | `check:agent-policy` enforces budgets and anchors; old sync script gone | 186-line gate, green; old script deleted; CI and README updated | 完成 |
| T6 | Verification | `docs:check`, `docs:build`, gate, scenario index, diff review | in progress | 实现中 |

Budget decision: `AGENTS.md` budget is 13,312 bytes, not the 10,240 first
planned. The final file keeps every non-negotiable and the testing, ratchet and
security content; forcing 10,240 would have deleted real rules. Spec 03 sits at
32,551/32,768, deliberately at the product's own 32 KiB instruction cap: further
growth must remove something. The other budgets are CLAUDE.md 1,024,
CONTRIBUTING.md 6,144 and spec 05 12,288.


## Execution and validation record

| Date | Revision / candidate | Environment | Command or action | Result / evidence |
| --- | --- | --- | --- | --- |
| 2026-11-02 | worktree at `9c09758ba` | macOS, Node 22 host toolchain | policy corpus measured, budgets agreed | this record |
| 2026-11-02 | English policy landed (uncommitted) | worktree | `node scripts/check-agent-policy.mjs` | PASS: 12,120/13,312, 196/1,024, 4,002/6,144, 32,551/32,768, 11,311/12,288; 15/15 anchors |
| 2026-11-02 | English policy landed (uncommitted) | worktree | `node docs/scripts/check-docs.mjs` | PASS: 632 pages, one H1, fences, tables, ADR citations |
| 2026-11-02 | English policy landed (uncommitted) | worktree + host `node_modules` reused by link | `node scripts/generate-scenario-index.mjs --check` | PASS: 138 suites, 167 executable ids, current |
| 2026-11-02 | English policy landed (uncommitted) | worktree + host docs dependencies | `docs/node_modules/.bin/vitepress build .` | PASS: build complete in 34.40 s, no dead links |
| 2026-11-02 | Chinese mirrors landed (uncommitted) | worktree | `node docs/scripts/check-locales.mjs` | PASS: 95 English/Chinese pairs |
| 2026-11-02 | Chinese mirrors landed (uncommitted) | worktree | `node docs/scripts/check-agent-policy.mjs` / `check-docs.mjs` / scenario index | PASS on all; 34 zh table lines and 2 fence lines match the English shape |
| 2026-11-02 | merged head `43dc869ed` | worktree | `git diff --check`, `node scripts/check-pr-base-main.mjs`, docs rebuild | PASS |
| 2026-11-02 | PR #74 head | GitHub Actions | JS build/typecheck/lint/architecture/test, Docs checks, head-contains-base, isolated launch smoke, Rust host-core | five checks SUCCESS |
| 2026-11-02 | merge `0450f9ae2` | primary checkout and task worktree | local `main` fast-forwarded to `0450f9ae2`; worktree removed; merged branch deleted; registrations pruned | clean, `git worktree list` lists only the primary checkout |

## Commit and integration

| Commit | Behavior change and reason | Validation | Merge / release |
| --- | --- | --- | --- |
| `43dc869ed` | Replace the mirrored policy with one authority plus an enforceable budget | policy gate, docs check, 95 locale pairs, scenario index, VitePress build, five CI workflows | merged as `0450f9ae2` in [#74](https://github.com/SakuraLoveSmile/PI-Desktop/pull/74) |

## Delivery and recovery

- Experience entry: `AGENTS.md` at repository root, then
  `docs/spec/06-delivery/03-ai-development-workflow.md`.
- Delivered: implementation, checks, PR #74 and merge `0450f9ae2`. The remote task branch is retained because deleting it needs explicit authorization.
- User confirmation: required before 已验收.
- Resume: the worktree no longer exists; start from `main` at `0450f9ae2` and read this record.
- Rollback: the change is documentation, CI and one script; revert the commit.
- Worktree cleanup: done on 2026-11-02; the worktree was removed, the merged local branch deleted, registrations pruned, and the primary checkout fast-forwarded to `0450f9ae2`.
