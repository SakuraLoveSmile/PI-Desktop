# Context Insights

## User surfaces

Context Insights ports the context-observation workflows of
[dsh-context](https://github.com/bowenliang123/dsh-context), using native
PI-Desktop data and UI. The plugin-first assessment is recorded in
[the ADR](../../adr/context-insights-native-port.md).

- The sidebar's Context Insights destination shows cross-session usage,
  an activity calendar, composition and searchable/filterable session cards.
- The session-owned Work Panel offers Context alongside existing native and
  plugin tools. The Composer usage inspector links to the same dashboard.
- `/context` opens a dialog for the active session, or the overview from home.
  Opening or refreshing an inspection never submits a user turn or model call.
- View defaults use validated device-local preferences. View toggles remain
  independent of provider configuration and context-management settings.

## Data contract and authority

`packages/shared/src/context-insights.ts` owns the exported version-1 contract.
`contextInsightsGet` is a sender-validated, read-only IPC operation for a
Desktop session. `sessionId` is required; `includeContent: false` strips large
contents for overview reads; `requestId` restricts a selected-content read.
Unknown/deleted sessions fail through the existing error contract. Native Pi
and remote sessions must not be presented as captured local Desktop sessions.

The runtime captures the logical Pi system prompt, model-facing tool schemas
and message entries for each provider request. When an adapter exposes its
`onPayload` callback, a separately labelled provider payload is captured after
existing extension transformations. `captureSource` and `contentRevision`
identify this distinction; category estimates never claim to be wire-byte
composition. Opaque plugin-owned adapters without this callback remain
explicitly Pi-context-only. It records request
identity, turn/step, model/provider, mode, model window, start/settlement times,
status and reported usage where available. Capture never changes the context,
model options, provider headers, cancellation signal or tool execution.

Seven content categories are exposed: system, tools, user, injected, skill,
assistant and tool result. Content is plain text/JSON rendered safely; images
carry metadata without binary payloads. Header credentials are never collected. Provider-payload authentication fields
and Gemini/Anthropic/OpenAI/Bedrock image binary representations are replaced
with redaction or metadata. The wire payload shares the request content budget.
Runtime usage-calibrated prompt estimates and uncalibrated content estimates
are distinct quantities, so the category sum is not asserted to equal actual
provider usage or calibrated occupancy.

The Host owns durable diagnostics under the existing persistence boundary.
Retention is bounded to 40 requests, 160 events, 120,000 captured characters
per request and 1,200,000 per session. Whole requests are retired when the total
budget is exceeded. Dropped request/event counts and per-entry/content truncation
flags are visible. Metadata omission is distinct from capture truncation.
Deleting a session retires its diagnostics; reads and late writes cannot recreate
a deleted session. Restart preserves retained captures without changing schema
or replaying interrupted provider requests.

The existing Host usage history remains billing authority independently of
diagnostic retention. Overview token/activity figures use that history;
retained-request costs and session cards identify their limited coverage. Missing
usage, cost, timing and window metadata are unknown, not synthetic zero reports.

## Inspection behavior

The dashboard identifies its latest **dispatched** request. It does not claim
to show an exact future request while the runtime is idle. Step/turn selection
and total/signed-delta trends use captured requests. Pinning selects a durable
request identity; hover preview does not discard that selection. Content is
loaded on demand; content revisions invalidate older hydration. Post-persistence
acknowledgements trigger visible reads, so settlement cannot be missed because
an earlier runtime event arrived before its write. Stale replies from previous sessions or selections cannot
replace the current view. Missing/retired captures have an explicit state.

The context browser groups collapsible content by category, supports search,
tool sorting and assistant-kind filtering, and offers safe raw/Markdown reading.
The composition shows estimated content alongside runtime occupancy and
provider-reported prompt/output/cache figures. Captured changes distinguish
compaction, pruning, model, mode and injection facts; events are never fabricated
merely to populate a chart. Original context-management behavior is preserved.

File activity and agent relationships use recorded PI tools/delegations and
existing session/team ownership. Paths open through the existing Work Panel
file boundary. Request metadata is not authority to read arbitrary filesystem
content. Operation/timing statistics identify retained/transcript coverage.

The overview provides 7-day/30-day/all-time controls, a specific-day filter,
project/search/sort controls, bounded metadata reads and paging. Its local-calendar day buckets
follow the existing Host usage history's time convention, including local
midnight rather than UTC date truncation. Opening a session follows
the ordinary session-selection path before opening that session's dashboard.

## Compatibility and verification

Earlier requests did not retain assembled contexts and cannot be backfilled
exactly. Empty historical sessions remain readable and explicitly uncaptured.
No transcript deletion, model/provider default change, plugin grant expansion
or automatic compaction/pruning is part of this port. DSH-specific PTC presets,
balance credentials and image-token formulas are not PI execution contracts;
the port displays only available PI facts and labels unknown values.

Validate with isolated provider fixtures, Host persistence/restart/deletion
tests, component interaction tests and a targeted native/browser acceptance
journey. Static checks and fixture tests do not constitute real-provider billing,
physical-device or published-release evidence.
