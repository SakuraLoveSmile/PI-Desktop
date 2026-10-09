# Bounded delegation local-main integration

Date: 2026-10-09. Delivery: local main only; not pushed or installed.

## Candidate and preserved state

- Previous local main: `a64a7314fc44938eb11529c38a39c8e6562a1030`.
- Remote base: `05dc95412028d7e5a9bcedbb03e2d01f795da21a`.
- Integrated production-code candidate: `c6e0a083c5c53761d3d154fc07ab51aa4705a2d5`.
- Final E2E harness candidate: `b434ae0d987341f472134937506b0f5ee87576af`.

The dedicated request branch incorporates all prior local-main commits. Two
spec conflicts retained both bounded delegation and the existing project-context
and Context Insights contracts. The primary checkout was clean and was not used
for candidate development or conflict resolution. Other tasks remain untouched.

## Validation run for this integration

- Dependency/runtime/Desktop builds and Desktop typecheck passed.
- Runtime: 11 relevant Vitest files, 527 tests passed, including recursive
  delegation, scoped ownership, permissions, cancellation, project memory and
  Context Insights overlaps.
- Desktop: 6 relevant Node test files, 40 tests passed.
- Host: rebuilt current binary; subagent limit persistence/restart/invalid-write
  regression passed using an isolated database.
- Lint, agent-policy synchronization and remote-base ancestry passed.
- `node scripts/e2e-subagent-recursion.mjs`: real Host/sidecar and 49 deterministic
  loopback requests passed, including confirmed expert recursion.
- `node scripts/e2e-subagent-settings.mjs`: production SettingsPage/store/CSS with
  real keyboard input and isolated preload fixture passed. Main agent inspected
  the rendered screenshot.
- `node scripts/e2e-settings-memory.mjs`: 11 existing Memory interactions passed.
- `PI_E2E_TEAM_CORE_ONLY=1 node scripts/e2e-team.mjs`: approval, expert dispatch,
  live task/member navigation and updates, queue actions, standard Task coexistence,
  pause/restart/resume and Chinese reload passed in isolated Electron/Main/Host.

Only E2E harness behavior needed additional integration fixes: wait for native
input/blur, explicitly remount Overview after approval before releasing a gated
mutation, use current solid separator expectations, wait for confirmed queue rows,
and converge ordinary delegates with TaskWait before checking durable results.
No production behavior was changed to satisfy these checks.

## Limits

Full Team font/theme/resize layout matrix was not rerun; the earlier task candidate
had a pointer-capture timeout, retained separately from the core gate. Real-model
delegation frequency and Windows were not validated. No paid provider or user
profile was used. This record does not claim remote publication or user acceptance.

## Merge and cleanup

Local main is fast-forwarded to the validated request head plus this documentation
commit, preserving the previous local-main history. Screenshots and logs are copied
to a checksum-verified archive before managed worktree archival. The merged task
branch is retired; other active task worktrees and branches are preserved.
