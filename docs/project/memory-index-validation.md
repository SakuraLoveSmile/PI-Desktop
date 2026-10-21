# Plus project context validation — 2026-10-08

> Historical pre-integration evidence. Later integration commits and package
> qualification supersede the original uncommitted-delivery status below.

T1 (automatic project memory), T2 (source-linked historical recall), and T3
(local literal code search) are ready for user evaluation. No release, install,
commit, push, or merge was performed. The primary checkout remains clean.

## Candidate

- Branch: `codex/memory-code-index`.
- Worktree: `<worktrees>/memory-code-index/PI-Desktop`.
- Base and latest fetched origin/main: `05dc95412028d7e5a9bcedbb03e2d01f795da21a`.
- Candidate: that base plus the uncommitted task files.
- Executable/task-file SHA-256 manifest fingerprint (excluding docs):
  `609601c3d28b96b49257b1fffa05d9851a72482d7502e8b319274a3f6a2203ea`. No tested-commit claim is made because committing requires
  an explicit user request. `check:pr-base` and base ancestry passed.

## Current-run evidence

- Real Node sidecar → parent Host proxy → Rust/SQLite, using only a local
  deterministic HTTP model: memory opt-in write, snapshot conflict, historical
  search/read with source IDs, code search, disabled-write/read retention,
  other-project isolation, both-process restart recall, and exact request count
  proving no added background model calls. `e2e-project-context.mjs` passed.
- CodeSearch tool → real isolated Host/filesystem: literal/short/CJK/Unicode
  results, caller-root isolation, forged bindings, same-size changes, file
  create/rename/delete, changed ignore rules, sensitive-file/global-ignore
  exclusions, escaping symlinks, partial-coverage/output limits, invalid inputs,
  persistent cache restart and explicit clear/rebuild. `e2e-code-index.mjs` passed.
- Production editor and production CSS in isolated Electron with fixture IPC:
  39 user-interaction checks passed, including draft-preserving conflicts,
  real-shaped error envelopes, stale responses, group-owner changes and narrow
  360/520px control reachability. `e2e-project-auto-memory.mjs` passed.
- Main agent browser check: Chinese light/dark editor, opt-in enabled while
  retaining an unsaved draft, Save, close/reopen and retained saved content.
  This used the production component with fixture IPC, not the installed app.
- Agent Runtime: full 1,429 tests passed. After the final preflight-cancellation
  fix, its 364 affected tests and final 13 focused tests passed. Host Runtime:
  full 149 tests passed. Shared: full 1,290 tests passed. i18n: 30 tests passed.
  Desktop affected contracts/model checks: 11 passed.
- Host: full 950 tests passed before the final review fixes. After those fixes,
  affected suites passed: memory 21, history 4, code RPC 2, index 9, session
  search 8, relocation 8 and the real expert RPC user path 1.
- All workspace build scripts were executed through the already provisioned
  underlying tsc/Electron-Vite/VitePress tools. Desktop typecheck, Biome lint,
  style tokens, docs links/locale pairs, agent-policy sync, Rust formatting,
  Host build and clippy passed. Clippy retains two existing argument-count
  warnings; Desktop/docs builds retain existing chunk-size warnings.
- Independent review found two defects (root reattachment resurrecting old
  notes and conflict-code/UI mismatch); failing baselines were established,
  both were fixed and reviewed again with no remaining material findings.

## Reproduction

With the request packages built and an explicitly selected candidate Host binary:

```sh
node scripts/e2e-project-context.mjs
node scripts/e2e-code-index.mjs
node scripts/e2e-project-auto-memory.mjs
```

`PI_DESKTOP_HOST_BIN` can select the reused Cargo-target candidate binary. Tests
create disposable profiles, databases and workspace files, and do not use a paid
provider. The existing host dependencies/caches were reused without installation.
The pnpm wrapper attempted automatic dependency verification against symlinked
node_modules and rejected the linked hoist directory. We then invoked the same
existing build/test tools directly; `pnpm build:js` itself is not reported green.

## Experience and limits

Open Project archive → project row menu → Project memory, enable Automatic
recording, then ask the Agent to remember a stable preference. Ask to recall an
earlier verification/discussion to use ProjectHistory, or to search a literal
phrase in project code to use CodeSearch. CodeSearch also supports explicit
status/clear requests. Recording defaults off and does not call a separate
extraction model.

The first index is text-based and reconciles/hash-checks files on every search;
no semantic-search or speedup claim is made. Partial results are marked explicitly.
History only includes saved Host-owned Desktop chats in the current group, not
native Pi sessions or a global personal-memory store. Existing expert tool
subsets and Plan research restrictions still limit these tools. Clear is denied
in Plan/Goal; cache deletion is not secure erasure.

Real-provider behavior, the installed full-app experience, native Windows/Linux
execution and remote publication were not tested. The feature is ready for local
user evaluation, not a release or user acceptance claim.
