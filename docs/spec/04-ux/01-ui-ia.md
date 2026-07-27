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
|  Plugins         |  or Plugins page               |   resizable      |
|                  |                                |   320–720px)     |
|  Sessions     +↕ |                                | surface          |
|   Recent rows ↕  |                                |                  |
|  Projects      + |                                | App.tsx Review × |
|   Project A      |                                | ───────────────  |
|   Project B      |                                | Active artifact  |
| Footer + bell    |  Floating composer (chat)      |                  |
+------------------+--------------------------------+------------------+
```

- **Sidebar**: primary navigation — New task, the Plugins destination,
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
- **Product identity**: runtime shell copy uses `PI-Desktop`; the home hero,
  sidebar, and docked composer reuse the canonical `build/icon_1024.png` logo,
  while New task/session controls use a dedicated message-plus icon. On
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
  there, including in fullscreen.
  Windows/Linux use a menu-free frameless 46px row with sidebar actions on the
  left and accessible minimize / maximize-or-restore / close controls on the
  right (D129). Destination history is shortcut-only (`Cmd/Ctrl+[` and
  `Cmd/Ctrl+]`); no back/forward buttons are rendered. The main titlebar has no
  notification action; the durable local inbox opens from the sidebar footer
  bell instead (D130/D117).
- **Work panel**: docked right column (not an overlay) created only by file,
  URL, browser-preview, successful-command, or successful workspace-edit
  artifacts. Its
  top strip contains only currently opened, closeable tabs: file paths get
  distinct tabs while Review, Terminal, and Browser deduplicate by kind. A
  successful active-session workspace Write/Edit artifact opens Review;
  scratch, failed, and background-session writes never steal focus. Width is
  drag-resizable from 320px to
  `min(720px, 60vw, viewport − visible sidebar − 360px)`, preserving a
  readable 360px Main pane. The sole panel-level control collapses the panel;
  changing the visible session/workspace clears runtime tabs. Startup is closed
  with no tabs and only panel width persists across launches; temporary OS
  window expansion is excluded from restored launch bounds.
  Replaces the former context-panel overlay; workspace/model/status info lives
  in the composer chips and Settings instead.
- **Composer**: workspace-agnostic floating pill anchored to the chat
  destination — scrollable centered stack on the empty home (D111),
  bottom-docked in a transcript, with no project / Local / branch rail (D095).
- **Backend status capsule**: appears under the titlebar while the backend
  restarts or is fatally degraded (D080), with an Open-logs action.

## 3. Destinations

### 3.1 Chat home (default)
- Empty state: hero title ("What should we build?" — project name becomes a
  dotted-underline button when a workspace is open), optional first-run
  checklist, and centered composer. The former four suggestion cards are not
  rendered (D131).
- With transcript: message stream + tool disclosure rows (D071), docked
  composer, permission cards inline.

### 3.2 Sidebar project groups

- **Sections**: the compact `Sessions` heading precedes `Projects` and owns
  path-less conversation creation plus the existing sort/archive-view menu.
  Its list shows at most five compact rows (140px) before scrolling internally,
  so standalone work stays visible without displacing project navigation. The
  following `Projects` heading exposes the folder-picker action; retained
  project groups use the remaining height and scroll independently.
- **Identity**: each group is keyed by the normalized full project path, never
  by a potentially ambiguous folder basename.
- **Header**: project name/path, active state, disclosure, new-task action,
  and an overflow menu. The directory title is one full-row disclosure target;
  collapse/expand affects only child visibility, and adjacent groups form one
  dense tree rather than detached cards.
- **Project actions**: pin/unpin changes presentation priority;
  archive/restore hides or restores the group in the default view; close
  removes the retained tab without deleting or archiving project/session data.
- **Conversation actions**: pin/unpin, archive/restore, and delete remain
  separate actions. Archive never removes the transcript.
- **Sort**: user-facing modes are Recently updated, Created date, Oldest
  first, and Name. Pinned rows precede unpinned rows. A legacy persisted
  `manual` value remains readable but does not imply a drag-reorder gesture.
- **Standalone sessions**: path-less sessions remain in the separate Sessions
  section and never inherit the last active project's workspace.
- **Concurrency**: the shell selects one visible project at a time, while
  agent run state remains keyed by session. Switching project tabs does not
  cancel a background turn.

### 3.3 Pull requests
Segmented Open/Draft/All filters with counts; rows carry icon plate, number,
title, status badge, branch meta, external link, and "Review with agent"
(creates a chat turn). Requires an active workspace and `gh`.

### 3.4 Scheduled
Create card + task rows (cadence/enabled badges, prompt preview, last run,
Run now / toggle / Delete). Run now opens a session seeded with the prompt.

### 3.5 Plugins
Installed plugin list (enable/disable/uninstall), dev-load entry, permission
declarations.

### 3.6 Settings (full-page takeover)
Settings replaces the whole shell (D063): back-to-app + search + a compact
five-destination rail in the exact order Basics / Model configuration / Import /
Project archive / Info (D133), with elevated content cards.
Appearance lives inside Basics; provider management lives inside
Agent. Import scans supported local agent stores and presents
candidates in collapsible groups. Project path is an alternate grouping
alongside the default source grouping, and every scan or grouping change starts
with all groups collapsed. Project archive owns the durable D086 Projects index
(search, add, expand, pin, archive/restore, close, and reopen) and always includes
archived records. Opening or switching a project retains a sidebar tab, selects
that project as the active workspace, and returns to chat. Other retained tabs
stay open. Plugin management remains solely on the app shell's independent
Plugins destination described in §3.5.

## 4. Overlays

| Overlay | Trigger | Notes |
|---|---|---|
| Command palette | Cmd/Ctrl+K (also Cmd/Ctrl+Shift+P per D014) | builtin + plugin commands |
| Permission dialog | tool permission request | risk copy, args preview, allow-once / allow-session / deny, 120s countdown → deny |
| Model menu | composer model chip | configured provider/model choices + settings entry (D091) |
| Profile menu | sidebar footer | Settings / Logs / Theme cycle (D041) |
| Notification inbox | sidebar footer bell | All/Unread views, task completion/failure rows, mark-all-read and clear actions (D130/D117) |
| Toasts | events (plugin toast, backend restored, copy) | top-center; 4s default, 8s for errors |

## 5. Navigation model

- `page` state: `chat | pulls | scheduled | plugins | settings`; the project
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
  the session tool root remains bound to its durable project; its artifacts do
  not open or activate tabs over the currently selected project.
- Completed/failed turn not already visible → host-core appends one durable
  inbox row. A result shown in the visible, focused current chat and every
  `aborted` turn append none. Background sessions and any turn finishing while
  the window is unfocused still append. The sidebar footer bell badge shows the
  unread count; selecting a row marks it read and activates its bound
  project/session.
  Electron additionally presents a native system notification only when the
  app window is unfocused, and clicking it focuses the window before activating
  the same session (D117).
- Backend degraded → status capsule (restarting) or fatal banner with Open
  logs (D080); composer submits are rejected with readable errors while down.

## 8. i18n

English is the source locale; zh-CN ships in parallel for shell chrome
(labels asserted by US-UI e2e scenarios). Copy rules live in
[02-i18n-english-first](02-i18n-english-first.md).
