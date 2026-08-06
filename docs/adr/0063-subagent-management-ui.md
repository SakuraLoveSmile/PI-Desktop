# ADR 0063: A Managed Surface for Subagent Definitions

- Status: Accepted for implementation
- Date: 2026-08-06
- Deciders: PI-Desktop core
- Related: D202, ADR 0062 (bounded subagents), ADR 0056 (user-owned MCP servers
  and skills with a shared activation scope), D192 (activation scope), D194
  (user skills), D196 (extensions page segmented control)

## Context

ADR 0062 shipped subagents with no renderer surface. A delegate could only be
added by hand-writing `<workspace>/.pi/agents/<name>.md`, and the only way to
see what a session actually offers `Task` was to read
`BUILTIN_SUBAGENT_DOCUMENTS` in `agent-runtime`. Every comparable user-owned
prompt artifact already has a managed surface: user skills (D194) and MCP
servers each get a registry, an activation scope, and an editor sheet on the
extensions page. Subagents were the exception.

The gap is not only authoring. A definition that silently loses — because a
project document shadows it, because it is turned off, or because it is scoped
to another project — is the failure mode of a three-source catalog, and nothing
in the product reported it.

ADR 0062's alternatives rejected "definitions in settings/SQLite" on the grounds
that a definition is a prompt and belongs in git next to the code it describes.
That reasoning holds for a team's delegates. It does not cover a personal
delegate the user wants in every project they open, which has nowhere to live
under a project-only model.

## Decision

### 1. Three sources, one writer

A user-level registry joins the two existing sources:

```text
<data>/agents/registry.json     records: id, name, description, enabled, scope,
                                tools, model, thinkingLevel, maxTurns, path, …
<data>/agents/<id>.md           the definition document
```

Shadowing order becomes **project > user registry > builtin**. A committed
`.pi/agents/<name>.md` still wins, so the registry is an additional user-level
layer and not a replacement for the project one.

The registry is the only thing the UI writes. `crates/host-core/src/
user_subagents.rs` renders the frontmatter and the body; `parseSubagentDefinition`
in `packages/shared` stays the only thing that reads a definition. Documents stay
Markdown on disk, so "reveal in folder" and an external editor keep working, and
the registry file itself carries only the metadata the list and the scope switch
need.

Two shapes deviate from the user-skills precedent they are otherwise modeled on:

- Documents are flat (`<data>/agents/<id>.md`), not `<id>/AGENT.md`. A subagent
  document is one file with no companion assets, and the flat layout is the same
  shape a project definition has — the same file can be copied either way.
- `id == name`. The name is the `Task` handle the model types, so a registry that
  auto-suffixed a colliding id would produce a definition addressable under a
  name the user never chose. A duplicate name is refused with
  `SUBAGENT_INVALID` instead.

The registry cap is `MAX_USER_SUBAGENTS` (16), matching
`MAX_SUBAGENT_DEFINITIONS`, so the UI cannot create a definition that would be
dropped at launch.

### 2. Activation scope, not a second enable concept

A registry record carries `enabled` plus the D192 `ActivationScope`, and
`agents.active` returns the records whose scope matches a project path. Nothing
new is invented: the same `ScopeControl` the MCP and skills sections use is
reused verbatim, and `UserSubagentRecord` joins `PluginSummary`,
`McpServerRecord` and `UserSkillRecord` as a scope carrier.

Because scope is evaluated per project, a personal delegate can be global while
a noisy one is limited to the repository it was written for.

### 3. Builtins and project documents are read-only

`explorer`, `code-reviewer` and `test-runner` are shown, but with no enable
switch, no scope control, and no editor. They are code, versioned with the app;
a switch over them would be a fourth piece of state that survives upgrades and
disagrees with the shipped set. The same treatment covers project documents,
which belong to the repository and are edited there — the row offers reveal.

What both get instead is **copy as my definition**: the sheet opens pre-filled
from the effective definition, and saving it produces a registry entry the user
owns. That covers retuning a builtin without a disable switch, because a
registry definition of the same name outranks the builtin it was copied from.

### 4. The effective catalog is computed in main

The read-only rows come from a `subagent/catalog` call that runs the real loader
— `loadSubagentDefinitions(projectPath, { userDocuments })` — and returns the
merged result plus its diagnostics. The renderer does not re-implement merge or
precedence.

This is deliberate. The panel's promise is "this is what `Task` offers right
now", and the only way to keep that true is to answer it with the same function
that answers it for the sidecar. A renderer-side merge would be a second
precedence implementation, and the first time the two disagreed the UI would be
lying about the thing it exists to show.

Main also reads the registry documents from disk (`activeUserSubagentDocuments`)
and passes them to the loader as `userDocuments`. host-core owns the files;
the loader stays pure and takes documents rather than paths, which is how project
documents already reach it. Because `resolveAgentRuntimeLaunch` runs on every
prompt, an edit in the UI takes effect on the next turn with no restart.

### 5. Shadowing is reported on the row that loses

A registry row shows a warning tag when a project document owns its name, and a
"not active here" tag when the name is absent from the effective catalog because
the record is off or scoped elsewhere. Builtin shadowing needs no tag: project
always outranks the registry, so a registry row can only ever be shadowed by a
project document.

The read-only list renders the *effective* catalog, so a builtin replaced by a
registry definition of the same name simply does not appear there — it is no
longer what `Task` would run.

### 6. Where it lives

A fifth segment on the extensions page: Installed / MCP / Skills / **Subagents**
/ Marketplace (amending D196's four-part control). Nine IPC channels
(`subagent/list`, `catalog`, `create`, `update`, `read`, `remove`, `setEnabled`,
`setScope`, `reveal`) mirror the skill API, and every mutation emits the existing
`pluginChanged` event, which is the refresh signal the page already listens to.

## Alternatives considered

- **Write into the project's `.pi/agents/`.** The obvious reading of ADR 0062,
  and it keeps definitions in git. Rejected as the *write* path: a UI that edits
  tracked files creates uncommitted diffs the user did not ask for, and a
  personal delegate would have to be re-created in every repository. The project
  source keeps its precedence, and it stays the place a team's delegates live.
- **A disable switch on builtins.** Rejected: it is durable state about code
  that changes under it, and copy-then-retune already produces a definition that
  outranks the builtin, with the new behavior visible in the document rather
  than implied by a toggle.
- **Merge and rank in the renderer.** Rejected in §4 — a second precedence
  implementation that can disagree with the one that matters.
- **A dedicated Subagents destination in the shell.** Rejected: a delegate is
  something the user installs or writes, which is exactly what the extensions
  page is for, and a sixth destination for at most 16 records is not worth the
  shell weight.
- **SQLite instead of a registry file.** Rejected for the reason skills were:
  the document has to be a file on disk for reveal and external editing to work,
  so the metadata may as well sit beside it.
- **Import from other agent stores.** Deferred. There is no settled third-party
  subagent format, and "copy as my definition" covers seeding from what the app
  already knows.

## Consequences

- A user can add, retune, scope and delete a delegate without leaving the app,
  and without touching a tracked file.
- Three sources now exist for one name. Precedence is fixed and reported, but
  answering "which definition is running?" requires reading the tag on the row,
  not just the list.
- host-core gains a fourth registry that follows the skills shape, and a fourth
  place `ActivationScope` is stored and matched.
- The extensions page segmented control grows to five, which is the practical
  ceiling for its density (ADR 0058).
- A registry document is user-level, so it is not reviewable in the project's
  git history. That is the trade for a delegate that follows the user across
  repositories; a team delegate still belongs in `.pi/agents/`.
