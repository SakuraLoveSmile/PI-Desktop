# ADR 0104: Built-in work panel tools become bundled plugins

- Status: Accepted for implementation
- Date: 2026-08-19
- Deciders: PI-Desktop core
- Related: [ADR 0019](0019-work-panel-subsystems.md) ·
  [ADR 0103](0103-plugin-contributed-work-panel-views.md) ·
  [07-plugins/13-plugin-permissions-matrix](../spec/07-plugins/13-plugin-permissions-matrix.md)

## Context

ADR 0103 makes the work panel an extension point. That leaves the host's own
four tools — Review, Terminal, Browser, Files — in a privileged position: they
render as first-class React surfaces with direct access to host IPC, while a
plugin's view is an isolated page reaching the host through a permission
gateway.

A permanent two-tier arrangement has two costs. Plugin authors cannot build
anything comparable to the built-ins, because the capabilities the built-ins
use are not exposed. And the host has no forcing function to find out whether
its own plugin API is adequate: nothing first-party depends on it.

## Decision

1. **Browser remains the only host-built work panel tool.** It is the one
   surface whose backend (a `WebContentsView` with navigation control) is the
   host's own window machinery rather than a workspace capability, and the one
   whose implementation would be circular to express as a plugin view.

2. **Review, Terminal, and Files become first-party plugins** shipped with the
   application under `apps/desktop/resources/plugins/`, contributing their UI
   through `contributes.views` exactly as a third-party plugin does. They are
   packaged with `extraResources`, following the precedent already set by
   `resources/skills`.

3. **They carry a new `source: "builtin"`** alongside `installed`, `dev`, and
   `marketplace`: enabled by default, not uninstallable, but **user-disableable**
   like any other plugin. A user who does not want a terminal can turn it off.

4. **The capabilities they need become real plugin APIs**, not host back doors:

   | Plugin | Needs | Status |
   |---|---|---|
   | `pi.files` | `pi.fs.list`, `pi.fs.readText` | **Shipped.** Implementation showed `fs.glob` was not enough — it returns a flat, 500-capped file list with no directories, which cannot back a lazy tree — so `fs.list` was added to the public API under the existing `fs.read` permission |
   | `pi.review` | Session review records and rollback | New `pi.review.*` API over the existing host-core `review.rs`; new `session.review` permission |
   | `pi.terminal` | A PTY | New `pi.terminal.*` API over the existing `PtyManager`; new `terminal.pty` permission |

5. **Only the *tool* migrates, not every surface that shares its component.**
   A `file:<path>` work panel tab is a transcript artifact — a file link or a
   plan checkpoint the conversation opened — and stays host-owned, exactly like
   Review's artifacts. What moves to `pi.files` is the Files entry in the tool
   launcher: the act of a user browsing the project. The same split will apply
   to Review when it migrates.

6. **`terminal.pty` is classified critical.** Granting a plugin a PTY is
   granting it arbitrary execution as the user, which is stronger than any
   permission in the current matrix. It requires an explicit grant at least as
   prominent as `fs.write`, and is documented as such in the security spec. This
   is the real cost of clause 4's "no back doors" rule, and it is accepted
   deliberately rather than sidestepped by giving first-party plugins private
   privileges.

## Consequences

- The plugin API gains a first-party consumer, so a gap in it becomes a bug in a
  shipped feature rather than an abstract complaint. This paid off immediately:
  `pi.files` could not be written against `fs.glob`, which produced `fs.list`.
- A user can replace any panel tool. A better Git view can supersede Review by
  disabling it and installing an alternative — the arrangement ADR 0103 exists
  to enable.
- Three surfaces move from direct host IPC to a permission-gated bridge, which
  costs some latency and some code. Review in particular reads message-owned
  records the renderer holds today, so its data has to travel host → plugin →
  view instead of staying in one process.
- `terminal.pty` widens the plugin trust boundary. Nothing forces a user to
  grant it, and no plugin that lacks it can spawn a shell, but the permission
  now exists for third parties to request.
- Migration is sequenced — `pi.files` first, then `pi.review`, then
  `pi.terminal` — so each step proves the path before the next depends on it.
  Until all three land, `HEADER_TOOLS` keeps the not-yet-migrated tools and the
  plugin-views group renders beside them. `pi.files` has shipped; Review and
  Terminal remain built in.

## Alternatives considered

### Keep all four tools built in and let plugins add a fifth

Rejected as the end state: it leaves the two-tier arrangement and its blind spot
about API adequacy intact. It remains, however, the correct fallback for
Terminal specifically if `terminal.pty` is judged too broad to ship — that would
cost only the terminal's participation, not the rest of this decision.

### Give bundled plugins private host capabilities

Rejected. It would avoid the `terminal.pty` permission entirely, but it also
destroys the reason for migrating: a first-party plugin on a private channel
tests nothing about the public one, and the two-tier arrangement returns wearing
a plugin's clothes.

### Delete Review, Terminal, and Files outright

Rejected. Review is wired to agent artifacts (successful workspace Write/Edit
opens it) and Terminal is required for Codex parity by product decision (ADR
0019). Removing them would be a feature regression dressed up as a refactor.
