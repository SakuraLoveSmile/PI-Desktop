# Upstream sync runbook

This runbook maintains Pi-Desktop-Plus as a compatible fork of
[vastsa/PI-Desktop](https://github.com/vastsa/PI-Desktop), preserving Plus user
data, identity and intentional behavior. Follow [AGENTS.md](https://github.com/SakuraLoveSmile/PI-Desktop/blob/main/AGENTS.md)
for request isolation, authorization and delivery gates. The primary checkout
and local `main` are coordination surfaces, never integration scratch space.

## Cadence and selection

Review upstream once a week and after each upstream release. Sync a commit
whose applicable upstream CI checks are green; a release tag alone does not
prove that. Record the selected full SHA, upstream checks and previous sync
SHA before starting. Keep `upstream` read-only and namespace its tags:

```sh
git remote set-url --push upstream DISABLED
git fetch upstream +refs/heads/main:refs/remotes/upstream/main \
  '+refs/tags/*:refs/tags/upstream/*'
git fetch origin main
git status --short --branch
git worktree add -b chore/sync-upstream-<release> <new-worktree> origin/main
```

Use a new, dedicated request worktree. Do not reuse or change another task's
checkout, uncommitted files or branch. Verify the selected upstream commit
with `git show` and hosting-platform checks. Merge that exact commit in the
request worktree with `git merge --no-ff <selected-upstream-sha>`; do not squash,
rebase upstream commits or copy only their diff. A failed or interrupted merge
is not permission to reset unrelated work.

The final Plus PR **must use Create a merge commit** (`gh pr merge --merge`
when explicitly authorized). Squash or rebase merging loses the upstream
ancestry that makes the next sync incremental. Push, PR publication, merge and
upstream messages require their own user authorization; a local sync request
alone does not grant them.

## Resolve conflicts by ownership

| Surface | Resolution and verification |
| --- | --- |
| Plus application versions and identity | Keep Plus at the seven surfaces below. `packages/*/package.json` follow the selected upstream library version, not the Plus app version. |
| Nine `packages/shared/src/changelog-<locale>.ts` catalogs | Take upstream byte for byte. Put Plus entries only in `plus-changelog.ts`; retain the Plus head expectations in `changelog.test.ts`. |
| `docs/project/unreleased.md` | Take upstream byte for byte. Put fork-only pending highlights in `plus-unreleased.md`; do not re-list already merged upstream releases there. |
| Shared database migration chain | Preserve upstream migrations, schema constant and dispatch; preserve the Plus before/after open hooks and independent steps. Extend migration coverage when upstream adds a step. |
| Lockfiles | Start with upstream lockfiles, restore any actual fork-only dependencies through the package manager, and verify frozen/locked resolution. Do not erase a fork dependency merely to obtain a clean diff. |
| i18n | Keep the union of required keys and both sides' current translations. Run locale validation; do not discard keys to resolve a textual conflict. |
| Hook points and cross-boundary types | Semantically retain both sides' fields, initialization and lifecycle order. Do not resolve a `SessionSummary` literal by deleting either Plus `execution_profile`/`team` or upstream `scheduled_run`. |
| Specs and ADRs | Reconcile the behavior against the executable contracts, update affected English/zh-CN pairs, and retain intentional Plus differences. Do not change an acceptance goal to excuse an implementation regression. |

The seven application/identity surfaces are:

1. Root `package.json`.
2. `apps/desktop/package.json`.
3. `apps/pi-host/package.json`.
4. `docs/package.json`.
5. `[workspace.package].version` in `Cargo.toml`.
6. The `host-core` package version in `Cargo.lock`.
7. `APP_VERSION`, `APP_ID` and `APP_NAME` in `packages/shared/src/protocol.ts`.

See [Plus version line](../adr/plus-version-line.md) and
[Plus schema track](../adr/plus-schema-version-track.md). Plus changes never
consume upstream `PRAGMA user_version` numbers. Preserve
`reconcile_before_upstream_chain` and `apply_pending` in `Database::open`,
including backups, refusal of newer Plus data and replay after upstream table
rebuilds. Re-adding a dropped column does not recover its old values; test
non-empty upgrade fixtures and every newly merged migration step.

The product changelog is the cached composition of locale-specific Plus
entries followed by upstream entries from `PLUS_UPSTREAM_CUTOFF` (`0.15.6`).
The eager `CHANGELOG` and lazy loader must share each locale's array identity.
Newer upstream catalog entries intentionally stay hidden until the product
policy changes. Verify every catalog contains the cutoff; the runtime's
Plus-only fallback is not permission to silently omit the historical notes.

Before moving a pending highlight, trace it with
`git log -m -S'<distinctive text>' -- docs/project/unreleased.md` and inspect
its introducing diff. `git merge-base --is-ancestor <commit> <upstream-sha>`
proves an upstream commit's origin. A merge-resolution summary may not exist
verbatim upstream: verify its source change or published upstream catalog too,
instead of treating every merge-introduced sentence as fork-only.

## Review and validation gates

Review the entire task diff and each upstream merge's conflict resolutions:

```sh
git show --remerge-diff <upstream-merge-commit>
git diff --check origin/main...HEAD
```

Verify no identity, provider, permission, sandbox, contract or Plus data path
was dropped. Pay particular attention to Host ownership, Team guards,
approved execution context, notification resource cleanup and session/project
changes across `await`. Keep tests that fail when the protection is removed.

Reuse the provisioned host toolchains, compatible dependency trees, stores,
Electron and caches. Overlay workspace package links to **this** request's
packages. Do not run pnpm in a symlink overlay or create a second environment
just for E2E. If upstream changes Pi or the lockfile, first look for a compatible
provisioned dependency tree; install only when missing/incompatible, recording
why. Build mutable workspace outputs locally. Use direct underlying commands
for an overlay and frozen/locked verification on a compatible proper install.

Run the applicable gates (not merely the easiest tests):

```sh
pnpm build:js
pnpm -r --if-present typecheck
pnpm lint
pnpm -r --if-present test
cargo fmt --all -- --check
cargo test -p host-core --locked
cargo clippy -p host-core --all-targets
node scripts/check-architecture.mjs
pnpm docs:check
pnpm check:agent-policy
pnpm check:release-docs
```

`check:release-docs` is mandatory for every sync and release. It is intentionally
absent from CI's docs workflow because prerelease branches need an explicit
stable documentation version; do not change CI to hide that choice. See
[release runbook](../spec/06-delivery/06-release-runbook.md).

Record which commands actually ran, versions, results, skips and reasons.
For an overlay invoke the same package-local compiler/test runner and `node`
checks directly; never describe an unexecuted pnpm command as passing. Existing
failures need a baseline comparison and mechanism, not an assumption that the
new range caused them. A relevant unresolved regression blocks landing.

Refresh a private request branch against latest `origin/main` **inside its own
worktree** before candidate validation. Commit only when requested; when local
commits are authorized, use explicit file paths and the repository commit
format. Rebase a private unshared branch; use a non-destructive merge for a
shared branch when rewriting would be unsafe. Never force-push or integrate
into local `main` as an E2E prerequisite. An unrelated-file rebase conflict
requires handoff rather than editing another task's work.

Run `pnpm check:pr-base` before opening/updating the PR; the current
`origin/main` must be an ancestor of its head. Repeat the base check if `main`
changes. Run relevant task-candidate E2E from the request worktree. For a full
sync include protocol smoke, Electron boot, Plan, Plan UI, scheduled runs,
Team, collaboration and storage, plus suites for the actual upstream changes
(e.g. session links, MCP, system transcript or tool declarations). Consult
[the E2E plan](../spec/06-delivery/04-e2e-test-plan.md) rather than inferring
coverage from a green build.

Unset `ANTHROPIC_*`, `CLAUDE*` and live-test credentials. Use isolated temporary
profiles, Host data directories, ports and fixture providers. Never point tests
at `~/.pi-desktop-plus` or a running user instance. Build the tested Host from
the candidate into a dedicated `/tmp` Cargo target. `verify:ui:*` needs explicit
authorization and is not implied by a sync or UI-shaped change.

Record evidence in this form, with full revisions and log/artifact locations:

```text
Task candidate:
Base main:
E2E suites:
Result:
Environment:
```

The final landing gate validates the current GitHub merge ref, merge queue or
an equivalent synthetic integration candidate. Compare executable tree IDs
before reusing a head's E2E evidence. If target `main` or relevant content
changed, rerun affected validation. Required checks/reviews must pass; never
bypass them. After an authorized merge, verify remote ancestry, synchronize a
clean local main when authorized, and remove only your own merged worktree and
branch. Preserve dirty primary files and every other task's worktree.

## Intentional Plus divergences

- **Application/update identity:** `cn.sakura.pi-desktop`, Plus app/profile
  names, `~/.pi-desktop-plus` data root and
  `SakuraLoveSmile/PI-Desktop` releases/updater source. No upstream feed fallback.
  See [independent identity](../adr/plus-independent-application-identity.md).
- **Version line:** Plus app semver independent from upstream library versions.
- **Renderer E2E asset loaders ([PR 38](https://github.com/SakuraLoveSmile/PI-Desktop/pull/38), merged):**
  five upstream-owned scripts (`e2e-transcript-render`,
  `e2e-transcript-disclosure-anchor`, `e2e-transcript-minimap-jump`,
  `e2e-copy-conversation` and `e2e-work-panel-reorder`, under `scripts/` with
  `.mjs` extensions) add `".svg": "dataurl"` for Plus `PixelAvatar` assets.
  Keep this one-line-per-script difference when syncing.
- **Persistence:** separate Plus migration track, with recoverable legacy
  reconciliation and upgrade coverage.
- **Team behavior:** Host-owned Expert Team state and durable mailbox/task
  ownership; see [Expert Team](../adr/plus-expert-team-collaboration.md).
- **Plan/Goal behavior:** trusted revision, scheduled one-time snapshots and
  execution lifecycle; see [Plan/Goal lifecycle](../adr/plus-plan-goal-revision-and-one-time-execution-lifecycle.md),
  [temporary Goal scratch workspace](../adr/temporary-goal-scratch-workspace.md)
  and the [Goal report RPC contract](../spec/03-runtime/06-host-rpc-protocol.md).
- **Pi npm skill discovery:** Plus retains explicit discovery/import of installed
  pi CLI npm skill packages after upstream reverted that feature. Import still
  requires source and executable-extension confirmation; discovery never
  enables code automatically. See [Pi npm discovery](../adr/pi-npm-skill-discovery.md).
  Reconcile both the introduction and any later
  upstream revert before attributing a pending highlight.
- **Plus-owned implementation seams:** `crates/host-core/src/db/plus_schema.rs`,
  `crates/host-core/src/team/`, `crates/host-core/src/plans/schedule.rs`,
  `rpc/team_rpc.rs`, `rpc/goal_rpc.rs`, `rpc/plan_schedule_rpc.rs` under
  `crates/host-core/src/`; `packages/agent-runtime/src/team/`;
  `packages/shared/src/plus-changelog.ts`; and
  `docs/project/plus-unreleased.md`. Prefer these owned modules for fork rules;
  maintain minimal semantic hooks in shared entry points.

## Known validation flakes

- The Plan UI `E2E-PLAN-REVISION` fixture timeout was fixed by
  [PR 28](https://github.com/SakuraLoveSmile/PI-Desktop/pull/28), merged on
  2026-10-05. Its refreshed candidate passed five consecutive `e2e-plan-ui`
  runs and protocol smoke; the GitHub integration candidate had the same tree.
  This fix does not close the separate renderer-reload timing issue below.
- During the 2026-10-04 sync validation, `e2e-scheduled` timed out waiting for
  "Scheduled review complete."; four isolated retries passed. The cause was
  not established and machine load was not recorded. Retain both results when
  diagnosing a candidate. This is historical evidence, not a rerun for this
  documentation change or proof that every timeout is harmless.
- `e2e-provider-api-style` can race the recommended-model preselection: the
  harness switches to an explicit selection before the recommended model is
  checked, then reports "StepFun model was not selected". The local
  `fix/upstream-test-harness` candidate waits for `checked === true` before
  switching and passed 12/12 fixture runs. That fix is not yet merged into
  main; those repeat runs are not a main-branch acceptance result.
- Renderer reload under heavy load can fail timing-sensitive UI harnesses.
  Capture the failing step and logs, compare the unchanged baseline, and
  separate harness timing from an actual lost user state. Do not disable the
  scenario or declare a failure harmless solely because it was seen before.

This runbook's operational acceptance is the next upstream sync (S7) executed
with these ownership rules and revision-bound evidence. Documentation checks
alone do not prove that future operation or its conflict-count improvement.
