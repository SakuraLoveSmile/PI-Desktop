# Stability Charter

Date: 2026-11-11. Owner: user. Status: accepted; default A/B inventory confirmed by the user.

## Freeze scope

The user confirmed the following default A/B inventory from the stability plan
on 2026-11-11. Scope changes and exceptions require the user's approval.

| Tier | Default scope | Freeze rule |
| --- | --- | --- |
| A | Single-agent turns; Goal; Team dispatch; scheduled tasks; external answering; projects and worktrees | Fix defects; do not add features. |
| B | Speech and real-time speech; image generation; Plugin, Skill and MCP markets; configuration sync; remote hosts; hosted search | Accept upstream fixes and security fixes only. |

An exception is granted only by the user. Before implementation, record its
reason and exact scope in the task's single authoritative record and link the
user's approval. Every feature commit must cite that exception record. An
exception applies only to its recorded scope; it does not amend this charter.

## Stability exit criteria

Stability is reached only when all four conditions hold:

1. Nightly E2E is fully green for seven consecutive days.
2. Three consecutive real-model benchmark rounds complete with zero human intervention.
3. The user uses the app for seven consecutive days without a stall incident.
4. No unapproved feature is introduced during the freeze.

The user accepted S1 with its Linux Electron/Viz root cause unresolved. That
package-level risk acceptance closes S1 only; it does not count as evidence for
any stability exit criterion. Keep the original CI results, failures and
NOT RUN records attached to the S1 task.

## Interface exit criteria

The UI track is complete only when all four conditions hold:

1. Font size, radius, line height and weight tiers are consolidated and the design specification matches.
2. Dialogs and menus use the foundation components.
3. The user has reviewed screenshots of the first three supervision surfaces.
4. Every UI change includes before-and-after screenshots.

The UI criteria track its screen packages separately from the stability
criteria. Screenshot capture follows the approved fixture-only route; each
capture round needs explicit user authorization and must not capture the running
user app.

## Authority and reporting

Product behavior remains owned by the relevant product specification. ADRs
record rationale for changes to frozen architecture, public contracts, data
ownership, security boundaries or release flow. Each package report records
changed files and behavior, checks run and results, every skipped check as
`NOT RUN`, and remaining risks. A dashboard or roadmap is updated only on the
user's instruction.
