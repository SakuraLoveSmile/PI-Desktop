# 01. Security

> Language: English (per ADR 0009). Statuses reflect the implementation as of
> M5 hardening. Cross-references: [logging](../03-runtime/09-logging-and-observability.md)
> · [process model](../03-runtime/07-process-model.md) · [plugin security](../07-plugins/04-plugin-security.md)

## 1. Security goals

1. The renderer must never gain unconstrained system access
2. Protect provider API keys
3. Bound the blast radius of agent tool execution
4. Keep sensitive operations auditable

## 2. Electron baseline

Required (all **implemented**):

- `contextIsolation: true`
- `nodeIntegration: false`
- `sandbox: true` — the preload is a fully bundled CJS file with no runtime
  module resolution, verified end-to-end by `test:e2e:boot`
- No remote module (Electron ≥ 14 default)
- Navigation locked down: `setWindowOpenHandler` denies and forwards to the
  OS browser; `will-navigate` blocks all non-dev-server navigations
- Preload exposes a whitelist-checked `invoke`/`on` bridge only
  (`IPC_WHITELIST` enforced on both preload and main sides)

### Content Security Policy

- Dev: `script-src 'self' 'unsafe-inline' 'unsafe-eval'` (required by Vite
  HMR tooling), localhost websocket connect-src.
- Production build: `'unsafe-eval'` and localhost connect-src are stripped
  at build time (`tightenCsp` plugin in `electron.vite.config.ts`);
  `connect-src 'self'` only. Provider network traffic happens in the Node
  sidecar, never in the renderer.

### Future hardening (tracked, post-MVP)

- Electron fuses (`runAsNode`, `nodeCliInspect` off) at package time
- `webSecurity` assertions in an automated security e2e

## 3. Secrets

- Keys stored via Electron `safeStorage` encryption, managed by host-core
  (see [14-secrets-storage](../03-runtime/14-secrets-storage.md))
- UI shows configured/not-configured only; never echoes key material
- Logs must never contain secrets: Logger redaction (key-name patterns +
  `sk-`-style token pattern) in Electron main, `redact_value` in host-core
  audit writes; verified by the no-secret-leak smoke check
- Error messages must not echo full keys

## 4. Workspace sandbox

- File tools are restricted to the project root by default
- Path normalization + root boundary check in host-core
  (`workspace::tests::blocks_escape` covers escape attempts)
- Symlink targets outside the root are rejected when detectable

## 5. Command execution

- Bash requires confirmation by default (risk-tiered permission cards)
- Timeouts are mandatory; output truncated at 256KB / 4000 lines with the
  `[truncated: output exceeded 256KB or 4000 lines]` marker
- Full command line recorded in the audit log (SQLite, redacted)
- Allowlist/denylist refinement is a tracked follow-up
  ([03-tools-and-permissions](../03-runtime/03-tools-and-permissions.md))

## 6. Supply chain

- Dependency versions locked via `pnpm-lock.yaml` / `Cargo.lock` committed
  to the repo; upgrades are explicit commits
- Prefer official pi packages
- No remote script execution for plugins in MVP (local install only, D009)

## 7. Application update security (D120)

- Electron Main owns `electron-updater`; renderer IPC cannot provide or
  override the fixed HTTPS GitHub owner/repository or releases URL.
- The updater forces `allowPrerelease = false` so discovery always uses
  GitHub's latest stable release rather than a same-channel prerelease pin.
- Feed manifests bind artifacts with electron-builder hashes. An error,
  unavailable feed, hash mismatch, or invalid updater state must not install.
- Packaged macOS is manual-only: it detects a release and opens the fixed
  releases page, but never downloads or installs it in-app. Enabling a signed
  macOS in-app channel requires a later explicit decision and qualification.
- D126 tag releases publish Windows NSIS and Linux AppImage installers plus
  their update manifests, activating those in-app lanes. Platform signing,
  rollback, and staged-rollout qualification remain release follow-ups.
- The client carries no GitHub token. A private or otherwise unreachable feed
  fails closed; automatic failures stay ambient and explicit checks expose the
  error.
- The Developer ID + notarization lane remains documented in the
  [release runbook](../06-delivery/06-release-runbook.md).

## 8. Host process attack surface

- host-core speaks NDJSON JSON-RPC on stdio to the Electron main process
  only; it binds no network ports
- The agent sidecar reaches host services only through the main-process
  proxy (`host.proxy`), which enforces a **method allowlist**
  (`tools.execute`, `tools.list`, `session.get`, `session.appendMessage`,
  `workspace.get`, `app.health`) — the sidecar cannot pull secrets or
  mutate providers/settings/plugins through the proxy
- host-core child processes (Bash tool) run with the user's privileges;
  containment relies on the permission layer, not OS sandboxing (documented
  limitation for MVP)

## 9. Threat model (summary)

| Threat | Mitigation |
|---|---|
| Malicious web content in renderer | no Node, sandbox, navigation lock, CSP |
| Prompt-injected destructive tool use | permission confirmation, path boundary, secret isolation |
| Dependency poisoning | lockfiles, few deps, native-module review |
| Malicious local plugin | declared permissions, no secret access, process isolation tracked post-MVP (ADR 0008) |

## 10. Security acceptance gates

1. Renderer cannot `require('fs')` (sandbox + no nodeIntegration) — verified
2. Write/Edit/Bash cannot run without confirmation — verified (M3)
3. Writing outside the workspace fails — verified (host tests)
4. API keys never appear in plaintext in exports/logs by default — verified
5. Non-whitelisted IPC channels are rejected — verified (M1)
