# PI-Desktop Spec

> Baseline: `0.4.14`
> Updated: `2026-07-31`
> Language: **English-first**
> Stack: Electron + **Rust host core** + pi Agent Harness + user-installable plugins

## Quick entry

| Doc | Description |
|---|---|
| [NAV.md](NAV.md) | One-page full navigation |
| [00-baseline.md](00-baseline.md) | Frozen baseline |
| [08-meta/decisions-log.md](08-meta/decisions-log.md) | Frozen detail decisions |
| [01-product/00-overview.md](01-product/00-overview.md) | Overview |
| [02-architecture/01-architecture.md](02-architecture/01-architecture.md) | Architecture |
| [03-runtime/05-host-core-rust.md](03-runtime/05-host-core-rust.md) | Rust host core |
| [04-ux/02-i18n-english-first.md](04-ux/02-i18n-english-first.md) | i18n policy |
| [04-ux/07-ui-design-system.md](04-ux/07-ui-design-system.md) | Design system (tokens, motion, density) |
| [../project/plan-mode-implementation-plan.md](../project/plan-mode-implementation-plan.md) | Plan operating-state implementation plan |
| [07-plugins/01-plugin-system.md](07-plugins/01-plugin-system.md) | Plugin system |
| [06-delivery/03-ai-development-workflow.md](06-delivery/03-ai-development-workflow.md) | AI dev workflow rules |
| [06-delivery/04-e2e-test-plan.md](06-delivery/04-e2e-test-plan.md) | E2E test plan & scenarios |
| [06-delivery/05-change-checklist.md](06-delivery/05-change-checklist.md) | Change checklist |

## Directory map

```text
docs/spec/
├── 00-baseline.md
├── 01-product/
├── 02-architecture/
├── 03-runtime/
├── 04-ux/
├── 05-security/
├── 06-delivery/
├── 07-plugins/
└── 08-meta/
```

## Reading paths

### Product
1. `00-baseline.md`
2. `01-product/00-overview.md`
3. `01-product/01-product-scope.md`
4. `06-delivery/01-mvp-milestones.md`

### Implementation
1. `00-baseline.md`
2. `02-architecture/01-architecture.md`
3. `03-runtime/05-host-core-rust.md`
4. `03-runtime/02-agent-runtime.md`
5. `03-runtime/01-ipc-protocol.md`
6. `03-runtime/11-provider-model-system.md`
7. `07-plugins/01-plugin-system.md`

### Plugin authors
1. `07-plugins/01-plugin-system.md`
2. `07-plugins/02-plugin-manifest-schema.md`
3. `07-plugins/03-plugin-api.md`
4. `07-plugins/10-plugin-devex.md`
5. `examples/plugins/hello`

## Frozen decisions (short)

1. Electron shell
2. English-first product/docs
3. Rust host backend core
4. pi agent engine in Node sidecar
5. Host RPC = stdio JSON-RPC NDJSON
6. SQLite owned by Rust only
7. Default mode = Agent; operating selector = Agent | Plan; Plan is the same
   Agent in planning state and is not a strict read-only security profile
8. SubmitPlan writes exact Markdown bytes to a new host-owned
   `.pi/plan/*.md` artifact; title/question stay structured in
   `plan_approvals`, approval opens the artifact, is approve/reject only, and
   expires after 30 absolute minutes with `PLAN_APPROVAL_TIMEOUT`
9. Protocol v9 and storage schema v10 are authoritative for Plan checkpoints,
   `plan_approvals` execution fields, startup interruption, and shell identity
10. Permission timeout 120s deny; Bash timeout 60s by default
11. Local user-installable plugins (market later)
12. Tag releases = macOS arm64, Windows x64, and Linux x64 (D126)
13. Universal provider/model coverage (native + OpenAI-compatible + custom)
