# 14. Plugin Roadmap

## 1. Guiding principle

```text
Local plugins usable → developer-friendly → marketplace distribution → signing and auto-update
```

## 2. Roadmap

### R1 — Foundation (with M4) ✅
- manifest v1
- Local directory loading
- enable/disable/uninstall
- command palette integration
- hello example plugin
- permission declaration display

### R2 — Agent Extension ✅ (core)
- Full agentTools pipeline
- skills contribution
- Per-plugin settings within the app shell's Plugins destination
- Plugin log panel (host audit channel)
- Unified namespace and audit

### R3 — DX & Packaging (partial ✅)
- plugin-sdk
- Template generation (still planned)
- `pi-plugin check/pack` (still planned)
- `.piplug` install ✅
- dev hot reload (still planned)

### R4 — Marketplace Read-only ✅
- market provider abstraction (official local catalog provider)
- Official-source browse/search
- Download + checksum install
- updates list (manual update)

### R5 — Trust & Auto Update (partial ✅)
- Publisher verification (verified flag in catalog)
- Signature verification (still planned; checksum enforced now)
- Permission-diff upgrade ✅
- Auto-update policy ✅
- Malicious-version yank response (still planned)

### R6 — Advanced Ecosystem
- MCP plugin type
- Background service plugins
- Enterprise private sources
- Inter-plugin message bus
- Marketplace reviews / quality score (optional)

## 3. Mapping to product milestones

| Product milestone | Plugin goal |
|---|---|
| M1 Skeleton | Reserve the plugins directory and interface stubs |
| M2 Chat Runtime | Non-blocking; can be designed in parallel |
| M3 Tools | ToolHost reserves contribution hooks |
| M4 Plugin Foundation | R1 complete |
| M5 Hardening | Plugin isolation and stability |
| Post-MVP | R2–R6 in phases |

## 4. Success metrics (ecosystem)

1. Users can extend their workflow via plugins even without a new official release
2. Third parties can independently develop and locally install plugins
3. A plugin failure does not break the main app's availability
4. Permissions are visible and refusable before installing any plugin

## 5. Risks and mitigations

| Risk | Mitigation |
|---|---|
| Building the marketplace too early destabilizes the core | Defer the marketplace; R1 does local first |
| Plugin security incident | Deny by default + audit + mandatory signing later |
| Frequent API breakage | apiVersion / schemaVersion |
| High developer barrier | Templates + hello example + SDK |
