# ADR: Pinned session summary in the activity rail

- Status: Accepted (implemented in PI-UI-1123). The user settled D1 to D8 on
  2026-11-22 ("全按推荐"), so the recommendations below are the decisions.
- Date: 2026-11-22
- Related: [session auto-title summary](0186-session-auto-title-summary.md),
  [session activity rail](session-activity-rail-and-managed-background-processes.md),
  [local server address](session-activity-server-address.md)
- Scope: PI-UI-1123, Batch D of the activity rail redesign (the pinned summary card)

## Context

The approved rail canvas (v6) pins one card above every section: a sparkle
glyph, "Updated 2026-11-21 09:50" in a small monospace face, a paragraph clamped
to four lines with Expand and Collapse, and a refresh control. The canvas sample
reads like a status note (what is under way, who is doing what, what comes
next), not like a title. The card is not a section: no grip, not part of the
saved section order, no hairline of its own.

Nothing in the product writes narrative text about a session today.

- The activity projection is deliberately free of prose: its module header says
  no assistant prose, tool output body, attachment content or credential crosses
  that boundary. The summary is therefore a separate read model, not a field of
  `sessionActivity.get`.
- The title summarizer is the one place a model labels a session. The renderer
  asks over `session/summarizeTitle` and passes the text; Electron main resolves
  the session's own provider and model through `resolveAgentRuntimeLaunch` under
  a synthetic id (`title-summary:<id>`), and the agent runtime runs a tool-free
  one-shot with thinking off. That path sets no timeout and no output cap
  (`maxOutputTokens` is unset, so the request may use the model's whole output
  budget; only the prompt keeps it short), which is acceptable for one 25-character
  title and not for a call that repeats every turn. The Live Voice work bridge is
  the precedent for a bounded main-side one-shot: an `AbortSignal` and
  `maxOutputTokens`.
- Host storage for a session-owned derived record has a precedent in Context
  Insights: a versioned `kv` namespace keyed by session id, its own RPC methods
  and cleanup in the session delete paths. `kv` has no foreign key to `sessions`,
  so each delete path names its namespaces: `delete_session` and
  `delete_session_with_team_cleanup` in `sessions.rs`, and the plugin session
  delete path in `plugin_sessions.rs` (trash and purge alike).
- `session.get` already takes `messageLimit` and `contentLimit` and returns the
  newest window with the session row, which carries `messageCount`.

## Decision

A one-shot summary of the recent conversation, written by the agent runtime in
Electron main, stored by Host core, shown by one pinned card.

1. **Author (D1).** Electron main runs a tool-free one-shot, thinking off, on the
   session's own provider and model, under its own synthetic launch id
   (`session-summary:<id>`). No agent is launched and no Team context is
   requested. The model call stays in the Node runtime (`summarizeSession`); the
   Host never calls a model, and credentials never reach the renderer.
2. **Input is read by main, never supplied by the renderer.** Main reads the
   canonical transcript tail from the Host (`session.get`, newest 60 rows, each
   cut to 1,200 characters), keeps only top-level `user` and `assistant` text (a
   row that carries a tool name or belongs to a nested agent is dropped), takes
   messages newest first until a budget of 6,000 characters (a longer message
   keeps its start and its end), then restores order. Tool rows, thinking text,
   attachments, system rows and internal model instructions are never sent. The
   previous summary (at most 480 characters) is sent as context, unless the
   session was rewound past it, so the note continues instead of drifting. The
   session's transcript, its search index and the agent's own context are
   untouched: the summary is never fed back to the agent.
3. **Output is inert text.** The runtime reduces the answer to one plain
   paragraph of at most 400 characters (code fences, markup, links, list
   markers, a label prefix and wrapping quotes stripped, whitespace collapsed,
   cut at a sentence end when possible) and rejects an empty, URL-only, path-only
   or markup-only result with `SESSION_SUMMARY_EMPTY`. The renderer shows it as a
   text node, never as HTML or Markdown. The one-shot has no tools, so a prompt
   injected through the transcript can only change this text; the instruction
   prompt says to describe the conversation, not to follow it, and not to repeat
   secrets or tokens, and the transcript is fenced in a block whose closing tag a
   message cannot forge.
4. **Limits (D4).** The call carries `maxOutputTokens` 320 and a 45 second
   `AbortSignal` that also ends the wait for a provider that ignores the signal.
   The provider's own transient-retry controller stays; the signal bounds the
   whole call. One request per session runs at a time and a second ask joins it.
   A failed or timed-out call keeps the previous summary, counts toward the
   interval (a broken provider is not retried every turn) and is logged with its
   error code only.
5. **When (D2, D8).** Automatically, when a turn of the shown session ends, its
   rail pane is mounted and visible, and the Host reports at least two messages
   since the stored summary (`behind >= 2`; tool rows count, so in practice one
   finished exchange), at most once every 60 seconds per session. A session
   with no stored summary needs two messages in all. Never on merely opening a
   session: nothing calls a model because the user looked. The refresh control
   (D6) forces a run for the shown session: it skips the threshold and the
   interval, never the single flight, and may run while a turn is still under
   way. A session with no conversation text is skipped (`no-content`) without a
   model call.
6. **Storage (D3).** Host core owns the record in the `kv` namespace
   `session-summary-v1`, key = session id, value `{version, text, revision,
   basedOnMessageCount, updatedAt}`, at most 2,000 bytes. No schema change and no
   migration. The namespace joins the three delete paths above, with a Rust test
   per path that fails if one of them leaves a row. A write is a compare-and-set
   on `revision` and fails for a missing, trashed, remote or native session, so a
   late result cannot resurrect a deleted session. The record goes with a hard
   delete of a session and with a plugin session's trash or purge, as Context
   Insights' record does (a trashed session reads as `NOT_FOUND`). An unreadable
   record or one written by a newer build reads as absent.
7. **Host RPC (additive, protocol 11 unchanged).** `sessionSummary.get({sessionId})`
   returns `{summary, messageCount}`; `summary` is `null` or the record with
   `behind` (messages since the summary) and `diverged` (the transcript is now
   shorter than it was, as after a rewind). `sessionSummary.set({sessionId, text,
   basedOnMessageCount, expectedRevision})` returns `{summary}` or a
   `SUMMARY_CONFLICT` that carries the current record. Blank or NUL text, a
   negative or fractional number and a basis ahead of the transcript are
   `INVALID_ARGUMENT`; more than 2,000 bytes is `LIMIT_EXCEEDED`; a native or
   remote session is `SESSION_SUMMARY_UNSUPPORTED`. An older Host answers
   `METHOD_NOT_FOUND`; the renderer reads that as "not supported" and draws no
   card. No `changed` notification in this batch: the refresh answer returns the
   new record to the pane that asked.
8. **IPC (renderer to main).** `pi-desktop/sessionSummary/get({sessionId})` and
   `pi-desktop/sessionSummary/refresh({sessionId, force?})`. Refresh answers
   `{outcome: "updated", summary}` or `{outcome: "skipped", reason, summary}`
   with `reason` one of `disabled`, `no-content`, `not-behind`, `too-soon` and
   `conflict` (another window stored a note first; the answer carries theirs).
   Both reject a `remote:` or `native-pi:` id; refresh also rejects a Team member
   session after reading it, and answers `skipped` with `disabled` when the
   setting is off (the Host's setting is read on every refresh). The handler is a
   new small module registered from `register.ts`; `electron/main/index.ts` gets
   no logic.
9. **Setting (D7).** `autoSummarizeSessions`, a boolean where absent means on,
   beside the title toggle in Settings (AI, Conversation and display). Off means
   no automatic refresh, no manual refresh and no card; a stored summary stays
   and shows again when the setting is switched back on. The description says
   what is sent and that it uses the session's model. It is a per-device
   preference and is not part of portable configuration sync.
10. **Renderer.** One controller per session owns the lifecycle: it reads only
    while the pane is visible, treats `running` going from true to false as the
    turn end, tags each request with the activation it was asked in so an answer
    for another session, a closed pane or a switched-off setting reaches nothing,
    adopts a record only when its revision is not lower than the one it holds,
    and keeps the in-flight flag the control shows. The card is the first child
    of the rail, above the Needs-attention block (D5): sparkle glyph, local
    `YYYY-MM-DD HH:mm` in the 11px monospace face, a 24 by 28 refresh control
    (a spinner while it runs; it stays focusable and inert, `aria-disabled`, so
    keyboard focus is not lost when the run starts), the paragraph at 13px with
    a four-line clamp and an Expand/Collapse action that appears only when the
    text is clamped. It is hidden for an unsupported session, with the setting
    off, with no summary yet (a first run shows nothing until it finishes), and
    while `diverged`. A failed manual refresh says so once in an error toast;
    a failed automatic one stays quiet and keeps the old text. New strings go to
    all nine locales.
11. **Not in this batch.** Live facts the transcript does not state (running
    subagents, server ports, Goal progress) are not fed to the model; the canvas
    sample mentions some, and adding them is a separate decision. No dedicated
    cheaper summary model, no streaming of the text, no `changed` notification.

## Settled decisions

All eight were answered "as recommended" by the user on 2026-11-22.

| # | Question | Decision | Alternative not taken |
|---|---|---|---|
| D1 | Who writes it | One-shot on the session's own model, thinking off, owned by the runtime | The main agent through a tool; deterministic assembly with no model |
| D2 | When it updates | Turn end of the shown session, `behind >= 2`, once per 60 s, plus the refresh control | Every turn with no interval; only on demand |
| D3 | Where it lives | `kv` namespace `session-summary-v1`, three cleanup paths | A table on the Plus schema track (new step, version bump, upgrade tests) |
| D4 | Cost and limits | 6,000 input characters, 320 output tokens, 45 s, one flight per session; measuring real cost and latency needs the user's explicit OK for a real provider | A smaller budget, or a dedicated cheaper model setting |
| D5 | Order | Summary above Needs attention, as the canvas and the request (the very top of the rail) say | Below it, so a failure reads first |
| D6 | Refresh control | Yes, forces a run | No control; the card only follows turns |
| D7 | Setting | New `autoSummarizeSessions`, default on, off hides the card | No setting; or default off |
| D8 | Old sessions | No model call on open; a session gets its card after its next finished turn | Summarize on first open |

## Alternatives

- Let the main agent write the note through a tool: rejected. It spends main
  context tokens every turn, depends on the model remembering to call it (the
  runtime already has model-robustness gaps of this kind), adds rows to the
  transcript, and cannot update while the agent is idle.
- Assemble the note without a model (first prompt, last assistant paragraph,
  counts): rejected as the default. It reads like a log and cannot say what comes
  next. It stays available as a zero-egress variant if a user wants the card
  without a model call.
- Store it in a table with a foreign key: rejected for now. It needs a Plus
  schema step, a version bump and upgrade tests for at most 2 KB per session; the
  cascade is its only advantage and a test on the three delete paths covers the
  same risk.
- Take the text from the renderer, as titles do: rejected. A stale or tampered
  input would be summarized under the user's credentials; main reads the
  canonical transcript.
- Summarize when a session is opened: rejected. It turns looking into spending.
- Reuse `autoGenerateSessionTitles`: rejected. Titles send one prompt and 500
  characters once; the summary repeats with a larger window.

## Consequences

Each refresh sends up to about 6,000 characters of recent conversation text (and
the previous summary) to the provider the session already uses. That is new
egress beyond the title's first prompt and reply excerpt; tool output, thinking,
attachments and file contents are never in it. Cost is one small completion per
finished turn (at most one per minute per session) while the rail is visible.
Real cost and latency are not measured: no real provider is called without
authorization.

The record is a new class of Host-stored, model-written text about a
conversation. It is removed with the session, is not exported, not searched and
not sent back to the agent. A session whose model cannot serve a one-shot (a
plugin-owned agent) gets no summary. A rewound session hides its summary until
the next refresh. A regenerated last answer leaves the count unchanged, so the
old note stays until the next turn. Two windows do not share an in-flight state;
the Host compare-and-set keeps the stored record consistent and the loser shows
the winner's note.

Known limit: the model reads the newest 60 transcript rows, and tool rows are
rows. In a tool-heavy session the window may hold few messages of text, so the
note describes less of the conversation than the 6,000-character budget allows,
and a window with no text at all is skipped. Widening the window is a Host read
cost decision left for a later batch once real usage shows whether it matters.

Verification covers Rust tests for get, set, the revision conflict, the size
limit, unsupported sessions, `behind` and `diverged`, the setting's validation and
a row removed by each of the three delete paths; runtime tests for the input
builder (roles, budget, newest-first order, CJK) and the output cleaner, with an
injected stream and no real provider; main tests for single flight, interval,
threshold, force, setting off, member and remote refusal, a stale or failing
Host, timeout and a conflict answer; renderer tests for the controller (turn end,
hidden pane, session switch, stale answers, in-flight control) and the card
(clamp, expand, names); a real-Chromium probe at the real 264px pane against the
canvas, in both themes at font scale 1.4; and an isolated production Host
scenario (`E2E-ACTIVITY-SUMMARY`).
