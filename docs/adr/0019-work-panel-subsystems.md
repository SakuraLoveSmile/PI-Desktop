# ADR 0019: Work panel subsystems (PTY terminal, embedded browser, git review, file browsing)

- Status: Accepted
- Date: 2026-07-26
- Deciders: PI-Desktop maintainers
- Related: [01-ui-ia](../spec/04-ux/01-ui-ia.md) ·
  [08-component-spec §5](../spec/04-ux/08-component-spec.md) ·
  [01-ipc-protocol §13a](../spec/03-runtime/01-ipc-protocol.md) ·
  decisions D097–D100, D128, D142 ·
  [ADR 0028](0028-session-scoped-work-panel-contexts.md)

## Context

The Codex-parity shell needs a docked right work panel with four backend
capabilities — Review (working-tree diff), Terminal (interactive), Browser
(preview), and Files (workspace browsing). Artifact-driven top tabs expose
those capabilities dynamically; multiple file resources may coexist. Each needs
a backend capability that the
sandboxed renderer cannot (and must not) implement itself. The existing
backends are host-core (Rust, tool execution with permission prompts) and
the Electron main process (window/OS integration, `gh` CLI spawns).

## Decision

All four backend capabilities are implemented in the **Electron main process**,
exposed only through the whitelisted IPC bridge, and scoped to the active
host workspace (`workspace.get`):

1. **Terminal — node-pty in main (D099).** One login-shell PTY per
   workspace path, owned by a `PtyManager`; xterm.js renders in the
   renderer. Sessions survive tab switches and panel close (renderer keeps
   xterm instances in a module cache; main keeps a 128KB replay ring for
   reattach after renderer reloads) and are killed on app quit. node-pty is
   N-API based; `pnpm-workspace.yaml` `allowBuilds` approves its build
   script, `electron-builder install-app-deps` (postinstall) covers ABI
   rebuilds, and `asarUnpack` ships the prebuilt binary. Fallback if source
   builds regress: `@homebridge/node-pty-prebuilt-multiarch`.
2. **Browser — WebContentsView in main (D100).** The recommended modern
   embedding (BrowserView is deprecated; `<webview>` is discouraged).
   Renderer measures the preview rect and syncs bounds over IPC. Hardening:
   popups open externally, all permission requests denied, navigation
   restricted to http(s), isolated `persist:` session partition. Because
   the view composites above the renderer, the renderer hides it whenever
   blocking overlays (command palette, permission dialog, settings
   takeover) are open; top-center toasts may overlap its corner — accepted.
3. **Review — git CLI in main (D098).** `git status`/`git diff` spawned in
   the workspace (same pattern as the `gh` pulls integration), parsed into
   typed hunks with per-file/patch caps. No libgit2/wasm dependency.
4. **Files — direct fs in main.** Read-only listing/reading with a
   resolve-within-root guard and the default ignore subset of
   [15-workspace-ignore-rules](../spec/03-runtime/15-workspace-ignore-rules.md).

## Alternatives considered

- **host-core tools (Read/Glob/Bash) as the backend** — rejected: those are
  agent tools wired to permission prompts, truncation limits, and audit
  rows; user-initiated UI browsing would spam prompts and pollute the audit
  trail. A future host RPC could replace the fs handlers without renderer
  changes.
- **`<webview>` tag for the browser** — rejected: officially discouraged,
  historical breakage across Electron majors; WebContentsView is the
  supported path despite its z-order caveat.
- **Command-replay terminal (agent Bash echo only)** — rejected by product
  decision: Codex parity requires a real interactive terminal.
- **PTY inside host-core (Rust)** — rejected for MVP: portable-pty adds a
  Rust dependency and a streaming RPC channel for high-frequency writes;
  the Electron main process already owns streaming push events.

## Consequences

- The renderer stays sandboxed; every new capability crosses the existing
  whitelist with typed payloads (protocol v2 additions).
- Agent Bash runs remain one-shot host-core executions; the panel terminal
  is the user's shell, not the agent's. Sharing a PTY with the agent is a
  future ADR.
- Native-module surface grows by node-pty (first native renderer-adjacent
  dep); build docs and packaging carry the asarUnpack/install-app-deps
  requirements.
