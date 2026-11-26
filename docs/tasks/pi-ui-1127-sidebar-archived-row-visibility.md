# PI-UI-1127: the sidebar keeps the row of the task on screen

Status: 待体验 (implemented, checked, and released as 0.15.25 in the same request branch; the installer is built by the cloud release workflow). Project: `fork-pi-desktop`. Created: 2026-11-26 (Asia/Taipei).
Tier: T1 (renderer-only visible change; no IPC, Host, protocol, storage or locale change; `docs/spec/04-ux/09-interaction-patterns.md` gains one sentence).
Baseline: `30f7b74c1` (`origin/main`, v0.15.24).
Branch: `fix/20261126-pi-ui-1127-archived-sibling-row`.
Worktree: `/Users/sakurasep/Documents/Code/Project/Project Worktree/fork-pi-desktop/20261126-fix-pi-ui-1127-archived-sibling-row`.
Ids: PI-UI-1127 is provisional.

## Request and source

The user reported a running Goal task that never appeared in the left sidebar: the window showed
the MediaPlayer transcript with `目标进度 0/8 … 执行中`, while the sidebar showed only
「会话 → 暂无临时对话」 and 「项目 → 打开项目」. The ask was to fix it.

## Root cause

Measured against the running app's own data (`~/.pi-desktop-plus/pi.sqlite`, the renderer's
`pi.desktop.sidebarPreferences` in Local Storage, and the control plane's `pi_project_get`):

- The displayed session `8de68aec…` belongs to project 48
  (`…/personal-kaneopilot/managed-worktrees/qnf4drf38c7gn4qjbs4nfuf4/run`, name MediaPlayer), and
  the Host reports that same directory as the active workspace, so `workspace` is not null.
- 38 project tabs are open. Their checkouts collapse into four shared-memory rows (Music,
  MediaPlayer, DedupeProbe, AsmrDownloader); in the MediaPlayer row 4 of 15 open checkouts carry
  `projectMeta[path].archived = true` (older `release-verify-*` worktrees and one `…/plan`).
- `buildSidebarMemoryProjects` reports a grouped row as archived while **any** checkout it keeps
  open is archived (`apps/desktop/src/lib/memory-projects.ts:140-148`), and the sidebar filters
  archived rows out unless Show archived is on (`Sidebar.tsx:726`). All four rows were archived,
  so `projectEntries` was empty and only the 「打开项目」 empty state rendered.
- A project row is created only from open tabs, the active workspace and memory groups; sessions
  never create rows (`memory-projects.ts:115-133`). A hidden row therefore removes every task it
  holds, including the task running in the window's own checkout.

Reproduction with the live data (`openProjectPaths`, `projectMeta`, project-memory spaces and
sessions read from the running app): 4 rows built, 0 visible, the running task listed in none.

## Behavior change

`visibleSidebarProjects()` keeps an archived project row when it holds the conversation currently
displayed — matched by the session's project path against the row's checkouts, or by the displayed
session already being one of the row's sessions. The row keeps its archived presentation, so its
Restore action still clears the archived checkouts it holds; other archived rows stay hidden as
before, and Show archived still reveals all of them.

Files:

- `apps/desktop/src/lib/sidebar-session-groups.ts`: `sidebarRowHoldsProjectPath()` and
  `visibleSidebarProjects()`.
- `apps/desktop/src/components/Sidebar.tsx`: the project-row filter goes through the new helper and
  depends on the displayed session's project path.
- `apps/desktop/test/sidebar-session-groups.test.mjs`: the exemption, the no-context case, Show
  archived, normalized paths and the session-membership fallback.
- `docs/spec/04-ux/09-interaction-patterns.md`: the Archive bullet states the exemption.

## Unchanged

Archive/restore writes, the Host, the protocol, the SQLite schema, archived-row sorting, the
「打开项目」 empty state and the rule that rows come from tabs rather than history.

## Checks

| Check | Command | Result |
| --- | --- | --- |
| Reproduction on live app data | `node /tmp/sidebar-verify.mjs` (real `openProjectPaths`, `projectMeta`, project-memory spaces, sessions) | 4 rows built, 0 visible; after the change the MediaPlayer row holding the displayed session is visible |
| Focused tests | `node --test test/sidebar-session-groups.test.mjs test/memory-projects.test.mjs` | 28 passed, 0 failed |
| Desktop suite | `cd apps/desktop && node --test test/*.test.mjs` (after `pnpm build:js`) | 4563 tests, 4559 passed, 0 failed, 4 skipped |
| Renderer build | `pnpm build:js` (runs `electron-vite build` for `apps/desktop`) | built |
| Type check | `pnpm --filter @pi-desktop/desktop typecheck` | clean |
| Style tokens | `pnpm --filter @pi-desktop/desktop lint` | `style tokens OK` |
| Test quality | `node scripts/check:test-quality.mjs` | passed; baseline untouched |
| UI verification in the installed app | — | NOT RUN: the installed 0.15.24 build predates this change and the agent does not drive the desktop UI |
| Candidate E2E on a packaged build | `pnpm test:e2e*` | NOT RUN: needs a packaged candidate built on a cloud runner |

## Release

The request branch also carries the 0.15.25 preparation: `node scripts/release.mjs 0.15.25` bumped
`package.json`, `docs/package.json`, `apps/*/package.json`, `Cargo.toml`, `Cargo.lock` and
`packages/shared/src/protocol.ts`; `packages/shared/src/plus-changelog.ts` gained the 0.15.25 note in
all nine shipped locales (one highlight each); `changelog.test.ts` and `plus-changelog.test.ts` list
0.15.25 first. `node scripts/check-release-docs.mjs 0.15.25` passes and the shared package suite is
green, so the tag can follow the merge.

## Risks and open decisions

- The deeper state stays as it is: four rows are archived because one archived checkout each keeps
  them hidden, so only the row holding the open conversation comes back. Making a row archived only
  when **every** checkout it holds is archived would restore the other three rows too, but it
  changes the documented archive rule and needs Archive to write every open checkout; that is a
  separate decision.
- Verified in the request worktree only. The user's installed 0.15.24 build still shows the old
  behavior until a new build is installed.
