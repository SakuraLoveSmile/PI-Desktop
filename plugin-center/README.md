# pi-plugin-center scaffolding

Staging copy of the [vastsa/pi-plugin-center](https://github.com/vastsa/pi-plugin-center)
repository, kept here so the center's contracts and the PI-Desktop client that
consumes them change together and are tested against each other.

Nothing in this directory runs as part of PI-Desktop. The workflows under
`.github/` are inert here — GitHub only reads workflows at a repository root —
and become live once the directory is copied into the center repository:

```bash
rsync -a --exclude catalog.json --exclude catalog/ plugin-center/ /path/to/pi-plugin-center/
```

## What this implements

Plugin source lives in the publisher's own repository. The center stores the
pinned build inputs, re-hosts the verified `.piplug` as a release asset of the
center repository, mirrors it to CNB, and generates the `catalog.json` that
PI-Desktop reads. There is no S3, no R2, and no separately operated CDN.

Design record: [ADR 0102](../docs/adr/0102-publisher-owned-plugin-source-and-git-hosted-artifacts.md) ·
Full plan: [15-plugin-center.md](../docs/spec/07-plugins/15-plugin-center.md)

## Layout

```text
schema/     JSON Schemas: submission, registry entry, catalog v2, review report
registry/   One file per plugin, written by the publish transaction
scripts/    Catalog generation, registry validation, artifact verification
.github/    PR validation, artifact re-hosting, CNB mirror, tamper detection
api/        OpenAPI contract for the center service
db/         PostgreSQL migrations
```

## Publish flow

```text
publisher tags a release in their own repository
  → pi-plugin publish            pack + pin (commit, ref, sha256)
  → submit to the center         ownership verified before queueing
  → isolated runner              build, test, scan
  → two-pass AI review           primary + critic, independent contexts
  → policy evaluator             the only component that can approve
  → publish transaction          digest written to the database
  → publish-release.yml          asset uploaded under tag <pluginId>@<version>
  → build-catalog.mjs            catalog.json regenerated and committed
  → mirror-cnb.yml               CNB copy with its own artifactBaseUrl
  → client market.refresh        visible in PI-Desktop
```

## Scripts

All three are dependency-free on purpose: `validate-registry.mjs` runs against
pull requests from forks, so it must not install anything or execute anything
the change brought with it.

```bash
node scripts/validate-registry.mjs                  # rules a registry entry must satisfy
node scripts/build-catalog.mjs --generated-at <iso> # registry -> catalog.json + shards
node scripts/check-catalog-client-contract.mjs --url catalog.json
node scripts/verify-artifact.mjs                    # re-download and compare digests
```

`build-catalog.mjs` takes `--generated-at` rather than reading the clock so a
rebuild from an unchanged registry is byte-identical — that is what lets CI
prove the committed catalog was generated and not hand-edited.

`check-catalog-client-contract.mjs` is a vendored copy of PI-Desktop's own
preflight. A catalog that passes it here cannot fail the client's rules on a
user's machine. Re-copy it when PI-Desktop changes that file.

## Integrity without object storage

GitHub release assets can be deleted and re-uploaded by a repository admin, so
"published" is not the same as "immutable". Three independent records stand in
for object lock:

1. The artifact digest in the center database, written inside the publish
   transaction and protected by a trigger that refuses to change it.
2. The same digest committed to `registry/` and `catalog.json`, so Git history
   is an append-only witness of what each version's bytes were.
3. The client's own checksum verification before it extracts anything.

`verify-artifacts.yml` re-downloads every live artifact daily and opens an
incident on a mismatch. **A mismatch is never fixed by updating the recorded
digest** — yank the version and publish a new one.

This is tamper-evident, not tamper-proof. It is the accepted cost of dropping
object storage.

## What a publisher cannot do

- Set `trust`, `review.decision`, or `policyVersion`. The center writes them;
  a submitted value is dropped.
- Have their code copied into a PI-Desktop-owned repository.
- Publish from a repository they do not hold `admin` or `maintain` on.
- Replace the bytes of an already published version.
- Serve packages from a host outside the client's allowlist
  (`github.com`, `githubusercontent.com`, `cnb.cool`).
