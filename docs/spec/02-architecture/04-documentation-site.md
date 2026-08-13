# Documentation site

## Status

Accepted. See [ADR 0079](../../adr/0079-vitepress-documentation-site.md).

## Decision

The `docs/` directory is a standalone VitePress project inside the pnpm
workspace. Markdown remains the source of truth; VitePress supplies the local
development server, static build, local search index, code highlighting, and
versioned navigation shell.

The site exposes two locale entry points:

- `/` — English-first complete documentation navigation.
- `/zh-CN/` — Simplified Chinese orientation plus a path-for-path companion
  page for every document under `docs/spec/`.

For Vercel deployments whose Root Directory is `docs`, `docs/vercel.json`
declares the VitePress build output as `.vitepress/dist` and enables Vercel's
`cleanUrls` routing. This keeps extensionless links such as `/spec/README` and
`/adr/README` working after a direct page refresh instead of becoming static
hosting 404s.

Existing `spec/`, `adr/`, `project/`, and guide Markdown files remain in place
so repository links and review history stay stable. Chinese specification pages
live under `docs/zh-CN/spec/` with the same relative paths as their English
sources. Every translated page links to the canonical English page and keeps
code, protocol fields, and identifiers unchanged.

## Local commands

```bash
pnpm docs:dev
pnpm docs:build
pnpm docs:preview
pnpm docs:check
```

The production build is static and does not require a runtime service. The
site may load Google Fonts during development or deployment, but the content
and search index are generated locally by VitePress.

`pnpm docs:check` verifies that every English specification has a matching
Chinese Markdown file with a heading and canonical-source notice. The VitePress
production build then validates the rendered routes and internal links.

## Content rules

1. English remains the canonical source language for specs, ADRs, code
   identifiers, and protocol terms.
2. Every English specification has a Simplified Chinese companion at the same
   relative path under `/zh-CN/spec/`; both locales expose the same sections and
   reading order.
3. Chinese pages translate the complete prose, link back to the English source,
   and preserve code, protocol fields, and identifiers verbatim. When wording
   differs, the English contract remains authoritative.
4. The sidebar is derived from the Markdown tree so a new specification cannot
   be omitted from deep navigation by accident.
5. User-visible or protocol-visible documentation behavior belongs in the E2E
   test plan.
6. Navigation should expose the shortest useful path; deep files remain
   searchable and directly linkable.
