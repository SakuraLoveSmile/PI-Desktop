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

## Addendum: restore Ubuntu fixture provisioning

Status: Accepted for implementation by the user during the runner-recovery
continuation. The accepted
nightly gate above remains unchanged. The user confirmed this concrete recovery
addendum under R4, including the offline-family environment check and continuation
of the original S2 exercises. Existing branch commit/push authorization continues.

### Evidence and decision

Run `43047754114`, source `cd7f66571`, passed JS and Rust CI but stalled before
any E2E suite. Its Ubuntu 24.04 image `20261101.360.1` repeatedly failed to
resolve `azure.archive.ubuntu.com`. APT index errors remained warnings and the
subsequent package acquisition repeated the same DNS failure.

The [exact image's official configuration](https://github.com/actions/runner-images/blob/ubuntu24/20261101.360/images/ubuntu/scripts/build/configure-apt-sources.sh)
creates `/etc/apt/apt-mirrors.txt` with Azure HTTP at priority 1, official Ubuntu
archive HTTPS at priority 2 and official Ubuntu security HTTPS at priority 3.
`ubuntu.sources` references that file. The
[APT mirror contract](https://manpages.ubuntu.com/manpages/noble/man1/apt-transport-mirror.1.html)
allows retaining priorities 2 and 3 without renumbering.

1. In the existing `e2e-run.yml` provision step, remove only the known Azure
   archive entry from this ephemeral runner's mirror list. Preserve both existing
   official HTTPS entries, their order and priorities. Reject an unexpected
   list rather than silently rewriting arbitrary sources. Do not rewrite
   `ubuntu.sources`, its suites/components/architectures/Signed-By, cloud-init
   templates, or the runner's DNS configuration.
2. Use `sudo apt-get update --error-on=any`, the
   [documented strict option](https://manpages.ubuntu.com/manpages/noble/man8/apt-get.8.html),
   so a transient index error stops provisioning before package installation.
   Keep the existing package list, signature/TLS verification, Electron sandbox,
   timeouts, test catalog, assertions and release gates. Add no retry or warning
   fallback. An unavailable official mirror remains a failed job.
3. Keep this recovery local to the temporary GitHub-hosted Ubuntu VM. The user's
   machine, running app, providers, repository package versions and signing or
   packaging bodies are outside this change. A new runner discards the modified
   mirror file; reverting the workflow change restores the old selection policy.

### Execution and acceptance

The main agent owns this atomic workflow/helper change, its focused tests and
the shared task record. A read-only researcher verified the official image and
APT contracts; no parallel writer is needed. An independent read-only review may
check the actual implementation. The user confirmed implementation and validation
of this addendum; original S2 acceptance criteria remain in force.

First validate the mirror-list transformation in disposable files: the two
official HTTPS lines and their metadata survive exactly, unexpected input is
rejected, and an APT update error prevents install. Then use the existing manual
`e2e-run.yml` entry with the smallest offline `voice` family on the request
branch. Require dependency installation and its fixture to pass. This is an
environment check and does not replace complete candidate validation.

Once provisioning is proven, run S2's original full negative and clean candidate
exercises on new pinned SHAs. Their acceptance criteria above remain unchanged.
Retain run/SHA/job/artifact evidence in the task record. If the official HTTPS
sources also fail DNS or transport checks, retain the failure and stop this
recovery path without overriding DNS, fixing IP addresses or bypassing trust.

On a strict index-update failure, bounded read-only diagnostics may compare
the system resolver for the two official hosts and a public control host with
HTTPS requests to the official signed index URLs. They do not retry APT, install
software, change sources or DNS, or unlock the fixture. Keep the original APT
failure even if the probes succeed or diagnostics themselves fail. This evidence
distinguishes a system-network failure from an APT-specific acquisition failure;
any further provisioning-policy change still requires a reviewed addendum.

Approval is not verification. Actual recovery checks, the hosted environment
check and the full S2 exercises are recorded in the linked task record.

### Recovery observation, 2026-11-12

The two hosted environment checks failed before installation. The diagnostic
check observed failures in both the system resolver and HTTPS resolution for
the official Ubuntu hosts, while the Microsoft DNS control succeeded. The
[Canonical official status feed](https://status.canonical.com/rss) recorded
`DNS - Major Outage` beginning on 2026-11-11 at 14:26 UTC. This supports an
upstream DNS blocker; it does not establish a mirror-selector defect or justify
rewriting `ubuntu.sources`. The recovery path stopped with its original strict
failure retained. Resume environment validation only with new recovery evidence;
the full candidate acceptance remains outstanding in the task record.
