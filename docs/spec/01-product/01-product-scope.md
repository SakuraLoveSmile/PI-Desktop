# 01. Product Scope

## 1. Positioning

PI-Desktop is for developers and power users who want a local agent that can read/modify projects with visible control.

It combines:

- strong desktop UX
- pi agent capabilities
- Rust-backed local host operations
- user-extensible plugins

## 2. Target users

### Primary
- Developers using coding agents daily
- Users who need local file/command execution
- Users in the pi ecosystem

### Secondary
- Teams needing custom providers/base URLs
- Plugin authors extending workflows

## 3. Core scenarios

### A. Project Q&A
Open a repository and ask architecture/code questions.

### B. Controlled edits
Request a code change, review tool calls, approve writes.

### C. Run and diagnose
Run tests/commands, inspect outputs, iterate.

### D. Multi-session work
Keep parallel sessions for refactor, debugging, docs, etc.

### E. Custom plugin extension
Install or develop local plugins for commands/panels/tools.

## 4. MVP in scope

- Electron desktop app (macOS first)
- English default UI + i18n framework
- Session create/switch/restore
- Multi-provider configuration
- Secure API key storage
- Streaming output + abort
- Workspace binding
- Builtin tools: Read / Write / Edit / Glob / Bash (+ Grep)
- Tool-call visualization
- Permission confirmations
- SQLite persistence
- Plugin system skeleton:
 - local/dev load
 - enable/disable
 - command palette registration
 - at least one sample plugin path
- Rust host core skeleton for privileged operations

## 5. Out of scope (current phase)

- Remote Gateway / browser remote control
- Cloud account sync
- Full IDE experience
- Complete plugin marketplace
- Mobile clients
- Billing systems
- Computer Use browser takeover

## 6. Operating modes

| Product selector | Behavior |
|---|---|
| Agent | The pi Agent runs with the full execution tool set under the selected permission policy. |
| Plan | The same pi Agent runs in planning state. It can inspect with Read/Glob/Grep/BrowserPreview, run Bash under the selected permission policy, use plan/context controls, and call `SubmitPlan(title, markdown, question)`. Host-core preserves the exact Markdown bytes in a new immutable `<workspaceRoot>/.pi/plan/*.md` artifact before separate approval; title/question remain structured approval fields and the card opens the artifact. Write/Edit/plugin tools are denied. |

Plan is a planning intent, not a strict read-only security profile: Bash under
`ask` or `accept-edits` prompts, while Bash under `auto` runs without
confirmation and may mutate the workspace or scratch directory. The Plan
selector and `EnterPlanMode` both address the same Agent; approval transitions
that Agent into Agent execution without creating a second planner. Approval is
approve/reject only, and the explicit execution permission selection defaults to
Ask. A host restart interrupts pending, queued, or running Plan work without
replay; an already-approved interrupted run leaves the session in Agent.

Existing persisted `Chat` mode values migrate to `Plan`. New sessions and new
scheduled tasks default to Agent. The conversation surface may continue to use
the internal `page = "chat"` route value; that value is not an operating mode.

## 7. Success criteria

1. First useful chat in under 5 minutes
2. Complete one controlled local edit on a real project
3. Tool calls are readable and interruptible
4. Sessions survive restart
5. Renderer never has direct Node/FS privileges
6. UI is fully usable in English
7. A submitted plan cannot cross into execution without a separate matching
   approval; its exact Markdown bytes are preserved in a unique `.pi/plan/*.md`
   artifact and the approval row records its path, hash, and size

## 8. Naming

- Product: `PI-Desktop`
- Package: `pi-desktop`
- Application ID: `com.pi-desktop.app`
- Window title: `PI-Desktop`

## 9. Platform strategy

| Platform | MVP | Notes |
|---|---|---|
| macOS Apple Silicon | Published | Primary development and acceptance platform |
| macOS Intel | Not packaged | No current x64 release target |
| Windows x64 | Published | NSIS installer and in-app update lane; native qualification continues |
| Linux x64 | Published | AppImage and deb packages; AppImage update lane; native qualification continues |
