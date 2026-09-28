# Remaining worktree closeout (2026-09-28)

This ledger compares the older local worktrees with fork `origin/main` at
`ed45a085275cd3855f049f07cb22051d28e6660e`. It records source disposition,
not permission to discard a checkout. The primary `main` remains at
`ea0b9685e3087cde044b167c4a9687c3450bc125` with 13 modified and four
untracked paths. The v0.15.9 upstream port has its own candidate and is outside
this closeout.

| Source worktree | Outstanding local content | Disposition against `origin/main` |
| --- | --- | --- |
| `goal-team-closeout` | 121 modified paths, 38 untracked entries | PR #1/#2/#4 absorbed Goal, Team, Temporary Goal, and RACP foundations. The old Team DTOs and report read model would regress current permissions and report states. Two Goal Report integrity gaps are repaired in this request: execution finalization must not publish after a failed session transcript barrier, and a terminal report must reject a late draft. Preserve the old tree. |
| `feat-transcript-answer-first` | 64 modified paths, 12 untracked entries | Its answer-first, title, and usage commits are ancestors of `origin/main`. Remaining Team/UI files duplicate older work; current Team IPC, roster/board revision checks, and Goal Report card must remain. Preserve the old tree. |
| `feat-mcp-turn-get` | Ten modified paths | PR #3 already provides Host `session.getTurn`, Electron IPC, `pi_turn_get`, cross-session checks, and restart E2E. No second implementation is needed. Preserve until its owner retires it. |
| `kaneopilot-plus-mcp` | 13 modified paths | Alternate old `turn/get` code and documentation are covered by PR #3's current contracts and tests. Do not install a parallel MCP tool. Preserve until its owner retires it. |
| `kaneopilot-goal-report-naming` | Two commits outside main's ancestry; one untracked `node_modules` symlink | `12094aa07` and `92745a4c6` were adapted into PR #2 as `87d189084` and `6f839253f`. Current main has read-only report access, durable project names, and failed-draft propagation. Do not cherry-pick the old SHAs or commit the dependency link. |
| `fix-temporary-goal` | Untracked `apps/apps/demo/weather.html` | Its feature commits are in main. The HTML is an unreferenced local demo, not a Goal dependency; preserve it outside the PR. |
| `feat-goal-completion-report` | Clean | Its HEAD is an ancestor of main; no action. |
| Three plan-only worktrees | One untracked Markdown file each | `goal-team-closeout-plan`, `worktree-main-integration-plan`, and `codex-chat-modes-ux-plan` remain planning records, not feature patches. |

The primary checkout's 13 tracked changes are not the remote contract: they
include dot-form `goalReports.*` RACP names where current main uses slash-form
operations, drop `REPORT_PERSISTENCE_BARRIER_FAILED` and permission mapping,
and weaken the PR #4 Retry lock. Its four input-history files overlap the
separate upstream-port task; that task's test also covers a session-switch race.
No primary file was copied or removed. Local `main` must remain unsynchronized
until these paths have a recoverable, owner-approved disposition.

The old `goal-team-closeout` Composer hides Team selection for remote and
`pi-native` sessions. Current product specs do not define that capability
boundary, so this is not an approved behavior change in this PR. The old
checkpoint-failure barrier is also excluded: a failed streaming checkpoint
does not invalidate a later durable final transcript. RACP's old
`authorizeSessionAccess` checks role and session existence, but adds no
principal-to-session ACL; Host report reads already bind report identity to
the requested session. Neither is a verified security fix to transplant.

This request's candidate must pass Goal Report runtime, Host, and real Host RPC
tests on its committed head. Other worktrees and the primary checkout remain
untouched; archive or remove them only after their owners verify the retained
content and authorize retirement.
