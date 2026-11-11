# Audited legacy release gate fixtures

These are exact test fixture bytes from commit
`98e2288795eae251af747940515cb9e219a72447`, copied from
`.github/workflows/release.yml` and `.github/workflows/ci.yml`.
They are not executable workflow definitions.

The pair is the legacy six-gate recovery allowlist recorded in ADR
`docs/adr/release-candidate-nightly-gate.md`. Tests assert both SHA-256 digests.
Changing either source requires a new audited contract, rather than accepting
an unknown historical workflow because it contains no nightly jobs.
