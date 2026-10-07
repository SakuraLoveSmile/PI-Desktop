# Delegation by execution profile — local validation

- Date: 2026-10-07
- Delivery: local commits only, on `feat/delegation-by-mode`.
- Status: pending user acceptance after automated validation.

## Behavior and scope

Standard Agent sessions with enabled subagents receive delegate-first steering
for substantial, separable work. Trivial few-tool work and user-participation
steps remain parent-owned. The prompt preserves no recursive delegation,
duplicate work or agent debates, and at most one optional review unless the
user asks for more.

Execution Team Leads default to expert task-board delegation. `lead_only` is
reserved for trivial, indivisible work with a concrete reason. Planning Lead
and member prompts, launch review, permissions, tools and persisted contracts
are unchanged. Plan/Goal Task-family declarations remain execution-denied.

`runtime.ts` shrank by 18 lines; steering text moved into
`packages/agent-runtime/src/delegation-prompt.ts`. ADRs, runtime specifications,
E2E scenario documentation and all nine Plus changelog locales were updated.

## Static and regression checks

The new prompt checks first failed against the old source (3 failed, 2 passed).
After implementation, the same selection passed (5 passed).

- Runtime tests: 351 passed across `runtime.test.ts`,
  `team/team-tools.test.ts`, `mode-tool-access.test.ts` and `subagent.test.ts`.
- Plus changelog tests: 23 passed.
- Agent-runtime TypeScript build and no-emit check: passed.
- Desktop no-emit TypeScript check: passed.
- Required dependency TypeScript builds and Electron/Vite production build:
  passed. The final renderer was checked for the new changelog text before
  final Team validation.
- Biome lint and desktop style-token lint: passed.
- Release-document alignment and `git diff --check`: passed.
- Remote-main ancestry: passed via `node scripts/check-pr-base-main.mjs`
  after fetch and rebase (already up to date).

The host's pnpm 12.8.1 script entry point attempted dependency repair and
rejected the linked `.pnpm` hoist directory. No dependency installation was
performed. Equivalent package scripts were executed directly with the existing
host binaries: `node node_modules/typescript/bin/tsc -p tsconfig.json`
(adding `--noEmit` for typechecks),
`node node_modules/vitest/vitest.mjs run <test files>`,
`node node_modules/electron-vite/bin/electron-vite.js build`,
`node node_modules/@biomejs/biome/bin/biome lint`, and
`node scripts/check-style-tokens.mjs`. Exact pnpm wrappers are not reported as
passing.

## Task-candidate E2E

Task candidate: `dffcfa70e3d9458e8e60e2566b1ea12bb35f96b0`

Base main: `ea54319c379e77e6117c828f10abf8d4f25c1ab3`

E2E suites:

- `node scripts/e2e-subagent-models.mjs`
- `PI_DESKTOP_HOST_BIN=<primary checkout>/target/debug/pi-desktop-host-core node scripts/e2e-team.mjs`

Result: PASS for both suites (exit code 0). Team was run after rebuilding the
renderer from the candidate's final shared changelog output.

Environment: macOS, Node 22.23.2; request worktree
`/Users/sakurasep/.codex/worktrees/delegation-by-mode/PI-Desktop`; primary
checkout's existing external dependencies and Electron reused by links, with
workspace package links resolving to the request worktree. Runtime, shared and
Desktop outputs were built in the request worktree. The unchanged host-core
binary was reused from the primary checkout. Team E2E used temporary HOME,
workspace, Host data and Chromium profile with a deterministic loopback
provider; no user's running Desktop or real provider was used.

The standard fixture confirms provider steering, tool isolation, a real
sidecar Task launch and explicit-ID TaskWait report convergence. Explicit IDs
also work when the child settles before TaskWait begins. The Team fixture
checks the execution Lead prompt and isolated tool catalog, approved expert
board workflow, visible lead-only reason, standard/Team coexistence, mailbox
restart/resume and rendered Team navigation. Runtime tests cover disabled
subagents and all four Task-family execution denials in Plan/Goal.

## Verification limits

- Real-provider behavioral validation: NOT RUN; no authorization to call a
  real provider or incur cost. Prompt guidance cannot guarantee delegation or
  establish real-model token/latency impact.
- Multi-worker parallel acceptance in the new named E2E scenarios: NOT RUN;
  representative E2E paths use one active worker, complemented by existing
  runtime lifecycle and concurrency coverage.
- PR integration E2E: NOT RUN; no push, PR or merge was requested.
- `verify:ui:*`: NOT RUN; not requested. The isolated existing Team E2E is
  separate from these commands.

The initial standard fixture incorrectly waited without an ID after its child
had already settled; default TaskWait selects running children. The fixture
was corrected to use the returned ID. The initial Team assertion also applied
execution steering to the planning Lead; it was restricted to the execution
Lead prompt. Neither finding required a production behavior change.

The primary checkout remained clean on `main`. No remote branch was pushed,
no PR was created and no merge or release was performed.
