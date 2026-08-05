# ADR 0059: Persist Composer Clipboard Files in Session Scratch

- Status: Accepted
- Date: 2026-08-05
- Deciders: PI-Desktop core
- Related: D197, ADR 0024 (composer commands and @ file references), D114 (session scratch directory), D119 (transcript file store)

## Context

The composer is a controlled textarea. Chromium exposes pasted operating-system
files and screenshots as `File` objects, but the text-only prompt contract has
no binary `ImageContent` channel and a pasted file must remain available to the
agent after the prompt is sent. Writing the bytes into the project would dirty
git state and would not follow the session-bound workspace/scratch ownership
rules.

## Decision

1. The renderer intercepts paste only when the clipboard contains one or more
   `File` objects. Text-only paste remains native textarea behavior.
2. The renderer transfers bounded file bytes plus the browser-provided name and
   MIME type to Electron main through `composer/pasteFiles`, together with the
   durable session id. A home composer creates or reuses a session before the
   transfer.
3. Electron main validates that the session exists, limits the request to 20
   files, 64 MiB per file, and 128 MiB total, strips directory components and
   unsafe name characters, and writes unique files with exclusive-create
   semantics below:

   ```text
   <data_dir>/scratch/<sessionId>/pasted/
   ```

4. Main returns absolute paths. The renderer inserts them into the draft as
   `@` references using the existing quoting rule for whitespace. The prompt
   and transcript carry paths, never clipboard bytes.
5. Pasted files follow the existing scratch lifecycle: deleting the session or
   the orphan/stale startup sweep removes them. They are not workspace
   artifacts and never change project git status.

## Security and boundary notes

- The renderer cannot select the destination directory; the session id is
  checked in main and the output root is constructed from the host data dir.
- Renderer names are reduced to a basename and sanitized. A UUID prefix and
  exclusive creation prevent collisions and overwrite-by-name.
- The bridge is Electron-only. It adds no host RPC method and does not expose
  arbitrary filesystem write access to the renderer.

## Alternatives considered

- **Insert the browser file name only:** loses the bytes and gives the agent no
  usable path. Rejected.
- **Write into the workspace:** makes a normal paste dirty the project and
  breaks session scratch isolation. Rejected.
- **Send binary inline with the prompt:** changes the text-only prompt contract,
  inflates context, and requires provider-specific attachment handling.
  Rejected.
- **Use an Electron file picker:** does not support screenshots and adds an
  extra interaction for the common clipboard workflow. Rejected as the paste
  path, though existing picker channels remain independent.

## Consequences

- File and image paste works from both home and docked composers without a
  project file mutation.
- The prompt gains one or more normal `@absolute/path` references, so existing
  Read/Glob/Grep behavior handles the materialized files.
- Large or malformed clipboard payloads fail visibly in the composer and do
  not partially write because bytes are validated before the first write.
