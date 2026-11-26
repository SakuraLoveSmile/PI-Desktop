# PI-UI-1128: a shared sidebar row keeps its project name

Status: 待体验 (implemented and checked in the request branch; not released, and the installed
0.15.25 build still shows the old label). Project: `fork-pi-desktop`. Created: 2026-11-26 (Asia/Taipei).
Tier: T1 (renderer-only naming fix; no IPC, Host, protocol, storage, schema or locale change;
`docs/spec/04-ux/09-interaction-patterns.md` gains one paragraph).
Baseline: `6a51b5d2f` (`origin/main`, v0.15.25).
Branch: `fix/20261126-pi-ui-1128-sidebar-shared-project-name`.
Worktree: `/Users/sakurasep/Documents/Code/Project/Project Worktree/fork-pi-desktop/20261126-fix-pi-ui-1128-sidebar-shared-project-name`.
Ids: PI-UI-1128 is provisional.

## Request and source

The user sent a crop of the sidebar: the row label read `plan`, while hovering that row showed the
path `/Users/sakurasep/Documents/Code/Project/Personal Project/MediaPlayer`, and every MediaPlayer
task sat inside that row (「文件夹的名称和侧边栏显示不一致，侧边栏都收入这个 plan 中了」).

## Root cause

Measured against the running app's own data (`~/.pi-desktop-plus/pi.sqlite`, its
`projectMemorySpaces`/`projectMemoryCheckouts`/`projectMemorySessions` records, and the renderer's
`pi.desktop.sidebarPreferences` in Local Storage), with `buildSidebarMemoryProjects` ported and fed
the real groups and sessions:

- MediaPlayer's checkouts collapse into one row keyed by the primary checkout
  (`…/Personal Project/MediaPlayer`) whose name comes from the shared project identity: `MediaPlayer`.
- Four `kanpilot plan …` tasks belong to planning worktrees (`…/managed-worktrees/<task>/plan`). Two of
  those worktrees were pruned and are no longer registered, so `project_memory_projects::list` leaves
  their project rows without a memory identity, and `memoryProjectForPath(groups, path)` finds no
  memory group for that path. They still enter the MediaPlayer row through the memory id the Host
  recorded on the session (`memoryProjectId`).
- Treating that session as a legacy single-checkout project, the row-name fallback in
  `memory-projects.ts:128-131` adopted the session's stored project name — the planning worktree's own
  project row, literally named `plan` — and renamed the shared row. The row kept the primary checkout
  path, which is exactly the label/path mismatch in the screenshot.

Reproduction before the fix: 1 MediaPlayer row, `path=…/Personal Project/MediaPlayer`, 14 sessions,
`name=plan`; it was the only row in the whole sidebar whose name differed from its path basename.

## Behavior change

A row that carries a shared memory identity keeps the Host-verified project name (or the rename saved
for that project): the legacy name adoption now requires `!entry.memoryProject`, next to the existing
"the session's path resolves to no memory group" and "the row still shows its path basename"
conditions. Single-checkout rows keep the old behavior, so a project row created from one folder still
takes the project name its Host-persisted session carries.

Files:

- `apps/desktop/src/lib/memory-projects.ts`: the name-adoption guard plus the reason in a comment.
- `apps/desktop/test/memory-projects.test.mjs`: regression case for a pruned `plan` checkout whose task
  remembers the shared memory identity.
- `docs/spec/04-ux/09-interaction-patterns.md`: §1.6 states which name a collapsed row carries.

## Unchanged

Row identity, grouping, checkout membership, archive state, sorting, session ownership, the Host's
memory records, the protocol, and the renderer's project rename action. Nothing migrates and no stored
label is rewritten; only the presentation of an already-collapsed row changes.

## Checks

| Check | Command | Result |
| --- | --- | --- |
| Regression before the fix | `node --test test/memory-projects.test.mjs` | 11 passed, 1 failed: `expected 'MediaPlayer', actual 'plan'` |
| Focused tests after the fix | `node --test test/memory-projects.test.mjs` | 12 passed, 0 failed |
| Live-data reproduction | `node /tmp/pi-emulate.mjs` (real groups, spaces, sessions, sidebar preferences) | before: `name=plan` on the MediaPlayer row; after: `name=MediaPlayer`, no row name/path mismatch |
| Desktop suite | `cd apps/desktop && node --test test/*.test.mjs` (after `pnpm build:js`) | 4564 tests, 4560 passed, 0 failed, 4 skipped |
| Type check | `pnpm --filter @pi-desktop/desktop typecheck` | clean (`tsc --noEmit`, exit 0) |
| Style tokens | `pnpm --filter @pi-desktop/desktop lint` | `style tokens OK` |
| Test quality | `pnpm check:test-quality` | passed; the per-file/case baseline is untouched |
| UI verification in the installed app | — | NOT RUN: the installed 0.15.25 build predates this change |
| Candidate E2E on a packaged build | `pnpm test:e2e*` | NOT RUN: the cloud candidate is built at release time |

Worktree toolchain: the fresh request worktree had no `node_modules`, so `pnpm install --offline --ignore-scripts`
reused the shared store (842 packages, 2.3s); `pnpm-lock.yaml` was restored afterwards, so the branch
carries only the four files below.

## Risks and open decisions

- The shared row now always shows the memory project's name. A user who renamed a single checkout and
  expects that name on the collapsed row keeps seeing the project-level name; the renamed checkout's
  own label stays in Edit project.
- The rows of the two pruned `plan` worktrees remain in `projects` with no memory identity. They are
  the reason such a session can still match by memory id; pruning them from the Host is a separate
  cleanup with its own data-loss question.
- Verified in the request worktree only; the label changes after a new build is installed.
