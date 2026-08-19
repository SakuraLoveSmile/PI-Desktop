# ADR 0105: Ship Files as a bundled plugin; keep Review and Terminal in the host

- Status: Accepted (amended 2026-08-19, scope reduced to Files)
- Date: 2026-08-19
- Deciders: PI-Desktop core
- Related: [ADR 0019](0019-work-panel-subsystems.md) ·
  [ADR 0104](0104-plugin-contributed-work-panel-views.md) ·
  [07-plugins/13-plugin-permissions-matrix](../spec/07-plugins/13-plugin-permissions-matrix.md)

## Context

ADR 0104 makes the work panel an extension point. That leaves the host's own
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

2. **Files becomes a first-party plugin** shipped with the application under
   `apps/desktop/resources/plugins/`, contributing its UI through
   `contributes.views` exactly as a third-party plugin does. It is packaged
   with `extraResources`, following the precedent already set by
   `resources/skills`.

   *Amended 2026-08-19.* This originally covered Review and Terminal too.
   Building the first migration answered both questions against it, and the
   scope is now Files alone — see §Amendment below.

3. **They carry a new `source: "builtin"`** alongside `installed`, `dev`, and
   `marketplace`: enabled by default, not uninstallable, but **user-disableable**
   like any other plugin. A user who does not want a bundled panel can turn it
   off.

4. **The capabilities they need become real plugin APIs**, not host back doors:

   | Plugin | Needs | Status |
   |---|---|---|
   | `pi.files` | `pi.fs.list`, `pi.fs.readText` | **Shipped.** Implementation showed `fs.glob` was not enough — it returns a flat, 500-capped file list with no directories, which cannot back a lazy tree — so `fs.list` was added to the public API under the existing `fs.read` permission |
   | `pi.review` | Session review records and rollback | **Not migrating** — see §Amendment |
   | `pi.terminal` | A PTY | **Not migrating** — see §Amendment |

5. **Only the *tool* migrates, not every surface that shares its component.**
   A `file:<path>` work panel tab is a transcript artifact — a file link or a
   plan checkpoint the conversation opened — and stays host-owned. What moves to
   `pi.files` is the Files entry in the tool launcher: the act of a user
   browsing the project. This tool-versus-artifact split turned out to be the
   load-bearing idea; see the amendment.

6. **`terminal.pty` is classified critical.** Granting a plugin a PTY is
   granting it arbitrary execution as the user, which is stronger than any
   permission in the current matrix. *Amended: this permission is not being
   introduced — see below.*

## Amendment (2026-08-19): the migration stops after Files

Building `pi.files` answered the two open migrations, and both answers were no.

**Terminal stays a host built-in.** Making it a plugin requires `terminal.pty`,
and shipping that permission means any third-party plugin may request arbitrary
execution as the user — a wider trust boundary than "the terminal reaches the
panel through the public channel" is worth. Clause 4 forbids giving first-party
plugins a private back door, and a bundled-only PTY channel would be exactly
that, so the honest options were "widen the boundary" or "do not migrate".
Terminal remains in `HEADER_TOOLS`.

**Review stays host-owned, and is reclassified as an artifact panel.** Its data
is message-owned by ADR 0043: each successful workspace Write/Edit carries its
own bounded `details.review` record, held by the renderer with the transcript.
Migrating it would mean moving that ownership into the host purely to hand it
back over a bridge — inverting a deliberate decision for no user-visible gain.

Applying clause 5's split instead puts Review on the *artifact* side, where it
already behaved: it is created and re-created by Write/Edit artifacts, exactly
as a `file:<path>` tab is created by a file link. So Review leaves the tool
launcher — the launcher is for surfaces a user picks — while remaining a live
tab kind the host renders. Closing it loses nothing, because the per-change
inline cards stay in the transcript.

The panel's built-in tools therefore settle at **Terminal and Browser**, with
Files as a bundled plugin and Review and `file:<path>` as artifact surfaces.

## Consequences

- The plugin API gains a first-party consumer, so a gap in it becomes a bug in a
  shipped feature rather than an abstract complaint. This paid off immediately:
  `pi.files` could not be written against `fs.glob`, which produced `fs.list`.
- The tool launcher now lists only what a user meaningfully *launches*. Surfaces
  the conversation produces — Review, file previews — are reached from the
  conversation, which is a more coherent rule than the previous mixture.
- A user can replace a panel tool with a plugin: a better file browser can
  supersede `pi.files` by disabling it and installing an alternative — the
  arrangement ADR 0104 exists to enable. Review and Terminal are not replaceable
  this way, which is the price of the amendment.
- One surface moved from direct host IPC to a permission-gated bridge, which
  costs some latency and some code, and proved the channel is sufficient for a
  non-trivial panel.
- `terminal.pty` is **not** introduced, so the plugin trust boundary is
  unchanged: no plugin can spawn a shell, and no permission exists to request.
  The cost is that Terminal stays host-only and cannot be replaced by a plugin.

## Alternatives considered

### Keep all four tools built in and let plugins add a fifth

Rejected as the end state: it leaves the two-tier arrangement and its blind spot
about API adequacy intact. The amendment adopts it for Terminal specifically —
`terminal.pty` was judged too broad to ship — which costs only the terminal's
participation, not the rest of this decision.

### Give bundled plugins private host capabilities

Rejected. It would avoid the `terminal.pty` permission entirely, but it also
destroys the reason for migrating: a first-party plugin on a private channel
tests nothing about the public one, and the two-tier arrangement returns wearing
a plugin's clothes.

### Delete Review, Terminal, and Files outright

Rejected. Review is wired to agent artifacts (successful workspace Write/Edit
opens it) and Terminal is required for Codex parity by product decision (ADR
0019). Removing them would be a feature regression dressed up as a refactor.
