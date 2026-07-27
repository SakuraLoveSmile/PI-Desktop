# 08. Component Spec

> Layout and IA reference: [01-ui-ia.md](01-ui-ia.md)  
> Design tokens and foundations: [07-ui-design-system.md](07-ui-design-system.md)  
> Interaction behavior: [09-interaction-patterns.md](09-interaction-patterns.md)


> Shell layout is Codex-aligned: left thread sidebar (~275px), main transcript, floating bottom composer with mode/model controls. Prefer neutral charcoal surfaces over blue-slate chrome.
>
> **Precedence rule**: where a metric or copy string below disagrees with a
> Codex parity decision in [decisions-log §D](../08-meta/decisions-log.md)
> (D034+), the decision log wins — it tracks the live gold captures. Known
> updated values: sidebar ~275px (not 240px), toolbar 46px (not 44px),
> composer placeholder per D094/D066, home empty stack per D111,
> Projects index table per D066/D133, settings full-page shell per D063 with the
> compact five-destination directory from D090/D133, and retained path-keyed
> project groups per D093 (which preserves D088's Temporary/exact-path boundary
> while restoring scoped project and conversation organization actions), and
> product branding/icon contract per D094.

## 1. AppShell

### 1.1 Purpose

Outer frame that positions Topbar, Sidebar, MainChat, and WorkPanel. Owns resize logic, responsive collapse, and theme class.

### 1.2 Anatomy

```text
+------------------+------------------------------+------------------+
| Sidebar          | MainChat                     | WorkPanel        |
| (275px / 48px)   | (flex-1)                     | (320–720px /     |
|                  |                              |  hidden)         |
+------------------+------------------------------+------------------+
| Titlebar row: 46px, traffic lights at {x:16,y:16} (D034/D070)      |
+--------------------------------------------------------------------+
```

### 1.3 States

| State | Behavior |
|---|---|
| Default | Sidebar expanded, work panel hidden |
| Narrow (<640px) | Sidebar auto-collapses to icon rail |
| Narrow window with panel open | Work panel width re-clamps to 60vw |
| Fullscreen | Topbar remains; sidebar toggle and artifact-driven panel stay available |

### 1.4 Interactions

- Sidebar toggle: keyboard shortcut + icon button beside Search in the expanded
  sidebar header; the button moves to the main titlebar while collapsed
- Work panel collapse: sole control lives in the session pane titlebar top-right
  while the panel is open, so the work-panel tab strip is not occupied
- Work panel resize: left-edge drag handle (§5.4)
- Window resize: responsive collapse per [07-ui-design-system.md](07-ui-design-system.md) §10.1

### 1.5 Accessibility

- Landmark roles: `<nav>` for sidebar, `<main>` for chat, `<aside>` for work panel, `<header>` for topbar
- Tab sequence: topbar → sidebar → main chat → work panel → composer

### 1.6 MVP constraints

- Sidebar width is fixed; only the work panel drag-resizes
- The main pane renders one active transcript and one selected workspace while
  the sidebar may retain several project tabs/groups
- No status bar (deferred)

### 1.7 Platform application chrome

| Platform | Top-level chrome | Application menu |
|---|---|---|
| macOS | Native inset traffic lights at `{x:16,y:16}`; expanded sidebar Search and Collapse controls share the row at right, with no logo/title; open work-panel collapse sits in the session pane top-right | System menu: PI-Desktop, File, Edit, View, Window, Help |
| Windows | Frameless 46px titlebar; sidebar actions at left, open work-panel collapse in session pane top-right ahead of minimize/maximize/close | None inside the window |
| Linux | Frameless 46px titlebar; sidebar actions at left, open work-panel collapse in session pane top-right ahead of minimize/maximize/close | None inside the window |

- The macOS system menu exposes New Task, Open Project, Settings, Command
  Palette, Sidebar, standard editing, zoom/fullscreen, window, Help, Logs, and
  Check for Updates actions. Windows/Linux expose equivalent product actions
  through in-app controls and keyboard shortcuts, with update checks in
  Settings -> Info.
- When Settings -> Basics -> Developer mode is enabled, the macOS View menu
  additionally exposes the native developer-tools role. All platforms expose
  F12, and Windows/Linux also expose Ctrl+Shift+I; the commands and Settings
  Open console action are unavailable while the mode is disabled.
- Window buttons have localized tooltips and accessible names. The maximize
  glyph reflects the initial native state plus later maximize/unmaximize
  events. Each Windows/Linux button is an explicit non-drag pointer target so
  the surrounding titlebar drag region cannot consume minimize, maximize,
  restore, or close clicks.
- Windows/Linux do not render File/Edit/View/Window/Help in the titlebar and
  do not reserve left-side space for an application menubar. F10 and
  Shift+F10 remain available to focused content.
- macOS native commands that create or reload a window wait for the renderer's menu
  subscription acknowledgement instead of relying on a timing delay.

---

## 2. Topbar

### 2.1 Purpose

Global controls bar: project identity, model selection, mode indicator, abort
button, and settings entry.

### 2.2 Anatomy

```text
[☰ Sidebar] [📁 Project name] [🤖 Model: provider/model] [🛡 Mode badge] [⏹ Abort] [⚙ Settings]
```

(Icons described functionally; actual render uses Lucide SVGs.)

### 2.3 Layout

- Height: 46px (Codex toolbar rhythm, D034; supersedes the old 44px)
- Background: bg-secondary
- Border: border-subtle bottom
- Sticky: `z-sticky`
- Items: left-aligned controls, right-aligned actions

### 2.4 States

| Element | Default | Running | Error | No workspace |
|---|---|---|---|---|
| Model selector | clickable dropdown | disabled during stream | clickable | clickable (no provider warning) |
| Mode badge | "Agent" or "Chat" badge | same | same | same |
| Abort button | hidden | visible, accent-hover pulse | hidden | hidden |
| Project name | workspace folder name | same | same | "No project" muted |

### 2.5 Accessibility

- Every control is keyboard-reachable with Tab
- Abort button has `aria-label="Abort active turn"`
- Model selector announces current value via `aria-label`

### 2.6 MVP constraints

- No search field in topbar (deferred)
- Notification history is the bounded D117 inbox; scheduled reminders,
  permission-request notifications, and notification preferences remain out of
  scope

---

## 3. Sidebar

### 3.1 Purpose

Scoped project and session navigation, management, and notification access. The
expanded sidebar shows path-less conversations first under a compact `Sessions`
heading and retained project tabs under a following `Projects` heading; the
collapsed state is an icon rail. Retained tabs are renderer presentation state,
not additional host workspaces.
The home destination controls expose Plugins only; Projects is managed through
Settings → Project archive, while Pull requests and Scheduled are not rendered
in the sidebar.

### 3.2 Anatomy

```text
Expanded (~275px, D034/D070):
+---------------------------+
| [lights]          [⌕][◧] |  macOS
| [π] PI-Desktop    [⌕][◧] |  Windows/Linux
| [message+ New Chat] button |
| Plugins                   |
| SESSIONS         [msg+][↕]|
|   • Path-less session   ↕|
| PROJECTS            [dir+]|
| [v] project-A      [+] … |
|   • Project session      |
| project-B      [>] [+] … |
|                           |
| [(user) Custom       v][?]|
|        Local profile     |
+---------------------------+

Collapsed (48px):
+----+
| [+] |
| ──  |
| ses |
| ses |
| ──  |
| [⚙] |
+----+
```

### 3.3 States

| State | Behavior |
|---|---|
| Expanded | Full session titles visible |
| Collapsed | Icon rail — hover shows tooltip with session title |
| Active session | Accent-blue outlined status ring plus active row background |
| Session in progress | Orange breathing dot; static under reduced motion |
| Session completed | Green check mark when the row is not selected |
| Session failed | Red circled alert mark when the row is not selected |
| Hover session | bg-tertiary background |
| Active project | Header carries active state; topbar follows that workspace; composer exposes no workspace identity |
| Collapsed project | Header remains visible; child conversations are hidden |
| Archived row | Hidden by default; visible in the explicit archived view |
| No retained project | Compact Open project entry; standalone Sessions rows remain available |
| Empty group | Muted one-line empty state; group create action remains available |
| Footer idle | Transparent 58px band; profile and Help controls remain visually quiet |
| Footer hover/focus | Only the targeted control receives the semantic hover/focus treatment |
| Profile menu open | Profile trigger is active; 280px menu opens 8px above the footer |

### 3.4 Interactions

- Click the project directory row (chevron, folder, label, or remaining
  disclosure hit area): activate its path when necessary, then toggle only
  that project's conversation group; retain the other project groups
- Click session: activate its bound project when necessary, switch the active
  session, and scroll to the last message
- Click the message-plus New Chat control: create/reuse a draft in the current workspace scope
- On Windows/Linux, click the PI-Desktop brand to return the main pane to the
  chat home while preserving the active conversation and workspace; macOS
  intentionally omits this brand control from the sidebar header
- Click Search or Collapse sidebar at the right of the header row to
  open global search or collapse the sidebar respectively
- While the work panel is open, click the session-pane top-right panel collapse
  control to hide the panel without deleting tabs; the work-panel header keeps
  only dynamic tabs
- Click the `Projects` heading folder-plus action: open the project picker and
  retain the selected project
- Right-click the `Projects` heading or empty project-list chrome: open a
  single-item create menu that runs the same new-project picker action
- Click project `+`: activate that project and create/reuse a session bound to
  its exact path
- Click the `Sessions` heading message-plus action: clear the workspace and create/reuse a
  path-less persistent session
- Right-click the `Sessions` heading or empty standalone-list chrome: open a
  single-item create menu that creates/reuses a path-less temporary session
- Project overflow: switch, pin/unpin, archive/restore, close retained tab
- Conversation overflow: pin/unpin, archive/restore, Create branch, open
  folder, delete. Create branch is disabled while that conversation is
  running; success activates the independent child session and focuses the
  composer.
- The sort menu remains beside the `Sessions` heading: Recently updated,
  Created date, Oldest first, and Name; pinned rows stay ahead of unpinned rows.
  A stored `manual` compatibility value requires no drag-reorder UI.
- Project groups use compact vertical spacing so adjacent directories and
  conversation rows read as one dense navigation list rather than detached
  cards. Directory `+` and overflow actions remain hidden until hover or
  keyboard focus.
- Sidebar toggle: expanded-header icon beside Search + keyboard shortcut; the
  collapsed main titlebar retains an Expand sidebar icon; when the work panel is
  open, the session-pane top-right hosts the sole panel collapse control
- Click the local profile trigger: open or close the identity menu containing
  Settings, Logs, and Theme
- Click the footer bell: open or close the durable notification inbox

### 3.5 Accessibility

- Projects and Sessions headings have localized names; each disclosure and
  create action has a scope-specific accessible name
- Session groups use semantic `section` containers
- Active session: `aria-current="true"`
- Every visible session indicator has a localized accessible name and tooltip;
  color is reinforced by ring, dot, check, or alert geometry
- Project directory rows expose `aria-expanded` and `aria-controls`; menu
  check/radio items expose `aria-checked`
- Collapsed state: each icon has `aria-label` with session title
- Keyboard: arrow keys navigate session list
- The profile trigger exposes `aria-haspopup="menu"` and its expanded state;
  the menu has a stable accessible relationship to the trigger
- The notification trigger has a localized accessible name containing the
  unread count, exposes `aria-expanded`/`aria-controls`, and never relies on
  the badge color alone


### 3.6 Brand and icon contract

- The visible shell name is `PI-Desktop`; Codex is not used as the renderer
  identity.
- `BrandLogo` imports canonical `build/icon_1024.png` through Vite. The
  empty-home hero renders it at 56px, the expanded/collapsed sidebar at
  20px/18px, and the docked composer at 15px.
- The expanded/collapsed New task control and project/Temporary session
  creation controls render the dedicated message-plus session icon. Generic
  `IconPlus` remains reserved for adding non-session entities.
- Icons are decorative when a localized text label or accessible name is
  present; click, keyboard, and focus behavior remain unchanged.
- The expanded sidebar brand is a localized button with a 20px logo and the
  shell name on Windows/Linux; pointer or keyboard activation navigates to the
  chat home. macOS hides this brand and right-aligns Search then Collapse
  sidebar in the same 46px row as the native traffic lights. Fullscreen keeps
  the brand hidden while reclaiming the native-chrome padding.

### 3.7 MVP constraints

- Expanded sidebar search filters the visible session tree in place; the
  collapsed rail continues to use the global command palette
- No drag-to-reorder contract; `manual` is a persisted compatibility value
- Project tabs do not create another host workspace or a second main pane

### 3.8 Project group contract

Each retained project is one labeled `section` keyed by normalized full path.
The header owns project-level controls; the child list owns conversation-level
controls.

| Element | Contract |
|---|---|
| Group root | localized project name; full path in tooltip/accessible description |
| Directory disclosure | single full-row target with `aria-expanded` / `aria-controls`; may activate an inactive project before toggling, but never archives |
| Project pin | presentation priority only; no host row deletion/move |
| Project archive | omitted from default view; restorable from archived view |
| Project close | removes retained tab only; durable project/sessions remain |
| Session list | exact-path matches only; no basename grouping |
| Active group | exactly one group reflects the selected host workspace |
| Task state | In-progress, selected, completed, and failed indicators update by session without replacing the visible transcript; precedence is in-progress, selected, then terminal outcome |

### 3.9 Local profile footer contract

The expanded sidebar ends with a WorkBuddy-inspired local identity cluster.
It borrows the compact avatar-and-actions grammar without implying a cloud
account, subscription, or collaboration backend.

| Element | Contract |
|---|---|
| Footer band | `58px` high, transparent, no top separator; remains outside the scrollable project/session region |
| Profile trigger | `44px` high, flexible width, rounded hover target; opens the profile menu |
| User glyph | `30px` circular local-user glyph; decorative when the text label names the control |
| Identity copy | Primary `Custom`; secondary `Local profile` or localized `本地配置`; two lines truncate independently |
| Chevron | Trailing disclosure indicator; reflects the menu's open state without motion when reduced motion is requested |
| Notification shortcut | Separate `32px` square Bell target with unread badge; opens the durable inbox above and to the right of the footer |
| Profile menu | `280px` wide, bottom anchored `8px` above the footer; opaque elevated surface |
| Identity header | Repeats the glyph and two-line local identity; non-interactive |
| Menu actions | Divider, then Settings, Logs, and Theme in that order; Theme retains its current-value metadata |

---

## 4. MainChat

### 4.1 Purpose

Primary chat area containing ChatTranscript and Composer. Scrollable, center of the workstation.

### 4.2 Anatomy

```text
+--------------------------------------+
| ChatTranscript (scrollable, flex-1)  |
|   MessageBubble (user/assistant)     |
|   ToolCallCard                       |
|   Review changes · 3 files  +8 −2  |
|   PermissionCard                     |
|   ...                                |
+--------------------------------------+
| Composer (docked in thread view;     |
| home uses scroll stack, D111)        |
+--------------------------------------+
```

### 4.3 Layout

- Background: bg-primary
- Max content width: 720px (messages), centered
- Scroll behavior: auto-scroll to bottom on new message; manual scroll pauses auto-scroll

### 4.4 States

| State | Behavior |
|---|---|
| Empty | Hero + optional onboarding checklist + home composer in one scrollable stack; no suggestion cards (D111/D131) |
| Streaming | Auto-scroll locked; new tokens append |
| Idle (after stream) | Auto-scroll unlocked; user can scroll freely |
| Session-owned dirty Git workspace | After this session successfully writes or edits the workspace, a compact Review changes command follows its transcript outside collapsed activity groups; it shows the capped file count plus explicit addition/deletion totals and opens the singleton Review tab. Other sessions in the same project do not render the command. |

### 4.5 Accessibility

- `role="log"` for transcript container
- `aria-live="polite"` on transcript for new message announcements
- Scroll-to-bottom button appears when user scrolls up during stream
- Review changes is a native button with a localized accessible name that
  includes file, addition, and deletion counts; the visible text and icon do
  not rely on color to communicate the action

### 4.6 MVP constraints

- No split-pane chat (single thread)
- No markdown editor preview split

---

## 5. WorkPanel

> Replaces the former ContextPanel overlay. The workspace/model/status
> summary it carried lives in the composer chips and Settings.

### 5.1 Purpose

Docked right work column for inspecting and steering the agent's workspace:
Review (working-tree diff), Terminal (interactive PTY), Browser (embedded
preview), and Files (workspace browser). Codex-parity surface.

### 5.2 Anatomy

```text
+--------------------------------------+
| App.tsx [×] | Review [×]              |  dynamic tabs only, 46px
| (session pane top-right hosts [◧] while open) |
+--------------------------------------+
| Active tab body                      |
|  Review: file cards + unified diff   |
|  Terminal: xterm host                |
|  Browser: URL bar + preview surface  |
|  Files: tree + file viewer            |
|                                      |
|                                      |
+--------------------------------------+
^ 6px resize handle on the left edge
```

### 5.3 States

| State | Behavior |
|---|---|
| Closed (default) | Not rendered; no unconditional launcher and no retained tabs after startup. A contextual Review changes command is available only in a session that produced a successful workspace Write/Edit while that Git working tree remains dirty. |
| Open | Docked flex row right of the main pane; opened by an artifact with width 320–`min(720, 60vw, viewport − visible sidebar − 360px)`. Windows keeps the native window bounds stable so its frameless window does not repaint between the panel layout and an asynchronous bounds change; other platforms may grow the window outward when space permits. |
| Multiple artifacts | Tabs follow first-open order, scroll horizontally, keep the active tab visible, and preserve readable labels at the panel minimum |
| Session switch | The destination session's retained open state, tabs, active tab, and Browser resource replace the previous session's panel context atomically; neither context is deleted |
| Resizing | Live width follows pointer while preserving a 360px MainChat; committed (and persisted) on release |
| No workspace | Each tab renders its own "open a project" empty state |
| Narrow window | Width re-clamps on window resize; the 320px panel minimum wins only when the supported shell itself cannot satisfy both minima |

### 5.4 Interactions

- Trigger: file/URL references, BrowserPreview, and completed-command artifacts
  create/activate their resource tab in the originating session's runtime
  context. BrowserPreview events carry `sessionId`, and the renderer retains
  that session's preview path/URL as its Browser resource. Successful workspace
  Write/Edit artifacts create/activate Review in the originating session.
  Background artifacts may update that retained context but never reveal it,
  resize the window, or change visible selection/focus. While the shared
  working-tree diff is dirty, only a session that produced a successful
  workspace Write/Edit exposes Review changes; activating it creates, reopens,
  or activates that session's singleton Review tab. Other sessions in the same
  project do not inherit the entry. Repeated resources deduplicate within the
  originating session.
- Review truth: the renderer shares one current-workspace diff between the
  transcript entry and Review. It refreshes on workspace activation, after a
  500ms debounce for successful Write/Edit/Bash completion, on explicit Review
  refresh, and when the app window regains focus. A workspace-keyed request
  sequence discards late responses. Clean and non-Git results clear review
  ownership for that workspace; clean, non-Git, missing-workspace, and
  failed-refresh states hide the transcript entry. Session ownership is
  renderer-memory state and is discarded on relaunch with D142's work-panel
  contexts.
- Tab close: closing an active tab selects its right neighbor, then its left;
  closing the last tab hides the panel. The panel-level collapse control lives
  in the session pane top-right (not the work-panel tab strip) and hides the
  panel without deleting the runtime tab set; a later artifact reopens it.
  Terminal mounts only after its first command artifact and stays mounted while
  its tab exists so the PTY and scrollback survive switches.
- Header context menu: right-click the work-panel top strip or empty tab-list
  chrome (not an existing tab) opens a one-shot tools menu that creates/activates
  Review, Terminal, or Browser via the same `openWorkPanelTab` path as artifacts.
  Existing tab rows keep their select/close behavior and do not open the menu.
- Context change: selecting another session atomically projects that session's
  retained `{open, tabs, activeTabId, browserResource}` state. The previous
  session's context remains in renderer memory and is restored when selected
  again. A workspace selection with no active conversation hides the panel.
  Every context remains bound to its originating session/workspace, so relative
  file and Browser resources are never reinterpreted against another workspace.
- Resize: pointer drag on the left-edge handle.
- Persistence: all session contexts are renderer runtime state only. On app
  startup, open state, tabs, active-tab selection, file requests, and Browser
  resources reset; only `{width}` remains in localStorage
  `pi.desktop.workPanel`. Where supported, OS window-state persistence excludes
  width added by an open work panel, so relaunch starts at the same base shell
  width. Windows docks within the existing client bounds and does not add or
  remove native window width when the panel opens, collapses, or closes its
  final tab.

### 5.5 Accessibility

- `<aside>` landmark; the top strip uses `nav`, `role="tablist"`, and a
  localized `aria-label`; each resource uses `role="tab"`, `aria-selected`,
  `aria-controls`, and a corresponding `role="tabpanel"`
- Resize handle: `role="separator"` `aria-orientation="vertical"`
- Every tab close and the sole session-pane panel collapse button expose
  localized names

### 5.6 MVP constraints

- Tab content specs: Review diff is read-only (no line comments yet);
  Browser is user-driven (no agent control); Files is read-only
- Single panel instance; no per-tab detach or split

---

## 6. SessionList

### 6.1 Purpose

List user sessions by execution context inside the sidebar. It exposes the
sessions for every retained project tab plus persistent sessions that have no
project. Pin/archive/collapse state is a presentation over durable host
sessions, not a replacement persistence model.

### 6.2 Anatomy

Groups and session items:

```text
[folder] current-project                         [+]
           Session title
[folder] another-project                         [+]
           Session title
SESSIONS                                      [msg+][↕]
           Session title
```

### 6.3 States

| State | Appearance |
|---|---|
| Active | accent-blue outlined ring, active bg highlight, text-primary |
| Inactive | bg-secondary, text-secondary |
| Hover (inactive) | bg-tertiary |
| In progress | warning-orange breathing dot; no motion under reduced-motion |
| Completed | success-green check mark |
| Failed | error-red circled alert mark |
| Pinned | ordered before unpinned rows within the selected sort |
| Archived | omitted by default; shown only when archived view is enabled |

### 6.4 Interactions

- Click: activate session
- Project matching uses the normalized full project path, never only the folder
  basename.
- Sessions for retained paths appear beneath their corresponding project
  group. Sessions for closed paths remain discoverable from Settings → Project
  archive.
- Selecting a temporary session clears the active workspace so session and
  tool context do not imply project access.
- Pin/archive actions update renderer presentation metadata; delete remains
  the explicit durable host operation.
- Create branch snapshots the idle conversation's complete current transcript
  into an independent session. The child stays in the same project or
  standalone Sessions section and becomes active; later transcript/configuration changes
  do not affect the source. The action is disabled for a running source.
- Selecting a conversation with a different project first activates that
  project's workspace. A running turn in the previously selected session is
  not aborted.
- Keyboard: arrow up/down, Enter to select
- Delete: row menu or command palette `builtin.session.delete`

### 6.5 Accessibility

- Each group is a labeled `section`.
- Scope-specific create buttons expose localized `aria-label` values.
- Active rows expose the selected visual state and retain their full title in
  a tooltip.
- Archived state and every task status are announced rather than conveyed by
  color alone. The status slot also uses different geometry for selected, in
  progress, completed, and failed.

### 6.6 MVP constraints

- Search remains a local title filter; archive visibility and ordering are
  local view controls rather than host queries.
- Temporary means **not bound to a project**, not ephemeral storage; these
  sessions survive restart.
- The standalone Sessions body shows at most five compact 28px rows and
  scrolls internally when more rows exist. The Projects list uses the remaining
  sidebar height and scrolls independently; neither region scrolls the footer
  or primary navigation.

---

## 7. ChatTranscript

### 7.1 Purpose

Scrollable container rendering the ordered sequence of user messages, assistant
responses, lightweight tool activity rows, and permission cards for a session.

### 7.2 Anatomy

```text
+----+-------------------------------------+
|map | [User MessageBubble]                |
|rail| [Thinking disclosure]               |
|    | [Assistant MessageBubble]           |
|    |   [ToolCallRow]                     |
|    |   [PermissionCard] (interrupt)      |
|    | [Assistant MessageBubble (resume)]  |
|    | [User MessageBubble]                |
|    | ...                                 |
+----+-------------------------------------+
```

### 7.3 States

| State | Behavior |
|---|---|
| Streaming | New tokens append; auto-scroll only while pinned to bottom |
| Thinking-only streaming | Transcript opens; disclosure stays open; no empty answer bubble or duplicate Working row |
| Idle | Scrollable; no auto-scroll |
| Permission pending | PermissionCard inserted inline; transcript continues after resolution |
| Error | Error MessageBubble with actionable retry link |

### 7.4 Interactions

- Scroll: user scroll pauses auto-scroll; "scroll to bottom" floating button appears
- Hover message: copy action appears
- Toggle Thinking disclosure: expand/collapse reasoning independently from the
  final answer; streaming reopens it while reasoning is arriving
- Hover code block: copy button appears
- Hover or focus a minimap marker: show the localized sender and a bounded
  plaintext preview; nearby markers magnify horizontally without reflowing the
  rail
- Click a minimap marker: smoothly scroll its message near the top of the
  transcript viewport
- Scroll the transcript: update the active minimap marker against an anchor
  near the upper third of the viewport
- Show the minimap rail only while the transcript overflows one page; if
  content fits the viewport, hide the rail even when two or more markers exist

### 7.5 Accessibility

- `role="log"` container
- `aria-live="polite"` for new content announcements
- Each message: `role="article"` with `aria-label` describing sender
- Thinking uses a button disclosure with `aria-expanded` and `aria-controls`;
  the localized label distinguishes Show thinking from Hide thinking, and the
  collapsed panel is hidden from accessibility and focus traversal
- The minimap is a localized navigation landmark; every marker is a button
  labeled with its message sender
- The marker nearest the reading position exposes `aria-current="true"` and
  keyboard focus opens the same preview available on pointer hover

### 7.6 MVP constraints

- No message search within transcript
- No inline message branching tree; regenerate variants remain linear per user
  root turn. Session-level Create branch produces an independent conversation
  row instead of adding tree chrome inside the transcript.
- The minimap renders only when at least two visible user or assistant messages
  exist **and** the transcript content overflows one viewport (scrollHeight >
  clientHeight); tool-only rows do not create markers and a one-page transcript
  never shows the rail
- Marker previews are capped at 280 source characters and are display-only

---

## 8. MessageBubble

### 8.1 Purpose

Single message render — either user (plaintext) or assistant (markdown streaming).

### 8.2 Anatomy

**User message:**

```text
+------------------------------------------+
| plaintext message content                |
|                    timestamp · edit icon  |
+------------------------------------------+
```

**Assistant message:**

```text
+------------------------------------------+
| [Thinking ▾]                             |
|   separate reasoning markdown (optional) |
| ──────────────────────────────────────── |
| [markdown rendered content]              |
|   code blocks: mono, bg-inset           |
|   inline code: mono, bg-inset           |
|                    timestamp             |
+------------------------------------------+
```

### 8.3 Layout

- Max content band: 760px thread column; assistant body max 720px
- User: right-aligned, theme-neutral soft plate (`color-mix` on primary ink,
  never a fixed accent tint), with a subtle primary-ink border,
  `radius-lg-plus`, capped at `min(78%, 560px)` so short prompts read as
  chat turns rather than full-width blocks. User body is plaintext with
  preserved hard newlines (`white-space: pre-wrap`);
  only trailing/leading composer trim is applied, never internal newline
  collapse
- Assistant: transparent surface, left-aligned, markdown rendered at full
  content width
- Thinking: separate lightweight disclosure above the answer with no card
  background or outer border. Its Sparkles/chevron trigger uses secondary text,
  and the expanded markdown is indented by a subtle theme-token left rule. It
  is never concatenated into answer markdown.
- Hover actions: quiet icon-only action chips under the bubble — Copy always;
  Fork and Regenerate on completed assistant turns; Edit and Delete on user
  turns. Assistant rows expose neither Delete nor Edit. Chips render the glyph
  alone: the label is carried by `aria-label` plus a themed hover/focus
  tooltip above the chip, never as visible caption text (D137). Right-aligned
  for user turns, left-aligned for
  assistant turns; visible on hover/focus-within. Regenerate truncates the
  durable transcript to the nearest preceding user prompt and re-runs that turn
  in place instead of appending a duplicate branch. When more than one
  variant exists, a ChatGPT-style `current / total` pager on the root user
  turn switches archived branches without losing history (D109). After
  Retry/Regenerate starts, the root user turn remains in the live transcript
  and owns the pager whenever `revisionCount > 1`; replacing the assistant/tool
  tail must not move or detach that pager from the user bubble. The pager is
  part of the message action toolbar: hidden by default and revealed together
  with Copy on row hover or keyboard focus.
  Fork creates and activates an independent session whose snapshot ends at the
  selected assistant response, requires an idle source, and leaves that
  source's transcript, live runtime, and provider cache state untouched (D134).
  Edit belongs to the user turn: it swaps the prompt bubble for a focused
  inline textarea (Escape cancels, Cmd/Ctrl+Enter saves; slash turns seed the
  typed `command` form so saving re-expands the template), widens the user
  column to the assistant reading width while open, and hides the action
  toolbar. Saving runs the Regenerate path with the new text in the same
  session, so the replaced prompt and its whole answer tail are archived as a
  D109 revision and the pager walks back to the original exchange. An
  unchanged prompt closes the editor without spending a turn (D137).
- Assistant meta: optional model badge + token-usage chip under the answer
  (collapsed summary with hover breakdown for input/output/cache/reasoning)
- Gap: 10px vertical padding between consecutive message rows (denser than
  consumer chat, closer to WorkBuddy task transcript)
- Font: text-base (14px) for body; text-sm (13px) mono for code
- Tool activity: tool-name classification selects a semantic 15px icon;
  `fork`, `fork_agent`, `fork_task`, and `fork_session` use the GitFork branch
  icon instead of the generic tool glyph.

### 8.4 States

| State | Appearance |
|---|---|
| Streaming | accent left rule on the answer surface; content grows |
| Thinking streaming | disclosure open; answer bubble omitted until answer text exists |
| Complete | no streaming rule; full rendered markdown |
| Error | assistant error card in transcript; localized summary + stable code; details disclosure opens to redacted provider response, provider/model IDs, and copy action; retriable failures show Retry and configuration failures show Open settings |

### 8.5 Accessibility

- User: `aria-label="User message"`
- Assistant: `aria-label="Assistant message"`
- Thinking trigger exposes localized Show/Hide labels, `aria-expanded`, and an
  `aria-controls` relationship to the reasoning panel
- Timestamps: `aria-label` with full time string, visual shows relative time

### 8.6 MVP constraints

- No message reactions/annotations
- No edit user message (deferred)
- Copy assistant answer excludes thinking text

### 8.7 Markdown & code rendering (implemented)

Renderer: `apps/desktop/src/components/Markdown.tsx` + `apps/desktop/src/lib/shiki.ts`.

- **Streaming without jank**: source splits into top-level blocks via `marked`'s
  lexer; each block renders through a memoized `<ReactMarkdown>`. While
  streaming only the tail block re-parses (incremental re-lex from the last
  block boundary), so cost stays linear in message length.
- **Plugins**: `remark-gfm` (tables, task lists, strikethrough, autolinks),
  `remark-math` + `rehype-katex` (inline `$…$`, display `$$…$$`). Raw HTML
  stays escaped (no `rehype-raw`).
- **Syntax highlighting**: Shiki singleton with the JavaScript regex engine
  (no wasm), themes `github-light`/`github-dark` following `data-theme`.
  Languages lazy-load per fence tag with a plain-mono fallback until ready.
  Streaming code re-tokenizes only changed lines by chaining GrammarState
  (per-line cache), so per-frame cost is constant regardless of block size.
- **Code block chrome**: `.code-block` card (radius-md-plus, hairline border,
  `--gray-1000` dark / `#f3f3f3` light) with `.code-block-head` — language tag
  (text-xs, muted) left, persistent copy button right (copies the raw code
  string). Body `pre` at text-sm-plus / leading-relaxed with horizontal
  scroll.
- **Prose**: heading ramp h1 `text-lg-plus` → h4+ `text-base` (semibold,
  tracking-tight), token-based lists/task lists/blockquote/hr/kbd/img; tables
  wrap in `.table-wrap` (rounded hairline shell, horizontal scroll).
- **Links**: rendered with `target="_blank"` so the main process routes them
  through `shell.openExternal`; in-window navigation stays blocked.
- **Typewriter**: rAF-driven reveal (speed scales with backlog);
  `prefers-reduced-motion` renders the buffer verbatim. `.thread-scroll` sets
  `overflow-anchor: none` (pinned-follow owns the scroll position) and
  `.message-row` uses `content-visibility: auto` for long transcripts.

---

## 9. ToolCallRow

### 9.1 Purpose

Lightweight inline disclosure row showing a semantic tool action, its primary
argument hint, status, input, and output. It follows D071 and is intentionally
not an elevated card.

Consecutive tool calls form one ChatGPT-style processing group. The group is
collapsed by default and its header shows `Processing · 12s` while active or
`Processed for 12s` after completion. Expanding it reveals the ordered tool
activity rows and their nested input/output disclosures.

### 9.2 Anatomy

```text
[sparkle] Processed for 12s  3 steps      [›]
          ├─ [file] Read /src/foo.ts      [›]
          ├─ [search] Searched tool-row   [›]
          └─ [terminal] Ran pnpm test     [›]
```

- The leading Lucide icon reflects the action type: file, folder, search,
  edit, terminal, web, or generic tool.
- The group header owns the elapsed timer and step count. It stays in the
  transcript after completion and remains collapsed unless explicitly opened.
- The visible label is a natural-language action (`Read`, `Ran`, `Searched`),
  not the raw function name. Running actions use the progressive form.
- The primary argument is a clamped single-line monospace hint.
- The disclosure chevron is quiet until hover/focus or expansion.

### 9.3 Layout

- Outer row: transparent, borderless, shadowless, approximately 24px high
- Icon: 15–16px; disclosure chevron: 12px
- Header gap: 4px; expanded body inset: 24px
- Input/output: `font-mono text-sm`, independently copyable, capped at 220px
  with internal scrolling
- Only expanded content receives an inset surface and subtle border

### 9.4 States

| State | Header treatment | Expanded content |
|---|---|---|
| Running | Progressive action + shimmer + spinner | Latest partial output |
| Success | Past-tense action; no green success badge | Final output, then raw input |
| Error | Past-tense action + compact danger status; auto-expanded | Error output, then raw input |
| Denied | Muted `Denied` status | Permission result when available |

### 9.5 Interactions

- Click the row: expand/collapse output and input; successful rows default
  collapsed and failed rows open automatically.
- Click the processing header: expand/collapse the ordered activity list.
  Processing groups default collapsed, including while the turn is active.
- Failed groups use an explicit `Failed after {elapsed}` header. Expansion uses
  a short height/opacity transition and keeps collapsed content inert.
- Running updates replace the latest partial output in place.
- Output is presented before raw input so the primary result has higher
  information priority.
- Input and output each expose a compact copy action.
- Host truncation markers remain visible and cannot be bypassed by expansion.

### 9.6 Accessibility

- `role="region"` with `aria-label="Tool call: {toolName}"`
- Status announced through localized `aria-label` text
- Expand/collapse: `aria-expanded` + `aria-controls`
- Keyboard focus uses the standard inset focus ring

### 9.7 MVP constraints

- No inline diff rendering for Edit/Write results
- No file path click-to-open (deferred)
- No cross-row activity grouping until turn boundaries are available to the
  transcript component

---

## 10. PermissionCard

### 10.1 Purpose

Inline transcript card requesting user approval for a high-risk tool call. See
[03-permission-ux.md](03-permission-ux.md) for full policy.

### 10.2 Anatomy (inline card)

```text
+----------------------------------------------+
| ⚠ Permission Required                        |
| Tool: Write · Risk: high                     |
| Reason: Agent wants to modify a file         |
| ───────────────────────────                  |
| Args preview (redacted)                      |
| Workspace: /Users/dev/project                |
| ───────────────────────────                  |
| [Allow once] [Allow for session] [Deny]      |
| Timeout: 120s countdown                       |
+----------------------------------------------+
```

### 10.3 Session scope

- The card renders after the originating session's latest activity group.
- Only the active session's pending request is mounted. Background requests
  stay in session-keyed renderer state without inserting content into the
  visible transcript or covering another destination.
- Different sessions may each hold one pending request. Resolution, timeout,
  abort, tool completion, and session deletion clear only the matching
  request.
- Countdown uses the request's absolute receipt time and does not restart when
  the user switches away and back.

### 10.4 States

| State | Appearance | Actions |
|---|---|---|
| Pending | warning accent, countdown visible | Allow once / Allow session / Deny buttons active |
| Resolving | pending appearance retained | All three buttons disabled until the request settles |
| Allowed once | success border, "Allowed (once)" label | No actions |
| Allowed session | success border, "Allowed (session)" label | No actions |
| Denied | error border, "Denied" label | No actions |
| Timeout denied | warning border, "Denied (timeout)" label | No actions |

### 10.5 Interactions

- Buttons: primary (Allow once), secondary (Allow session), danger (Deny)
- Countdown: visible timer decrementing from 120s
- The first action locks all buttons. Resolution errors use an error toast;
  successful or failed completion returns focus to the current composer.
- The originating session's composer cannot send during pending permission,
  while text remains editable (per [03-permission-ux.md](03-permission-ux.md) §7)
- Abort cancels pending permission

### 10.6 Accessibility

- `role="region"` with a localized accessible name; the static title supplies
  the polite live announcement so the per-second timer is not re-announced
- Buttons clearly labeled and reachable in normal transcript tab order; the
  card never traps or forcibly moves focus
- Countdown announced periodically (every 30s) or on request

### 10.7 MVP constraints

- Inline card only; no modal or backdrop fallback
- No "allow always" option (per [03-permission-ux.md](03-permission-ux.md))
- No risk-level customization

---

## 11. Composer

### 11.1 Purpose

Input area at the bottom of MainChat for composing and sending prompts. Supports multi-line, model/mode context display, and abort.

### 11.2 Anatomy

```text
+----------------------------------------------+
| [model: provider/model · mode badge]         |
| ───────────────────────────                  |
| textarea (auto-growing, 1 line → max 7)      |
| placeholder: "Ask PI-Desktop to do anything"      |
| (D094; zh-CN 向 PI-Desktop 下达任意指令; home     |
|  variant "Ask anything" when project open,   |
|  D066)                                       |
| ───────────────────────────                  |
| [⏹ Abort (when running)] [→ Send / Enter]   |
+----------------------------------------------+
```

### 11.3 Layout

- Height: compact one-line shell by default; textarea auto-grows through seven
  visible lines, then the textarea scrolls internally
- Workspace context: no project, Local, or branch rail is rendered or
  reserved above the shell in either home or thread-docked mode (D095)
- Background: one solid semantic composer surface; no internal gradient,
  background image, or decorative wash
- Elevation: 20px radius with a hairline stroke and restrained soft shadow;
  the docked transcript fade is outside the composer shell
- Border: border-default top
- Padding: px-4 py-3 inner textarea
- Font: font-mono text-sm for agent mode; font-sans text-sm for chat mode
- Bottom-anchored: fixed at bottom of MainChat area

### 11.4 States

| State | Appearance | Actions |
|---|---|---|
| Idle (no model) | textarea active, send button disabled + tooltip "Configure a model first" | Agent link remains available in model menu |
| Idle (ready) | textarea active, send button enabled | Send active |
| Running | textarea disabled, abort button visible | Abort active, Send hidden |
| Permission pending | textarea disabled (per [03-permission-ux.md](03-permission-ux.md) §7) | Send disabled, abort visible |
| No workspace | textarea active, warning banner "No project — tools limited" | Send enabled |

### 11.5 Interactions

- Enter: send message (configurable: Shift+Enter for newline)
- Shift+Enter: newline in textarea
- Escape: when textarea focused, clears input or blurs (not abort)
- Abort: stops running turn and cancels pending permission
- Auto-grow: textarea measures wrapped visual lines, starts at one visible
  line, expands through seven lines, then scrolls internally; deleting content
  shrinks it back to one line
- Chat / Agent and provider/model changes update the active session, not the
  app default. They are disabled while a turn runs.
- The model menu lists only enabled, runnable providers with a default model.
- For a reasoning-capable active model, a separate Thinking trigger appears
  immediately to the right of Chat / Agent and before the Agent permission
  control. It shows the current level and opens only the exact model's supported
  levels in a compact single-column list and canonical order; the selected row
  carries a trailing check. The menu width fits its content up to 160px and is
  further constrained by the viewport; longer localized labels truncate. The
  list contains no inherited/default choice. Selecting a concrete level persists
  the complete session config and closes the menu. Non-reasoning models render
  no Thinking trigger.
- Unknown Custom/OpenAI-compatible models can enable an explicit reasoning
  override from the model menu. The provider refreshes, the session selects the
  supported level nearest `medium`, and the toolbar trigger appears; known
  non-reasoning models remain unavailable rather than receiving an override.
- Switching provider preserves an available level, otherwise uses the nearest
  supported level (upward first, then downward); a non-reasoning provider
  persists `off`.

### 11.6 Accessibility

- `role="textbox"` with `aria-label="Message input"`
- Send button: `aria-label="Send message"`
- Abort button: `aria-label="Abort active turn"`
- Disabled send: `aria-disabled="true"` with tooltip explanation
- Thinking levels use radio-menu semantics inside a localized Thinking group;
  the selected level exposes `aria-checked="true"`

### 11.7 MVP constraints

- No file attachment (deferred)
- No image/appshot attachment stubs
- No voice input

### 11.8 Slash commands and @ file references (D123–D125, ADR 0024)

The composer owns an inline autocomplete menu — one component serving two
modes. Focus never leaves the textarea (D125).

Anatomy:

```text
┌──────────────────────────────────────────────┐
│  group label (sticky)                        │
│  ▸ item title      argument-hint   descr.    │  ← kb-active row
│  ▸ item title                      descr.    │
│  …                                           │
│  ↑↓ select · Enter confirm · Esc close       │  ← hint bar (footer)
└──────────────────────────────────────────────┘
[ composer textarea                            ]
```

- Anchored above the input, spanning the full composer width; same elevated
  surface recipe as the model menu (opaque elevated background, dialog
  shadow, subtle hairline, `--radius-lg`); max-height caps with internal
  scroll and `scrollIntoView(nearest)` keyboard follow.
- Slash mode (`/` typed at position 0, cursor inside the first token, no
  whitespace yet): groups in order — prompt templates (name +
  `argument-hint` ghost text + description, project source before
  user-global), app commands (builtin slash aliases), plugin commands.
  Matched characters highlight in accent.
- File mode (`@` token at cursor, boundary-preceded): rows show file name as
  the primary line and relative path as the secondary line; directories get
  a trailing `/` and continue completion on accept; entries come from
  `fs/index` (D124). A truncation footnote appears when the index is capped;
  without a workspace the menu shows an "open a project" empty state.
- Accepting always inserts text (`/name ` / `@path ` / `@dir/`); dispatch
  happens only at send time (D123). Builtin/plugin dispatch bypasses the
  model-ready gate since no prompt is sent.
- Sent template invocations render in the transcript as a monospace command
  chip from the message's `command` field instead of the expanded body.
- States: keyboard-active row uses the shared `kb-active` treatment; empty
  query lists everything (slash) / recently indexed order (file); zero
  matches renders the localized empty row and the menu counts as closed for
  key handling.

---

## 12. ModelSelector

### 12.1 Purpose

Dropdown in Topbar showing current provider/model pair. Allows switching models within the current session.

### 12.2 Anatomy

```text
[provider icon] provider-name / model-name   [▼ dropdown arrow]
```

### 12.3 States

| State | Appearance |
|---|---|
| Configured | shows current provider/model, clickable |
| No provider | "Add provider" muted text + link to settings |
| Running | disabled, shows current model |
| Dropdown open | cached available models grouped by provider; refreshes in background |

### 12.4 Interactions

- Click: opens dropdown with provider/model list
- Cached provider models are available on the first open after restart; a
  background refresh updates the list without clearing it first
- Select: switches model for current session
- Keyboard: up/down arrow in dropdown, Enter to select, Escape to close

### 12.5 Accessibility

- `role="combobox"` with `aria-expanded`
- Current value announced via `aria-label`
- Dropdown items: `role="option"` with `aria-selected`

### 12.6 MVP constraints

- No model favorites/pinning
- No custom model creation from selector (use settings)
- Dropdown shows models from configured providers only

---

## 13. ProjectPicker

### 13.1 Purpose

Control in Topbar showing current workspace. Allows opening or clearing a project folder.

### 13.2 Anatomy

```text
[folder icon] /path/to/project   or   "No project"   [open button]
```

### 13.3 States

| State | Appearance |
|---|---|
| Active project | folder name shown, clickable path |
| No project | "No project" muted text + "Open folder" link |
| Opening | disabled, "Opening..." spinner |

### 13.4 Interactions

- Click path: opens system file dialog to select folder
- "Open folder": same action, explicit button
- "Clear project": command palette `builtin.project.clear`

### 13.5 Accessibility

- Current project: `aria-label="Current project: /path/to/project"`
- "No project": `aria-label="No project open"`
- Open button: `aria-label="Open project folder"`

### 13.6 MVP constraints

- Project selection may activate a retained tab or add a new local project
  tab; the host still exposes one selected workspace
- No project status indicators beyond path display

---

## 14. StatusBar

### 14.1 Purpose

Optional bottom bar showing runtime status indicators. **Deferred from MVP** — mentioned in IA but not implemented in M1–M3.

### 14.2 MVP constraints

- Not implemented in MVP
- Status indicators (running/error/idle) shown in Topbar instead
- Future: separate spec when implemented

---

## 15. Empty states

### 15.1 Purpose

Guidance surfaces when key data is absent. Must always provide an **action link**, not just a message.

### 15.2 States

| Context | Message | Action |
|---|---|---|
| No sessions | "Start your first conversation" | "New Chat" button → focus composer |
| No provider | "No model provider configured" | "Add provider" link → Settings → Agent → Providers |
| No project (Agent mode) | "No project open — local tools unavailable" | "Open folder" button → ProjectPicker |
| No project (Chat mode) | "Open a project for context" (muted warning) | "Open folder" button |
| Session empty (first message) | "Ask PI-Desktop to do anything" placeholder (home variant "Ask anything", D094/D066) | N/A |

### 15.3 Layout

- Chat home empty: single scrollable stack (hero → optional checklist →
  composer) centered in MainChat; the former suggestion-card row is omitted
- Other empty surfaces: text-xl heading + text-sm description + primary action
- Icon (48px Lucide / brand mark) above heading where applicable
- Background: bg-primary (transparent, not a card)

### 15.4 Accessibility

- Action buttons are keyboard-focusable
- `aria-label` on icon providing context description

### 15.5 MVP constraints

- No animated empty-state illustrations
- No product tour overlays (per [05-onboarding.md](05-onboarding.md) §6)

---

## 16. Command palette surface

### 16.1 Purpose

Overlay surface for the command palette (Cmd/Ctrl+Shift+P, per D014). Defined in [04-builtin-commands.md](04-builtin-commands.md).

### 16.2 Anatomy

```text
+----------------------------------------------+
| [search input]                               |
| ───────────────────────────                  |
| Results list (scrollable)                    |
|   Category: Session                          |
|     ▸ New Chat                               |
|     ▸ Delete Current Session                 |
|   Category: Mode                             |
|     ▸ Switch to Chat Mode                    |
|     ▸ Switch to Agent Mode                   |
| ...                                          |
+----------------------------------------------+
```

### 16.3 Layout

- Position: centered overlay, max-width 480px, max-height 360px
- Background: bg-secondary, radius-lg, shadow-lg (light)
- Z-index: `z-command-palette` (60)
- Backdrop: semi-transparent bg-primary (0.5 opacity)

### 16.4 Interactions

- Search: filters commands by title and keywords
- Keyboard: arrow up/down navigate, Enter execute, Escape close
- Click: execute command

### 16.5 Accessibility

- `role="dialog"` with `aria-label="Command palette"`
- Focus trapped within palette while open
- Search input auto-focused on open
- Results: `role="listbox"` with `role="option"` per item

### 16.6 MVP constraints

- No sub-command nesting (flat list)
- No command history/recents
- Plugin commands appear alongside builtin commands

---

## 17. Toast

### 17.1 Purpose

Transient, non-blocking feedback for completed actions and failures that have no inline surface (background events, cross-page confirmations). One global stack — never per-page toast markup.

### 17.2 Anatomy

```text
                        ┌  toast-viewport (fixed top-center, z-toast) ┐
                        │  ┌──────────────────────────────────────┐ │
   newest, at anchor →  │  │ (✓)  Provider saved               ✕  │ │
                        │  ├──────────────────────────────────────┤ │
   oldest, pushed down →│  │ (i)  Message text                 ✕  │ │
                        │  └──────────────────────────────────────┘ │
                        └───────────────────────────────────────────┘
```

- `ToastHost` (in `components/Toast.tsx`) renders the stack; mounted once per shell branch in `App.tsx`
- Each card: 16px variant icon (semantic tint) · message · X dismiss button
- Surface: `bg-elevated-opaque` + 1px `border-subtle` + `shadow-dialog`, radius-md-plus — same floating family as menus; metrics in [07-ui-design-system.md §11.8](07-ui-design-system.md#118-toast)

### 17.3 API

State lives in the app store (`useAppStore`):

```ts
showToast(message: string, options?: {
  variant?: "info" | "success" | "warning" | "error"; // default "info"
  duration?: number; // ms; default 4000 (error 8000); 0 = sticky
});
dismissToast(id: number); // ToastHost internal / tests
```

### 17.4 Usage rules

| Rule | Detail |
|---|---|
| Variant semantics | `success` = a user action completed (saved, created, loaded). `error` = an operation failed (every `catch` path). `warning` = degraded/at-risk state that self-resolves. `info` = neutral notice (context echo, "not available yet"). |
| Errors always toast as `error` | `showToast(e instanceof Error ? e.message : String(e), { variant: "error" })` — never the default variant |
| No caller timers | Auto-dismiss is owned by the toast system; callers must not `setTimeout`-clear |
| i18n | Messages come from the i18n catalog (D073); raw host/provider error strings pass through unchanged |
| Not for blocking flows | A tool decision uses the inline PermissionCard, not a toast |
| Not for inline validation | Field-level errors render next to the field; message-bound provider failures render as assistant error messages in the transcript |
| Host-pushed toasts | Plugin/main-process toasts arrive via `api.onToast` and render as `info` |

### 17.5 Behavior

- Auto-dismiss 4s (error 8s, `duration: 0` sticky); hovering a card pauses its timer, leaving resumes with remaining time
- Stack caps at 4 — oldest drops first; re-raising an identical message+variant restarts the existing toast instead of stacking a twin
- Newest toast enters at the top-center anchor (slide-down 200ms ease-out) pushing older cards down; exit is a 150ms ease-in fade
- Dismiss X always available; every card is an explicit non-drag pointer target
  so hover pause and dismissal remain interactive where the top-center stack
  overlaps frameless titlebar drag chrome
- Reduced motion keeps animations near-zero-duration so removal (bound to
  `animationend`) still fires

### 17.6 Accessibility

- Viewport is `aria-live="polite"`; `success`/`info` cards are `role="status"`, `warning`/`error` are `role="alert"`
- Dismiss button labeled with `toast.dismiss` catalog key
- Icons are `aria-hidden`; the variant is conveyed by the announced role, not color alone

### 17.7 MVP constraints

- No action buttons inside toasts (post-MVP; use the inline error banner for actionable errors)
- No progress/loading toasts — running state belongs to the working indicator
- No toast history surface

---

## 18. SessionImportPanel

### 18.1 Purpose

Scan supported local agent stores, review discovered sessions in manageable
groups, select candidates, and start an explicit import.

### 18.2 Anatomy

```text
[Found N sessions]  [Group by: Source ▾]  [Import selected (N)]
──────────────────────────────────────────────────────────────────
[ ] [›] Claude Code                                      N sessions
[ ] [›] Codex                                            N sessions
```

- The grouping control supports **Project path** and **Source**.
- Source is the default grouping.
- In project-path mode, exact paths remain visible in group headers.
- Sessions without a project path appear in a final **No project** group.
- Each group header includes group selection, disclosure, label, and count.
- Import source names, grouping controls, counts, results, and accessible names
  come from the shared i18n catalog. Candidate dates use the active app locale.

### 18.3 States and interactions

- A successful scan replaces the prior candidate set, clears selection, and
  leaves every group collapsed.
- A successful import creates or reuses one durable Projects-index entry for
  each distinct non-empty project path and refreshes sessions/projects.
- Path-less imports create no project entry and remain under Temporary
  sessions. Import never creates a physical filesystem directory.
- Re-importing an existing source session skips it without duplicating its
  project entry.
- Changing the grouping mode preserves candidate selection but collapses every
  newly formed group.
- Expanding or collapsing one group does not affect the others.
- Group and global checkboxes support checked, unchecked, and indeterminate
  selection states as applicable.
- Candidates inside each group and groups themselves are ordered newest first;
  the path-less group remains last in project-path mode.

### 18.4 Accessibility

- Each disclosure button exposes `aria-expanded` and references its body with
  `aria-controls`.
- Global and group checkboxes have localized accessible names.
- The grouping selector has a visible label and is keyboard-operable.
- Projects-row disclosure and action-menu buttons expose localized,
  project-specific accessible names.

---

## 19. ProviderStudio (Settings → Agent)

### 19.1 Purpose
Modern model-configuration surface for adding OpenAI-compatible providers,
reviewing readiness, and managing connection/default behavior without a dense
form dump. Model parameters remain owned by pi-ai.

### 19.2 Anatomy
1. **Hero summary** — kicker, title, short description, stats for provider count / ready count / default pair
2. **Defaults card** — segmented default mode, default model id, Enter-to-send switch
3. **Providers head** — section title + primary Add provider toggle
4. **Composer** — dialog with connection fields (name, base URL, model id, API style, API key); no reasoning, thinking-level, context, output, temperature, or compatibility controls
5. **Provider cards** — avatar initials, badges (default / secret state), host + model, Test / Make default / Delete

### 19.3 States
| State | Presentation |
|---|---|
| Empty | Hero shows zeros / No default; composer open; empty panel with primary add CTA |
| Populated | Cards list every provider; add flow opens a modal dialog |
| Default provider | Card gets subtle accent wash + default badge; Make default hidden |
| Secret missing | Warning badge "No API key"; test may fail closed |
| Busy row | Test/update/delete actions disabled for that card |

### 19.4 Interactions
- Add provider opens a modal dialog; Cancel/close resets fields and dismisses the dialog
- Save creates the provider, stores the secret, sets it as default when successful, and refreshes the list
- Test connection calls `providers.testConnection` and toasts success/failure
- Thinking preset updates persist through `providers.update` with D102 semantics
- Make default updates `defaultProviderId` / `defaultModelId` only

### 19.5 Accessibility
- Segmented controls expose `aria-pressed`
- Enter-to-send uses `role="switch"` + `aria-checked`
- Card actions keep visible text labels; thinking select has an accessible name
- Empty and hero regions expose localized labels

### 19.6 MVP constraints
- OpenAI-compatible path only in the composer (vendor marketplace deferred)
- No raw secret redisplay after save
- No catalog browser yet; custom model id remains first-class

---

## 20. NotificationInbox (D117)

### 20.1 Purpose

Expose the bounded, host-owned history of task completion and failure events
the user did not already see in the focused current chat, without turning
transient toasts into history. The inbox is local-only and durable across app
restarts.

### 20.2 Anatomy

```text
Sidebar footer                                        Popover (360px max)
[Bell (12)]  ->  [Notifications]       [All | Unread] [Mark all read] [Clear]
                 ------------------------------------------------------------
                 [unread dot] [check] Task completed              2m
                                      Session title
                 ------------------------------------------------------------
                              [x]     Task failed                  9m
                                      Session title · ERROR_CODE
```

- Trigger: 32px Lucide `Bell` icon button at the right of the expanded sidebar
  footer, replacing the former Help shortcut. The main titlebar has no
  duplicate. A compact badge renders `1`–`99` and `99+`; its accessible label
  retains the exact count (the durable store is capped at 200).
- Popover: width `min(360px, calc(100vw - 24px))`, opens above and to the right
  of the footer, and is no taller than the available window, with one internally
  scrollable row list.
- Header: localized title, `All` / `Unread` segmented filter, Lucide
  `CheckCheck` mark-all-read button, and Lucide `Trash2` clear button. Icon-only
  actions carry localized tooltips and accessible names.
- Row: unread dot, semantic completion/failure icon, localized event label,
  snapshotted session title, optional stable failure code, and localized
  relative time. Rows are dense list items separated by hairlines, not cards.
- Display title/body are derived at render time from `kind`, `sessionTitle`,
  and optional `errorCode`; no localized title/body string is persisted.

### 20.3 States

| State | Behavior |
|---|---|
| No unread | Bell has no badge; Mark all read is disabled |
| Unread | Badge shows count; unread rows carry dot and stronger label weight |
| All empty | Centered compact “No notifications” empty state; list actions disabled |
| Unread empty | “You're all caught up”; All filter remains available |
| Loading/refresh | Preserve current rows and filter; disable mutations until refresh settles |
| Mutation failure | Keep the existing list and announce an error toast; do not optimistically lose rows |

### 20.4 Interactions

- Bell toggles the popover. Opening does not implicitly mark anything read.
- `All` shows the newest retained rows; `Unread` filters to `readAt == null`.
- Selecting a row first calls `notification.markRead`, closes the popover, then
  activates the row's durable session (including its project when applicable)
  and scrolls the transcript to its latest content.
- Mark all read is idempotent and preserves rows. Clear deletes every inbox
  row but never deletes a session, transcript, or turn.
- `notification.changed` updates the visible list and badge. Opening the
  popover also refreshes the bounded list from host-core. A
  `notification.activated` event from Electron follows the same session
  activation path as a row click.
- Completion/failure enters the durable inbox unless the main window is
  visible/focused and the exact finishing session is the current chat. A
  focused background session still enters the inbox without a native banner;
  an unfocused current session enters the inbox and receives a native banner.
  Clicking the banner restores/shows and focuses the main window before
  emitting `notification.activated` for the matching session.
- Aborted turns, permission requests, scheduled reminders, and plugin
  notifications do not enter this inbox.

### 20.5 Accessibility

- Popover is a labelled, non-modal `role="dialog"`; the row collection is a
  semantic list and every row is one button with a complete localized name.
- Opening focuses the first unread row, otherwise the first row, otherwise the
  `All` filter. `ArrowUp` / `ArrowDown`, `Home`, and `End` move among rows;
  `Enter` / `Space` activate the focused row.
- `Tab` follows DOM order through filters, header actions, and rows without a
  focus trap. `Escape` or outside press closes the popover; Escape restores
  focus to the bell.
- Badge changes are announced through one polite status region using the exact
  unread count. Completion/failure meaning uses icon, text, and accessible
  name, never color alone.
- Native notification accessibility and activation semantics use the platform
  API; the renderer does not recreate native banners.

### 20.6 Constraints

- The list contains only `task.completed` and `task.failed` records produced
  from unseen terminal agent turns. Visible-current results and `aborted` turns
  are intentionally silent.
- At most 200 newest rows are retained globally. There is no pagination,
  scheduled notification source, permission-notification source, preferences
  page, notification permission prompt, or cloud sync.

---

## 21. Acceptance criteria (all components)

1. All components use semantic color tokens from [07-ui-design-system.md](07-ui-design-system.md) — no raw hex
2. All interactive elements have visible focus rings (2px accent, offset 2px)
3. Layout shell metrics (46px titlebar row, ~275/48 sidebar, 280 context,
   compact composer with 1–7-line draft growth) match spec
4. Chat messages constrained to 720px max width
5. ToolCallCard shows status, args preview, result preview, duration per [01-ui-ia.md](01-ui-ia.md) §5
6. PermissionCard shows tool name, risk, args, countdown, and three action buttons per [03-permission-ux.md](03-permission-ux.md)
7. Composer: Enter sends, Shift+Enter newline, draft grows from one through
   seven visible lines then scrolls, disabled during running/pending, abort
   button visible during run
8. ModelSelector shows provider/model pair; disabled during stream; links to settings when unconfigured
9. Command palette opens at z-index 60, traps focus, supports keyboard navigation
10. Empty states always provide an actionable next step, not just a message
11. All components have correct ARIA roles and labels
12. Responsive collapse works at 800px and 640px breakpoints
13. Toasts stack top-center with variant icon + dismiss, auto-dismiss 4s/8s, pause on hover, and announce via `role="status"`/`role="alert"` per §17
14. Session import defaults to source grouping, offers project-path grouping, collapses all groups after scan/group changes, and exposes accessible group disclosure state per §18
15. Imported project paths materialize exactly once in the durable Projects index; path-less imports remain Temporary sessions and no filesystem directory is created
16. ProviderStudio shows hero summary + add dialog + provider cards; secrets never render raw; test/default/delete remain keyboard reachable
17. NotificationInbox exposes All/Unread views, exact unread badge semantics,
    row activation, mark-all-read and clear actions; it is keyboard-operable
    and never treats a visible-current or aborted turn as a notification
