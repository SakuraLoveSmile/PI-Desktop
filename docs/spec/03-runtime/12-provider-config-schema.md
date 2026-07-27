# 12. Provider Config Schema

## 1. Storage location

Owned by Rust host DB/settings store.

Tables (canonical DDL in [04-data-storage](04-data-storage.md) §4.3–4.4, §4.11):

- `providers`
- `models` (single catalog table; `source: bundled | discovered | user` replaces the old `provider_models` / `model_catalog_cache` split)
- `secrets_meta` (no raw secret values)
- recent-model MRU lives in `kv(ns='cache')`, not a table

## 2. Provider record JSON schema (logical)

```json
{
  "$id": "pi-desktop.provider.v1",
  "type": "object",
  "required": ["id", "name", "vendorKey", "type", "protocol", "enabled", "authKind"],
  "properties": {
    "id": { "type": "string", "minLength": 1 },
    "name": { "type": "string", "minLength": 1 },
    "vendorKey": { "type": "string", "minLength": 1 },
    "type": { "enum": ["native", "openai_compatible", "custom"] },
    "protocol": {
      "enum": ["openai", "anthropic", "google", "openai_compatible", "bedrock", "custom_http"]
    },
    "enabled": { "type": "boolean" },
    "baseUrl": { "type": "string" },
    "authKind": {
      "enum": [
        "api_key",
        "api_key_and_base_url",
        "bearer",
        "azure_api_key",
        "aws_sdk_default",
        "custom_headers",
        "none"
      ]
    },
    "secretRef": { "type": "string" },
    "headers": {
      "type": "object",
      "additionalProperties": { "type": "string" }
    },
    "apiStyle": { "enum": ["chat_completions", "responses", "auto"] },
    "compatibility": {
      "type": "object",
      "properties": {
        "supportsTools": { "type": "boolean" },
        "supportsVision": { "type": "boolean" },
        "supportsStreaming": { "type": "boolean" },
        "supportsReasoning": { "type": "boolean" },
        "supportedThinkingLevels": {
          "type": "array",
          "items": {
            "enum": ["off", "minimal", "low", "medium", "high", "xhigh", "max"]
          },
          "uniqueItems": true
        }
      }
    },
    "defaultModelId": { "type": "string" },
    "createdAt": { "type": "string" },
    "updatedAt": { "type": "string" }
  }
}
```

`compatibility.supportsReasoning` and
`compatibility.supportedThinkingLevels` remain readable for stored-record and
older-client compatibility, but Electron main ignores them during runtime
model resolution. The public provider shape is enriched from the exact pi-ai
model record instead. Unknown free-form models expose `supportsReasoning=false`
and `supportedThinkingLevels=["off"]`. The raw secret and internal compatibility
JSON remain hidden.

## 3. Built-in vendor presets

Presets only prefill form defaults; they are not a closed world.

| vendorKey | default protocol | authKind | baseUrl required |
|---|---|---|---|
| openai | openai | api_key | no |
| anthropic | anthropic | api_key | no |
| google | google | api_key | no |
| openrouter | openai_compatible | api_key_and_base_url | yes |
| deepseek | openai_compatible | api_key_and_base_url | yes |
| groq | openai_compatible | api_key_and_base_url | yes |
| together | openai_compatible | api_key_and_base_url | yes |
| fireworks | openai_compatible | api_key_and_base_url | yes |
| mistral | openai_compatible or native | api_key | optional |
| xai | openai_compatible | api_key_and_base_url | yes |
| azure_openai | openai_compatible | azure_api_key | yes |
| bedrock | bedrock | aws_sdk_default | no |
| ollama | openai_compatible | none | yes |
| lmstudio | openai_compatible | none | yes |
| custom | openai_compatible | api_key_and_base_url | yes |

## 4. Model catalog cache record

```ts
type ModelCatalogCacheRecord = {
  providerId?: string // empty for global bundled
  modelId: string
  displayName: string
  vendorKey: string
  capabilities: string[]
  contextWindow?: number
  source: "bundled" | "discovered" | "user"
  updatedAt: string
  raw?: unknown
}
```

## 5. IPC / host methods (provider domain)

- `providers.list`
- `providers.get`
- `providers.create`
- `providers.update`
- `providers.delete`
- `providers.testConnection`
- `providers.listModels`
- `providers.cacheModels` (internal Electron-main to host persistence bridge)
- `providers.refreshModels`
- `providers.upsertUserModel`
- `providers.deleteUserModel`

## 6. Security constraints

1. raw secrets never returned by list/get provider APIs
2. `headers` must not store `Authorization: Bearer <secret>` if secret store can be used
3. export settings excludes secrets by default

## 7. Migration

- schema version via `PRAGMA user_version` (04-data-storage §7)
- provider records additive-evolved; per-provider extension fields land in `config_json`
- unknown future protocol values should not crash older app versions (ignore/disable with warning)

## 8. SQL (Rust-owned SQLite)

The canonical DDL lives in [04-data-storage](04-data-storage.md) (D086). Summary of the provider-domain tables:

```sql
-- providers: id/name/vendor_key/type/protocol/api_style/auth_kind/base_url/
--            enabled/secret_ref/default_model_id + config_json (headers,
--            compatibility, future knobs), INTEGER ms timestamps
-- models:    PK(provider_id, model_id), display_name, source
--            (bundled|discovered|user), capabilities_json, context_window,
--            max_output_tokens, deprecated — refresh upserts never overwrite
--            source='user' rows
-- secrets_meta: secret_ref PK, owner_kind/owner_id, kind, backend
```

> Raw secret material is **not** stored in these tables.

## 9. Host method contracts (v1)

### `providers.list`
- in: `{ includeDisabled?: boolean }`
- out: `{ providers: ProviderPublic[] }`
- `ProviderPublic` excludes raw secrets; includes `hasSecret: boolean`

### `providers.create` / `providers.update`
- in: provider fields + optional `secretValue`; legacy clients may still send
  `supportsReasoning` / `supportedThinkingLevels`
- behavior: persist config; if secretValue present, write secret store and set
  `secretRef`; legacy thinking fields may remain in
  `config_json.compatibility` but do not affect runtime resolution
- out: `ProviderPublic`

### `providers.delete`
- in: `{ id, deleteSecret?: boolean }` default `deleteSecret=true`
- out: `{ ok: true }`

### `providers.testConnection`
- in: `{ id, modelId?: string }`
- out: `{ ok: boolean, latencyMs?: number, error?: AppError, sampleModelId?: string }`

### `providers.listModels`
- renderer IPC in: `{ providerId, source?: "cache"|"refresh" }`; `cache`
  returns the durable catalog without provider network access, while `refresh`
  runs discovery in Electron main
- host RPC in: `{ providerId?: string }`; reads only the Rust-owned `models`
  table
- out: `{ models: ModelCatalogItem[] }`; each model carries pi-resolved
  `reasoning` capability and `supportedThinkingLevels`. Cached capability tags
  and legacy provider fields cannot override the pi model record.

### `providers.cacheModels` (internal host RPC)
- in: `{ providerId, models: DiscoveredModelInput[] }`
- behavior: transactionally upsert successful live discovery into `models` as
  `source='discovered'`; never overwrite `source='user'` rows and never delete
  prior cache rows on a failed or partial refresh
- out: `{ cached: number, models: ModelCatalogItem[] }`
- raw secrets and authorization headers are never part of this call

### `providers.refreshModels`
- in: `{ id }`
- out: `{ added: number, updated: number, removed: number, models: ModelCatalogItem[] }`

### `providers.upsertUserModel` / `providers.deleteUserModel`
- manage free-form / override model entries

## 10. Validation rules

1. `name` unique (case-insensitive) among providers
2. `openai_compatible` / local gateways require absolute `baseUrl` unless preset says optional
3. `authKind=none` forbidden for cloud presets that require keys
4. headers keys are case-insensitive unique
5. secretValue max length enforced (e.g. 8KB)
6. modelId must be non-empty trimmed string; allow `/`, `.`, `:`, `-`
7. unknown protocol on older clients => provider shown disabled with warning, not crash
8. Legacy `supportsReasoning`, when present, must still validate as boolean but
   has no runtime effect
9. Legacy `supportedThinkingLevels`, when present, must still validate as an
   array of canonical thinking levels but has no runtime effect

## 11. Secret ref format

```text
secret:provider:<providerId>:api_key
```

Future multi-secret providers may add suffixes (`:client_secret`, etc.).
