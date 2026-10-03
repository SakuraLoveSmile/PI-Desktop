# Pi 1.0.1 adoption

Status: task candidate on `fix/pi-1.0.1-adaptation`, based on the latest
`origin/main` at `7f1d7c1ce5f21a533c8910249bb6d22320d4581e`. Validation and
landing status are recorded below after candidate checks.

## Scope

All five direct Pi dependencies used by Agent Runtime and Electron Main are
pinned exactly to `1.0.1`. The three existing Desktop patches were rebased on
the published 1.0.1 package contents; the pnpm lockfile records the resulting
patch hashes and upstream package versions.

| Workspace entry | Direct dependencies |
| --- | --- |
| `packages/agent-runtime` | `@earendil-works/pi-agent-core`, `@earendil-works/pi-ai`, `@earendil-works/pi-coding-agent` |
| `apps/desktop` | `@earendil-works/pi-ai`, `@earendil-works/pi-mcp` |

The 1.0.1 release adds retry classification for model-capacity errors in
`pi-ai`, updates Anthropic request handling and its SDK, and includes fixes for
Bedrock thinking state and OAuth callback port collisions. `pi-agent-core`'
runtime implementation is unchanged. `pi-coding-agent` and its transitive Pi
packages receive the 1.0.1 release updates. `pi-mcp` replaces the
`clientMetadataUrl` option with `clientMetadataDocument`; repository code does
not call that option directly, and the updated runtime consumes the package.

No Host RPC, Plugin SDK, provider persistence, session format, or permission
contract changes. The desktop retry classifier already retries generic
provider failures. A regression contract test now confirms both that
classification and Pi's 1.0.1 native classifier treat “Selected model is at
capacity” as retryable.

## Fresh-release policy

At adoption time, Pi 1.0.1 and seven packages in its release group are inside
the configured minimum-release-age window. `pnpm-workspace.yaml` therefore
contains exact-version exclusions for those eight packages. The dependency
check rejects missing, additional, wildcard, or non-1.0.1 exclusions. Remove
these entries once the release group clears the age window and regenerate the
lockfile; do not broaden them.

## Patch identity

| Package | Patch SHA-256 |
| --- | --- |
| `@earendil-works/pi-agent-core@1.0.1` | `02de513ae53cf7f1e92d0cfc7fce07cf880d31195f5ec621d2f2197ead92a9da` |
| `@earendil-works/pi-ai@1.0.1` | `b8c1b3aa54b7649346e1eb2fc225471b32e47a209bbda021704f26dd2647e603` |
| `@earendil-works/pi-coding-agent@1.0.1` | `ab63d8f7817d606be15d14daedd329df64bb34e73b71c6842b02f67643ba0769` |

The `check:pi-dependencies` and `check:pi-patches` scripts verify exact direct
pins, installed package versions, patch mappings and lockfile identities, and
representative patched source and declaration contracts.

## Validation

Preliminary checks on the task working tree based on
`7f1d7c1ce5f21a533c8910249bb6d22320d4581e` passed below. They are not the
final candidate result: rerun the relevant checks after committing and
refreshing the branch against the newer `origin/main` before landing.

- Frozen install, Pi pin/patch checks, and `pnpm audit --recursive --prod`.
- `pnpm build:js`, agent-runtime and desktop typechecks, and `pnpm lint`.
- Agent Runtime: 85 files / 1,163 tests. Desktop: 3,482 tests.
- `pnpm docs:check` and `pnpm check:agent-policy`.
- `node scripts/e2e-agent-live.mjs` using the configured `.env` model through
  Pi Agent Runtime and candidate host-core: passed with the expected reply.
- `pnpm test:e2e` using the same `.env` model: 25/25 passed, including live
  completion and streaming requests.
- `cargo build --locked -p host-core` using the shared host Cargo target.

## Rollback

Rollback the dependency manifests, lockfile, release-age entries, patch files,
and version references together. Do not roll back an individual patched Pi
package while retaining the others at 1.0.1.
