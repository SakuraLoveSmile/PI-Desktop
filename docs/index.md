---
layout: home
title: PI-Desktop
titleTemplate: Local-first AI coding agent
hero:
  name: PI-Desktop
  text: Local-first AI coding agent
  tagline: A calm, inspectable desktop workspace for building with AI. Read the product decisions, runtime contracts, and extension model in one place.
  actions:
    - theme: brand
      text: Start with the guide
      link: /guide/
    - theme: alt
      text: Browse specifications
      link: /spec/README
features:
  - title: Product clarity
    details: Understand the shipped shell, operating states, permissions, and the decisions behind them.
  - title: Runtime contracts
    details: Follow the Rust host core, pi sidecar, NDJSON RPC, storage ownership, and provider model system.
  - title: Extension-ready
    details: Build local plugins with a documented package format, lifecycle, permissions, and developer workflow.
---

## Read the system, not the sales pitch

Use the guide when you want orientation, the specs when you need implementation detail, and ADRs when you need to understand why a boundary exists.

| 01 / ORIENTATION | 02 / CONTRACTS | 03 / CONTEXT |
|---|---|---|
| [**Start with the guide**](/guide/) — Get the product model, the local-first promise, and the shortest path into the codebase. | [**Explore specifications**](/spec/README) — Browse product, architecture, runtime, UX, security, delivery, and plugin domains. | [**Review decisions**](/adr/README) — See the constraints and trade-offs that keep the desktop client coherent as it grows. |

## Current implementation snapshot

| Application line | Host wire protocol | Storage schema | Documentation |
|---|---|---|---|
| `0.5.8` | `v9` | `v11` | `EN / 中文` |

## Designed for contributors

| Plugin authors | Architecture | Delivery |
|---|---|---|
| [**Build your first plugin**](/plugin-development) — Start from the authoring guide, then follow the package, API, security, and lifecycle specs. | [**Trace a request**](/spec/02-architecture/01-architecture) — See how the renderer, Electron orchestration, Node agent, Rust host, and SQLite fit together. | [**Ship with confidence**](/spec/06-delivery/04-e2e-test-plan) — Use the acceptance criteria, E2E scenarios, change checklist, and release runbook as one flow. |
