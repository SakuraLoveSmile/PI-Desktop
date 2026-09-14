# ADR 0247: Continue native Pi sessions in their canonical JSONL

- Status: Accepted
- Date: 2026-09-14
- Decision: D416
- Supersedes: baseline D007 only for session discovery; one-shot import remains available

## Context

PI-Desktop historically imports Pi sessions by flattening them into Desktop-owned transcripts. That copy cannot preserve the native tree, compaction, custom entries, or receive turns subsequently sent from either application. The coding-agent SDK already owns the v3 session format and native model/auth/resource lifecycle.

## Decision

1. The Node agent sidecar exposes a source-discriminated `pi-native` adapter. It discovers files below Pi's agent session directory, projects immutable byte snapshots through `SessionManager.inMemory`, and opens a persistent `SessionManager` only when a prompt is accepted.
2. Native identity is an opaque composite derived from canonical file path plus native header id. Paths never cross the preload boundary. Electron merges native summaries with Rust-owned Desktop summaries; Rust remains the exclusive SQLite and Desktop-transcript owner.
3. Native continuation uses `createAgentSession` with Pi `ModelRuntime`, `SettingsManager`, `DefaultResourceLoader`, saved provider/model/thinking, and the original `SessionManager`. There is no Desktop provider fallback and no `UiMessage` reconstruction for model context.
4. The first slice supports list, detail, refresh, Agent text prompt, stop, and renderer-local pin/archive. Rename, delete, move, fork, revision, Plan/Goal, queue, collaboration, side-chat, attachment, and transcript rewrite operations are rejected.
5. A cooperative sidecar lease serializes PI-Desktop writers. Before each SDK append, the adapter verifies canonical file identity and full-byte fingerprint; after append it verifies exactly one line with the expected entry and parent was added. Divergence fails closed. A stale lease is reclaimed only for a dead local PID when the target fingerprint is unchanged. This cannot make an uncooperative Pi Web/CLI process honor the lease, so optimistic validation remains mandatory.
6. Version other than exactly v3, a missing trailing newline, missing cwd, unavailable saved provider/auth, untrusted project resources, corrupt identity, or another live lease keeps the session browseable and read-only with an explicit reason. Projection never repairs or migrates the source file.

## Consequences

- Desktop sessions and their host-owned persistence are unchanged.
- Native branches, compaction data (including unknown fields such as `retainedTail`), custom/context messages, and future unknown entries remain untouched because reads are in-memory and writes are SDK append-only.
- An uncooperative writer can still race within the OS append operation. The adapter detects prefix/suffix divergence after the append, preserves bytes, disposes the runtime, and requires reload; full mutual exclusion requires Pi clients to adopt a shared lease protocol.
- `@earendil-works/pi-coding-agent` is a runtime dependency of the bundled sidecar and its session format behavior is version-pinned.
