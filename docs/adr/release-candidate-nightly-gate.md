# ADR: Release candidates require the complete fixture nightly

- Status: Accepted for implementation by the user on 2026-11-11.
- Date: 2026-11-11.
- Task: [PI-STAB-1111-R1](../tasks/PI-STAB-1111-R1-stability-gates.md), S2.

## Context

Release currently calls CI, whose E2E job selects only the smoke tier. The
scheduled nightly is independent, so a missing scheduled run or a failure in a
nightly-only suite does not block a release. S1 was closed by the user's risk
acceptance with an unresolved Linux Electron/Viz capture failure; that acceptance
does not authorize skipping the suite or overriding a release gate.

The publication recovery tool checks an exact set of six successful gate jobs
and one failed/cancelled publication job. Adding nested nightly jobs without
updating that consumer would make recovery reject otherwise valid new runs.
Checking only a new aggregate job would instead weaken its existing evidence.

## Decision

1. Make `e2e-nightly.yml` callable with a full `source_sha`. Scheduled/manual
   runs resolve their own full SHA once; release supplies `metadata.source_sha`.
   The catalog and every family check out that same SHA. Continue deriving the
   family matrix from the checked-in catalog, including smoke and nightly suites
   and excluding only the existing manual tier. Preserve matrix parallelism and
   `fail-fast: false`.
2. Keep every existing CI gate. The release build depends on both CI and the
   complete nightly, for manual candidates as well as formal tags. A failed,
   cancelled, skipped or missing catalog/family/summary cannot unlock build or
   publication. Do not change signing, packaging, updater metadata or artifact
   verification logic.
3. Add an `always()` nightly summary that writes family results and the source
   SHA to the Actions job summary and emits an error annotation on failure.
   Unexpected or absent results fail closed. This is an in-Actions signal; it
   does not create an issue or send an external message. An absent scheduled run
   cannot count as a green day; candidate validation does not depend on schedule
   delivery.
4. Version the release gate contract explicitly as `nightly-v1`. Recovery reads
   the contract, workflows and catalog from the original run's immutable source
   SHA, not current `main`. For that contract it computes the complete job-name
   set: all existing six gates plus nightly catalog, one real fixture job per
   catalog family and the nightly summary, followed by publication. Every name
   must be unique, from the original run/SHA, completed, and successful except
   for the failed/cancelled publication job. Keep the unique artifact, digest,
   source SHA, original run and run-attempt checks unchanged.
5. Preserve the audited legacy six-gate recovery contract only when the original
   `release.yml` and `ci.yml` contents match explicitly recorded SHA-256 digests
   of this task's reviewed baseline (`98e228879`). Do not infer a legacy run from
   missing nightly jobs or a missing contract marker. Unknown workflow/contract
   versions are rejected and require a new fully gated candidate; adding another
   legacy digest requires a separate audited change. Thus this narrowly scoped
   compatibility path cannot exempt a new nightly-gated run.

The audited legacy digest pair at baseline
`98e2288795eae251af747940515cb9e219a72447` is:

| Source file | SHA-256 |
| --- | --- |
| `.github/workflows/release.yml` | `5384f558617933d98de0bcd1945bda68efeba83449d25e96ea58721bf64221e9` |
| `.github/workflows/ci.yml` | `d4336a9a2561e2cdd84159cd4ad0b3be69d1bacd42987e320977b2fbfa7c5b2b` |

## Validation and rollout

Before hosted exercises, cover source identity propagation, exact family
coverage, failure/cancellation/skips, and recovery rejection of missing,
duplicate, foreign-run or foreign-SHA jobs. Test both supported recovery
contracts and reject unknown/missing contracts outside the legacy digest pair.
Retain the existing artifact and run-attempt rejection tests.

Use the existing manual candidate lane on the dedicated request branch, with
`sign_macos=false`. The deliberate failure must affect only a nightly-only
suite: metadata and every existing CI job must succeed, the intended nightly
family must fail, and build/aggregate/publication must be skipped. A clean candidate
must pass CI and all nightly families on one SHA before the normal candidate
build and aggregation succeed. Keep both run URLs, SHAs, complete job results
and artifact identities in the task record. The failing fixture is an exercise
change only; it must not land in the production catalog or reduce assertions.

Branch push and workflow dispatch require the user's explicit authorization
for this request. The exercises create Actions candidate artifacts only: no
formal tag, GitHub Release or updater feed publication. If the unresolved S1
failure recurs, record a failed gate and stop release progression.

Update the release runbook and workflow specification together with the
workflows and recovery consumer. Acceptance authorizes implementation on the
request branch; integration and hosted exercises remain separate permissions.

## Consequences

Every candidate pays the full fixture nightly cost before packaging. Existing
flakiness will block it; S1's risk acceptance does not waive S2. Family additions
are automatically included by the source catalog, while recovery remains tied
to the gate contract that produced each artifact. Unknown historical workflow
variants lose automatic recovery until audited or rebuilt. The normal
publication recovery identity and artifact safeguards remain mandatory.

## Alternatives

Relying on the last scheduled green run can validate a different commit and
miss an absent schedule. Running a hand-maintained subset duplicates the
catalog. Allowing recovery based only on an aggregate result discards the
existing per-job evidence. None provides the requested candidate guarantee.
