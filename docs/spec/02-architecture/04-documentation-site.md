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
- `/zh-CN/` — Simplified Chinese orientation, the same eight-topic map, and
  localized landing pages that link to the English technical source of truth.

For Vercel deployments whose Root Directory is `docs`, `docs/vercel.json`
declares the VitePress build output as `.vitepress/dist` and enables Vercel's
`cleanUrls` routing. This keeps extensionless links such as `/spec/README` and
`/adr/README` working after a direct page refresh instead of becoming static
hosting 404s.

Existing `spec/`, `adr/`, `project/`, and guide Markdown files remain in place
so repository links and review history stay stable. New site-only content lives
under `docs/guide/` and `docs/zh-CN/`.

## Local commands

```bash
pnpm docs:dev
pnpm docs:build
pnpm docs:preview
```

The production build is static and does not require a runtime service. The
site may load Google Fonts during development or deployment, but the content
and search index are generated locally by VitePress.

## Content rules

1. English remains the source language for specs, ADRs, code identifiers, and
   protocol terms.
2. English and Chinese expose the same eight topic domains and the same reading
   order. Chinese pages translate orientation, summaries, and navigation copy.
3. Chinese pages link to the English technical contract instead of silently
   forking protocol details or decision records.
4. User-visible or protocol-visible documentation behavior belongs in the E2E
   test plan.
5. Navigation should expose the shortest useful path; deep files remain
   searchable and directly linkable.
