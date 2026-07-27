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

## 6. Modes

| Mode | Behavior |
|---|---|
| Chat | Prefer read-only behavior; high-risk tools restricted |
| Agent | Tools available under permission policy |

## 7. Success criteria

1. First useful chat in under 5 minutes
2. Complete one controlled local edit on a real project
3. Tool calls are readable and interruptible
4. Sessions survive restart
5. Renderer never has direct Node/FS privileges
6. UI is fully usable in English

## 8. Naming

- Product: `PI-Desktop`
- Package: `pi-desktop`
- Application ID: `com.pi-desktop.app`
- Window title: `PI-Desktop`

## 9. Platform strategy

| Platform | MVP | Notes |
|---|---|---|
| macOS Apple Silicon | Required | Primary dev/acceptance |
| macOS Intel | Compatible | Best effort |
| Windows x64 | Planned | Architecture reserved |
| Linux x64 | Planned | Architecture reserved |
