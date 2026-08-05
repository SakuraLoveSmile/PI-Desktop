# 01. UI Information Architecture

> Language: English (per ADR 0009). This describes the shipped Codex-aligned
> shell (D034+). Component detail: [08-component-spec](08-component-spec.md);
> visual tokens: [07-ui-design-system](07-ui-design-system.md); behavior:
> [09-interaction-patterns](09-interaction-patterns.md).

## 1. Goal

A clear, restrained, developer-first workbench: one window, one active
destination, chat as the home surface, tools and permissions inline.

## 2. Shell regions

```text
+----------------------------------------------------------------------+
| Platform titlebar: macOS traffic lights / Windows/Linux actions     |
+------------------+--------------------------------+------------------+
| Sidebar (~275px) | Main pane (active destination) | Work panel       |
|  New task        |  chat home / transcript        |  (optional,      |
|  Extensions      |  or Extensions page            |   resizable      |
|                  |                                |   244–720px)     |
|  Sessions     +↕ |                                | surface          |
|   Recent rows ↕  |                                |                  |
|  Projects      + |                                | ◫ | App.tsx  ⌄ × |
|   Project A      |                                | > |              |
|   Project B      |                                | ◎ | Active       |
| Footer + bell    |  Floating composer (chat)      |   | resource     |
+------------------+--------------------------------+------------------+
```

- **Sidebar**: primary navigation — New task, the Extensions destination,
  path-less conversations under a compact **Sessions** section with new-session
  and sort actions, retained open-project groups under a following **Projects**
  section with a persistent new-project action, and the
  WorkBuddy-inspired local profile footer
  (Custom / Local profile → Settings / Logs / Theme, plus the durable
  notification bell and unread badge, D130/D117). Pull requests and Scheduled
  are intentionally omitted from the home sidebar. Each retained project is a
  path-keyed tab/group that can be
  collapsed independently. Project and conversation rows expose
  non-destructive pin/archive actions, an independent conversation-branch
  command, and sortable views. Projects not retained in the sidebar remain
  discoverable through Settings → Project archive.
  Collapsible to an icon rail (Cmd/Ctrl+B).
- **Product identity**: runtime shell copy uses `PI-Desktop`; the home hero and
  sidebar reuse the canonical `build/icon_1024.png` logo, while composer prompt
  rows have no leading brand icon and New task/session controls use a dedicated
  message-plus icon. On
  Windows/Linux, the expanded sidebar begins with a keyboard-accessible Home
  brand and Search plus Collapse sidebar controls at the right; activating the
  brand returns the main pane to chat. The macOS expanded sidebar omits the
  logo/title brand and places only Search and Collapse sidebar at the right of
  the traffic-light row. `Codex` remains only an external import source or a
  design-reference term.
- **Main pane**: exactly one destination at a time; destinations replace the
  pane (they are pages, not modals).
- **Titlebar**: platform-native desktop chrome (D118). macOS uses
  `hiddenInset` traffic lights and the system application menu. The expanded
  sidebar keeps Search and Collapse sidebar in the same 46px row, aligned to
  the right outside the traffic-light safety area; no logo/title is rendered
  there, including in fullscreen. While the work panel is open, the session
  pane titlebar hosts its collapse control at the top-right so the panel tab
  header remains focused on the active resource.
  Windows/Linux use a menu-free frameless 46px row with sidebar actions on the
  left and accessible minimize / maximize-or-restore / close controls on the
  right (D129). Destination history is shortcut-only (`Cmd/Ctrl+[` and
  `Cmd/Ctrl+]`); no back/forward buttons are rendered. The main titlebar has no
  notification action; the durable local inbox opens from the sidebar footer
  bell instead (D130/D117).
- **Work panel**: docked right column (not an overlay) created only by file,
  URL, browser-preview, successful-command, or successful workspace-edit
  artifacts. A combined create trigger keeps Review, Terminal, Browser, and
  Files one click away while the panel is visible; opened-but-inactive tools show a quiet
  dot and the active tool has a restrained edge marker. The 46px content header
  names the
  current resource, closes it directly, and opens a compact switcher for all
  current session resources. File paths stay distinct in that switcher while
  Review, Terminal, and Browser deduplicate by kind. The create trigger is not
  rendered while the panel is closed and does not create a global or empty
  manual panel entry point. A
  successful active-session workspace Write/Edit artifact opens Review;
  scratch, failed, and background-session writes never steal focus. Width is
  drag-resizable from 244px to 720px and remains at
  its fixed committed width while open. The sole panel-level control collapses
  the panel;
  each session retains its own runtime open state, tab set, active tab, and
  Browser resource in renderer memory. Selecting another session swaps the
  visible panel context without deleting either session's state; selecting a
  workspace without an active conversation hides the panel rather than
  reinterpreting relative resources. Background artifacts update only their
  originating session's retained panel context and never open, activate, or
  resize the visible panel. Startup is closed with no retained session
  contexts, and only the preferred panel width persists across launches.
  The work panel is a fixed-width in-flow column of the fixed client area
  (ADR 0033). Opening it reflows MainChat to the left and never expands the OS
  window; collapse and final-resource close release the space, and a divider
  commit updates the preferred width. On constrained windows chat reflows below
  its 360px target. Native window edges resize chat by reflow and never the
  panel. Maximized/fullscreen is unaffected; moving between displays or changing
  a display work area reconciles the window bounds normally. Persisted base
  bounds are the user's window size. Background artifacts never change the
  visible panel (D163, ADR 0033).
  Replaces the former context-panel overlay; workspace/model/status info lives
  in the composer chips and Settings instead.
- **Composer**: workspace-agnostic floating pill anchored to the conversation
  destination — scrollable centered stack on the empty home (D111),
  bottom-docked in a transcript, with no project / Local / branch rail (D095).
  Its left-of-input operating-mode chip is the sole active-session control for
  exactly **Agent** and **Plan**. Plan shows the same Agent's planning state,
  keeps the permission-mode chip, and exposes the host-written immutable
  `.pi/plan/*.md` artifact opener and approval surface after `SubmitPlan`.
  The conversation top bar retains the model picker and window actions but has
  no duplicate Agent/Plan control.
- **Backend status capsule**: appears under the titlebar while the backend
  restarts or is fatally degraded (D080), with an Open-logs action.

## 3. Destinations

### 3.1 Chat home (default)
- Empty state: a restrained hero title ("What should we build?" — project name
  becomes a dotted-underline button when a workspace is open), a compact
  contextual quick-action row without a section heading, optional first-run
  checklist, and centered composer. The actions prefill the composer or open a
  project without auto-submitting; the former four suggestion cards are not
  rendered (D131).
- With transcript: message stream + tool disclosure rows (D071), a contextual
  message-scoped review card immediately after each successful workspace
  Write/Edit row, docked composer, and a session-scoped permission card inline.
  The card reads the message's durable review snapshot rather than the current
  Git diff, so it stays visible after commit. It shows the file status and
  addition/deletion counts, expands the exact message hunks in place, and
  offers guarded rollback; it is not a global transcript entry. A background
  session's message, tool, and permission events never replace or cover the
  visible conversation.

### 3.2 Sidebar project groups

- **Sections**: the compact `Sessions` heading precedes `Projects` and owns
  path-less conversation creation plus the existing sort/archive-view menu. Its
  toolbar places sorting before new-session creation. Both headings keep quiet
  glyph actions and also accept a right-click create menu on the heading or empty
  list chrome so section creation stays discoverable
  without extra chrome. Its list shows at most five compact rows (140px) before
  scrolling internally, so standalone work stays visible without displacing
  project navigation. The following `Projects` heading exposes the
  folder-picker action; retained project groups use the remaining height and
  scroll independently.
- **Identity**: each group is keyed by the normalized full project path, never
  by a potentially ambiguous folder basename.
- **Header**: project name, active state, disclosure, new-task action, and an
  overflow menu. The directory title is one full-row disclosure target;
  collapse/expand affects only child visibility, and adjacent groups form one
  dense tree rather than detached cards. Hovering or focusing the project title
  reveals the full project path.
- **Project actions**: open folder reveals the project directory; pin/unpin
  changes presentation priority; archive/restore hides or restores the group in
  the default view; close removes the retained tab without deleting or
  archiving project/session data.
- **Conversation actions**: pin/unpin, archive/restore, and delete remain
  separate actions. Archive never removes the transcript. Open folder is a
  project action, not a conversation action.
- **Sort**: user-facing modes are Recently updated, Created date, Oldest
  first, and Name. Pinned rows precede unpinned rows. A legacy persisted
  `manual` value remains readable but does not imply a drag-reorder gesture.
- **Conversation list**: each group shows the ten most-recent sessions in the
  active sort order by default; the remainder folds behind a **Load N more…**
  row that expands the full time-grouped list on click. Pinned rows precede
  unpinned rows and are never pushed behind the fold; the expansion state is
  not persisted.
- **Standalone sessions**: path-less sessions remain in the separate Sessions
  section and never inherit the last active project's workspace.
- **Concurrency**: the shell selects one visible project at a time, while
  agent run state remains keyed by session. Switching project tabs does not
  cancel a background turn. Background events update only their originating
  session and never change the active session, page, project, or keyboard
  focus.

### 3.3 Pull requests
Segmented Open/Draft/All filters with counts; rows carry icon plate, number,
title, status badge, branch meta, external link, and "Review with agent"
(creates a chat turn). Requires an active workspace and `gh`.

### 3.4 Scheduled
Create card + task rows (cadence/enabled badges, prompt preview, last run,
Run now / toggle / Delete). Run now opens a session seeded with the prompt.
New tasks default to Agent. A migrated Plan task is allowed to remain stored,
but an unattended run is explicitly rejected before provider, artifact, or
queue work with `PLAN_REQUIRES_INTERACTIVE_SESSION`; it cannot display or
auto-approve a plan.
The user must explicitly switch it to Agent before enabling unattended
execution.

### 3.5 Extensions
The Extensions destination uses a compact header and a four-part segmented
control — Installed / MCP / Skills / Marketplace — with relevant tab counts;
it does not render a separate numeric overview band (D196 amends D169).
Installed groups rows by state — Needs attention / Updates available / Active /
Turned off — inside one hairline-separated panel; each row shows the plugin
glyph, name, version, state tags, author meta, risk-tinted permission chips,
and reveals quiet icon actions on hover (open panel, overflow menu with
auto-update and Uninstall) beside an always-visible enable switch. MCP and
Skills provide their own scoped configuration and authoring surfaces.
Marketplace is a card grid with category chips and skeleton placeholders.
Details open in a right-side sheet (about, links, safety notes, risk-labeled
permissions, version picker, readme). Installing opens a permission dialog
that groups requests by risk tier and marks permissions new to an upgrade.

### 3.6 Settings (full-page takeover)
Settings replaces the whole shell (D063): back-to-app + search + a compact
seven-destination rail in the exact order Basics / 全局 AI / Shortcuts / Model
configuration / Import / Project archive / Info (D133, D166), with elevated
content cards.
Appearance lives inside Basics; global AI behavior (permissions and context
management) lives inside 全局 AI; keyboard shortcuts has its own destination;
provider management lives inside
Agent. Import scans supported local agent stores and presents
candidates in collapsible groups. Project path is an alternate grouping
alongside the default source grouping, and every scan or grouping change starts
with all groups collapsed. Project archive owns the durable D086 Projects index
(search, add, expand, pin, archive/restore, close, and reopen) and always includes
archived records. Opening or switching a project retains a sidebar tab, selects
that project as the active workspace, and returns to chat. Other retained tabs
stay open. Extension management remains solely on the app shell's independent
Extensions destination described in §3.5.

## 4. Overlays

| Overlay | Trigger | Notes |
|---|---|---|
| Command palette | Cmd/Ctrl+K (also Cmd/Ctrl+Shift+P per D014) | builtin + plugin commands |
| Model menu | top-bar model picker | configured provider/model choices + settings entry (D091) |
| Profile menu | sidebar footer | Settings / Logs / Theme cycle (D041) |
| Notification inbox | sidebar footer bell | All/Unread views, task completion/failure rows, mark-all-read and clear actions (D130/D117) |
| Toasts | events (plugin toast, backend restored, copy) | top-center; 4s default, 8s for errors |

## 5. Navigation model

- `page` state: `chat | pulls | scheduled | plugins | settings`; `chat` is the
  conversation-surface route, not an operating mode. The project
  archive is the `projects` settings tab rather than a standalone page.
- Destination history is linear; `Cmd/Ctrl+[` and `Cmd/Ctrl+]` traverse it
  without persistent back/forward chrome.
- Selecting a project tab reuses `project.set` when its path differs from the
  selected host workspace and keeps the other tabs retained.
- Selecting a project-scoped thread activates its project before switching to
  `chat`. Selecting a temporary thread clears the visible active workspace
  before loading it.
- New task reuses an existing empty draft in the same project or temporary
  scope instead of stacking drafts (D088/D093; US-UI-11).

## 6. Keyboard map (IA level)

| Keys | Action |
|---|---|
| Cmd/Ctrl+K, Cmd/Ctrl+Shift+P | command palette |
| Cmd/Ctrl+B | toggle sidebar |
| Cmd/Ctrl+[ | previous destination |
| Cmd/Ctrl+] | next destination |
| Cmd/Ctrl+N | new task |
| Cmd/Ctrl+O | open project |
| Cmd/Ctrl+, | settings |
| Cmd/Ctrl+. | abort current run |
| Enter / Shift+Enter | send / newline (configurable Enter-to-send) |
| Esc | dismiss overlay/menu |

## 7. State-dependent chrome

- No provider configured → blocking guidance toward Settings before first run
  (`MODEL_NOT_CONFIGURED`).
- No workspace → home hero without project underline; Pull requests shows a
  workspace-required empty state. The composer never renders a workspace rail.
- Background project session → the originating project row retains its
  running/error indicator. Selected shell state can move independently while
  the session tool root remains bound to its durable project; its artifacts are
  retained in that session's work-panel context without opening or activating
  tabs over the currently selected project. Messages, tool events, permission
  requests, and panel resources remain scoped to that session. Explicitly
  opening the conversation restores its retained panel context and reveals any
  pending permission card with its original deadline.
- Completed/failed turn not already visible → host-core appends one durable
  inbox row. A result shown in the visible, focused current chat and every
  `aborted` turn append none. Background sessions and any turn finishing while
  the window is unfocused still append. The sidebar footer bell badge shows the
  unread count; selecting a row marks it read and activates its bound
  project/session.
  Electron additionally presents a native system notification only when the
  app window is unfocused, and clicking it focuses the window before activating
  the same session (D117). Receiving either the durable or native notification
  event never navigates by itself; only explicit activation does.
- Backend degraded → status capsule (restarting) or fatal banner with Open
  logs (D080); composer submits are rejected with readable errors while down.
- Plan checkpoint → the originating session shows the structured title and
  question, an opener for its immutable `.pi/plan/*.md` artifact, absolute
  approval deadline, and current status. The renderer retains the latest
  proposal/execution snapshot per session only for the current renderer
  lifetime, updated by live Host events; only a live `pending` row forms the
  approval gate. Reload through `plans.pending` while the same Host remains
  alive restores a still-pending row with its original deadline. Rejected,
  expired, approved/completed, and interrupted terminal cards are not
  rehydrated; a terminal card may remain visible and non-actionable only until
  renderer reload. Reject, expiry, or interruption clears the approval gate,
  leaves the session Plan/planning and editable, and requires a later turn to
  create a new artifact. While pending, the draft remains visible but
  read-only and only Approve or Reject actions are enabled. Host/app restart
  interrupts prior work before RPC with no replay or stale action; pending
  unapproved work remains Plan, while already-approved interrupted execution
  remains Agent. The UI is not required to present that interrupted terminal
  snapshot after restart.

## 8. i18n

English is the source locale; zh-CN ships in parallel for shell chrome
(labels asserted by US-UI e2e scenarios). Copy rules live in
[02-i18n-english-first](02-i18n-english-first.md).
