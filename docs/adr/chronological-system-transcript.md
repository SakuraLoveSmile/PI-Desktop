# ADR: Preserve chronological model system state

- Status: Accepted
- Date: 2026-10-01
- Issue: #1285
- References: [Pi PR #9548](https://github.com/earendil-works/pi/pull/9548),
  [Pi model authority](pi-ai-core-0991-authority.md)
- Updates: ADR 0039 catalog refresh, ADR 0225 deferred-tool restoration

## Context

Moving new tool declarations to the beginning of a conversation changes its
cached prefix. Rebuilding from visible chat alone also loses the chronology of
instruction and tool changes. Pi 0.99.1 already owns tool-state diffing and
provider request projections; Desktop owns session persistence and permissions.

## Decision

Keep Pi's provider-neutral system messages in chronological order. Use the
existing Host-owned transcript writer and optional versioned `modelSystem`
metadata on hidden system rows, acknowledging writes before dispatch. Anchors
preserve model order when the user row was pre-persisted. Save the effective
state once at explicit compaction; restore it before the summary and retained
tail. Keep current mode/catalog/Host permissions authoritative for execution.

Separate Desktop's runtime instructions, skill catalog and contextual guidance
into replaceable sections. The skill-loading header uses `skills`, and each
catalog entry uses `skill:<exact-id>`; a change or removal appends only that
entry's replacement or null tombstone. The fixed prefix prevents collisions with
other Desktop section names. Restoring a legacy aggregate `skills` section
replaces it with the header and individual entries once at continuation.
Catalog-only skill changes refresh an idle runtime;
body loading and permission checks stay at the existing Host bridge. Tool schema
changes cannot reuse an idle runtime merely because tool names are identical.

Retain the published model/API/endpoint identity before account overrides.
Accept transcript capability opt-ins only when that identity matches the actual
request route. Let Pi adapt the request for partial or absent support; never
persist an adapter's folded projection.

The current models.dev catalog remains authoritative for published limits,
prices and modalities. Independently copy only the five transcript transport
flags and their original binding from Pi's exact published model. Do not derive
transport support from a models.dev metadata match or an account endpoint
override. Both Pi and models.dev metadata projections can carry that binding;
unverified routes and generic records retain the conservative fallback.

The existing Pi 0.99.1 dependency patch adds the missing mid-conversation system
capability to its `deepseek-flash` catalog entry. Authorized official-endpoint
experiments confirmed both preserved cache reuse and effective updated
instructions. Keep this correction in the single Pi catalog, not a parallel
Desktop allowlist; remove the hunk when an upgraded Pi catalog carries it.
The model/API/endpoint binding check still excludes aliases and relays. Native
tool-addition and tool-change flags are not enabled by this correction.

## Alternatives and consequences

Prepending a reconstructed snapshot was rejected because it changes history on
ordinary continuation. A new persistence store or adopting Pi AgentSession
would create another session owner; optional canonical metadata preserves the
current process and data boundaries without a database migration. Unknown old
histories establish their first baseline at continuation rather than inventing
past state. Downgrades remain readable but do not retain these cache guarantees.

The added records consume transcript storage. A failed write stops dispatch as
a local preparation failure; retry uses the same row ID. Providers may still
fold unsupported updates and lose cache reuse. Even native mid-conversation
system support does not guarantee provider cache reuse. Entry-level updates
reduce new input tokens without changing instruction roles or priority. Offline tests prove ordering,
restoration and payload compatibility, not real-provider cache-hit ratios.
