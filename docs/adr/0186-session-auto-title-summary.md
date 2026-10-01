# ADR 0186: Summarize First-Turn Session Titles with a Main-Owned One-Shot

- Status: Accepted
- Date: 2026-09-08

## Context

A first prompt currently needs an immediate sidebar label, but a raw truncated
prompt is noisy and can obscure the task's topic. The title summary must use the
same provider/model as the session without moving model execution into the
renderer or changing host-owned session storage.

## Decision

Keep the normalized first-prompt fallback synchronous from the renderer's point
of view. After the initial turn emits `agent_end`, the renderer calls the
allowlisted `session/summarizeTitle` IPC. Electron validates the session and
prompt, resolves the session's effective provider/model, and invokes the
agent-runtime `summarizeSessionTitle` one-shot with thinking disabled. The
runtime sanitizes the response and an empty or failed completion leaves the
fallback unchanged. The renderer persists a valid result through the existing
`session.rename` path.

Renderer-local session metadata persists `manualTitle`. The automatic path also
refuses to run for a persisted title that is neither a recognized default nor
the deterministic first-prompt fallback. This protects manual titles made
before the marker existed and prevents a completed summary from being replaced
on a later renderer restart. No host RPC or storage schema version changes.

## Consequences

- New sessions get immediate, readable fallback labels and a concise background
  summary when the configured provider succeeds.
- Manual titles remain authoritative across renderer restart.
- Provider failures cannot block or fail the conversation turn.
- The title-summary IPC is main-owned and cannot expose provider credentials or
  model execution to the renderer.

## Approved Plan/Goal execution amendment (2026-10-02)

This additive path addresses approved execution that starts without a new
visible user turn. The implementation is covered by isolated candidate validation in the UX
repair plan; this amendment does not establish user acceptance or release status.

When the Host reports a committed Plan/Goal execution transition to `running`,
the renderer may request one title summary for that exact Lead session and
execution ID. It reuses the main-owned `session/summarizeTitle` one-shot with
thinking disabled. The bounded model input uses the approved proposal title
and question, not the full Team board, member transcripts, or arbitrary
artifact contents. Explicit `autoGenerateSessionTitles: false` makes no
request. Provider failure, empty output, or stale execution leaves the existing
fallback and never delays or fails the approved execution.

The synthetic `title-summary:<sessionId>` namespace isolates one-shot model
resolution from a running agent's bindings. Its launch configuration uses the
standard profile only to resolve the provider; no agent or tools are launched.
It must not request Team participant context for that synthetic ID. The real
Lead's Team profile, approval and dispatch permissions remain unchanged.

The approved source has a guard separate from ordinary first-turn
`autoTitleAttempted`, so an earlier first-turn attempt does not suppress the
approved proposal title. Persist the execution ID before requesting a summary;
renderer restart and duplicate events cannot request it twice. Recheck that the
same execution is still current before applying a response. Team member
sessions, remote sessions and native sessions do not use this local-Host path.

Automatic replacement remains conservative: manual titles and unrecognized
legacy custom titles stay authoritative. A known previous automatic title may
be replaced by the current approved execution title, recorded as `lastAutoTitle`
in existing renderer session metadata. No database schema column is added.

Approved-execution rename supplies optional `{ expectedTitle,
expectedExecutionId }` to `session.rename`. Host compares the current title and
latest assigned execution ID inside the same write transaction before
updating. A mismatch returns conflict without writing, so a delayed result
cannot replace a manual title or title belonging to a newer execution. Calls
without these optional guards retain their existing behavior. This does not
add Team behavior to remote-host rename or move provider execution into the
renderer.

## Alternatives considered

- Run the one-shot in the renderer: rejected because provider resolution and
  credentials belong to Electron main and the sidecar.
- Wait for the summary before submitting the prompt: rejected because it adds
  visible latency to every first turn.
- Add a host schema column for title origin: deferred; persisted renderer
  metadata plus the title/fallback guard covers existing and new sessions
  without a storage migration.
