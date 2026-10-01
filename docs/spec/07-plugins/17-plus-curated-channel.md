# 17 — Plus curated channel

Status: contract frozen, activation pending a published catalog.

The Plus channel is a curated marketplace source. It exists so a maintainer's
review of an exact `(pluginId, version, shasum)` is what puts a version in front
of users, without changing how the existing four sources behave.

The label means "a maintainer reviewed this exact version". It does **not** mean
the maintainer authored the plugin, and it is **not** a guarantee that the code
is safe. Upstream authorship and license are retained on every entry.

## Channel identity

| Field | Value |
| --- | --- |
| `PluginMarketSource` | `plus` |
| Catalog URL (pinned) | `https://raw.githubusercontent.com/SakuraLoveSmile/Pi-Desktop-Plus-Plugins/main/catalog.json` |
| Catalog `providerId` | `pi-desktop-plus-curated` |
| Installed-record `marketplace.providerId` | `plus` |
| Policy version | `plus-curated-v1` |
| Download resolve | none — the catalog resolves package URLs relatively, exactly like the `github` and `mirror` channels |

The endpoint is supplied by the host build, not by a user field. While it is
unset, the option renders as disabled with a localized "not configured yet"
description and issues no request. A persisted `plus` selection with no endpoint
reports a configuration error; it never resolves to the upstream catalog.

`is_trusted_channel()` must **not** list this URL. A curated catalog cannot
promote itself to `verified`; entries default to `trust: "unknown"` unless an
existing upstream authority establishes a tier.

## Repository layout

```
catalog.json                     generated; never edited by hand
packages/<pluginId>-<version>.piplug
approved/<pluginId>/<version>.json
scripts/generate-catalog.mjs
```

`catalog.json` is generated from `approved/`, so the approval records are the
allowlist. The catalog must not be a copy of the upstream catalog.

## Approval record

Maintainer-authored, one file per exact version:

```json
{
  "schemaVersion": 1,
  "pluginId": "acme.todo",
  "version": "1.2.0",
  "shasum": "<64 lowercase hexadecimal characters>",
  "sizeBytes": 40960,
  "decision": "approved",
  "reviewedAt": "<UTC ISO-8601 timestamp>",
  "policyVersion": "plus-curated-v1",
  "sourceRepository": "<original HTTPS repository>",
  "sourceCommit": "<40 hexadecimal characters>",
  "license": "<redistribution-compatible license>",
  "notes": "<maintainer review summary>",
  "catalog": {
    "name": "<display name from the package manifest>",
    "description": "<short description from the package manifest>",
    "author": "<manifest author, kept as upstream authorship>",
    "publishedAt": "<UTC ISO-8601 timestamp of this package build>",
    "minPiDesktop": "<optional minimum host version>",
    "permissions": ["<permission ids the package declares>"]
  }
}
```

The `catalog` block is copied from the package manifest at review time, so the
generator never has to unpack a package. A CI job may verify it against the
published `.piplug`; the catalog entry schema requires `id`, `name`,
`description`, `author` and `versions`, and every version requires
`publishedAt`, `shasum`, `url`, `sizeBytes` and `permissions`.


A `yanked` record withdraws one version: it must not be offered for
installation, an installed copy stays intact, and its notice survives a later
refresh from another source.

Changed bytes or a new version require a new human approval. CI validates
records and packages; CI never approves them. A package is published, its
approval record and the regenerated catalog in one commit, with relative package
URLs and no cross-provider download base.

## Client rules

- Fresh metadata check, SHA-256 and size verification, host allowlist, ZIP and
  path checks, manifest checks, permission review and pre-upgrade backup all
  stay as they are.
- An install records the reviewed source pin in the market IPC input
  (`expectedMarketplace: {source, catalogUrl, version, shasum}`). A mismatch
  against the effective channel, endpoint or freshly resolved metadata fails
  with `PLUGIN_MARKET_CHANGED` and leaves the installed copy intact.
- A valid empty catalog is an empty curated list. A failed fetch falls back
  only to a snapshot from this exact source, with a stale or error indication.
- The review badge always describes the exact displayed version, never every
  future version of that plugin id.

## Activation checklist

1. Publish a schema v2 catalog with `providerId: "pi-desktop-plus-curated"` and
   an empty `plugins` array.
2. Approve at least one exact version whose license permits redistribution, and
   publish its package, approval record and regenerated catalog.
3. Confirm the repository stays public: the client reads it unauthenticated.
4. Only then pin the endpoint in a release build and re-run the curated-channel
   acceptance path.

## Preflight note

`scripts/check-marketplace-catalog.mjs` requires `plugins` to be a non-empty
array, so a freshly created curated repository fails that gate until its first
approval lands. The client itself deserializes an empty list fine and treats it
as an empty curated list. Until the first approved package exists, either run
that preflight tool against deployment catalogs only, or add an explicit
curated-empty allowance to the checker in the same change that wires the
channel.
