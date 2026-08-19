# 15. Plugin Center

> Companion repository: [vastsa/pi-plugin-center](https://github.com/vastsa/pi-plugin-center)
> Decision record: [ADR 0102](../../adr/0102-publisher-owned-plugin-source-and-git-hosted-artifacts.md)
> Client contract: [07-plugin-marketplace.md](07-plugin-marketplace.md)

This document defines the distribution system that replaces the single-repository
marketplace. It is the normative plan for the center service; the marketplace
document remains the normative contract for what the desktop client consumes.

## 1. Positioning

The plugin center is the publishing side of plugin distribution. It answers three
questions the desktop client cannot answer for itself:

1. Does this publisher actually control the repository they claim to publish from?
2. What source produced these bytes, and can that be shown to a user before install?
3. Is this version fit to publish, and who decided that?

The client remains responsible for validation, permission review, install,
isolation, and runtime. The center never gains the ability to run code on a user's
machine that the client would not otherwise accept.

## 2. Ownership model

| Asset | Owner | Location |
|---|---|---|
| Plugin source | Publisher | Publisher's own GitHub repository |
| Build inputs (commit, tree, path) | Center (pinned copy) | Center database + snapshot store |
| `.piplug` artifact | Center (re-hosted) | `vastsa/pi-plugin-center` release assets |
| Artifact mirror | Center | CNB release/raw assets |
| Catalog | Center | Git-tracked `catalog.json` + release asset |
| Review evidence | Center | Center database, summarized in catalog |
| Install decision | User | Desktop permission review |

Plugin source is never copied into a PI-Desktop-owned Git repository. The center
retains an immutable snapshot of the pinned commit for build and review evidence;
that snapshot is storage, not a Git mirror, and is not published.

## 3. Artifact hosting

The reference design used S3/R2 with a CDN. This system uses Git hosting instead
(ADR 0102 §2).

### 3.1 Layout

```text
vastsa/pi-plugin-center
├─ catalog.json                       # generated, Git-tracked, schemaVersion 2
├─ catalog/
│  ├─ plugins/<pluginId>.json         # per-plugin detail shard
│  └─ generations/<generation>.json   # previous catalog generations
├─ registry/<pluginId>.json           # published projection, one file per plugin
└─ releases
   └─ <pluginId>@<version>            # one release tag per published version
      ├─ <pluginId>-<version>.piplug
      ├─ <pluginId>-<version>.piplug.sha256
      ├─ <pluginId>-<version>.provenance.json
      └─ <pluginId>-<version>.review.json
```

One release tag per published plugin version. Tags are never moved or reused; a
correction is a new version, and a withdrawal is a yank.

### 3.2 Artifact URL

```text
https://github.com/vastsa/pi-plugin-center/releases/download/<pluginId>@<version>/<pluginId>-<version>.piplug
```

The CNB mirror serves the same file names under its own base. Because the base
differs per provider, the catalog declares it:

```json
{
  "schemaVersion": 2,
  "artifactBaseUrl": "https://github.com/vastsa/pi-plugin-center/releases/download/"
}
```

Version entries carry a path relative to that base. Switching to the mirror
changes the base and nothing else — the file name, size, and checksum are
identical, so a mid-session source switch cannot invalidate a checksum.

### 3.3 What replaces WORM

GitHub release assets can be deleted and re-uploaded by a repository admin, so
object-lock semantics are not available. Integrity rests on three independent
records instead:

1. The artifact SHA-256 is written to the center database inside the publish
   transaction and never updated.
2. The same digest is committed to `catalog.json`, so Git history is a signed,
   append-only witness of what each version's bytes were.
3. The client verifies the downloaded bytes against the catalog digest before
   extracting anything.

A replaced asset therefore fails the client check and leaves a visible
disagreement between the asset and two immutable records. This is tamper-evident,
not tamper-proof, and is the accepted cost of dropping object storage.

### 3.4 Retention

Release assets are retained for every non-yanked published version. A yanked
version keeps its metadata and loses its asset after the incident window closes,
so an already-warned user is not silently re-served the withdrawn bytes.

## 4. Service architecture

```text
            ┌──────────────────────────────┐
            │ Next.js on Vercel            │
            │ SEO pages · publisher console│
            └──────────────┬───────────────┘
                           │ HTTPS
            ┌──────────────▼───────────────┐
            │ Center API                   │
            │ auth · ownership · submission│
            └──────┬───────────────┬───────┘
                   │               │
        ┌──────────▼─────┐   ┌─────▼──────────┐
        │ PostgreSQL     │   │ Redis / queue  │
        │ source of truth│   │ tasks + leases │
        └────────────────┘   └─────┬──────────┘
                                   │
                          ┌────────▼─────────┐
                          │ Worker           │
                          └──┬────────────┬──┘
                             │            │
                 ┌───────────▼──┐   ┌─────▼─────────┐
                 │ Isolated     │   │ AI review     │
                 │ runner       │   │ primary+critic│
                 └───────────┬──┘   └─────┬─────────┘
                             │            │
                       ┌─────▼────────────▼─────┐
                       │ Policy evaluator       │
                       │ the only publish gate  │
                       └───────────┬────────────┘
                                   │
                       ┌───────────▼────────────┐
                       │ Release publisher      │
                       │ GH Releases + CNB + Git│
                       └────────────────────────┘
```

### 4.1 Responsibilities

| Component | Owns | Must not |
|---|---|---|
| Next.js | Pages, forms, SEO, status display | Touch the database, hold keys, decide publication |
| Center API | Identity, ownership, submissions, queries | Execute plugin code, build, publish directly |
| PostgreSQL | Accounts, links, releases, reviews, audit | Act as a queue or a blob store |
| Redis | Queue, leases, idempotency locks | Be the source of truth |
| Worker | Orchestrate snapshot, build, scan, review, evaluate | Skip the state machine or overwrite an attempt |
| Isolated runner | Install dependencies, build, test, scan | Reach production secrets, the host, or the network outside its allowlist |
| Release publisher | Upload assets, mirror, regenerate catalog | Publish a release the evaluator has not approved |

The API process never executes publisher-supplied code. Everything that runs
untrusted input runs in the isolated runner.

## 5. Identity and ownership

A single GitHub App provides both login and repository access.

- **OAuth (PKCE + state, short-lived user token)** proves who is submitting.
- **Installation** proves which repositories that account has granted, and to
  what scope.
- **Webhooks** deliver installation, repository, push, release, and membership
  changes so a revoked installation stops further submissions immediately.

Requested permissions are read-only: repository metadata, repository contents,
and the commit/tag/release reads a pin requires. No write scopes, no secrets, no
organization administration. Adding a scope requires an ADR.

Ownership verification runs before a submission is queued, never after:

1. The session's GitHub account matches the request identity.
2. The installation still exists and still covers the target repository.
3. The account holds `admin`, `maintain`, or an explicitly allowed role.
4. The submitted canonical URL matches the owner/name GitHub returns.
5. The account, installation, and repository link is persisted with the check
   time and a hash of the permission evidence.

Failures return `SOURCE_OWNERSHIP_DENIED` or `SOURCE_OWNERSHIP_UNAVAILABLE`.
Being logged in is never sufficient.

Personal access tokens are not a supported publishing credential. The GitHub App
private key lives only in the secret manager; installation tokens are exchanged
on demand and cached no longer than their lifetime.

## 6. Submission state machine

```text
submitted
  → ownership_verified
  → source_pinned
  → scanning
  → building
  → ai_review
  → policy_evaluated
  → approved
  → published

any intermediate state → needs_info | changes_requested | blocked | build_failed | canceled
published → yanked
```

Rules:

- Only the server advances state, using conditional updates guarded by a row
  version, so concurrent workers cannot both advance the same release.
- `published`, `canceled`, and `yanked` are terminal for that release. A retry
  creates a new attempt; it never revives a terminal state.
- Every retry creates a new `review_attempt` and keeps the prior attempt's
  inputs, outputs, and hashes.
- Queue redelivery is idempotent by submission key; a crashed worker's lease is
  recoverable without republishing.
- An incomplete deterministic gate cannot be marked passed by an AI report.

## 7. Source pinning

Accepted input:

```json
{
  "pluginId": "acme.todo",
  "repository": "https://github.com/acme/pi-plugin-todo",
  "path": ".",
  "ref": "refs/tags/v1.2.0",
  "channel": "stable",
  "version": "1.2.0",
  "artifact": {
    "mode": "publisher-release",
    "assetUrl": "https://github.com/acme/pi-plugin-todo/releases/download/v1.2.0/acme.todo-1.2.0.piplug",
    "sha256": "…"
  },
  "idempotencyKey": "…"
}
```

- Only canonical HTTPS GitHub URLs. No query, fragment, credentials, or non-GitHub host.
- `ref` is a full 40-hex commit SHA or `refs/tags/<tag>`. Annotated tags resolve
  through to their commit.
- The worker re-resolves the commit, tree, and archive itself. Client-supplied
  hashes are inputs to compare against, never trusted values.
- The snapshot records repository, submitted ref, resolved commit, tree SHA,
  archive SHA-256, and fetch time.
- Unpacking rejects absolute paths, `..` traversal, symlinks, hard links, device
  files, and duplicate paths, and bounds total size, per-file size, file count,
  and directory depth.

### 7.1 Artifact modes

| Mode | Publisher provides | Center does |
|---|---|---|
| `publisher-release` | A `.piplug` attached to their own release | Verify bytes against the submitted digest, verify the package's `manifest.json` matches the pinned source, re-host |
| `center-build` | Nothing beyond the pin | Build in the isolated runner from the pinned commit, then re-host |

`publisher-release` is the default because it keeps toolchain responsibility with
the publisher. In both modes the center re-hosts, and in both modes the packaged
manifest identity must agree with the pinned source and the submitted version.

## 8. Review and the publish gate

Each release runs two independent AI passes over the same evidence bundle:
`primary` checks the contract, behavior, permissions, data practices, and supply
chain; `critic` receives the same inputs and looks for what `primary` missed or
over-claimed. `critic` never receives `primary`'s output as fact. Each attempt
records model, prompt version, and input hash.

The review skill treats source, manifests, and logs as untrusted data and does
not execute instructions found in them. It has no network, no environment
variables, and no key access. Insufficient evidence produces `needs_info`, never
a guess. Its output is schema-valid JSON only.

The policy evaluator is the only component that can produce `approved`. It
recomputes, from the database rather than the report:

- The release tuple matches the recorded submission.
- Snapshot, artifact, SBOM, and provenance hashes match.
- Every required deterministic gate passed.
- Both `primary` and `critic` attempts exist and are independent.
- No unresolved high or critical finding, permission escalation, or data-practice change.
- Signature, catalog key, builder version, and policy version are valid.
- This version is still the unique, unrevoked publish candidate.

`deterministicGates`, `publishable`, and `approved` in a model report are advisory
text and are ignored. Evaluator failure, missing evidence, or a dependency outage
yields `needs_info` or `build_failed` — never `published`.

## 9. Publication order

A publish is only durable if it happens in this order:

1. Commit the database transaction that marks the release published and writes
   the artifact digest.
2. Emit the outbox event.
3. Upload the release assets to `vastsa/pi-plugin-center` under `<pluginId>@<version>`.
4. Mirror the assets and catalog to CNB.
5. Regenerate the complete catalog and per-plugin shards.
6. Sign the catalog generation.
7. Atomically swap the current generation and commit it to Git.

Any failed step leaves the previous catalog generation in place. There is no
state in which the database has published a version but a client can fetch a
half-written catalog.

## 10. Public API

```text
GET  /v2/catalog.json
GET  /v2/plugins
GET  /v2/plugins/{pluginId}
GET  /v2/plugins/{pluginId}/versions
GET  /v2/plugins/{pluginId}/versions/{version}
GET  /v2/publishers/{publisherId}
GET  /v2/categories
GET  /v2/healthz
```

Publisher-facing:

```text
GET  /v2/auth/github/start
GET  /v2/auth/github/callback
GET  /v2/me
POST /v2/auth/logout
GET  /v2/github/installations
POST /v2/github/installations/link
POST /v2/plugins/{pluginId}/submissions
GET  /v2/submissions/{submissionId}
POST /v2/submissions/{submissionId}/cancel
```

Internal, service identity only:

```text
POST /internal/workflows/plugin-scan
POST /internal/policy-evaluations/{releaseId}
POST /internal/catalog-publications
POST /v2/webhooks/github
```

Public responses contain only published data and carry a schema version.
Mutations require a session, CSRF and Origin checks, an idempotency key, and an
audit event. Internal routes reject browser sessions.

**The desktop client depends only on the generated catalog, not on this API.**
The API can be unavailable without breaking browse, install, or update, because
the catalog and artifacts are static files on GitHub and CNB. This is the main
resilience benefit of dropping object storage.

## 11. Trust tiers

| Tier | Meaning | Who can set it |
|---|---|---|
| `verified` | Center-reviewed publisher with a confirmed identity | Center operators |
| `community` | Ownership-verified publisher, automated review passed | Policy evaluator |
| `unknown` | Custom or enterprise source the center did not review | Client default |

A publisher cannot assert any tier. Catalog generation writes the tier from the
database; a submitted value in plugin metadata is dropped. The client renders
anything it cannot attribute to the center as `unknown` and never upgrades a tier
based on catalog text alone.

## 12. Migration

| Phase | State | Client behavior |
|---|---|---|
| 1 | v1 catalog in `pi-desktop-plugins` remains default | Reads v1, as today |
| 2 | v2 catalog published by the center in parallel | Reads both; v2 fields render when present |
| 3 | Default source moves to the center; mirror follows | Reads v2; v1 still selectable as a custom source |
| 4 | `pi-desktop-plugins` becomes an archive | v1 support retained for custom/enterprise catalogs |

The client ships v1 and v2 support together. No client release is required to
move the default source, because the source is a setting.

## 13. Delivery phases

### Phase 0 — contracts (this change)

- ADR 0102, this document, and the catalog v2 contract in the marketplace spec.
- JSON Schemas for registry entry, catalog, submission, and review report.
- Center repository scaffolding: schemas, catalog builder, verification scripts,
  publish and mirror workflows, API contract, database migrations.
- Client: catalog v2 parsing, download host allowlist, yank enforcement,
  `minPiDesktop` enforcement, provenance capture and display, `pi-plugin publish`.

Acceptance: the client installs from a v2 catalog whose artifacts are GitHub
release assets, and refuses a package from a host outside the allowlist.

### Phase 1 — identity and pinning

GitHub App OAuth, installation linkage, ownership verification, webhooks, source
snapshot. Acceptance: a user cannot submit a repository they do not control, and
every accepted input is pinned to a commit.

### Phase 2 — build and review

Isolated runner, deterministic packaging, SBOM and provenance, two-pass AI review,
schema validation. Acceptance: the same input reproduces the same artifact digest,
and no model output can fake a gate.

### Phase 3 — policy, signing, catalog generations

Policy evaluator, signing keys, catalog generation and rollback, client signature
verification. Acceptance: only an approved release reaches a published catalog,
and a generation can be rolled back.

### Phase 4 — publisher console and SEO

Submission history, version status, evidence summaries, detail pages, sitemap,
hreflang. Acceptance: public pages show only published data.

### Phase 5 — resilience

Backups and restore drills, runner escape drills, token revocation, catalog
rollback, rate limits, alerting.

## 14. Explicitly not doing

- Copying publisher source into a PI-Desktop repository.
- Personal access tokens as a publishing credential.
- Executing plugin code, installing dependencies, or running tests inside the API process.
- Letting the frontend, an ordinary admin route, or a model output set `published`.
- Human review as the main path. People handle incidents, appeals, and policy exceptions.
- Object storage, a separately operated CDN, in-app payments, or remote code patching.

## 15. Acceptance for "the center is live"

- Ownership verification passes integration tests against a real installation.
- API, worker, runner, database, queue, and secret manager are production instances.
- Two-pass review and a trusted policy evaluator are enabled.
- Builds are reproducible and artifacts verifiable from provenance.
- The catalog has generations, signatures, and a rollback path.
- Public pages expose only approved, published versions, and a yank propagates.
- Audit, metrics, backup, restore, and a security drill are complete.

Until then, any local fixture, static sample, or manual step is development
validation and must not be described as a publishing capability.
