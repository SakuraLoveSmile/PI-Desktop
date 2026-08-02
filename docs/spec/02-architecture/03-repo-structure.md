# 03. Repo Structure

## 1. Target structure

```text
PI-Desktop/
├── apps/
│ └── desktop/ # Electron app
│ ├── electron/ # main + preload (TS)
│ ├── src/ # React renderer
│ ├── locales/
│ │ └── en/ # English source locale
│ ├── package.json
│ └── electron.vite.config.ts
├── crates/
│ └── host-core/ # Rust backend host core
│ ├── Cargo.toml
│ └── src/
├── packages/
│ ├── agent-runtime/ # Node pi runtime wrapper
│ ├── plugin-sdk/ # plugin author types/sdk
│ ├── shared/ # shared contracts (TS)
│ └── i18n/ # shared i18n utilities/catalog
├── examples/
│ └── plugins/hello/
├── docs/
│ ├── adr/
│ ├── project/
│ └── spec/
├── scripts/
├── package.json
├── pnpm-workspace.yaml
├── Cargo.toml # rust workspace (optional root)
└── README.md
```

## 2. Package responsibilities

### `apps/desktop`
Product entry:
- Electron lifecycle
- UI
- IPC wiring
- packaging config

### `crates/host-core`
Rust host services:
- tools execution
- permission gateway
- plugin host services
- persistence adapters
- audit logging

### `packages/agent-runtime`
Node wrapper over pi:
- model bootstrap
- agent turn control
- event normalization
- host tool bridge client

### `packages/shared`
Cross-boundary contracts:
- IPC channel names
- DTO types
- error codes
- protocol versioning

### `packages/i18n`
- English message catalog source
- locale loading helpers
- message ID conventions

### `packages/plugin-sdk`
- manifest types
- host API types
- validators

## 3. Runtime data (not in git)

```text
~/.pi-desktop/
 ├── pi.sqlite            # single DB, host-core owned (03-runtime/04, D086)
 ├── secrets/
 ├── attachments/
 ├── logs/
 │    ├── app/<category>.log
 │    ├── host/<category>.log
 │    └── agent/<category>.log
 ├── cache/
 ├── workspaces/
 └── plugins/
 ├── installed/
 ├── data/
 ├── logs/
 └── cache/
```

## 4. Naming conventions

| Object | Convention |
|---|---|
| JS packages | `@pi-desktop/*` |
| Rust crate | `pi-desktop-host-core` (or `host-core`) |
| IPC channels | `pi-desktop/<domain>/<action>` |
| i18n keys | `domain.section.key` |
| Plugin IDs | reverse-domain style |
