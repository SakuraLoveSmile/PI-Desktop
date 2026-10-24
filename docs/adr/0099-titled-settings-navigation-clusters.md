# ADR 0099: Add titled visual clusters to the Settings directory

- Status: Accepted
- Date: 2026-08-18
- Deciders: PI-Desktop core
- Related: D238, D241, ADR 0096

## Context

The Settings rail is intentionally a flat, searchable directory of eight
destinations. The rows are correct and remain in one navigation level, but the
unbroken list is visually dense. The previous visual-only spacing used divider
lines, which was especially easy to lose against the dark rail and did not
provide a useful scan landmark.

## Decision

Keep the destination index flat and preserve its order, IDs, search behavior,
and ownership. Render four localized, non-interactive headings above the
existing row clusters:

- Personal / 个人: Basics, AI, Shortcuts
- Agent / 智能体: Instructions, Model configuration
- Workspace / 工作区: Import, Project archive
- About / 关于: Info

Use muted typography and whitespace between clusters. Do not render divider
lines or add nested navigation. Search continues to filter destinations as one
flat index; a cluster and its heading disappear when no destination remains in
that cluster.

## Search usability amendment (2026-10-23)

The empty-query directory keeps the same flat order and titled clusters.
With a query, the rail now lists specific matching settings with their owning
category, reusing the global search index and row anchors. Option/help matches
resolve to a visible row/card or to the category when the target is dynamic.
This replaces category-only filtering; it introduces no nested navigation or
persisted navigation state. Built-in and plugin matches share the empty state,
and only the current destination is marked selected. The reason is to remove
the second manual search inside long categories after a keyword already matched.

The keyboard, clear, wrapping, and selection requirements are maintained in
the Settings IA specification rather than duplicated here.

## Consequences

- The rail gains clear scan landmarks without introducing another interactive
  navigation level.
- The headings are available in both supported UI locales.
- The rail no longer depends on border contrast to communicate grouping in
  either theme.
- The existing destination ordering and deep-link behavior remain stable.

## Alternatives

### Keep the completely flat rail

Rejected because the compact rows remain difficult to scan as one block.

### Use divider lines between groups

Rejected because the previous rule was low-salience in dark mode and added
chrome without naming the groups.

### Add interactive nested navigation

Rejected because the Settings IA is intentionally a flat destination index and
the groups do not own additional navigation state.
