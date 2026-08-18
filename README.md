<div align="center">

<img src="docs/image/readme/logo.png" alt="PI-Desktop logo" width="120" />

# PI-Desktop

**A local-first desktop app for AI coding agents.**

Bring your own models. Keep your code, your keys, and your conversations on your machine.

[![Release](https://img.shields.io/github/v/release/vastsa/PI-Desktop?include_prereleases&label=release)](https://github.com/vastsa/PI-Desktop/releases/latest)
[![CI](https://github.com/vastsa/PI-Desktop/actions/workflows/ci.yml/badge.svg)](https://github.com/vastsa/PI-Desktop/actions/workflows/ci.yml)
![Platforms](https://img.shields.io/badge/platform-macOS%20%C2%B7%20Windows%20%C2%B7%20Linux-4c8dd8)

[Download](#download) · [Getting started](#getting-started) · [Highlights](#highlights) · [Screenshots](docs/guide/screenshots.md) · [How it works](#how-it-works) · [Development](#development) · [简体中文](README.zh-CN.md)

<br/>

<img src="docs/image/readme/home.webp" alt="PI-Desktop home — pick a task and start" width="88%" />

</div>

## What is PI-Desktop?

PI-Desktop puts an AI coding agent in a native desktop app. Point it at a project, describe what you want — explore and understand code, build a feature, review changes, fix a failing test — and watch it work, with every file edit and shell command surfaced for your approval.

There is no account, no subscription, and no cloud in the middle: you connect the model provider you already use, and everything else — sessions, settings, API keys — stays local.

## Highlights

- **Any model, your keys.** Anthropic, OpenAI, or anything that speaks an OpenAI-compatible API — hosted relays as well as local gateways like Ollama or LM Studio. Model IDs are free-form (no hardcoded allowlist), with per-model context window, output limit, temperature, and thinking-mode controls.
- **Agent, Plan, and Goal modes.** Agent mode reads, edits, and runs commands to get things done. Plan has the same agent inspect the project and submit an immutable implementation checkpoint for approval. Goal lets the agent agree on an outcome and acceptance criteria, then continue autonomously after approval.
- **You approve every change.** File writes and shell commands ask first, with session-scoped grants and a configurable default policy. Unanswered prompts deny by default.
- **A real workbench.** Review the agent's edits as message-scoped diffs with guarded rollback, open a terminal, preview a local app in a browser, and browse project files — all in a side panel, without leaving the conversation.
- **Projects and sessions.** Sessions are grouped by project in a multi-project sidebar, with pinning, archiving, sorting, branching, notifications, and throwaway scratch sessions.
- **Local-first and private.** Transcripts live on disk as plain JSONL with a SQLite index — easy to back up, grep, or delete. API keys go into the OS keychain. Logs stay local; there is no telemetry.
- **Extensions beyond plugins.** Manage standalone MCP servers, Skills, and Subagents from the Extensions page, with global or project-scoped activation. Plugins can add commands, panels, agent tools, skills, themes, MCP servers, resident services, and a message bus; the local/official marketplace and `.piplug` package workflow are available today.
- **A fast daily workflow.** Use slash commands and `@` file references, paste files into session scratch, stage the next turn while an answer streams, search plugins globally with Option/Alt+Space, and create manual or recurring task prompts.
- **Comfortable to live in.** English and 简体中文, light/dark/system and plugin themes, command palette, onboarding checklist, local notifications, context checkpoints, and update notifications for packaged builds.

Plugin APIs and panels are permission-gated and run out-of-process. Plugin code is still user-trusted code rather than a complete OS sandbox, so review permissions and only install plugins you trust.

<table>
  <tr>
    <td width="50%"><img src="docs/image/readme/conversation.webp" alt="A conversation with the minimap rail on the right" /></td>
    <td width="50%"><img src="docs/image/readme/marketplace.webp" alt="The plugin marketplace with installable plugins" /></td>
  </tr>
  <tr>
    <td align="center"><sub>Every turn in one transcript, with a minimap rail for long conversations</sub></td>
    <td align="center"><sub>Install from the official catalog, a mirror, or a custom URL you configure</sub></td>
  </tr>
  <tr>
    <td width="50%"><img src="docs/image/readme/models.webp" alt="The model menu in the top bar" /></td>
    <td width="50%"><img src="docs/image/readme/basics.webp" alt="Basics — language, theme, and appearance" /></td>
  </tr>
  <tr>
    <td align="center"><sub>Switch the model per session — any provider you have configured, keys in the OS keychain</sub></td>
    <td align="center"><sub>Language, theme, and appearance, including themes plugins contribute</sub></td>
  </tr>
</table>

<p align="center"><sub><a href="docs/guide/screenshots.md">See every screen →</a></sub></p>

## Download

Grab the latest build from the [Releases page](https://github.com/vastsa/PI-Desktop/releases/latest).

| Platform | Package | Status |
|---|---|---|
| macOS (Apple Silicon) | `.dmg` / `.zip` | ✅ Published with each release |
| Windows (x64) | NSIS installer | ✅ Published with each release; in-app auto-update |
| Linux (x64) | `.AppImage` / `.deb` | ✅ Published with each release; AppImage auto-updates in-app |

> **macOS note:** builds are not yet code-signed or notarized. If macOS refuses to open the app, right-click it and choose **Open**, or clear the quarantine flag:
>
> ```bash
> xattr -cr /Applications/PI-Desktop.app
> ```

Packaged builds check GitHub Releases for new versions and show an in-app update banner.

## Getting started

1. **Add a model provider.** Open **Settings → Model configuration → Add provider**: pick the API style, paste the base URL and your API key, then choose or type a model ID. The key is stored in your OS keychain and never shown again.
2. **Open a project.** Add a project folder from the sidebar — sessions, tools, and permissions are scoped to it.
3. **Describe the task.** Start in Agent mode to make changes, switch to Plan for an approval checkpoint, or use Goal when you want to approve an outcome rather than prescribe the steps. Review work in the **Review** diff panel before you commit anything.
4. **Extend the workspace when needed.** Open **Extensions** to add an MCP server, a Skill, a Subagent, or a plugin. Use **Settings → Import** to bring in local sessions from Claude Code, OpenCode, Codex, or Pi.

## How it works

PI-Desktop keeps renderer privileges narrow and separates the agent loop from the desktop UI:

- **Electron shell** — a sandboxed React renderer plus the main/preload bridge for desktop-only services such as panels, terminal, browser preview, updates, and supervision.
- **Rust host core** — owns SQLite, transcript persistence, secrets, permissions, and workspace access over stdio JSON-RPC.
- **pi agent sidecar** — a Node process running the pi agent engine (`pi-ai` + `pi-agent-core`) for the actual agent loop.

The full picture lives in the [architecture spec](docs/spec/02-architecture/01-architecture.md).

## Status & roadmap

PI-Desktop is an early preview under active development. The current 0.5.x line ships the app shell, streaming agent runtime, Agent/Plan/Goal contracts, workspace tools with permissions, the workbench, projects and sessions, imports, extensions (plugins/MCP/Skills/Subagents), context checkpoints, notifications, and cross-platform packaging with update checks.

Still in progress: signed and notarized macOS builds, native Windows/Linux qualification, a stronger plugin sandbox and publisher-signature path, and full UI-driven E2E coverage. See the [milestones](docs/spec/06-delivery/01-mvp-milestones.md) and the [project board](docs/project/BOARD.md).

## Development

Prerequisites: Node.js `>=22.19`, pnpm `>=10` (the repository uses pnpm 11), and a stable Rust toolchain.

```bash
# build the Rust host core
cargo build -p host-core

# install JS dependencies and build packages + app
pnpm install
pnpm build:js

# run in dev mode
pnpm dev

# protocol e2e smoke test
PI_DESKTOP_TEST_API_KEY=... pnpm test:e2e

# Plan host acceptance (includes the real 60-second default timeout)
PI_DESKTOP_E2E_LONG_TIMEOUT=1 pnpm test:e2e:plan

# rendered English / Simplified Chinese Plan acceptance through Electron CDP
pnpm test:e2e:plan-ui

# focused desktop probes
pnpm test:e2e:boot
pnpm test:e2e:supervision
pnpm test:e2e:subagents
```

CI runs JS build / typecheck / lint / unit tests plus `cargo test` for
code-related pull requests and pushes to `main`; documentation-only changes are
skipped. Releases are cut by tag:

```bash
node scripts/release.mjs 0.2.0 --tag   # bump versions + commit + tag v0.2.0
git push origin main v0.2.0            # Release workflow builds & publishes
```

### Documentation

- [Plugin development: zero to one](docs/plugin-development.md)
- [Screens](docs/guide/screenshots.md) — every surface, captured from the running app
- [Spec index](docs/spec/README.md) — start here
- [Product scope](docs/spec/01-product/01-product-scope.md)
- [Baseline decisions](docs/spec/00-baseline.md)
- [Architecture](docs/spec/02-architecture/01-architecture.md)
- [UI information architecture](docs/spec/04-ux/01-ui-ia.md)
- [E2E test plan](docs/spec/06-delivery/04-e2e-test-plan.md)
- [Plugin system](docs/spec/07-plugins/01-plugin-system.md)
- [ADRs](docs/adr/) · [Milestones](docs/spec/06-delivery/01-mvp-milestones.md) · [Agent guide](AGENTS.md)

## Open-source acknowledgements

PI-Desktop is built with and informed by these open-source projects:

- **Agent runtime:** [pi-mono](https://github.com/badlogic/pi-mono), whose
  `pi-ai` and `pi-agent-core` packages provide the agent loop and provider
  abstractions.
- **Desktop and UI foundation:** [Electron](https://github.com/electron/electron),
  [React](https://github.com/facebook/react),
  [Vite](https://github.com/vitejs/vite),
  [Tailwind CSS](https://github.com/tailwindlabs/tailwindcss),
  [Lucide](https://github.com/lucide-icons/lucide),
  [xterm.js](https://github.com/xtermjs/xterm.js),
  [Shiki](https://github.com/shikijs/shiki),
  [Mermaid](https://github.com/mermaid-js/mermaid),
  [KaTeX](https://github.com/KaTeX/KaTeX),
  [TypeBox](https://github.com/sinclairzx81/typebox), and
  [i18next](https://github.com/i18next/i18next).
- **Behavioral and visual references:**
  [OpenAI Codex](https://github.com/openai/codex) informs parts of the shell
  and context-management UX. [OpenCode DCP](https://github.com/Opencode-DCP/opencode-dynamic-context-pruning)
  was studied as a behavioral reference for context compaction; it is not a
  PI-Desktop dependency, and no code is copied from it.
- **Bundled fonts:** [Geist](https://github.com/vercel/geist-font),
  [Inter](https://github.com/rsms/inter),
  [Noto Sans SC](https://github.com/google/fonts) (Source Han Sans lineage),
  and [LXGW WenKai](https://github.com/lxgw/LxgwWenKai), which includes work
  from [Klee](https://github.com/fontworks-fonts/Klee). Their SIL Open Font
  License texts are included under
  [`apps/desktop/src/assets/fonts/licenses/`](apps/desktop/src/assets/fonts/licenses/).

## Community Links

- [Linux.Do](https://linux.do/) — A community for sharing and discussing technology.

## License

TBD — a license will be finalized before the first stable release.
