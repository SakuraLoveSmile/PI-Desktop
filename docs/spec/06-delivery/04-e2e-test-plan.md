# 04. E2E Test Plan

> Scope: MVP acceptance scenarios for PI-Desktop  
> Status: Accepted (protocol automation started; full desktop Playwright deferred to M5+)  
> Cross-references: [acceptance-criteria](02-acceptance-criteria.md) · [milestones](01-mvp-milestones.md) · [ai-development-workflow](03-ai-development-workflow.md) · [change-checklist](05-change-checklist.md)

---

## 1. Goals

- Document every user-visible and protocol-visible behavior that MVP must verify.
- Provide a scenario catalog that maps to acceptance criteria (A–H) and milestones (M1–M5).
- Serve as the traceability backbone: scenario ID ↔ acceptance criterion ↔ spec.
- Prepare for future automation without requiring implementation now.

## 2. Non-goals

- Full automated test suite in MVP phase (document scenarios first; automate later).
- Performance / stress testing (post-MVP).
- Windows/Linux release qualification (macOS arm64 remains the first-release
  acceptance platforms per D126; native qualification gaps remain documented).
- Plugin marketplace scenarios (post-MVP).
- Remote gateway / control-plane scenarios (post-MVP — ADR 0004 / baseline #20).

---

## 3. Test Pyramid

```
        ╱  E2E  ╲           — few, high-value, cross-system
       ╱ Integration ╲      — IPC/RPC contracts, host↔renderer
      ╱    Unit       ╲     — per-module, fast, isolated
```

| Level | Scope | Count target | Tooling |
|---|---|---|---|
| **Unit** | Single module, no IPC | Many | Vitest / Rust #[test] |
| **Integration** | IPC contract, host↔renderer, host↔sidecar | Moderate | Vitest + IPC mocks or live Electron |
| **E2E** | Full user journey through the desktop app | ~65 functional + US-UI visual catalog | protocol smoke + Electron probes now; Playwright later |

**Strategy**: document all E2E scenarios now; write unit/integration tests alongside code; automate E2E after M5.

---

## 4. Tooling Intent

| Tool | Purpose | Status |
|---|---|---|
| **Vitest** | Unit + integration (TS side) | Active (`pnpm test`, shared package) |
| **Rust #[test]** | Host-core unit tests | Active (`cargo test -p host-core`) |
| **Protocol smoke** | Host RPC + tools + plugins headless | Active (`test:e2e`, 15 checks) |
| **Electron probes** | Boot bridge + crash supervision | Active (`test:e2e:boot`, `test:e2e:supervision`) |
| **Playwright** | Full UI-driven journeys | Planned (post-M5) |

> Decision: document scenarios now; pick concrete E2E runner when code is ready for M5 hardening.

---

## 5. Environment Requirements

| Requirement | Detail |
|---|---|
| Platform | macOS arm64, Windows x64, and Linux x64 release targets (D126) |
| Profile | Clean `~/.pi-desktop` profile (no prior config) |
| Fixtures | Sample project directory (`examples/fixtures/sample-project/`) |
| Sample plugin | `examples/plugins/hello` loaded from local path |
| Provider | At least one provider with a valid key (test account) |
| Display | Headless-capable Electron or real display |

---

## 6. Scenario Template

Each scenario is documented in this format:

```markdown
### E2E-<ID>: <title>

- **Preconditions**: what must be true before steps start
- **Steps**: ordered list of user / system actions
- **Expected**: observable outcome that proves correctness
- **Specs linked**: relevant spec file(s)
- **Acceptance criterion**: which A–H letter(s) this verifies
- **Milestone**: M1–M5 target
- **Status**: Draft | Documented | Automated | Passed
```

---

## 7. MVP Scenario Catalog

### Boot & Healthcheck

#### E2E-001: App launches and shows main window

- **Preconditions**: macOS arm64; no prior `~/.pi-desktop` profile. For the
  development lane, workspace package build outputs are absent or older than
  their TypeScript sources.
- **Steps**: 1) Launch PI-Desktop. In the development lane, use `pnpm dev`.
  2) Observe main window appears.
- **Expected**: Development launch rebuilds all workspace dependencies before
  host-core and Electron startup. Window renders in English with the current
  locale catalog; no compile error, missing-menu runtime error, or crash;
  version info visible.
- **Specs linked**: `03-runtime/07-process-model.md`, `04-ux/01-ui-ia.md`
- **Acceptance**: A (app startup)
- **Milestone**: M1
- **Status**: Partially automated (`runtime-build-contract.test.mjs` covers the
  dependency build contract; Electron window launch remains Draft)

#### E2E-002: IPC bridge is functional

- **Preconditions**: App is running.
- **Steps**: 1) Trigger an action that calls preload IPC (e.g. version query). 2) Observe result in renderer.
- **Expected**: Main↔renderer IPC returns expected data; no error.
- **Specs linked**: `03-runtime/01-ipc-protocol.md`
- **Acceptance**: A (bridge normal)
- **Milestone**: M1
- **Status**: Automated (`scripts/e2e-electron-boot.mjs` — sandboxed preload bridge + IPC round-trip)

#### E2E-003: Rust host healthcheck responds

- **Preconditions**: App is running; Rust host-core sidecar started.
- **Steps**: 1) Electron handshakes with protocol version 5. 2) Call the host
  healthcheck RPC. 3) Repeat boot with version 4 and version 3 host fixtures.
- **Expected**: The version 5 host returns `ok` and the handshake is logged.
  The stale version 4 and version 3 hosts are rejected before chat becomes
  interactive, so notification records cannot be silently lost at turn
  completion.
- **Specs linked**: `03-runtime/05-host-core-rust.md`, `03-runtime/06-host-rpc-protocol.md`
- **Acceptance**: A (bridge normal)
- **Milestone**: M1
- **Status**: Automated (protocol smoke)

#### E2E-004: First-run inline checklist appears

- **Preconditions**: Fresh profile (no `~/.pi-desktop`).
- **Steps**: 1) Launch app on fresh profile. 2) Observe onboarding checklist.
- **Expected**: Inline checklist is displayed; provider/key items open Settings
  → Agent, and the optional plugin item opens the app-shell Plugins
  destination.
- **Specs linked**: `04-ux/05-onboarding.md`
- **Acceptance**: A (first-run checklist)
- **Milestone**: M2
- **Status**: Automated (protocol smoke: host onboarding state; UI checklist manual)

### Provider & Key

#### E2E-005: Add a provider and save API key

- **Preconditions**: App running; no provider configured.
- **Steps**: 1) Open Settings → Agent. 2) Open the add-provider dialog. 3) Enter name, base URL, model id, and API key. 4) Save.
- **Expected**: Provider appears as a card with secret badge; key stored securely (not in plaintext config); hero summary counts update.
- **Specs linked**: `03-runtime/12-provider-config-schema.md`, `03-runtime/14-secrets-storage.md`
- **Acceptance**: B (add provider, save key)
- **Milestone**: M2
- **Status**: Automated (protocol smoke: provider create + secret, no plaintext echo)

#### E2E-006: Key survives restart

- **Preconditions**: Provider + key configured.
- **Steps**: 1) Quit app. 2) Relaunch. 3) Open Settings → Agent → Providers.
- **Expected**: Provider still listed; key usable (no re-entry needed).
- **Specs linked**: `03-runtime/14-secrets-storage.md`
- **Acceptance**: B (key survives restart)
- **Milestone**: M2
- **Status**: Draft

#### E2E-007: No-provider blocking prompt

- **Preconditions**: App running; no provider configured.
- **Steps**: 1) Attempt to start a chat.
- **Expected**: Clear blocking prompt explaining that a provider must be configured.
- **Specs linked**: `04-ux/06-settings-ia.md`
- **Acceptance**: B (blocking prompt)
- **Milestone**: M2
- **Status**: Draft

### Chat Stream & Abort

#### E2E-008: New session and send message

- **Preconditions**: Provider configured.
- **Steps**: 1) Create new session. 2) Type a message. 3) Send.
- **Expected**: Message sent; assistant begins streaming response.
- **Specs linked**: `03-runtime/02-agent-runtime.md`, `03-runtime/10-session-state-machine.md`
- **Acceptance**: C (new session, send message)
- **Milestone**: M2
- **Status**: Automated (protocol smoke, live-model lane; requires PI_DESKTOP_TEST_API_KEY)

#### E2E-009: Streamed tokens visible in UI

- **Preconditions**: Session active; message sent.
- **Steps**: 1) Observe assistant response as it streams.
- **Expected**: Tokens appear progressively in chat UI; final response complete.
- **Specs linked**: `03-runtime/02-agent-runtime.md`
- **Acceptance**: C (streamed output)
- **Milestone**: M2
- **Status**: Automated (protocol smoke, live-model lane; requires PI_DESKTOP_TEST_API_KEY)

#### E2E-010: Abort generation

- **Preconditions**: Assistant is streaming a response.
- **Steps**: 1) Click abort/stop button during streaming. 2) Observe result.
- **Expected**: Stream stops; partial response preserved; session remains usable.
- **Specs linked**: `03-runtime/02-agent-runtime.md`
- **Acceptance**: C (abort)
- **Milestone**: M2
- **Status**: Draft

#### E2E-011: Switch between project and temporary sessions

- **Preconditions**: One retained project session and one path-less Temporary
  session exist.
- **Steps**: 1) Open the project session from its exact-path sidebar group. 2)
  Open the Temporary session. 3) Observe chat content and workspace chrome.
- **Expected**: The sidebar contains no Recents aggregate; retained projects
  have scoped groups and path-less sessions remain under Temporary; each
  transcript loads correctly; selecting Temporary clears project context and
  inherits no workspace access; both sessions remain persisted.
- **Specs linked**: `03-runtime/10-session-state-machine.md`, `04-ux/01-ui-ia.md`, `04-ux/08-component-spec.md`
- **Acceptance**: C (switch sessions)
- **Milestone**: M2
- **Status**: Draft

### Workspace Open

#### E2E-012: Open a project directory

- **Preconditions**: App running; no project open.
- **Steps**: 1) Open project directory via UI. 2) Select a local folder.
- **Expected**: Project path displayed; tool paths resolve relative to project root.
- **Specs linked**: `03-runtime/15-workspace-ignore-rules.md`
- **Acceptance**: D (open project, show path)
- **Milestone**: M3
- **Status**: Draft

#### E2E-013: Read-only tools work in project

- **Preconditions**: Project directory open.
- **Steps**: 1) Ask agent to read a file in the project. 2) Observe result.
- **Expected**: `Read`/`Glob`/`Grep` return correct results within project scope.
- **Specs linked**: `03-runtime/03-tools-and-permissions.md`
- **Acceptance**: E (Read/Glob/Grep work), D (tools based on project)
- **Milestone**: M3
- **Status**: Automated (protocol smoke: Read + Glob in sample project)

### Permission Allow / Deny / Timeout

#### E2E-014: Write/Edit/Bash triggers permission card

- **Preconditions**: Agent mode; project open.
- **Steps**: 1) Ask agent to write a file. 2) Observe permission card.
- **Expected**: Permission card appears with tool name, arguments preview, and allow/deny options.
- **Specs linked**: `04-ux/03-permission-ux.md`, `03-runtime/03-tools-and-permissions.md`
- **Acceptance**: E (Write/Edit/Bash trigger confirmation)
- **Milestone**: M3
- **Status**: Draft

#### E2E-015: Denied permission blocks execution

- **Preconditions**: Permission card displayed.
- **Steps**: 1) Click deny on permission card. 2) Observe agent response.
- **Expected**: Tool not executed; agent receives denied result; no file changed.
- **Specs linked**: `03-runtime/03-tools-and-permissions.md`
- **Acceptance**: E (denied → not executed)
- **Milestone**: M3
- **Status**: Draft

#### E2E-016: Allowed permission executes tool

- **Preconditions**: Permission card displayed.
- **Steps**: 1) Click allow on permission card. 2) Observe agent response and UI.
- **Expected**: Tool executed; result returned to model and displayed in UI; file modified.
- **Specs linked**: `03-runtime/03-tools-and-permissions.md`
- **Acceptance**: E (allowed → result returned)
- **Milestone**: M3
- **Status**: Draft

#### E2E-017: Permission timeout defaults to deny

- **Preconditions**: Permission card displayed; no user action.
- **Steps**: 1) Wait 120 seconds without responding to permission card. 2) Observe outcome.
- **Expected**: Permission auto-denied after timeout; tool not executed.
- **Specs linked**: `03-runtime/03-tools-and-permissions.md`
- **Acceptance**: E (timeout → deny)
- **Milestone**: M3
- **Status**: Draft

#### E2E-018: Chat mode cannot run Write/Edit/Bash

- **Preconditions**: Chat mode active.
- **Steps**: 1) Ask agent to write a file in Chat mode. 2) Observe behavior.
- **Expected**: Write/Edit/Bash not available in Chat mode; only Read/Glob/Grep work.
- **Specs linked**: `03-runtime/03-tools-and-permissions.md`
- **Acceptance**: E (Chat read-only)
- **Milestone**: M3
- **Status**: Automated (protocol smoke: WRITE_DISABLED_IN_CHAT)

#### E2E-019: Workspace-outside paths are rejected

- **Preconditions**: Agent mode; project open.
- **Steps**: 1) Ask agent to read a file outside the project root. 2) Observe result.
- **Expected**: Tool rejects out-of-scope path; no data returned from outside workspace.
- **Specs linked**: `03-runtime/15-workspace-ignore-rules.md`
- **Acceptance**: E (workspace-outside rejected)
- **Milestone**: M3
- **Status**: Automated (protocol smoke: PATH_OUTSIDE_WORKSPACE)

#### E2E-019a: Scratch-directory writes stay out of the workspace (D114)

- **Preconditions**: Agent mode; project open; session started.
- **Steps**: 1) Ask the agent to produce a temporary/intermediate file (e.g. a one-off script). 2) Observe where it writes and whether a permission card appears. 3) Check `git status` and the work-panel state. 4) Delete the session and check `<data_dir>/scratch/`.
- **Expected**: The file lands under `<data_dir>/scratch/<sessionId>/` without a permission card; project `git status` stays clean; no file or Review artifact tab opens for the scratch write; deleting the session removes the scratch directory.
- **Specs linked**: `03-runtime/03-tools-and-permissions.md §4b`, `03-runtime/04-data-storage.md`
- **Acceptance**: E (temp files isolated from workspace)
- **Milestone**: M5
- **Status**: Partially automated (host-core unit tests: dual-root resolve, scratch write/read, PI_SCRATCH_DIR, sweep)

#### E2E-019b: Scratch containment matches workspace defenses (D114)

- **Preconditions**: Agent mode; project open.
- **Steps**: 1) Attempt Write with `..` traversal from the scratch root. 2) Attempt Write through a symlink planted inside scratch pointing outside. 3) Attempt scratch writes in Chat mode.
- **Expected**: Both escapes return `PATH_OUTSIDE_WORKSPACE`; Chat mode still returns `WRITE_DISABLED_IN_CHAT` even for scratch paths.
- **Specs linked**: `03-runtime/03-tools-and-permissions.md §4b`
- **Acceptance**: E (scratch root cannot be escaped)
- **Milestone**: M5
- **Status**: Automated (host-core unit tests)

#### E2E-019c: Permission modes govern high-risk approval (D115/D132)

- **Preconditions**: Agent mode; project open; global default `ask`.
- **Steps**: 1) With a newly inherited session and global default Ask every time, open the composer menu — expect Ask every time to be selected with no global-default/inherit label — then ask the agent to write a workspace file and expect a permission card. 2) Switch the session chip to Accept edits; repeat — expect no card for Write/Edit but still a card for Bash. 3) Switch to Auto — expect no card for Bash either. 4) Create another inherited session after setting the global default to Accept edits in Settings — expect the composer chip and menu selection to display Accept edits directly and Write/Edit to be auto-allowed. 5) Switch the session to Chat mode with Auto set — expect Write denied (`WRITE_DISABLED_IN_CHAT`).
- **Expected**: Effective mode = session override → global default → ask; chat-mode hard deny outranks every mode; the composer chip and menu always display the effective mode without default/inherit provenance.
- **Specs linked**: `03-runtime/03-tools-and-permissions.md §6`, `03-runtime/04-data-storage.md`, `08-meta/decisions-log.md` (D115/D132)
- **Acceptance**: E (permission modes resolve and enforce host-side)
- **Milestone**: M5
- **Status**: Partially automated (host-core unit tests: evaluate matrix, chat-deny precedence, session grants under ask; renderer source test: effective-only composer options and selection)

### Session Persistence

#### E2E-020: Session survives restart

- **Preconditions**: Session with message history exists.
- **Steps**: 1) Quit app. 2) Relaunch. 3) Open session list.
- **Expected**: Previous session appears; messages recoverable.
- **Specs linked**: `03-runtime/04-data-storage.md`, `03-runtime/10-session-state-machine.md`
- **Acceptance**: F (session survives restart)
- **Milestone**: M2
- **Status**: Automated (protocol smoke: host-level persistence; full restart lane manual)

#### E2E-021: Delete session works

- **Preconditions**: Session exists.
- **Steps**: 1) Delete a session. 2) Observe session list.
- **Expected**: Session removed from list; data gone.
- **Specs linked**: `03-runtime/04-data-storage.md`
- **Acceptance**: F (delete session)
- **Milestone**: M2
- **Status**: Draft

#### E2E-036: Localized import grouping starts collapsed

- **Preconditions**: Supported local agent stores contain importable sessions across at least two project paths and two sources, including one session without a project path; the app can be launched once with an English system locale and once with a Simplified Chinese system locale.
- **Steps**: 1) Launch in English and open Settings → Import. 2) Scan for sessions. 3) Inspect the initial source groups. 4) Expand one group and select a session. 5) Change Group by to Project path. 6) Switch back to Source. 7) Repeat the flow after launching with a Simplified Chinese system locale.
- **Expected**: Source/来源 is the initial grouping; all groups are collapsed after the scan and after either grouping change; project-path mode shows exact project paths and a final No project/未关联项目 group; expanding one group leaves the others collapsed; the selected session remains selected across grouping changes; counts, dates, selection labels, accessible names, and the import result use the active locale without raw keys or unresolved `{{...}}` placeholders.
- **Specs linked**: `04-ux/01-ui-ia.md`, `04-ux/02-i18n-english-first.md`, `04-ux/08-component-spec.md`
- **Acceptance**: F (session import review)
- **Milestone**: M2
- **Status**: Draft

#### E2E-037: Import creates durable project entries

- **Preconditions**: Import candidates include two sessions at path A, one at path B, and one without a project path; neither project is the active workspace.
- **Steps**: 1) Import all candidates. 2) Open Settings → Project archive. 3) Inspect and expand paths A and B. 4) Return home and inspect Temporary sessions. 5) Repeat the import.
- **Expected**: Project archive contains exactly one durable row for A and one for B; the matching imported sessions appear under their exact project rows; the path-less session appears only under Temporary sessions; the active workspace does not change; repeating import duplicates neither sessions nor project rows; no missing filesystem path is created on disk.
- **Specs linked**: `03-runtime/04-data-storage.md`, `04-ux/01-ui-ia.md`, `04-ux/08-component-spec.md`
- **Acceptance**: F (session/project persistence)
- **Milestone**: M2
- **Status**: Draft

#### E2E-038: Settings owns the project archive destination

- **Preconditions**: App running with at least one configured provider, one supported local session store, one retained project, and one archived project.
- **Steps**: 1) Open Settings. 2) Inspect the complete settings rail. 3) Open Basics and change the theme in its Appearance card. 4) Open Model configuration and inspect the provider studio. 5) Open Import, Project archive, and Info in order. 6) Search Settings for "project" or "archive". 7) Restore the archived project, then activate it. 8) Return to the app shell and open Plugins.
- **Expected**: The rail contains exactly Basics, Model configuration, Import, Project archive, and Info in that order; Appearance and Providers remain merged into their owning destinations; Project archive shows active, closed, and archived durable rows without a visibility toggle; restore keeps the archive open and activation returns to chat with the restored project retained in the sidebar; the home sidebar and global page results have no standalone Projects destination; Settings search finds Project archive; Plugins remains an independent app-shell destination.
- **Specs linked**: `04-ux/06-settings-ia.md`, `04-ux/01-ui-ia.md`, `03-runtime/11-provider-model-system.md`
- **Acceptance**: B (model configuration), F (session import)
- **Milestone**: M4
- **Status**: Unit-covered (`settings-project-archive.test.mjs`, `sidebar-navigation.test.mjs`); rendered scenario Draft

#### E2E-039: Settings titlebar drag moves the window

- **Preconditions**: App running windowed on macOS with Settings open.
- **Steps**: 1) Record the window position. 2) Drag the empty 46px band above the settings rail. 3) Drag the same band above the content pane. 4) Use Back, search, Project archive, and navigation controls.
- **Expected**: Either top-band drag moves the native window; Back, search, and navigation remain interactive and never initiate a window drag.
- **Specs linked**: `04-ux/06-settings-ia.md`, `04-ux/01-ui-ia.md`
- **Acceptance**: Quality (key operations feel polished)
- **Milestone**: M5
- **Status**: Draft

#### E2E-043: Settings content follows window width

- **Preconditions**: App running windowed on macOS with Settings open.
- **Steps**: 1) Open Basics at the default window width and record the content-card width. 2) Expand the window to 1600px wide. 3) Open Model configuration, Import, and Project archive. 4) Shrink the window to the supported 960px minimum.
- **Expected**: The right-side content cards expand and contract with the available pane at every tested width; the 275px rail and pane gutters remain stable; controls remain visible without clipping or horizontal page scrolling.
- **Specs linked**: `04-ux/06-settings-ia.md`, `04-ux/07-ui-design-system.md`
- **Acceptance**: Quality (key operations feel polished)
- **Milestone**: M5
- **Status**: Unit-covered (`settings-responsive-layout.test.mjs`); scenario Documented

#### E2E-040: Codex-style tool activity survives transcript reload
- **Preconditions**: Provider configured; project open; a session can run a
  successful tool and a failing or aborted tool.
- **Steps**: 1) Run representative read, search, and command tools. 2) Inspect
  the collapsed processing header while it is active. 3) Wait for completion
  and expand the processing group. 4) Expand a completed row and copy its
  output. 5) Reload the session and expand the restored group.
- **Expected**: Consecutive calls are collapsed by default under one localized
  processing header that updates and then freezes its elapsed time and shows a
  step count. Expanded calls use transparent semantic activity rows with an
  action icon, natural-language verb, monospace primary argument, and quiet
  disclosure. Nested expansion shows output before raw input in clamped scroll
  regions. Live partial output updates in place. Reloaded rows preserve the tool
  name, arguments, result, and status.
- **Specs linked**: `04-ux/01-ui-ia.md`,
  `04-ux/07-ui-design-system.md`, `04-ux/08-component-spec.md`,
  `04-ux/09-interaction-patterns.md`
- **Acceptance**: C (chat stream), E (tools), F (persistence)
- **Milestone**: M3
- **Status**: Draft

#### E2E-041: Conversation minimap navigates long transcripts

- **Preconditions**: A session contains enough user and assistant messages to
  scroll beyond one viewport, including tool activity between messages; a second
  session has at least two eligible messages that still fit in one viewport.
- **Steps**: 1) Open the long session. 2) Scroll through the transcript and
  observe the active minimap marker. 3) Hover a marker and inspect its preview.
  4) Use keyboard focus to reach another marker. 5) Activate a marker. 6) Open a
  session with fewer than two visible user or assistant messages. 7) Open the
  multi-message session that still fits one viewport. 8) Resize the long session
  window taller until content no longer overflows, then shorter again.
- **Expected**: The rail contains one marker per visible user or assistant
  message and no marker for tool-only rows; the marker near the upper-third
  reading anchor exposes `aria-current`; hover and focus show the same
  localized sender and bounded plaintext preview; nearby markers magnify
  horizontally without shifting the stack; activation smoothly scrolls to the
  corresponding message; the rail is absent when fewer than two eligible
  messages exist **or** when content does not overflow one viewport; the rail
  reappears once overflow returns after a resize.
- **Specs linked**: `04-ux/08-component-spec.md`
- **Acceptance**: C (chat stream), Quality (keyboard and long-thread navigation)
- **Milestone**: M3
- **Status**: Draft

#### E2E-042: Pre-v7 storage archives via breaking reset; transcripts live in session files

- **Preconditions**: A fixture data directory contains a `pi.sqlite` whose
  `PRAGMA user_version` is between 1 and 6 (pre-D119 content-in-DB schema)
  with representative rows.
- **Steps**: 1) Start host-core against the fixture. 2) Create a session and
  append messages through host RPC. 3) Stop and restart host-core. 4) Reload
  the session through RPC and inspect the data directory.
- **Expected**: Host-core renames the legacy file to exactly one
  `pi.sqlite.v6.bak`, bootstraps a fresh schema-v7 database (index-only
  `messages`), writes `sessions/<id>.jsonl` with a session-header line plus
  one line per message, reloads the transcript from the file after restart
  with identical logical results, and deleting the session removes both the
  index rows and the session files. No Electron-owned persistence file is
  authoritative.
- **Specs linked**: `03-runtime/04-data-storage.md`,
  `03-runtime/06-host-rpc-protocol.md`, ADR 0014
- **Acceptance**: F (persistence), H (reset failures are diagnosable)
- **Milestone**: M2
- **Status**: Unit-covered (`db::tests::archives_pre_v7_database_and_starts_fresh`,
  `sessions::tests::transcript_survives_reopen_from_file`,
  `sessions::tests::delete_session_removes_transcript_files`); full fixture
  scenario Draft

### Plugin Load / Command / Disable

#### E2E-022: Load local plugin

- **Preconditions**: App running; sample plugin available at local path.
- **Steps**: 1) Open Plugins from the app sidebar. 2) Add plugin from local directory. 3) Enable.
- **Expected**: Plugin loads; manifest validated; contributions registered.
- **Specs linked**: `07-plugins/01-plugin-system.md`, `07-plugins/05-plugin-lifecycle.md`
- **Acceptance**: G (load local plugin)
- **Milestone**: M4
- **Status**: Automated (protocol smoke: plugins.loadDev)

#### E2E-023: Plugin command in palette and executes

- **Preconditions**: Plugin loaded and enabled.
- **Steps**: 1) Open command palette. 2) Find plugin command. 3) Execute.
- **Expected**: Command appears in palette; execution produces expected result.
- **Specs linked**: `07-plugins/09-plugin-command-palette.md`
- **Acceptance**: G (plugin command appears and executes)
- **Milestone**: M4
- **Status**: Draft

#### E2E-024: Plugin registers and calls agent tool

- **Preconditions**: Plugin loaded; plugin declares an agent tool.
- **Steps**: 1) Ask agent to use the plugin's tool. 2) Observe permission card if required. 3) Allow.
- **Expected**: Tool registered with forced prefix (`plugin_<id>_<name>`); call succeeds.
- **Specs linked**: `07-plugins/03-plugin-api.md`, `07-plugins/13-plugin-permissions-matrix.md`
- **Acceptance**: G (plugin agent tool)
- **Milestone**: M4
- **Status**: Automated (protocol smoke: dispatch roundtrip host->runner->host; in-app JS execution via PluginRuntime)

#### E2E-025: Disable plugin removes contributions

- **Preconditions**: Plugin enabled and contributions visible.
- **Steps**: 1) Disable the plugin on the Plugins page. 2) Check command palette and agent tools.
- **Expected**: Commands and tools disappear; no leftover contributions.
- **Specs linked**: `07-plugins/05-plugin-lifecycle.md`
- **Acceptance**: G (disable removes contributions)
- **Milestone**: M4
- **Status**: Automated (protocol smoke: disable clears enabled flag; palette removal manual)

#### E2E-026: Plugin error does not crash app

- **Preconditions**: Plugin loaded.
- **Steps**: 1) Trigger a scenario where plugin throws an error. 2) Observe app behavior.
- **Expected**: App remains running; error is captured and reported; no crash.
- **Specs linked**: `07-plugins/04-plugin-security.md`
- **Acceptance**: G (plugin error → no crash)
- **Milestone**: M4
- **Status**: Draft

### Security — No Secret Leakage

#### E2E-027: Secrets not in logs for normal flows

- **Preconditions**: Provider configured with API key.
- **Steps**: 1) Perform a chat session. 2) Inspect log files.
- **Expected**: API keys / tokens not present in any log output for normal flows.
- **Specs linked**: `05-security/01-security.md`, `03-runtime/09-logging-and-observability.md`
- **Acceptance**: H (secrets not in logs)
- **Milestone**: M2
- **Status**: Automated (protocol smoke: provider list carries no secret material)

#### E2E-028: Renderer has no Node integration

- **Preconditions**: App running.
- **Steps**: 1) Inspect renderer process flags.
- **Expected**: `nodeIntegration: false`; `contextIsolation: true`; preload is the only bridge.
- **Specs linked**: `05-security/01-security.md`
- **Acceptance**: Security (no Node in renderer)
- **Milestone**: M1
- **Status**: Draft

#### E2E-029: Unwhitelisted IPC cannot be called

- **Preconditions**: App running.
- **Steps**: 1) Attempt to invoke an IPC method not on the whitelist from renderer.
- **Expected**: Call blocked; no data returned; error or no response.
- **Specs linked**: `03-runtime/01-ipc-protocol.md`, `05-security/01-security.md`
- **Acceptance**: Security (IPC whitelist enforced)
- **Milestone**: M1
- **Status**: Draft

#### E2E-030: Plugin cannot read API key

- **Preconditions**: Plugin loaded; provider configured.
- **Steps**: 1) Plugin attempts to access provider secret via any API. 2) Observe result.
- **Expected**: Access denied; no secret data returned to plugin.
- **Specs linked**: `07-plugins/04-plugin-security.md`, `03-runtime/14-secrets-storage.md`
- **Acceptance**: Security (plugin cannot read API key)
- **Milestone**: M4
- **Status**: Draft

#### E2E-031: Error codes are stable and readable

- **Preconditions**: App launched through the normal desktop development
  command; provider configured.
- **Steps**: 1) Select or enter a model ID that the provider rejects. 2) Send a
  prompt. 3) Inspect the assistant error message and its detail disclosure. 4)
  Switch sessions and reload the failed session. 5) Repeat with an invalid
  provider key.
- **Expected**: The run stops and the transcript contains one durable
  `role=assistant`, `status=error` message instead of a toast, floating banner,
  or blank row. It shows a localized summary and stable
  `MODEL_NOT_CONFIGURED` or `PROVIDER_UNAUTHORIZED` code. Details expose the
  redacted provider response plus provider/model IDs and can be copied; no API
  key or Authorization value appears. The configuration failure links to
  settings, retriable failures offer Retry, the composer becomes usable again,
  and reload preserves the error message. The development launch executes a
  sidecar rebuilt from current runtime source.
- **Specs linked**: `03-runtime/02-agent-runtime.md`,
  `03-runtime/07-process-model.md`, `03-runtime/08-error-codes.md`
- **Acceptance**: C (failed chat settles), H (errors expose stable codes)
- **Milestone**: M2
- **Status**: Unit-covered (agent-runtime error message/redaction, host
  persistence, desktop transcript contract, and predev build contract); full
  Electron UI scenario Draft

### Hardening (M5)

#### E2E-032: Backend crash triggers supervised restart

- **Preconditions**: App running; host-core and sidecar healthy.
- **Steps**: 1) Kill the host-core (or sidecar) process externally. 2) Observe app behavior.
- **Expected**: In-flight RPCs fail fast (no long hang); `hostStatus` shows degraded then restored; child restarts with backoff; after 3 failed restarts in 2 minutes the app stays degraded with a visible fatal status.
- **Specs linked**: `03-runtime/07-process-model.md`
- **Acceptance**: Quality (main path no crash)
- **Milestone**: M5
- **Status**: Automated (`scripts/e2e-supervision.mjs` — SIGKILL host-core, assert restart + healthy RPC)

#### E2E-033: Window bounds persist across restart

- **Preconditions**: App running with default window size.
- **Steps**: 1) Resize/move the window to a distinct valid size (≥960×640). 2) Quit. 3) Relaunch.
- **Expected**: Window restores at the saved bounds; invalid/tiny saved bounds fall back to the 1200×800 default.
- **Specs linked**: `04-ux/09-interaction-patterns.md`
- **Acceptance**: Quality (key operations feel polished)
- **Milestone**: M5
- **Status**: Documented

#### E2E-034: NDJSON log files are written and redacted

- **Preconditions**: Fresh profile; provider configured; one chat turn completed.
- **Steps**: 1) Run a prompt with a tool call. 2) Open `~/.pi-desktop/logs/`. 3) Inspect `app.log`, `host.log`, `agent.log`.
- **Expected**: NDJSON records exist with `ts/level/channel/message`; tool start/end carry `sessionId`/`toolCallId`; no API key material appears; files rotate at 5 MB.
- **Specs linked**: `03-runtime/09-logging-and-observability.md`
- **Acceptance**: H (diagnostics)
- **Milestone**: M5
- **Status**: Documented

#### E2E-035: Bash tool resolves a platform shell or fails with guidance

- **Preconditions**: Workspace open; agent mode.
- **Steps**: 1) Run a Bash tool call (e.g. `echo ok`) and observe success on a machine with bash. 2) Set `PI_DESKTOP_BASH` to a non-executable path, restart host-core, run a Bash tool call.
- **Expected**: With a resolvable bash the command runs (Unix `bash -lc`, Windows Git-for-Windows `bash -c`); with a broken override the tool fails fast with stable `SHELL_NOT_FOUND` and a message naming `PI_DESKTOP_BASH`/Git for Windows; no partial execution.
- **Specs linked**: `03-runtime/03-tools-and-permissions.md`, `03-runtime/08-error-codes.md`
- **Acceptance**: H (errors expose stable codes)
- **Milestone**: M5
- **Status**: Unit-covered (`tools::shell::tests`); scenario Documented

#### E2E-044: Development launch uses PI-Desktop Dock branding

- **Preconditions**: macOS development checkout with canonical `build/icon_1024.png`.
- **Steps**: 1) Run `pnpm dev`. 2) Inspect the running application's Dock icon.
- **Expected**: The Dock shows the PI-Desktop brand icon, not Electron's default icon; packaged builds continue to use `build/icon.icns`.
- **Specs linked**: `06-delivery/06-release-runbook.md`
- **Acceptance**: Quality (development shell matches release branding)
- **Milestone**: M5
- **Status**: Unit-covered (`development-branding.test.mjs`); visual scenario Documented

#### E2E-045: Global text selection preserves editing and copying

- **Preconditions**: App running with a chat transcript containing a user
  message, an assistant Markdown response with a code block, and an expanded
  tool result.
- **Steps**: 1) Drag across sidebar/titlebar chrome and a button label. 2)
  Drag across user/assistant prose, code, and tool output. 3) Focus the
  composer and a settings/search input, then use `Cmd/Ctrl+A` and replace the
  selected text. 4) Copy selected transcript and code text.
- **Expected**: Chrome does not leave an accidental text selection; message
  prose, code, tool input/output, and editable controls remain selectable and
  copyable; native editing shortcuts, focus-visible rings, and window drag
  behavior remain intact.
- **Specs linked**: `04-ux/07-ui-design-system.md`,
  `04-ux/09-interaction-patterns.md`
- **Acceptance**: Quality (key operations feel polished)
- **Milestone**: M5
- **Status**: Unit-covered (`user-select.test.mjs`); scenario Documented

#### E2E-046: PI-Desktop renderer branding and session creation icon

- **Preconditions**: App running in both English and zh-CN locales, with an
  empty home and a docked transcript available.
- **Steps**: 1) Inspect the expanded and collapsed sidebar. 2) Inspect the
  empty-home hero and docked composer. 3) Focus the New task control and each
  project/Temporary create control. 4) Open Settings and the composer input.
- **Expected**: Visible shell identity reads `PI-Desktop`; the home hero,
  expanded/collapsed sidebar, and docked composer all render the canonical
  `build/icon_1024.png` asset through `BrandLogo`; every session-creation
  control uses the dedicated message-plus icon with localized labels and
  accessible names. `Codex` remains visible only as the external import-source
  label or in non-runtime design-reference text.
- **Specs linked**: `04-ux/01-ui-ia.md`, `04-ux/07-ui-design-system.md`,
  `04-ux/08-component-spec.md`, `04-ux/09-interaction-patterns.md`,
  `08-meta/decisions-log.md` (D094)
- **Acceptance**: Quality (brand consistency and key operations feel polished)
- **Milestone**: M5
- **Status**: Unit-covered (`renderer-branding.test.mjs`); scenario Documented

#### E2E-047: Retain, collapse, switch, and close multiple project tabs

- **Preconditions**: Projects A and B each have at least one durable session;
  neither path is archived; a Temporary session also exists.
- **Steps**: 1) Open project A from Settings → Project archive. 2) Open project B without closing
  A. 3) Click A's directory row on its chevron, folder, label, and trailing
  disclosure hit area in turn to collapse/expand it; use B's directory row to
  activate and collapse B; verify `+` and overflow do not toggle B. 4) Select
  A's conversation. 5) Close B. 6)
  Restart the app. 7) Reopen B from Settings → Project archive.
- **Expected**: A and B render as separate exact-path sidebar groups in a
  compact continuous list with one keyboard stop per directory disclosure;
  every non-action point in A's row toggles only A, project actions appear on
  hover/focus without shifting labels, and collapse survives restart;
  activating a group or its conversation
  clears the previous visible transcript, updates the selected workspace and
  session binding, and then loads only the selected project's conversation;
  Temporary remains separate; closing B removes only its retained tab and
  deletes neither its project row nor sessions; reopening B restores the same
  sessions without duplication.
- **Specs linked**: `04-ux/01-ui-ia.md`, `04-ux/08-component-spec.md`,
  `04-ux/09-interaction-patterns.md`, ADR 0016
- **Acceptance**: C (switch sessions), D (workspace), F (local presentation
  persistence)
- **Milestone**: M5
- **Status**: Unit-covered (`sidebar-preferences.test.mjs` for retained paths
  and collapse persistence); full UI scenario Draft

#### E2E-048: Pin, archive, restore, and sort project/conversation rows

- **Preconditions**: Two retained projects contain conversations with distinct
  titles and created/updated timestamps; archived view is initially disabled.
- **Steps**: 1) Pin one project and one conversation. 2) Select Recently
  updated, Created date, Oldest first, and Name in turn. 3) Archive another
  conversation and project. 4) Enable Show archived and restore both. 5)
  Restart the app. 6) Delete a disposable conversation through the distinct
  Delete action.
- **Expected**: Pinned rows remain ahead of unpinned rows under every selected
  secondary order; each sort produces the documented stable order; archived
  rows disappear from the default view but retain transcripts/project records
  and reappear in Show archived; restore returns them to the selected order;
  archiving the active row selects a visible non-archived fallback or creates
  the documented empty fallback instead of leaving hidden active context;
  pin/archive/sort choices survive restart; only Delete removes the disposable
  durable session. A legacy `manual` preference loads safely without exposing
  or implying a drag-reorder workflow.
- **Specs linked**: `03-runtime/04-data-storage.md`, `04-ux/01-ui-ia.md`,
  `04-ux/08-component-spec.md`, `04-ux/09-interaction-patterns.md`
- **Acceptance**: C (session organization), F (persistence)
- **Milestone**: M5
- **Status**: Unit-covered (`sidebar-preferences.test.mjs` for metadata,
  filtering, and sort behavior); full UI scenario Draft

#### E2E-049: Background sessions keep their originating workspace

- **Preconditions**: Projects A and B are retained; each contains a session in
  Agent mode; both workspaces contain different marker files with the same
  relative name.
- **Steps**: 1) In session A, start a turn that reads the marker and performs a
  permission-gated long-running tool. 2) While A is running, activate project
  B and open session B. 3) Read B's marker and allow a tool only in B. 4) Wait
  for both turns to complete. 5) Open a Temporary session and attempt a
  workspace-required tool.
- **Expected**: Switching tabs aborts neither turn; A's tool cwd/path sandbox
  remains project A and B's remains project B; A's events and grants never
  appear in B's transcript/session; each sidebar row reports its own
  running/completed state; the Temporary session inherits no project and
  receives `WORKSPACE_REQUIRED`; returning to A restores A's completed
  transcript.
- **Specs linked**: `02-architecture/01-architecture.md`,
  `03-runtime/02-agent-runtime.md`, `03-runtime/03-tools-and-permissions.md`,
  `03-runtime/06-host-rpc-protocol.md`,
  `03-runtime/10-session-state-machine.md`, ADR 0016
- **Acceptance**: C (parallel sessions), D (workspace), E (tool/permission
  isolation), Security (workspace boundary)
- **Milestone**: M5
- **Status**: Unit-covered (`rpc::tests` for project-bound, Temporary, and
  missing-session workspace resolution); full multi-turn UI scenario Draft

#### E2E-050: Thinking selector follows exact model capability

- **Preconditions**: One catalogued reasoning model, one non-reasoning model,
  and a custom provider with an explicit reasoning override.
- **Steps**: 1) Select each provider/model in turn. 2) Inspect the composer
  controls beside Chat / Agent. 3) Open the Thinking trigger and choose multiple
  supported levels. 4) Use Enable thinking from the model menu on the unknown
  custom provider. 5) Disable its override in Agent and refresh model data.
- **Expected**: Reasoning models show the current Thinking level immediately to
  the right of Chat / Agent, expose only their sparse supported levels as a
  single-column list in canonical order, mark the selected row with a trailing
  check, expose no inherit/default row, size the menu to its content without
  exceeding 160px or the available viewport, truncate overlong labels, and close
  the menu after selection. Non-reasoning models show no Thinking trigger.
  Custom providers may persist
  `supportedThinkingLevels` such as `["off","high"]` from Settings and the
  Composer must not invent graded options for those sets. The custom action
  persists `supportsReasoning` and selects the supported level nearest
  `medium`; explicit `false` removes stale reasoning tags and resets the
  effective level to `off`; known non-reasoning and legacy providers remain
  unavailable without a crash.
- **Specs linked**: `03-runtime/11-provider-model-system.md`,
  `03-runtime/12-provider-config-schema.md`,
  `03-runtime/13-model-catalog-and-selection.md`, ADR 0018
- **Acceptance**: B (model config), Quality
- **Milestone**: M5
- **Status**: Unit-covered (`thinking-ui.test.mjs`, agent-runtime capability tests); full UI scenario Draft

#### E2E-051: Thinking level persists with the session

- **Preconditions**: A reasoning-capable session is idle.
- **Steps**: 1) Select `high`. 2) Change Chat/Agent mode without changing the
  thinking level. 3) Restart the app and reopen the session. 4) Switch to
  another session and back.
- **Expected**: Every configuration update sends the complete session config;
  `high` survives mode change, session switches, host reload, and app restart.
  A v2 database migrates the same field to `off` without transcript loss.
- **Specs linked**: `03-runtime/04-data-storage.md`,
  `03-runtime/06-host-rpc-protocol.md`, `04-ux/08-component-spec.md`, ADR 0018
- **Acceptance**: F (persistence)
- **Milestone**: M5
- **Status**: Unit-covered (host schema/session tests, `thinking-ui.test.mjs`); full restart scenario Draft

#### E2E-052: Thinking level reaches the pi request

- **Preconditions**: Instrumented reasoning-capable provider with a sparse
  level set and request capture; one session configured above and below gaps.
- **Steps**: 1) Select each available level and run a prompt. 2) Seed an
  unsupported stored level and run again. 3) repeat with reasoning disabled.
- **Expected**: Main resolves capability using the session's actual model id;
  Composer, main, sidecar, and pi use the same upward-first/downward-second
  clamp; pi receives the effective level; disabled reasoning receives `off`.
- **Specs linked**: `03-runtime/01-ipc-protocol.md`,
  `03-runtime/02-agent-runtime.md`, `03-runtime/13-model-catalog-and-selection.md`, ADR 0018
- **Acceptance**: B (model config), C (chat and stream)
- **Milestone**: M5
- **Status**: Unit-covered (agent-runtime prompt/clamp tests); integration scenario Draft

#### E2E-053: Thinking streams separately from the answer

- **Preconditions**: Provider emits thinking deltas before and between answer
  deltas.
- **Steps**: 1) Start a turn in both light and dark themes. 2) Observe a
  thinking-only phase. 3) Let the answer complete. 4) Toggle the disclosure,
  test keyboard focus, enable reduced motion, and use Copy answer.
- **Expected**: The transcript opens during thinking-only streaming; one open
  Thinking disclosure updates without an empty answer bubble or duplicate
  Working indicator. The disclosure uses the transcript surface, theme tokens,
  a Sparkles/chevron trigger, and a left rule instead of an inset card;
  collapsed content leaves focus traversal and reduced motion disables shimmer
  and transitions. Final answer markdown renders separately; Copy answer
  contains no thinking text.
- **Specs linked**: `03-runtime/01-ipc-protocol.md`,
  `04-ux/07-ui-design-system.md`, `04-ux/08-component-spec.md`, ADR 0018
- **Acceptance**: C (chat and stream), Quality
- **Milestone**: M5
- **Status**: Unit-covered (`thinking-ui.test.mjs`, agent-runtime event tests); full streaming scenario Draft

#### E2E-054: Stored thinking reloads losslessly

- **Preconditions**: A completed assistant message contains both reasoning and
  final answer blocks; another contains reasoning only.
- **Steps**: 1) Complete both turns. 2) Restart the host/app. 3) Reopen the
  session. 4) inspect search results and answer copy.
- **Expected**: Host returns the same separate `thinking` and `content`
  values after reload/import/replace round-trips; both messages remain
  visible; search and answer copy exclude reasoning.
- **Specs linked**: `03-runtime/04-data-storage.md`,
  `03-runtime/06-host-rpc-protocol.md`, `04-ux/08-component-spec.md`, ADR 0018
- **Acceptance**: C (chat and stream), F (persistence)
- **Milestone**: M5
- **Status**: Unit-covered (host message/import tests, `thinking-ui.test.mjs`); full reload scenario Draft

#### E2E-055: Unsupported provider transition clamps safely

- **Preconditions**: Session on a reasoning provider at `max`; target
  providers include non-reasoning and sparse-level variants.
- **Steps**: 1) Switch to the non-reasoning provider. 2) Run a turn. 3) Switch
  to sparse variants around the previous level. 4) send malformed/legacy
  payloads lacking capability or thinking fields.
- **Expected**: Non-reasoning persists and sends `off`; sparse variants choose
  the same nearest level everywhere; missing fields fall back safely;
  malformed thinking is not rendered and never contaminates answer content.
- **Specs linked**: `03-runtime/01-ipc-protocol.md`,
  `03-runtime/13-model-catalog-and-selection.md`, `04-ux/08-component-spec.md`, ADR 0018
- **Acceptance**: B (model config), C (chat and stream), Quality
- **Milestone**: M5
- **Status**: Unit-covered (`thinking-ui.test.mjs`, host validation tests); full UI scenario Draft

#### E2E-056: Work panel shell docking and persistence

- **Preconditions**: App running with any workspace state.
- **Steps**: 1) Relaunch and inspect the titlebar, application menu, and
  Cmd/Ctrl+J. 2) Open two distinct file artifacts, the same first file again,
  a URL preview, and a completed command artifact. 3) Close an inactive tab,
  then the active middle and edge tabs. 4) Use the sole collapse control and
  trigger another artifact. 5) Switch sessions and projects with tabs open.
  6) Drag the left-edge handle below 320px and beyond every upper bound at
  960px, 1200px, and 1600px window widths. 7) On Windows, record the native
  window bounds before opening a file artifact, collapsing the panel, and
  closing its final tab; inspect each transition frame. 8) Relaunch.
- **Expected**: Startup shows no panel, welcome chooser, fixed tool buttons,
  titlebar/menu launcher, or Cmd/Ctrl+J action. Each artifact atomically opens
  the docked third column and creates or activates one closeable top tab; file
  tabs are path-keyed, repeated resources deduplicate, and tabs scroll without
  colliding with the collapse control while keeping the active tab visible.
  Active close selects the right neighbor then left; closing the last tab hides
  the panel. Collapse retains runtime
  tabs but hides the panel until another artifact reopens it. Width clamps to
  `320px–min(720px, 60vw, viewport − visible sidebar − 360px)`, re-clamps on
  window resize, and never squeezes MainChat below 360px in the supported shell.
  Session/workspace changes clear tabs before relative resources can cross
  contexts. Only `{width}` is restored after relaunch; open state and tabs
  reset, and temporary panel expansion does not enlarge the restored base
  window. On Windows, the native bounds stay unchanged throughout open,
  collapse, and final-tab close transitions, with no intermediate compressed
  or expanded frame. The former context-panel overlay no longer exists.
- **Specs linked**: `04-ux/01-ui-ia.md`, `04-ux/08-component-spec.md`
- **Acceptance**: F (persistence), Quality
- **Milestone**: M5
- **Status**: Unit-covered (`work-panel.test.mjs` source invariants); full UI scenario Draft

#### E2E-057: Review tab reflects the git working tree

- **Preconditions**: A git workspace with a clean tree; agent configured.
- **Steps**: 1) Ask the active agent to edit a tracked workspace file and
  create a new one. 2) Repeat with a failed Write, a scratch Write, and a Write
  in a background project session. 3) Edit a file outside the app and press
  refresh after Review is open. 4) Inspect Review in a non-git folder.
- **Expected**: Each successful active-session workspace Write/Edit creates or
  activates one deduplicated Review tab and refreshes the diff automatically
  (debounced) with
  per-file status badges, +/− counts, and colored unified hunks (untracked
  files included). Failed/scratch/background writes do not open or steal focus;
  background invalidation remains scoped. Manual refresh picks up external
  edits; non-git and no-workspace states render their dedicated copy. Binary and >200KB patches
  render as capped rows without hunks; >100 changed files shows the
  truncation notice.
- **Specs linked**: `03-runtime/01-ipc-protocol.md` §13a, `04-ux/08-component-spec.md` §5
- **Acceptance**: D (workspace), Quality
- **Milestone**: M5
- **Status**: Unit-covered (`git-diff-parse.test.mjs`); full UI scenario Draft

#### E2E-058: Interactive terminal session lifecycle

- **Preconditions**: A workspace is open; a successful completed-command
  artifact exists.
- **Steps**: 1) Activate the completed command artifact to create Terminal,
  then run `pwd` and `ls`. 2) Switch to another artifact tab and back. 3)
  Collapse and reopen via another command artifact. 4) Drag-resize the
  panel and toggle light/dark theme. 5) Run `exit`. 6) Restart via the
  overlay button. 7) Quit the app and check for orphan shells.
- **Expected**: The shell starts in the workspace directory as a login
  shell with 256-color TERM; output/scrollback survive tab switches and
  panel close (same PTY reattached); resize refits columns without garbling;
  theme switch recolors the terminal; `exit` shows the ended-session
  overlay whose restart starts a fresh shell; app quit kills all PTYs; with
  no workspace the tab shows its empty state and no PTY spawns.
- **Specs linked**: `03-runtime/01-ipc-protocol.md` §13a, ADR 0019
- **Acceptance**: D (workspace), Quality
- **Milestone**: M5
- **Status**: Draft (manual)

#### E2E-059: Embedded browser preview isolation and overlays

- **Preconditions**: A local dev server is running; a URL or BrowserPreview artifact exists.
- **Steps**: 1) Activate the artifact, enter `localhost:<port>` without a scheme, and submit.
  2) Navigate site links; use back/forward/reload/stop. 3) Trigger a
  `window.open` popup and a permission-requesting page (e.g. notification
  prompt). 4) Open the command palette, then a tool permission dialog, then
  Settings. 5) Switch to another panel tab and back; close the panel.
  6) Use open-external.
- **Expected**: Scheme-less input normalizes to http; nav state (URL bar,
  back/forward enablement, load spinner) mirrors the page. Popups open in
  the default browser (never in-app); permission requests are denied;
  non-http(s) navigation is blocked. The preview hides under every blocking
  overlay and while unmounted, reappearing with correct bounds afterwards;
  resize/drag keeps the view aligned with the placeholder rect.
  Open-external launches the current URL in the default browser. The view
  uses an isolated persist partition (no session bleed from the app shell).
- **Specs linked**: `03-runtime/01-ipc-protocol.md` §13a, ADR 0019
- **Acceptance**: Quality, Security
- **Milestone**: M5
- **Status**: Draft (manual)

#### E2E-060: Files tab browsing stays inside the workspace

- **Preconditions**: Workspace with file artifacts for nested source, large
  (>512KB), image, and binary files.
- **Steps**: 1) Activate each file artifact and verify a distinct path-keyed
  top tab; browse the tree, expanding nested folders. 2) Open a source
  file, the image, the binary, and the large file. 3) Use reveal-in-Finder.
  4) Attempt a traversal read (`../outside`) via devtools IPC. 5) Switch
  workspaces.
- **Expected**: Directories list lazily, folders first, with `.git` /
  `node_modules` / build outputs hidden; text renders with syntax highlight
  (capped at 5000 lines), images preview inline, binary and oversized files
  show fallbacks with reveal still available. Traversal attempts are
  rejected with `INVALID_ARGUMENT`; no workspace → empty state; switching
  workspaces resets the tree and viewer.
- **Specs linked**: `03-runtime/01-ipc-protocol.md` §13a, ADR 0019,
  `03-runtime/15-workspace-ignore-rules.md`
- **Acceptance**: D (workspace), Security
- **Milestone**: M5
- **Status**: Unit-covered (`fs-panel-guard.test.mjs`); full UI scenario Draft

---

#### E2E-059: Transcript message plates follow WorkBuddy density

- **Preconditions**: A session contains at least one short user prompt, one
  longer user prompt, and a completed assistant answer; light and dark themes
  available.
- **Steps**: 1) Open the session in dark theme. 2) Inspect user and assistant
  rows at rest and on hover. 3) Start a streaming assistant answer. 4) Switch
  to light theme and repeat. 5) Focus the copy control with the keyboard.
- **Expected**: User turns are right-aligned, theme-neutral soft plates capped
  near 560px, derived from each theme's primary text ink rather than an accent
  tint, with a subtle border; assistant answers remain transparent full-width
  prose in the 720px content band. Row spacing is denser (~10px). Copy chips are
  hidden at rest, appear on hover/focus-within, and stay right-aligned under
  user turns. Streaming assistant answers show a thin accent left rule without
  boxing the whole answer. Both themes keep readable contrast on the user
  plate.
- **Specs linked**: `04-ux/07-ui-design-system.md`,
  `04-ux/08-component-spec.md`, `04-ux/10-workbuddy-benchmark-ux.md`
- **Acceptance**: C (chat stream), Quality
- **Milestone**: M5
- **Status**: Unit-covered (`transcript-style.test.mjs`); full visual scenario Draft

#### E2E-061: User message hard newlines stay visible

- **Preconditions**: Provider configured; composer can accept multi-line input
  via Shift+Enter (or Enter-to-send disabled).
- **Steps**: 1) Compose a three-line prompt with two hard newlines. 2) Send.
  3) Inspect the user bubble in the transcript. 4) Copy the user message and
  paste into an external editor. 5) Reload the session.
- **Expected**: The user plate shows three distinct lines (not collapsed to a
  single paragraph). Copied text retains the original newlines. After reload
  the same line breaks remain.
- **Specs linked**: `04-ux/08-component-spec.md`
- **Acceptance**: C (chat stream), Quality
- **Milestone**: M5
- **Status**: Unit-covered (`transcript-style.test.mjs`); full visual scenario Draft

#### E2E-060: Assistant meta chips and retry action

- **Preconditions**: A completed assistant message includes modelId and token
  usage; another completed assistant message has content but no usage.
- **Steps**: 1) Open the session. 2) Hover the completed assistant turn that has
  usage. 3) Inspect the model/token chips and their tooltip. 4) Click Retry on
  that turn while idle. 5) Confirm a turn without usage still offers Retry and
  omits the token chip.
- **Expected**: Model badge and token chip appear under completed assistant
  answers when data exists; token chip hover shows input/output and optional
  cache/reasoning breakdown; Retry re-sends the nearest preceding user prompt
  and is disabled while a turn is running; Copy still excludes thinking text.
- **Specs linked**: `04-ux/08-component-spec.md`,
  `04-ux/10-workbuddy-benchmark-ux.md`, `03-runtime/01-ipc-protocol.md`
- **Acceptance**: C (chat stream), Quality
- **Milestone**: M5
- **Status**: Unit-covered (`transcript-style.test.mjs`, runtime usage mapping); full scenario Draft

#### E2E-061: Regenerate replaces the current turn in place

- **Preconditions**: A session has user A → assistant A → user B → assistant B.
- **Steps**: 1) Hover assistant A and click Regenerate. 2) Wait for the new
  turn to complete. 3) Reload the session.
- **Expected**: Transcript truncates away assistant A / user B / assistant B
  before the redo starts; only user A plus the new assistant/tool tail remain.
  The regenerated answer does not leave the old branch above it. Reload keeps
  the truncated branch only.
- **Specs linked**: `04-ux/08-component-spec.md`,
  `03-runtime/01-ipc-protocol.md`, `03-runtime/04-data-storage.md`
- **Acceptance**: C (chat stream), F (persistence)
- **Milestone**: M5
- **Status**: Unit-covered (store/main truncate wiring tests); full scenario Draft

#### E2E-062: Regenerate history pager restores prior variants

- **Preconditions**: A session where an assistant answer was regenerated at least once.
- **Steps**: 1) Click Retry/Regenerate on a completed assistant turn. 2)
  Observe the visible root user bubble while the replacement turn starts and
  after it completes. 3) Switch to a previous variant. 4) Switch forward
  again. 5) Reload the session.
- **Expected**: The root user bubble remains visible and shows the
  `current / total` pager inside its action toolbar once the row is hovered or
  focused; the toolbar, including the pager, is hidden by default. Retry does
  not move or detach the selector from that bubble. Switching restores the
  archived assistant/tool branch in place. Reload preserves the active variant
  and the full revision set.
- **Specs linked**: `04-ux/08-component-spec.md`, `03-runtime/04-data-storage.md`
- **Acceptance**: C (chat stream), F (persistence)
- **Milestone**: M5
- **Status**: Unit-covered (`sessions::tests::save_and_activate_message_revision`, schema v4 migration); full scenario Draft

#### E2E-063: Empty home omits suggestion cards without leaving a layout gap

- **Preconditions**: App running on empty chat home (no transcript) in light
  and dark themes; window can be resized to ~1200×690 and ~900×640.
- **Steps**: 1) Open empty home. 2) Inspect the space between the hero and home
  composer with onboarding visible. 3) Dismiss onboarding and inspect again.
  4) Repeat in the other theme. 5) Resize to a short height and scroll if
  needed.
- **Expected**: No Explore / Build / Review / Fix cards render. Hero, optional
  checklist, and composer form one scrollable stack; dismissing the checklist
  leaves no empty spacer. The composer never covers the checklist, and short
  windows keep every remaining block reachable via scroll.
- **Specs linked**: `04-ux/01-ui-ia.md`, `04-ux/07-ui-design-system.md`,
  `04-ux/08-component-spec.md`, `08-meta/decisions-log.md` (D111/D131)
- **Acceptance**: Quality (layout integrity)
- **Milestone**: M5
- **Status**: Unit-covered (`home-empty-layout.test.mjs`); full UI scenario Draft

#### E2E-064: Durable notification inbox records terminal task outcomes

- **Preconditions**: Two durable sessions exist; a deterministic provider can
  complete one turn, fail one turn with a stable error code, and abort one
  turn; notification inbox starts empty.
- **Steps**: 1) Focus and view session A, then complete a turn in A. 2) While
  still focused on A, fail a turn in background session B. 3) Unfocus the
  window and complete another turn in A. 4) Abort a fourth turn. 5) Repeat each
  terminal RPC. 6) Confirm the main titlebar has no bell, then open the bell in
  the expanded sidebar footer and switch between All and Unread. 7) Mark one
  row read, close/reopen the popover, and restart the app. 8) Select the other
  row. 9) Generate a host fixture with 205 eligible terminal turns. 10) Use
  Mark all read, then Clear.
- **Expected**: A's visible-current completion creates no row. Exactly two rows
  exist, newest first: the unfocused A completion and background B failure,
  with localized labels, snapshotted session titles, and B's stable code.
  Abort/repeated terminal calls create no row. The former footer Help shortcut
  is absent; the 32px footer bell and its upward-opening popover replace it.
  Badge and Unread show the exact unread count without opening implicitly
  reading rows. Read state and both
  records survive restart. Row selection marks it read and activates its bound
  project/session. The fixture retains exactly the newest 200 rows. Mark all
  preserves rows with zero unread; Clear empties only the inbox and leaves
  sessions, turns, and transcripts intact.
- **Specs linked**: `03-runtime/04-data-storage.md`,
  `03-runtime/06-host-rpc-protocol.md`, `03-runtime/01-ipc-protocol.md`,
  `04-ux/08-component-spec.md`, `08-meta/decisions-log.md` (D117/D130)
- **Acceptance**: C (turn completion), F (persistence), Quality
- **Milestone**: M5
- **Status**: Draft

#### E2E-065: Native task notifications are unfocused-only and activate sessions

- **Preconditions**: Native notifications are supported; sessions A and B
  exist; the main window can be focused, unfocused, hidden, and minimized.
- **Steps**: 1) Keep the app focused on A and complete a turn in A. 2) While
  still focused on A, complete a turn in B. 3) Unfocus the app while A remains
  current and complete another turn in A. 4) Click A's native notification. 5)
  Minimize the app, fail another turn, and click its native notification. 6)
  Unfocus the app and abort a turn. 7) Repeat with native delivery suppressed
  by the OS.
- **Expected**: Focused-current A creates neither inbox row nor native banner.
  Focused-background B creates an inbox row without a native banner. Unfocused
  current A and the minimized failure each create one durable row and one
  localized native notification. Clicking restores, shows, and focuses the
  main window before activating the matching session; no event opens the wrong
  currently selected session. Abort shows neither surface. OS suppression does
  not lose the durable row or surface a misleading app error.
- **Specs linked**: `03-runtime/01-ipc-protocol.md`,
  `04-ux/09-interaction-patterns.md`, `08-meta/decisions-log.md` (D117)
- **Acceptance**: C (turn completion), Quality
- **Milestone**: M5
- **Status**: Draft

#### E2E-066: Provider model catalog survives restart and offline refresh

- **Preconditions**: A saved provider has returned at least two models from its
  discovery endpoint and the resulting catalog is stored in `models`.
- **Steps**: 1) Quit and restart the app. 2) Disconnect the provider endpoint.
  3) Open the composer model picker. 4) Wait for background refresh to fail.
  5) Reconnect the endpoint with one renamed model and one additional model,
  then update the provider configuration and reopen the picker.
- **Expected**: The first picker open renders the prior catalog without starting
  from an empty list. Offline refresh preserves every cached entry and the
  configured-model fallback. After reconnection, live results update the
  renderer and persist to Rust-owned SQLite. User-defined model rows remain
  unchanged, and the newly discovered model remains available after another
  restart.
- **Specs linked**: `03-runtime/04-data-storage.md`,
  `03-runtime/12-provider-config-schema.md`,
  `03-runtime/13-model-catalog-and-selection.md`, `04-ux/08-component-spec.md`
- **Acceptance**: B (model config), F (persistence), Quality
- **Milestone**: M5
- **Status**: Unit-covered (`providers::tests`, `model-cache.test.mjs`); full
  restart/offline UI scenario Draft

#### E2E-067: Platform application menus and window chrome

- **Preconditions**: Native macOS, Windows, and Linux runners; built desktop
  app; English and zh-CN locales available. The Windows/Linux harness can set
  `PI_DESKTOP_START_MAXIMIZED=1` before launch so Main maximizes the hidden
  native window before renderer mount.
- **Steps**: 1) On macOS, launch both `pnpm dev` and a packaged build. Confirm
  the application-menu title is PI-Desktop, open About PI-Desktop, and inspect
  its name, version, and icon. Then open every system menu and invoke New Task, Open
  Project, Settings, Command Palette, sidebar toggle, editing,
  zoom/fullscreen, Window, Help, Logs, and Check for Updates actions. Verify
  the update status reports that the current fixture version is up to date.
  2) On Windows/Linux, confirm no File/Edit/View/Window/Help menubar appears
  inside the window and the left-side navigation occupies the reclaimed
  titlebar space. Verify F10 and Shift+F10 are not consumed by shell chrome;
  exercise New Task, Open Project, Settings, close-window, zoom, fullscreen,
  search, command-palette, sidebar, and standard editing shortcuts. Invoke
  Check for Updates from Settings -> Info with the same status result.
  3) Close the macOS window, immediately invoke two native menu
  commands, and acknowledge renderer readiness after the replacement loads.
  Verify one window and one delivery per command. 4) On Windows/Linux, repeat
  from the main chat, Settings, and an open work panel. Click the center plus
  the top, bottom, and titlebar-facing edges of each right-side control to
  minimize, maximize, restore, and close the window. 5) Start
  the renderer while its native window is already maximized and inspect the
  initial queried glyph/state. 6) Attempt unknown menu/window IPC actions
  while a window exists and after it closes. 7) Build each target on its
  native runner from a clean release-host directory.
- **Expected**: macOS development and packaged launches show PI-Desktop as the
  native application identity, and the About panel uses the canonical
  PI-Desktop icon; neither surface exposes the stock Electron name or icon.
  macOS follows native menu conventions and accelerators.
  Windows/Linux show no application menu inside the window; navigation and
  right-side controls do not collide with drag regions, keyboard shortcuts
  remain operational, and no work-panel launcher is present. Check for Updates
  invokes the allowlisted update command from the macOS system menu and the
  Settings surface and shows the resulting up-to-date state. Replacement-window
  commands wait for renderer readiness without
  creating duplicate windows or losing events. No Main, Settings, or work-panel
  drag rectangle overlaps the reserved control zone. Window controls remain
  clickable across their full 46px-high hit targets, match native state, and
  have accessible names. Unknown actions fail closed. Each package contains
  the target-native host binary (`.exe` only on Windows). Passing this scenario
  on Windows/Linux proves shell readiness, not first-release qualification.
- **Specs linked**: `03-runtime/01-ipc-protocol.md`,
  `04-ux/01-ui-ia.md`, `04-ux/02-i18n-english-first.md`,
  `04-ux/07-ui-design-system.md`, `04-ux/08-component-spec.md`,
  `04-ux/09-interaction-patterns.md`, `06-delivery/06-release-runbook.md`,
  `08-meta/decisions-log.md` (D118, D121, D129)
- **Acceptance**: A (app startup), Quality
- **Milestone**: M5 on macOS; post-MVP release qualification on Windows/Linux
- **Status**: Unit-covered (`window-menu.test.mjs`,
  `development-branding.test.mjs`); Electron boot probe covers
  platform bridge, native menu installation, and the pre-render maximize
  fixture on Windows/Linux; native visual scenario Draft

#### E2E-068: Fork a conversation into an independent session

- **Preconditions**: An idle project conversation has user, assistant,
  thinking, and tool history plus at least one regenerate variant. A second
  source conversation is running. A Temporary conversation and two retained
  project workspaces contain distinct same-named marker files. The idle source
  has a session-scoped tool grant.
- **Steps**: 1) Open the idle conversation overflow menu with keyboard. 2)
  Choose Create branch. 3) Append a prompt and change model/mode on the child.
  4) Switch the visible workspace, return to the child, and read the marker.
  5) Trigger the previously granted tool and verify confirmation is requested.
  6) Reopen the source. 7) Restart the app and inspect both sessions. 8) Open
  the running conversation overflow menu. 9) Fork the Temporary conversation
  and invoke a workspace-required tool.
- **Expected**: A localized branch title appears in the same project group and
  is activated with composer focus. Its visible active transcript and durable
  project/provider/model/mode/thinking/permission configuration match the
  source snapshot, but regenerate pager history is absent. Child messages and
  later configuration changes do not affect the source; both survive restart.
  The running source action is disabled. No turns, notifications, artifacts,
  permission grants, revisions, or scratch files are copied.
  The marker resolves under the child's inherited project; the Temporary child
  remains path-less and returns `WORKSPACE_REQUIRED`.
- **Specs linked**: `03-runtime/01-ipc-protocol.md`,
  `03-runtime/04-data-storage.md`, `03-runtime/06-host-rpc-protocol.md`,
  `04-ux/01-ui-ia.md`, `04-ux/08-component-spec.md`,
  `04-ux/09-interaction-patterns.md`
- **Acceptance**: C (sessions), D (workspace), F (persistence), Quality
- **Milestone**: M5
- **Status**: Unit-covered (`sessions::tests::fork_session_clones_active_transcript_and_configuration`,
  `session-fork.test.mjs`); full restart UI scenario Draft

#### E2E-071: Fork and edit an assistant response without changing its source

- **Preconditions**: An idle conversation contains two completed user/assistant
  exchanges and the second assistant response has cache-token usage metadata.
- **Steps**: 1) Hover the first assistant response and inspect its toolbar. 2)
  Click Fork. 3) Confirm the activated child ends at that response and append a
  prompt. 4) Reopen the source and choose Edit on the first assistant response.
  5) Change its text and save. 6) Use the response-version pager to switch to
  the original and back to the edit. 7) Append a prompt, restart, and inspect
  source and both children. 8) Repeat while the source is running.
- **Expected**: The completed-assistant toolbar contains Copy, Fork, Edit, and
  Regenerate but no Delete. Fork and Edit are disabled during a source turn.
  Each successful action activates a separately titled session whose history
  stops at the selected response; later source turns are absent. The edit child
  shows the changed response and a `2 / 2` pager, and both original/edited
  variants restore in place after restart. Source text, version history, token
  metadata, later turns, runtime, and cache state remain unchanged. Continuing
  any child affects only that child and reseeds from its own remapped transcript.
- **Specs linked**: `03-runtime/01-ipc-protocol.md`,
  `03-runtime/04-data-storage.md`, `03-runtime/06-host-rpc-protocol.md`,
  `04-ux/08-component-spec.md`, `08-meta/decisions-log.md` (D134)
- **Acceptance**: C (chat stream/sessions), F (persistence), Quality
- **Milestone**: M5
- **Status**: Unit-covered (`sessions::tests::message_scoped_fork_stops_at_selected_assistant_response`,
  `session-fork.test.mjs`, `transcript-style.test.mjs`); full restart UI scenario Draft

#### E2E-069: Sidebar brand returns to chat home

- **Preconditions**: PI-Desktop is open with the expanded sidebar and a chat
  session is active.
- **Steps**: 1) Open Plugins. 2) Inspect the PI-Desktop brand beside
  the sidebar logo. 3) Activate the brand with a pointer. 4) Return to the
  destination and activate the brand with keyboard focus and Enter/Space.
- **Expected**: The canonical logo renders at 20px beside the 15px shell name.
  The complete brand has a localized Home accessible name, visible hover/focus
  feedback, and returns the main pane to the chat destination without clearing
  the active conversation or workspace.
- **Specs linked**: `04-ux/01-ui-ia.md`, `04-ux/07-ui-design-system.md`,
  `04-ux/08-component-spec.md`
- **Acceptance**: Quality
- **Milestone**: M5
- **Status**: Unit-covered (`renderer-branding.test.mjs`,
  `sidebar-navigation.test.mjs`); rendered interaction scenario Draft

#### E2E-070: Settings native select menus follow the Windows theme

- **Preconditions**: PI-Desktop is running on Windows with Settings available
  in both light and dark themes.
- **Steps**: 1) Open Settings → Basics in light theme. 2) Open the Language and
  Default permission mode selects. 3) Repeat in dark theme. 4) Open Settings →
  Model configuration and inspect the default-model and provider API-style
  selects. 5) Scan importable sessions and open the Import grouping select.
- **Expected**: Every closed trigger and opened native option list uses the
  active theme's readable foreground/background pairing. No dark-theme list
  falls back to a light Windows surface with light text, no light-theme list
  uses dark-theme ink, and changing theme updates subsequent openings.
- **Specs linked**: `04-ux/06-settings-ia.md`,
  `04-ux/07-ui-design-system.md`
- **Acceptance**: Quality (cross-platform theme readability)
- **Milestone**: M5
- **Status**: Unit-covered (`settings-general.test.mjs`); Windows rendered
  scenario Draft

## 8. Traceability Matrix





| Acceptance | Scenarios |
|---|---|
| A — App startup | E2E-001, E2E-002, E2E-003, E2E-004, E2E-067 |
| B — Model config | E2E-005, E2E-006, E2E-007, E2E-038, E2E-050, E2E-052, E2E-055, E2E-066 |
| C — Chat & stream | E2E-008, E2E-009, E2E-010, E2E-011, E2E-031, E2E-040, E2E-047, E2E-048, E2E-049, E2E-052, E2E-053, E2E-054, E2E-055, E2E-059, E2E-060, E2E-061, E2E-062, E2E-064, E2E-065, E2E-068, E2E-071 |
| D — Workspace | E2E-012, E2E-013, E2E-047, E2E-049, E2E-057, E2E-058, E2E-060, E2E-068 |
| E — Tools & permissions | E2E-014, E2E-015, E2E-016, E2E-017, E2E-018, E2E-019, E2E-040, E2E-049 |
| F — Persistence | E2E-020, E2E-021, E2E-036, E2E-037, E2E-038, E2E-040, E2E-042, E2E-047, E2E-048, E2E-051, E2E-054, E2E-056, E2E-061, E2E-062, E2E-064, E2E-066, E2E-068, E2E-071 |
| G — Plugins | E2E-022, E2E-023, E2E-024, E2E-025, E2E-026 |
| H — Diagnostics | E2E-027, E2E-031, E2E-034, E2E-042 |
| Security | E2E-028, E2E-029, E2E-030, E2E-049, E2E-068 |
| Quality | E2E-032, E2E-033, E2E-039, E2E-043, E2E-044, E2E-045, E2E-046, E2E-047, E2E-048, E2E-049, E2E-050, E2E-053, E2E-055, E2E-056, E2E-057, E2E-058, E2E-059, E2E-060, E2E-061, E2E-062, E2E-063, E2E-064, E2E-065, E2E-066, E2E-067, E2E-068, E2E-069, E2E-070, E2E-071 |

| Milestone | Scenarios |
|---|---|
| M1 | E2E-001, E2E-002, E2E-003, E2E-028, E2E-029 |
| M2 | E2E-004, E2E-005, E2E-006, E2E-007, E2E-008, E2E-009, E2E-010, E2E-011, E2E-020, E2E-021, E2E-027, E2E-031, E2E-036, E2E-037, E2E-042 |
| M3 | E2E-012, E2E-013, E2E-014, E2E-015, E2E-016, E2E-017, E2E-018, E2E-019, E2E-040 |
| M4 | E2E-022, E2E-023, E2E-024, E2E-025, E2E-026, E2E-030, E2E-038 |
| M5 | E2E-032, E2E-033, E2E-034, E2E-039, E2E-043, E2E-044, E2E-045, E2E-046, E2E-047, E2E-048, E2E-049, E2E-050, E2E-051, E2E-052, E2E-053, E2E-054, E2E-055, E2E-056, E2E-057, E2E-058, E2E-059, E2E-060, E2E-061, E2E-062, E2E-063, E2E-064, E2E-065, E2E-066, E2E-067 (macOS), E2E-068, E2E-069, E2E-070, E2E-071 (+ packaging scenarios in release runbook) |

The `US-UI-*` visual scenarios (§UI shell visual scenarios) trace to the
Codex parity decisions in [decisions-log §D](../08-meta/decisions-log.md)
rather than the A–H criteria; their gold source is the capture suite.

---

## 9. How AI Must Update This Doc

When adding or changing a feature that affects user-visible or protocol-visible behavior:

1. **Add a new scenario** using the template in §6. Assign the next available ID (`E2E-<N>`).
2. **Link it** to the relevant acceptance criterion (A–H) and milestone (M1–M5).
3. **Set status** to `Draft` unless an automated test already exists.
4. **Update the traceability matrix** in §8.
5. **Commit** the update as part of the change (per [ai-development-workflow](03-ai-development-workflow.md) R3).

---

## 10. Future Automation Mapping

When E2E automation is implemented (post-M5):

- Each `Draft` scenario → Playwright test file.
- Scenario ID becomes test case name: `e2e-001-app-launches`.
- Fixtures and test data paths defined in a `tests/e2e/fixtures/` directory.
- CI gate: all E2E scenarios must pass before release.

Automation section will be expanded in a future ADR when the tooling decision is finalized.

---

## 11. Acceptance Criteria

This test plan spec is accepted when:

- [ ] All MVP acceptance criteria (A–H) have at least one E2E scenario.
- [ ] All security acceptance items have at least one E2E scenario.
- [ ] Every scenario links to at least one spec document.
- [ ] Traceability matrix is complete (scenarios ↔ acceptance ↔ milestones).
- [ ] Scenario template is defined and all entries follow it.
- [ ] AI update rules are documented and cross-linked to workflow spec.
- [ ] Environment requirements match baseline (macOS arm64, clean profile).

## UI shell visual scenarios

### US-UI-01 Codex-aligned shell chrome
- Open the desktop app on macOS dark theme.
- Expect charcoal main surface (`#181818`), left sidebar with New task +
  current-project and Temporary session groups, and a floating bottom composer
  with mode/model controls and no workspace rail.
- Expect no blue-slate marketing chrome; primary send control is a circular inverted button.

### US-UI-02 Empty thread hero
- Open or create a thread with zero messages.
- Expect centered hero copy: "What should we build" with optional project name underline when a workspace is open.

### US-UI-03 Sidebar destinations
- Expect the expanded home sidebar to show Plugins without a standalone Projects,
  Pull requests, or Scheduled entry.
- Click Plugins in the left sidebar and expect it to replace the main pane with
  a dedicated page.
- Open Settings → Project archive and use it to open, switch, and close a local
  folder workspace.

### US-UI-04 Composer without workspace context
- With a git workspace open, composer does not show project, Local, or branch
  labels above the prompt surface.
- Permission toggle switches between Agent and Request approval (chat mode).

### US-UI-05 Locale chrome
- On a zh-CN system locale, sidebar labels render in Chinese (新建任务 / 项目 /
  插件 / 临时会话), without 拉取请求 or 已安排 entries.
- Empty-thread hero remains the English PI-Desktop shell copy: "What should we build?".
- Composer omits the 本地 workspace label and shows Chat mode plus the active
  model ID.

### US-UI-06 Session auto-title
- Create a new task and send a first prompt such as "同步代码".
- Expect its project or temporary session row title to become a truncated form
  of that prompt instead of remaining "New task".

### US-UI-08 Titlebar history
- Navigate Settings → Project archive → a project session → Plugins.
- Expect back/forward controls near the traffic-light area to traverse that history.

### US-UI-09 Grouped session title backfill
- Open an older session that previously showed "New task"/"New chat" but has a first user message.
- Expect its scoped sidebar row to display a truncated first-user-message title
  after session list load.

### US-UI-11 Empty draft reuse
- Click New task twice.
- Expect only one empty "New task" draft in the current project or Temporary
  group and the home hero remains visible. Empty drafts in another scope are
  not reused.

### US-UI-12 Composer without workspace rail
- On empty home, project home, and in a thread, expect no project / Local /
  branch context rail above the composer.
- The prompt shell remains one uninterrupted rounded surface with no reserved
  rail height, attached top lip, rail shadow, bottom seam, or separators.

### US-UI-13 Light theme shell parity
- Set theme to system/light on a light macOS appearance.
- Expect sidebar `#f3f3f3`, main `#ffffff`, text `#1a1c1f`, white floating composer, and home hero with project underline.
- Sidebar nav labels (New task / Plugins / Projects group / Sessions group),
  current-project identity, thread titles, and composer controls must remain
  readable dark-on-light (≥4.5:1). Never white/translucent text on the light
  sidebar.
- Titlebar back/forward controls use dark ink on light chrome.

### US-UI-14 Semantic chrome tokens
- Toggle theme system → light → dark without restart.
- Shell chrome (sidebar items, composer runtime controls, icon buttons)
  follows semantic `--ds-text-*` / `--ds-bg-*` tokens in both themes; no
  hard-coded white (`gray-0`) text on light surfaces.

### US-UI-15 Codex density + elevation
- Sidebar nav rows use ~32px height / 13px type with 8px horizontal padding (Codex `radius-token-row` 10px).
- Floating composer uses Codex elevation-prominent: 0.5px stroke + soft 3px/20px shadow (not heavy 10–30px drop).
- Empty hero title is 28px / 34px line-height, weight 400.
- Window restores ≥1000×700 (target 1200×800) if Stage Manager collapses it.

### US-UI-16 WorkBuddy-inspired local profile footer
- On the light/dark home shell, the sidebar footer is a transparent 58px band
  with no separator. It shows a 44px profile trigger containing a 30px circular
  user glyph, `Custom` + `Local profile` / `本地配置` on two lines, and a
  trailing chevron.
- A separate 32px notification Bell remains visible at the right with its
  unread badge. It replaces the former Help shortcut and opens the inbox above
  the footer; the main titlebar has no duplicate Bell.
- Traffic lights sit at Codex `{x:16,y:16}` with 46px toolbar; back/forward nav lives in the drag row after lights.

### US-UI-17 PI-Desktop home hero logo
- On empty chat home, the canonical PI-Desktop PNG renders at 56px above the
  title with its native colors and no decorative hover state.
- Title is 28px / weight 400; active project name uses dotted underline (1px, offset 4px).
- Composer does not render attachment or appshot controls before their payload
  reaches pi end to end.

### US-UI-18 Composer has no inert actions
- On chat home and a docked thread, inspect every composer control.
- Expect no file, photo, or appshot controls while those payloads are
  unsupported by the pi runtime. Exact reasoning-capable models expose the
  current Thinking level immediately to the right of Chat / Agent; unsupported
  models show no trigger. Unknown compatible models can explicitly enable
  thinking from the model menu, and changes update the durable session.
- Expect no project, Local, or branch context labels in the composer.
- Every visible composer control changes the active session, opens its menu, or
  submits/aborts the current turn.



### US-UI-19 Permanent Stage Manager bounds restore
- On macOS with Stage Manager, shrink or unfocus the PI window until width < 960 or height < 640.
- Expect the shell to re-assert a Codex-like footprint (~1200×800, min 960×640) and keep restoring while still collapsed (not only during the first 20s after launch).

### US-UI-20 Dark floating composer box
- Switch to dark theme on chat home.
- Expect main `#181818`, sidebar `#000000`, and the floating composer plate at elevated-primary (`#212121f5` / gray-800 96%) with elevation-prominent stroke + soft lift so the box reads against the main surface.

### US-UI-21 Composer model menu configures pi
- Create a session with provider A/model A, then open the composer model menu.
- Expect enabled, runnable provider/default-model pairs and an Agent entry. The
  model trigger shows only the model ID; a capability-gated Thinking trigger is
  placed beside Chat / Agent instead of being nested in the model menu.
- Select provider B/model B, send a prompt, and expect the main-to-sidecar
  `agent.prompt` payload and pi runtime to use B for that session.
- Switch away and back; expect B to remain selected. While a turn runs, expect
  mode/model controls to be disabled.

### US-UI-22 Profile footer menu
- On the sidebar footer, click the `Custom` / `Local profile` trigger.
- Expect a 280px opaque elevated menu 8px above the footer. It repeats the local
  identity in a non-interactive header, then shows a divider and Settings,
  Logs, and Theme actions in that order.
- Arrow keys wrap through the three actions; Home/End jump to the boundary.
  Escape closes the menu and restores trigger focus. An outside pointer press
  closes it without stealing target focus.
- Settings navigates to the settings page, Logs opens local logs, and Theme
  cycles the current theme after closing the menu.

### US-UI-23 Project archive index
- Open Settings → Project archive.
- Expect the Settings title "Project archive", primary "Add project", and
  either an empty state or a project index with colored glyph, path, durable
  pinned indicator where supplied by the host, archived rows, and active highlight.
- Expand a non-active project and open one of its sessions; expect the app to
  activate that project before selecting the session, so workspace tools and
  session scope use the same project.

### US-UI-24 Settings full-page shell
- Open Settings (footer profile → Settings).
- Expect **full-page** Codex settings (no app sidebar/nav). Left rail has Back
  to app, search, and exactly Basics / Model configuration / Import / Project
  archive / Info in that order; content pane shows section title and the
  destination's settings or archive content.
- Return to the app shell and expect Plugins to remain an independent sidebar
  destination.
- Drag the empty 46px top band over either the rail or content pane; the native
  window moves while Back, search, and navigation remain clickable.

### US-UI-27 Dark destination pages
- Force dark theme and open Plugins and Settings → Project archive.
- Expect black sidebar, main `#181818`, and destination cards/rows readable on elevated dark plates (not flat same-gray).

### US-UI-28 Home empty composer association
- On empty chat home (light + dark), expect the hero, optional onboarding
  checklist, and home composer in one scrollable vertical stack (D111/D131),
  with no suggestion-card row or large empty gap.
- The composer remains a standalone plate without an attached workspace rail.
- Starting a transcript restores the bottom-docked composer with fade veil.

### US-UI-29 Light composer plate legibility
- On light theme empty home, the white composer shell uses one uniform solid
  fill with no internal gradient or background image.
- The shell still reads as an elevated box through a hairline stroke and
  restrained soft shadow against the `#ffffff` main surface.
- Toolbar controls and placeholder remain legible (not pure white-on-white).

### US-UI-30 Composer placeholder copy
- Empty composer shows PI-Desktop placeholder copy: EN `Ask PI-Desktop to do anything`, zh-CN `向 PI-Desktop 下达任意指令`.
- Placeholder ink is legible on light and dark floating plates.

### US-UI-31 Home empty vertical stack (D111)
- Given empty chat home, when the window is ~1200×690, hero, optional
  onboarding checklist, and the home composer render as one centered vertical
  stack with clear gaps (not dual-grow absolute portal regions).
- No suggestion cards render; no absolute overlay covers the onboarding
  checklist.

### US-UI-32 Dark floating box elevation
- Given dark theme empty home, when the composer shell is painted, it uses elevated-primary `#212121` on `#181818` with elevation-prominent stroke+lift identical to light (no heavier custom dark shadow).

### US-UI-33 Scoped sidebar session groups
- The home sidebar has no Recents aggregate.
- It shows one independently collapsible header per retained project path with
  nested sessions and one `Temporary sessions` / `临时会话` header for
  path-less sessions.
- Project and Temporary headers expose compact scope-specific `+` controls;
  project/session overflow menus expose pin/archive actions; nav row pitch
  remains ~32px and session row pitch ~28–31px.

### US-UI-34 Home suggestion cards removed (D131)
- On empty chat home (light + dark), no Explore / Build / Review / Fix cards
  render between the hero and composer.
- The removed card row leaves no blank layout block at ~1200×690 or shorter
  heights; the optional onboarding checklist remains actionable when present.
- Task entry starts directly in the composer; no suggestion-card prompt-prefill
  action remains.

### US-UI-35 Empty composer plate density
- Empty-home composer is compact and content-driven with an empty or one-line
  draft; it does not reserve the former fixed ~148px empty plate.

### US-UI-36 Hero Y + night box elevation
- At ~1200×690 light home, hero first dark ink is near y≈300 (±12px) vs Codex gold.
- Dark home composer plate reads as elevated-primary `#212121f5` with elevation-prominent against `#181818` (not flat same-surface).
- Light composer renders as one uninterrupted solid surface with no context
  rail or independent top elevation.
- Model chip shows the active model ID; its menu contains only runnable
  provider/model choices and Agent.
- Placeholder and approval chip remain legible on light and dark plates.

### US-UI-39 Home mark + hero title optical
- Empty-home PI-Desktop mark is visible (not near-invisible); stroke density remains readable without a decorative ghost effect.
- Empty-home title with a project uses a readable project label span (short basenames may display as `PI-Desktop` for optical parity).

### US-UI-40 Home content width vs rem root
- At 1200×690 light empty home, composer plate outer width is ~744–760px (not ~640px).
- Home suggestion grid spans the same content column as the composer plate.

### US-UI-41 Dark hero + night box readability
- Dark empty home hero title ink is light-on-dark (`--ds-text-primary` / near white), not hardcoded `#1a1c1f`.
- Night composer plate is elevated-primary `#212121f5` on main `#181818` with elevation-prominent; light theme is not forced to the night plate fill.

### US-UI-42 Light New task ghost chrome
- Light empty-home **New task** row has no solid gray chip fill (transparent on `#f3f3f3` sidebar); icon+label only until hover.




### US-UI-43 Empty home plate Y + night elevated-primary
- Open empty home at ~1200×690 light theme.
- Composer plate is bottom-aligned and content-driven: an empty or one-line
  draft uses the compact shell rather than a fixed ~140px minimum; the surface
  remains uniformly solid with no decorative wash.
- Switch dark theme: night plate is elevated-primary (`#212121f5` / gray-800
  96%) with the same restrained elevation and no internal gradient.


### US-UI-44 Settings compact directory + merged sections
- Open Settings light theme at ~1200×690.
- Full-page shell: rail ~260px on `#f3f3f3`, main `#fff`; Back to app; search pill; Basics active pill with icon.
- Rail order is exactly Basics, Model configuration, Import, Project archive,
  and Info;
  there are no Personal/Integrations/Coding group headings, plugin duplicate,
  or placeholder destinations.
- Basics content: large title and an **Appearance** card with working
  system/light/dark controls. Permission defaults, file-open target, language
  override, menu-bar behavior, and bottom-panel behavior are absent until
  host-backed implementations exist.
- Model configuration contains the provider studio hero, default mode/model, Enter-to-send
  switch, and card-based Providers management with an add-provider dialog.
- Plugin load/enable/disable/uninstall remains available from the app shell's
  independent Plugins destination.
- Dark: rail `#000`, main `#181818`, cards elevated `#212121`.

### US-UI-38 Composer workspace context omitted
- On empty home, project home, and after starting a transcript, the composer
  never renders a project / Local / branch capsule.
- Workspace identity remains visible through the home hero or sidebar rather
  than being duplicated above the prompt.

### US-UI-37 Empty draft brand logo + resize
- Empty composer shows the 15px shared brand logo and visible placeholder ink
  (not a blank white/night hole).
- Auto-resize never collapses empty textarea below ~28px.
- Disabled send control is a solid gray chip on light (`#8e8e90`), full opacity with white arrow.
- Dark night plate remains elevated-primary `#212121f5` with readable elevation-prominent on `#181818`.

### US-UI-31b (superseded)
- Superseded by US-UI-31 home empty vertical stack (D111).



### US-UI-46 Home-with-project composer chrome
- Open a project on empty home (no transcript).
- Expect no workspace controls attached to the plate; there is no legacy draft
  mark, and the placeholder uses the PI-Desktop copy.
- Model chip shows the active model ID; the footer uses the circular local-user
  glyph, two-line Custom / Local profile identity, disclosure chevron, and
  separate Help → Settings Info control.

### US-UI-47 Projects index parity
- Open Settings → Project archive.
- Expect the Settings section title, search pill, Add project button, and the
  complete durable project list including archived rows.
- Rows expand for recent tasks; activating a project or one of its sessions
  uses `setProject` without re-picking via dialog and keeps session/workspace
  context synchronized. Sidebar pin/archive/close metadata remains local to
  the renderer and never hides or deletes a durable Project-archive row.


### US-UI-48 Home suggestion glyphs removed (D131)
- On empty home, no code / hammer / refresh / bug suggestion glyphs render.
- No explore / create / review / fix suggestion labels remain in either locale.


### US-UI-49 Scoped sidebar row chrome
- Hover or select a project or temporary session row.
- Expect restrained title rows with active/hover background and compact
  overflow actions for pin/archive (not a Recents aggregate).
- Multiple retained project groups may be visible at once; sessions remain
  under exact-path groups, while closed-project sessions remain available in
  Settings → Project archive.


### US-UI-50 Destination title scale
- Open Settings → Project archive and Plugins.
- Expect large section titles (~28px) consistent with Codex destination/index pages.
- Dark home New task remains a ghost row (no solid selected chip) unless genuinely active.

### US-UI-52 Settings gold chrome metrics (D070)
- Open Settings light Basics at ~1200×690.
- Expect ~275px `#f4f4f4` rail, single active Basics pill, Back + search.
- Expect the working theme selector without inert toggle or open-target rows.
- Expect Permissions + Basics + Appearance elevated cards; Agent,
  Import, and Info remain the only other destinations.
- Resize between 960px, 1200px, and 1600px widths; the content cards fill the
  available right pane at each size without changing the rail or introducing
  horizontal scrolling.

### US-UI-53 Settings dark shell (D070)
- Dark theme Settings Basics: black rail, elevated cards, blue on-toggles, Back returns to chat.
- Row descriptions use theme-aware secondary text and remain clearly readable on
  the `#212121` card surface; they must not fall back to low-contrast muted ink.

### US-UI-54 Toast variants + lifecycle (D085)
- Trigger a success (save provider), an error (run with an invalid key), and an
  info toast from a test plugin.
- Expect a top-center stack on an elevated plate with a tinted variant icon (green ✓ / red ! / info) and an X dismiss per card; newest enters at the top-center anchor and pushes older cards down.
- Success/info auto-dismiss ~4s, error lingers ~8s; hovering a card pauses its countdown; X removes it immediately.
- With the stack overlapping the frameless titlebar band, hover still pauses
  the countdown and every X remains clickable instead of dragging the window.
- Repeating the same action restarts the existing toast instead of stacking a duplicate; stack never exceeds 4.
- Capture rig scenes `pi-toasts-light` / `pi-toasts-dark` show the stack in both themes.

### US-UI-55 Composer textarea growth (D089)
- In both home and thread-docked composers, an empty or single-line draft
  displays one visible text line.
- Enter or paste two through seven visual lines; the textarea grows with the
  wrapped content without manual resizing.
- Add an eighth visual line; the textarea stays at seven visible lines and
  scrolls internally instead of growing the composer further.
- Delete back to one line or submit the draft; the textarea contracts to its
  one-line default.

### US-UI-56 Codex transcript tool activity
- In light and dark themes, tool calls use transparent compact activity rows,
  not elevated cards or colored success rails.
- Consecutive calls appear inside one default-collapsed processing group. Its
  active header shows `Processing · {elapsed}` and its completed header shows
  `Processed for {elapsed}`, plus a localized step count.
- The row shows a semantic 15–16px icon, progressive/past-tense action,
  ellipsized monospace argument hint, quiet disclosure chevron, and localized
  running/error/denied state.
- Fork-family tools show the GitFork branch icon instead of the generic tool
  glyph.
- Expanding a completed call reveals output before input. Both sections are
  independently copyable and capped with internal scrolling.
- Reloading the session preserves the action label and argument hint instead of
  degrading the row to a generic `Tool`.

### US-UI-57 Multi-project sidebar groups
- Open projects A and B without closing either.
- Expect a `Projects` heading with a new-project folder action, one path-keyed
  group per retained project, and an active-state marker on exactly one group.
  Below those groups, expect a separate `Sessions` heading containing path-less
  conversations plus new-session and sort actions. Adjacent project groups read
  as a compact continuous tree without detached card spacing.
- Collapse A by clicking its directory label, expand it from the chevron area,
  then activate B and return to A. Only A's child rows collapse; project `+`
  and overflow actions do not toggle it; the
  active project, topbar path, and transcript switch together; the composer
  remains free of workspace identity chrome.
- Close B and reopen it from Settings → Project archive. Closing removes only the sidebar tab;
  durable project/session rows remain available.

### US-UI-58 Sidebar organization actions
- Open a project and conversation overflow menu.
- Expect localized Pin/Unpin, Archive/Restore, and (for conversations) Delete
  actions with keyboard-reachable menu semantics.
- Open the sort menu from the standalone `Sessions` heading, pin one
  project/session, and choose each user-facing sort mode (Recently updated,
  Created date, Oldest first, Name). Pinned rows remain first.
- Archive a row, verify it is absent by default, enable Show archived, and
  restore it. The transcript and project binding remain unchanged.
- A legacy `manual` preference loads without presenting a drag-reorder
  affordance.

### US-UI-59 Session-rooted background tools
- Start a visible turn in project A, switch to project B while it runs, and
  inspect both sidebar status indicators.
- Expect A's turn to continue in the background, B's composer/context to show
  only B, and tool output/artifacts from A to remain rooted in A without
  opening or activating a work-panel tab over B.
- Open a Temporary session and invoke a workspace-required tool; expect the
  normal `WORKSPACE_REQUIRED` result rather than inheritance from B.


### US-UI-60 WorkBuddy transcript plates (D101)
- Open a mixed transcript in light and dark themes.
- Expect right-aligned compact user plates, transparent full-width assistant
  prose, denser row spacing, and hover-only copy chips under each turn.
- While an assistant answer streams, expect a thin accent left rule rather than
  a boxed frame.


### US-UI-61 Assistant meta chips + retry (D103)
- Complete an assistant turn that reports usage.
- Expect a model badge and token chip under the answer; hover shows the
  input/output breakdown.
- Hover the action row and click Retry; the nearest preceding user prompt is
  re-sent.


### US-UI-62 In-place regenerate (D105)
- On a multi-turn transcript, regenerate an earlier assistant answer.
- Expect the later turns to disappear and the chosen user prompt to re-run in
  place, without stacking a second copy of the prompt.


### US-UI-63 Regenerate history pager (D109)
- Regenerate an assistant answer twice.
- After each retry, hover or focus the root user bubble and expect its action
  toolbar to expose a `1/N` pager for restoring earlier variants.


### US-UI-64 Empty home no composer overlap (D111)
- Open empty home at ~1200×690 and at a shorter height (~900×640).
- Expect hero, optional onboarding checklist, and home composer as one
  scrollable stack with positive vertical gaps and no suggestion cards.
- Short windows scroll the remaining stack rather than stacking the composer
  over the checklist; when the checklist is absent, no empty spacer remains.


### US-UI-65 Durable notification inbox (D117/D130)
- Verify a focused-current completion leaves the inbox unchanged, then
  populate it through background/unfocused completed and failed task rows,
  including one long session title. Inspect the expanded sidebar footer and
  popover in light/dark themes at default and narrow supported widths.
- Expect no titlebar bell, a stable 32px footer bell in the former Help position,
  a non-overlapping `1`–`99` / `99+` badge,
  dense 360px-or-narrower list, localized kind/session/time/error content, and
  distinct text/icon/unread-dot semantics without nested cards or clipped text.
- Switch All/Unread; use Tab, arrow keys, Home/End, Enter/Space, Escape, and
  outside click. Focus order remains predictable, row activation opens the
  correct session, and Escape restores focus to the bell.
- Mark all read and Clear expose icon tooltips/accessible names, disabled and
  empty states remain understandable, and reduced-motion mode changes the
  popover instantly without suppressing focus or unread state.

### US-UI-66 Application update notice layout
- In a conversation with the docked composer visible, exercise manual
  `available`, in-app `downloading`, and `downloaded` update fixtures in light
  and dark themes at default and minimum supported window sizes. Grow the
  composer draft to its maximum visible height.
- Expect one compact update notice below the titlebar in the main pane's
  top-right safe area. It never intersects the composer, including while the
  draft grows, and it does not cover an open work panel.
- Expect a stable update icon/title/message hierarchy, determinate progress for
  `downloading`, the applicable View release or Restart to update action, and a
  24px dismiss control with an accessible name. Dismissing one status stage
  does not suppress a later stage for the same version.

### US-UI-67 Distinct sidebar task status indicators (D135)
- In light and dark themes, keep session B selected while session A progresses
  through in-progress, completed, a new in-progress turn, failed, and aborted
  states. Repeat with reduced motion enabled and inspect keyboard focus.
- Expect A to show an orange breathing dot while in progress, a green check on
  completion, and a red circled alert on failure. Starting a new turn clears
  A's earlier terminal mark; abort leaves no completed or failed mark.
- Expect selected idle B to show a static accent-blue outlined ring and active
  row background. If selected B starts work, its orange in-progress dot takes
  precedence until the turn settles; its latest terminal result remains hidden
  behind the selected ring while selected.
- Every indicator exposes localized In progress / Selected / Completed / Failed
  text through its accessible name and tooltip. Reduced motion makes the orange
  dot static without changing its color or meaning. Row height, title truncation,
  pin icon, hover actions, and focus ring remain stable in both themes.
