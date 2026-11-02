# Contributing to PI-Desktop

Thanks for helping improve PI-Desktop. This guide is the short human on-ramp.
AI agents start from [AGENTS.md](AGENTS.md); the workflow itself has exactly one
owner, [03-ai-development-workflow](docs/spec/06-delivery/03-ai-development-workflow.md),
with a stage-by-stage [change checklist](docs/spec/06-delivery/05-change-checklist.md).

## Read before changing

1. [AGENTS.md](AGENTS.md): non-negotiables, architecture, security, testing bar.
2. `docs/spec/00-baseline.md` plus the domain spec you are touching.
3. The nearest `AGENTS.md`, package `README.md`, and the relevant ADR.

Current code, public types, schemas and tests are the source of truth. If a
document contradicts the implementation, verify the behavior first and report
the drift instead of silently following either side.

## Set up

- Node >= 22.19, pnpm >= 10 (the repository pins its pnpm version).
- `pnpm install`, then `pnpm dev` for the desktop app.
- Rust toolchain for `crates/host-core`.

## Start an isolated request

Every request gets its own branch and worktree: `1 request = 1 branch + 1
dedicated worktree`. Never develop on `main` or in the primary checkout.
Create it from current `origin/main` under the central worktree root declared in
[AGENTS.md](AGENTS.md); branch names use `<type>/<YYYYMMDD>-<task-id>-<slug>`
and worktree directories `<YYYYMMDD>-<type>-<task-id>-<slug>` with the creation
date in Asia/Taipei. The exact commands and refresh rules are in the workflow
spec.

Pick the change tier before starting:

- **T0**: docs, copy, i18n text or comments with no runtime, rule or user-path
  change. Worktree and CI only; no task record, no candidate E2E.
- **T1**: normal code change. Task record, targeted tests; candidate E2E only
  when user-visible or protocol-visible.
- **T2**: architecture, public contract, persistence, security or release. Full
  evidence, candidate E2E, cleanup archive.

## Implement

Keep the diff small and coherent: one purpose, no drive-by cleanup, no unrelated
dependency bumps. Preserve existing behavior unless the task explicitly changes
it, and never hide a behavior change in a `refactor` commit. New logic belongs
in the domain module that owns the state or process boundary, not in the known
hotspots listed in [AGENTS.md](AGENTS.md).

## Validate

Run the narrowest authoritative gate for the surface you changed:

```bash
pnpm build:js
pnpm --filter @pi-desktop/desktop typecheck
pnpm lint
pnpm -r --if-present test

cargo fmt --check
cargo test -p host-core --locked
cargo clippy -p host-core --all-targets
```

Narrower tests never justify skipping an applicable gate, and a skipped command
is reported as NOT RUN, never as passing. Installer and release packages are
built only on GitHub-hosted Actions runners.

## Commit and open the pull request

- Stage files by explicit path; review the full diff before committing.
- Conventional Commits, subject plus blank line plus body explaining why.
- Do not force-push and do not rewrite a contributor's branch.
- The pull request head must contain the latest `origin/main`:
  `pnpm check:pr-base`.
- Outside contributions are temporarily limited to `perf` and `fix` pull
  requests.

Landing blockers, review rules and the full delivery order are in
[03-ai-development-workflow](docs/spec/06-delivery/03-ai-development-workflow.md).

## After merge

Cleanup is part of delivery: verify the merge and checks, archive recoverable
work, remove your worktree, prune, and delete the merged branch. Do not leave
backup snapshots as normal local branches. Never remove another task's
resources.

## Issues and security

Verify a reported bug against current code before implementing; a linked issue
is intake, not proof. Report suspected vulnerabilities privately through
[SECURITY.md](SECURITY.md); never open a public issue for one.

## Language

Repository code, comments, commits, specs and ADRs are English. Issue and pull
request discussion follows the original author's language.
