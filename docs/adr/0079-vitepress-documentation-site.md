# ADR 0079: Use VitePress for the bilingual documentation site

- **Status:** Accepted
- **Date:** 2026-08-13

## Context

The repository has a growing set of specifications, ADRs, project notes, and
plugin authoring material. Plain Markdown files are easy to review, but the
current directory has no shared navigation, local search, responsive reading
experience, or clear language entry point.

## Decision

Make `docs/` a standalone VitePress project in the pnpm workspace. Keep the
existing Markdown files in place as the source of truth and add a custom,
responsive theme with local search, English and Simplified Chinese locale
entry points, and curated navigation.

The English site is complete and source-first. The Chinese site provides a
translated orientation and topic map, linking to English technical contracts
where maintaining a second copy would risk drift.

## Consequences

- Contributors can run, build, and preview the docs with `pnpm docs:*` commands.
- Documentation has a stable static site shape without adding a server runtime.
- New user-visible documentation behavior must be covered in the E2E test plan.
- English remains the canonical language for specs, ADRs, protocol terms, and
  code-facing documentation.
- VitePress becomes a development dependency and the docs package joins the
  existing pnpm workspace.

## Alternatives considered

- Keep plain Markdown only: preserves the smallest toolchain, but does not
  solve navigation, search, responsive presentation, or bilingual entry points.
- Use a hosted docs platform: adds an external publishing dependency and makes
  local preview less representative of the repository source.
