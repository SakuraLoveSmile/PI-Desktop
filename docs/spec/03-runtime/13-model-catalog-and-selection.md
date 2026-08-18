# 13. Model Catalog & Selection

## 1. Product rule

Users must be able to use **market-available models broadly**, not only a curated demo subset.

Therefore:

1. Catalog is refreshable
2. Custom model IDs are always allowed
3. OpenAI-compatible gateways are first-class
4. Search is global across enabled providers

## 2. Selection UX

### Model picker fields
- search box
- provider filter
- capability filters: tools / vision / reasoning
- sort: recent / provider / name

### Item display
- model display name
- model id
- provider name
- capability badges
- optional context window

### Advanced
- “Use custom model ID”
- “Refresh catalog”

## 3. Recent models

Persist recent selected model refs:

```ts
type RecentModelRef = {
  providerId: string
  modelId: string
  usedAt: string
}
```

Show top N in picker.

## 4. Session model binding

Each session stores:

- `providerId`
- `modelId`
- `thinkingLevel` (`off|minimal|low|medium|high|xhigh|max`)

Changing model or thinking level mid-session affects subsequent turns only.
The stored thinking preference survives restart; the effective request level
is capability-clamped for the selected model at execution time.

For a newly created session, the renderer resolves the app default provider's
current default-model capability. A reasoning-capable model starts at the
highest canonical level in its published `supportedThinkingLevels`; a
non-reasoning model or missing capability metadata starts at `off`. This is a
creation default only and never rewrites an existing session's stored choice.

## 5. Capability warnings

If user selects model tagged without tools while in Agent mode:

- show non-blocking warning
- do not hard-block (vendor tags may be incomplete)

## 6. Refresh behavior

`providers.refreshModels`:

1. query runtime-supported discovery endpoints
2. merge into catalog cache
3. keep user-defined models
4. return counts: added/updated/failed providers

The desktop uses stale-while-revalidate for configured providers:

1. hydrate each saved provider's last catalog from Rust-owned SQLite during
   renderer bootstrap
2. render that catalog immediately in the composer picker and saved-provider
   edit dialog
3. perform at most one live refresh per provider per renderer lifetime
4. merge a successful response into SQLite and replace the renderer snapshot
5. reset the renderer refresh marker after provider configuration changes so
   the next picker open revalidates the endpoint

## 7. Offline behavior

If refresh fails / offline:

- use cached catalog
- never clear an already-rendered cached list or flash an empty picker
- allow custom model id
- still allow providers with known model ids

## 8. Catalog item schema

```ts
type ModelCatalogItem = {
  providerId: string
  vendorKey: string
  modelId: string
  displayName: string
  source: "bundled" | "discovered" | "user" | "recent"
  capabilities: Array<
    | "tools"
    | "vision"
    | "reasoning"
    | "streaming"
    | "json"
    | "long_context"
  >
  contextWindow?: number
  maxOutputTokens?: number
  deprecated?: boolean
  notes?: string
  supportedThinkingLevels?: Array<
    "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max"
  >
}
```

## 9. Selection resolution order

When UI/search requests models for picker:

1. recent models for enabled providers
2. user-defined models
3. discovered/refreshed cache
4. bundled snapshot
5. always include "custom model id" entry action

Deduplicate by `(providerId, modelId)` with priority:
`user > discovered > bundled > recent-only`.

## 10. Default model policy

App-level default:
- first successfully tested provider + its default/recommended model
- if none configured, onboarding checklist requires provider setup before first agent run

Session-level:
- inherits app default at creation
- initializes thinking to the highest level published by the inherited model
  when it supports reasoning, otherwise `off`
- can override independently

## 11. Capability gating

| mode/feature | required capability |
|---|---|
| Agent mode tools | `tools` (warn if missing; hard-block only if runtime cannot function) |
| image input | `vision` |
| reasoning UI affordances | `reasoning` |
| structured repair helpers | `json` optional |

Warnings are non-blocking unless execution is impossible.

### 11.1 Reasoning capability resolution

1. Resolve pi catalog metadata for the exact `(vendorKey, modelId)` or a
   separator-bounded compatible-gateway alias.
2. The complete pi model record is authoritative; cached/discovered model
   capabilities and legacy provider overrides cannot replace its reasoning
   flag or thinking-level map.
3. A free-form id absent from pi is an unknown generic model and exposes only
   `off`; the UI cannot promote it to reasoning-capable.
4. The Composer renders the selector only when the resolved pi model supports
   reasoning and lists only the resolved `supportedThinkingLevels`.
5. If a stored/requested level is unavailable, choose the nearest supported
   level by scanning upward first and then downward. Non-reasoning models
   always resolve to `off`.
6. Changing to a non-reasoning provider persists `off`; no unsupported level
   leaks into the next request.

### 11.2 Vision capability resolution

1. Resolve the same exact pi model record used to build the sidecar provider.
2. Mark the model `vision` only when `input.includes("image")` is true.
3. A discovered, cached, or user-defined capability flag may remain useful as
   selection metadata, but it cannot promote an unknown runtime model to image
   transport. Unknown/custom models therefore show the path-fallback status in
   Composer.
4. The main process prepares pasted images as content-addressed refs. A
   vision-capable model receives images within the 20 MiB app-side inline
   bound as transient image blocks; other cases receive a safe `@path`.

## 12. Refresh strategy

- manual refresh button in settings/model picker
- optional refresh on provider create/test success
- no aggressive background polling in MVP
- refresh failures keep previous cache and surface non-fatal error

Electron decorates cached and freshly discovered model rows with the matching
`pi-ai` model record when one exists. Its `contextWindow` is the authoritative
value for the picker and context inspector because the same record is passed to
the agent sidecar. Provider discovery remains the fallback for models absent
from the `pi-ai` catalog.

## 13. Search behavior

- case-insensitive match on displayName, modelId, provider name, vendorKey
- capability filters are AND
- provider filter is exact providerId
- empty query shows recents + popular/bundled first

## 14. Acceptance criteria

- [ ] search finds models across multiple providers
- [ ] custom model id path works without catalog hit
- [ ] recent models surface in the picker
- [ ] refresh merges into cache and picker (never destructively replaces)
- [ ] restart hydrates the prior catalog before live refresh, and offline
      refresh keeps the cached picker populated
- [ ] capability badges visible
- [ ] session model change applies to next turn only
- [ ] a new session defaults a reasoning-capable inherited model to its highest
      published thinking level and otherwise defaults to `off`
- [ ] reasoning selector is capability-gated and pi-published sparse level
      sets clamp the same way in Composer, Electron main, and the pi sidecar
- [ ] provider settings and cached discovery cannot override a known pi model
- [ ] unknown free-form models remain runnable without invented capabilities
- [ ] pinned pi-ai ^0.82.1+ resolves `claude-opus-5` (and gateway-compatible aliases) to the published 1M-context adaptive-thinking record without desktop overrides
