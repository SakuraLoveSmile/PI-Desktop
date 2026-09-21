# Image generation and editing

The desktop exposes one optional `AppSettings.imageGeneration` binding with
`providerId` and `modelId`. `null` clears it; absent means unconfigured. Host-core
validates and persists it through the existing settings store. No schema bump
is needed. The binding is independent of the conversation default and references
an existing enabled API-key or no-auth provider and one of its configured models.

## Configuration

Model Advanced offers **Set as image model**. A draft selection only takes effect
when the provider form saves; Cancel leaves settings unchanged. Saving a provider
as an image model does not replace the default conversation model. Below the
default model row, **Image generation model** displays the binding and offers
searchable replacement and Clear. OAuth accounts are not eligible. Missing,
disabled or removed bindings remain visible as unavailable; there is no fallback.

## Agent contract

`GenerateImages({items: [{prompt, count?, images?}]})` is an Agent-mode tool.
`count` defaults to 1. Both distinct prompts and same-prompt variants are supported,
with 1–10 output images total. An optional `images` array supplies 1–4 local source
files per item for editing; a previous generated path supports iterative edits.
Prompt length is bounded at 32,000 characters. Unsupported or excessive input is
rejected rather than truncated. Plan and Goal cannot execute the tool.

The bundled `pi-desktop/imagegen` skill is discoverable in ordinary sessions and
loads through the existing Skill tool. It teaches prompting, batches, reference
edits, preserving originals, partial-failure handling and project asset delivery.
It does not grant permission or carry credentials.

The trusted desktop bridge first calls host-core `tools.execute` with the same
identity, arguments and permission scope. Host-core applies the existing high-risk
tool policy and returns authorization only. The bridge executes the image service
only after approval. The host authorization audit is distinct from the actual
sidecar tool result. Runtime cancellation reaches both pending approval and the
network request; host loss or sidecar disposal aborts local work.

## OpenAI Images adapter

Only OpenAI-compatible Images is supported. A root base URL acquires `/v1`; an
explicit path prefix is retained. Generation uses `POST images/generations` with
`model`, `prompt`, `n: 1`. Editing uses `POST images/edits`, multipart image files,
the prompt, model and `n: 1`. No browser mask editor is included. A configured
service may implement generation without editing; its error is reported without
silently switching to generation or another model.

Each batch snapshots the binding and provider before dispatch, uses two workers,
and returns results in input order. Each output has a 180-second request budget.
Requests are never automatically retried. Authentication failure stops queued
work. Cancellation stops queued work and aborts active HTTP; it cannot promise the
upstream provider stopped processing or billing. Completed output files survive.

Responses accept exactly one Base64 image or HTTPS image URL per request. JSON and
download bodies are bounded; image files are capped at 16 MiB and restricted to
PNG, JPEG and WebP signatures. Downloads use checked, pinned public DNS addresses,
reject redirects and private destinations, and never receive provider headers.
Input edits accept the session project, that session's scratch directory and the
attachment store after realpath containment. Each edit input set is capped at
32 MiB, with a 64 MiB input cache budget for the batch. Credentials remain outside the renderer and tool results.

## Results and recovery

Each result records index, status (`succeeded`, `failed`, `cancelled`), successful
path/MIME type or a safe error code. New files get unique names in session scratch;
editing never overwrites its source. The tool result and transcript retain file
references, not Base64. Existing bounded image reads and file viewers serve previews.
Successful images and per-item failures render even when only part of a batch
completed. Missing configuration returns a structured error and a Settings → AI
navigation action. The same references render after session reload/restart.

Validation: `node scripts/e2e-image-generation.mjs` covers host/stdio/HTTP/storage;
`node scripts/e2e-image-generation-ui.mjs` covers real React/Chromium interactions
with an API-boundary fixture. Unit/service tests cover limits, cancellation,
partial failures, authentication, timeout, unsafe paths, and bounded downloads.
Live verification is opt-in via `scripts/test-image-generation-live.mjs`, limited
to one generation plus one edit and never a default test command.
