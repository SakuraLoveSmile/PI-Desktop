# ADR 0037: Resolve project instructions in Electron main

- Status: Accepted
- Date: 2026-07-30
- Related: [Agent runtime](../spec/03-runtime/02-agent-runtime.md)

## Context

PI-Desktop initially loaded only `<project root>/AGENTS.md` at runtime
creation. That omits directory-specific rules in monorepos and provides no
compatibility path for projects that use `CLAUDE.md`. Letting the model-driven
agent sidecar scan the workspace would weaken the existing boundary that keeps
workspace file access in Electron main and host-core.

## Decision

1. Electron main resolves instructions only inside the session-bound project
   root; it never follows an instruction file whose canonical path escapes that
   root.
2. The global file `~/.pi/agent/AGENTS.md` is loaded before all project
   entries. Settings manages this fixed path. A project's `AGENTS.md` is
   managed from that project's list-menu action in either the Projects view or
   the home sidebar; dedicated IPC accepts only a project root registered by
   host-core and never an arbitrary file path.
3. For every project directory, the first non-empty candidate wins in this order:
   `AGENTS.override.md`, `AGENTS.md`, `CLAUDE.md`,
   `.claude/CLAUDE.md`.
4. Sources are concatenated from root to target directory, capped at 32 KiB of
   UTF-8 content. Later, closer entries take precedence and each source is
   labelled in the prompt.
5. The root chain is loaded when the runtime is created. Before a file-path
   tool executes, the sidecar may request a path-specific chain through the
   Electron-owned `project.instructions.resolve` local proxy. The sidecar does
   not read instruction files directly.

## Consequences

- Repository-wide rules load without a recursive workspace scan.
- Global defaults are editable without a project; project instructions remain
  reviewable and versionable in the repository root.
- Nested rules become available only when an agent accesses a matching path.
  Each file tool replaces the active chain with that target's complete chain,
  preventing sibling-directory rules from leaking into later tool calls.
- Root instruction changes rebuild an idle runtime on the next prompt. Nested
  rules are re-resolved for future file-path tool calls.
- This private sidecar proxy remains constrained to a session id and a path
  that Electron main validates against that session's project root.

## Alternatives

### Load every nested instruction file at startup

Rejected. Large monorepos could inject unrelated rules and consume the model
context before the task identifies a relevant directory.

### Let the sidecar scan the workspace

Rejected. The sidecar executes model-directed paths. Workspace discovery stays
in Electron main so the existing containment boundary remains explicit.
