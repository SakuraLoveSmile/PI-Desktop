# PI-KP-1110: Show a dispatched worktree task when its shared project is archived

- Project: `fork-pi-desktop`; task ID: `PI-KP-1110`; tier: T1; status: 待体验.
- Created: 2026-11-10 (Asia/Taipei).
- Authoritative record: this file. Linked evidence only supplements it.
- Goal / authorization: the user reported "KaneoPilot 派发任务之后 侧边栏不显示"
  on 2026-11-10 and asked for a fix. Scope is the renderer presentation of the
  home sidebar; no commit, push, PR, or release was requested.
- Baseline: `fbd37eb2df15c77a9f887e17dc716d995b84f32f` (`origin/main`).
- Branch: `fix/20261110-PI-KP-1110-sidebar-archived-worktree`.
- Worktree:
  `/Users/sakurasep/Documents/Code/Project/Project Worktree/fork-pi-desktop/20261110-fix-PI-KP-1110-sidebar-archived-worktree`.
- PR: [#83](https://github.com/SakuraLoveSmile/PI-Desktop/pull/83), opened
  2026-11-10 against `main`.
- Target: remote `main` (not landed; merge not authorized).

## Problem statement

KaneoPilot dispatches a task by creating a session over the loopback MCP control
plane in a fresh worktree of the target repository, then prompting it. The
desktop opens that worktree and selects the session, but the sidebar showed no
row for the task.

The maintainer's profile reproduced it with host data alone: the repository's
checkouts share project memory, the primary checkout was archived earlier, and
the dispatched worktree was opened but never archived. `Sidebar` collapses the
shared checkouts into one row keyed by the primary checkout and previously read
the archive flag from that key, so `showArchived: false` filtered the whole row
out. Any KaneoPilot task in a repository whose primary checkout is archived was
invisible, even though the app had just activated the worktree.

## Root cause

`buildSidebarMemoryProjects` copied `projectMeta[key]` — the primary checkout's
record — onto a row that represents a different, open checkout. Visibility used
`entry.meta.archived`, so the archived primary hid the fresh worktree. The
mirror defect also existed: the sidebar's Archive/Restore actions wrote
`entry.path` (the key), while visibility read the key as well, so archiving the
open worktree never registered.

## Scope

1. `apps/desktop/src/lib/memory-projects.ts`: the grouped row derives its
   archive flag from the checkout it represents (`actionPath`); name, pin,
   fold, and order state stay keyed by the logical project.
2. `apps/desktop/src/components/Sidebar.tsx`: Archive and Restore write the
   same checkout path the row reads.
3. Spec and E2E updates: `04-ux/09-interaction-patterns.md` (archive bullet),
   ADR 0294 amendment, decisions log D643, E2E-048.
4. Regression tests in `apps/desktop/test/memory-projects.test.mjs`.

Frozen: no host protocol, SQLite schema, IPC, i18n, or packaging change; the
primary checkout's archive flag is neither cleared nor rewritten.

## Acceptance scenarios

1. A worktree of a shared-memory project whose primary checkout is archived,
   opened by the user or by an external dispatch, renders its task row.
2. Opening the archived primary checkout still hides its row.
3. Archiving the checkout a grouped row represents hides the row, and Restore
   brings it back.
4. Non-grouped projects keep their previous behavior.

## Validation

- `node --test apps/desktop/test/memory-projects.test.mjs`: 10/10 pass; the two
  new archive cases failed before the change (2026-11-10).
- Full desktop suite (`node --test test/*.test.mjs`): 4385 tests, 4381 pass,
  0 fail, 4 skipped.
- `tsc -p tsconfig.json --noEmit` in `apps/desktop`: clean.
- `scripts/check-test-quality.mjs`: pass (no new source/CSS assertions).
- `scripts/generate-scenario-index.mjs --check`: current.
- Real host data check (temporary copy of the maintainer's database, deleted
  afterwards): before the change the dispatched session's group was filtered
  out; after it the group is visible with the dispatched session, while the
  explicitly archived checkouts stay hidden.
- NOT RUN: Electron E2E of a real KaneoPilot dispatch and packaged-app manual
  verification. The report path is renderer grouping; the cross-process MCP
  event and host behavior are unchanged, and the user should confirm the
  packaged app (`待体验`).

## Remaining work

- The user should confirm the dispatched task now appears in the sidebar in the
  packaged app (`待体验`).
- Commit, push, PR, and release only on explicit user authorization.
