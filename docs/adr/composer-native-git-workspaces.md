# ADR: Composer native Git workspace navigation

- Status: Accepted (local implementation)

## Context

The composer footer needs project, branch and execution-directory menus. A label
alone cannot provide a safe Worktree mode, and the existing session `mode` already
represents agent/chat/plan behavior. Renderer shell execution would violate the
frozen native-state ownership boundary.

## Decision

Host Core reads the Git worktree registry and performs bounded, non-destructive
native Git operations behind additive IPC/RPC contracts. `projectPath` remains
the session execution root. Linked checkouts are allocated beneath the app data
worktree directory, with no duplicate database registry or new session mode.
Project and directory navigation reuse the existing new-session workflow.

Branch mutations verify the session/workspace owner, idle checkout, expected HEAD
and branch, and staged/unstaged/untracked cleanliness. Git runs with argv rather
than a shell, no network protocol, no repository hooks or executable filters. Repositories requiring file
conversion are explicitly refused for mutations; disabling conversion is not
reported as a usable checkout. Effective checkout roots must contain the project
path. Read-only metadata releases the global state lock before Git I/O.
The controller binds async results to their original session and directory.

## Consequences

Old sessions, drafts and checkouts remain available after navigation. A successful
worktree is retained even if later navigation or metadata refresh fails; no hidden
cleanup removes work. Git remains an external requirement. This workflow does not
perform remote branch management, push, automatic stash, destructive cleanup or
SSH provisioning; the existing Remote Hosts page owns SSH connection behavior.
