# 08. Component Spec

> Layout and IA reference: [01-ui-ia.md](01-ui-ia.md)  
> Design tokens and foundations: [07-ui-design-system.md](07-ui-design-system.md)  
> Interaction behavior: [09-interaction-patterns.md](09-interaction-patterns.md)


> Shell layout is Codex-aligned: left thread sidebar (~275px), main transcript, floating bottom composer with runtime mode/permission controls and a topbar model picker. Prefer neutral charcoal surfaces over blue-slate chrome.
>
> **Precedence rule**: where a metric or copy string below disagrees with a
> Codex parity decision in [decisions-log §D](../08-meta/decisions-log.md)
> (D034+), the decision log wins — it tracks the live gold captures. Known
> updated values: sidebar ~275px (not 240px), toolbar 46px (not 44px),
> composer placeholder per D094/D066, home empty stack and bottom composer per
> D111/D204/D206,
> Projects index table per D066/D133, settings full-page shell per D063 with the
> compact seven-destination directory from D090/D133/D166, and retained path-keyed
> project groups per D093 (which preserves D088's Temporary/exact-path boundary
> while restoring scoped project and conversation organization actions), and
> product branding/icon contract per D094/D160.

## 1. AppShell

### 1.1 Purpose

Outer frame that positions Topbar, Sidebar, MainChat, and WorkPanel. Owns resize logic, responsive collapse, and theme class.

### 1.2 Anatomy

```text
+------------------+------------------------------+------------------+
| Sidebar          | MainChat                     | WorkPanel        |
| (275px / 48px)   | (flex-1)                     | (244–720px /     |
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
| Constrained work area with panel open | Work panel keeps its fixed committed width; MainChat absorbs any reservation shortfall |
| Fullscreen | Topbar remains; sidebar toggle and artifact-driven panel stay available |

### 1.4 Interactions

- Sidebar toggle: keyboard shortcut + icon button beside Search in the expanded
  sidebar header; the button moves to the main titlebar while collapsed. The
  collapse and expand use a mounted-then-animated dock transition (entrance
  `sidebar-in`, exit `sidebar-out` keyframes) that mirrors the work-panel dock:
  the aside stays in the tree through the exit keyframe, then unmounts
  (`is-exiting` flag + `animationend` guard, with a timeout fallback)
- Work panel collapse: sole control lives in the session pane titlebar top-right
  while the panel is open, with its outer edge flush against the divider
  between the session pane and work panel so the work-panel content header is
  not occupied. On
  Windows/Linux, opening the work panel removes the main titlebar's native
  window-control clearance because those controls occupy the work-panel header
  at the outer window edge.
- Work panel resize: left-edge drag handle (§5.4)
- Window resize: native edges change MainChat width only while an open work
  panel keeps its committed width; responsive layout follows
  [07-ui-design-system.md](07-ui-design-system.md) §10.1

### 1.5 Accessibility

- Landmark roles: `<nav>` for sidebar, `<main>` for chat, `<aside>` for work panel, `<header>` for topbar
- Tab sequence: topbar → sidebar → main chat → work panel → composer

### 1.6 MVP constraints

- Sidebar width is fixed; the work panel is the only adjustable auxiliary
  column and is resized only from its own divider
- The main pane renders one active transcript and one selected workspace while
  the sidebar may retain several project tabs/groups
- Sidebar and work-panel dock transitions animate their flex allocation as well
  as opacity/transform feedback, so MainChat reflows over the motion duration
  rather than jumping before the first painted frame.
- `AppShell` owns low-frequency shell/navigation state only. Streamed
  `messages`, active-turn rendering, inline chat errors, and active permission
  projection are subscribed inside a memoized `ChatSurface`, so a token update
  cannot rerender Sidebar, WorkPanel, window chrome, global dialogs, or toasts.
- Session selection exposes the destination row immediately, coalesces hover/
  focus prefetches, and keeps at most five recently visited transcripts in
  renderer memory. Transcript IO and required workspace alignment may run in
  parallel; navigation generations ensure that only the newest selection can
  project session, workspace, messages, and work-panel context.
- While a destination transcript is resolving or React is preparing its heavy
  Markdown tree, `ChatSurface` retains the previous complete transcript as a
  non-interactive stable frame, exposes `aria-busy`, and shows a 2px progress
  track. The destination transcript replaces it atomically at the bottom; a
  stale transcript is never relabeled with the destination session id.
- Settings, Plugins, Pull requests, and Scheduled are route-level lazy modules.
  Chat and shell chrome stay in the initial renderer bundle; first entry to a
  secondary destination shows a compact localized status indicator until its
  local chunk resolves.
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
- When Settings -> Info -> Developer mode is enabled, the macOS View menu
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

Global controls bar: task title, model selection, and window actions. Project
scope remains available in the title tooltip. The active session's Agent/Plan
control belongs solely to the
left-of-input Composer chip. (Settings is reached from the command palette /
application menu, not the top bar.)

### 2.2 Anatomy

```text
[☰ Sidebar] [Task title] [●]   [🤖 Model] [＋ New] [🔍 Search]
```

(Icons described functionally; actual render uses Lucide SVGs. The `[☰ Sidebar]`
toggle renders **only when the sidebar is collapsed**; when the sidebar is
expanded it owns that control, so the top bar does not duplicate it.)

The conversation top bar renders for the chat route only; Pull requests, Scheduled,
Plugins, and Settings keep the frameless drag band. It owns the task title, the
downward-opening model picker, and window actions only. Project scope remains in
the title tooltip instead of adding another visible label. The left-of-input
Composer chip is the sole Agent/Plan control and writes the session `mode`; the
Thinking and permission triggers remain in the Composer (§11).

### 2.3 Layout

- Height: 46px (Codex toolbar rhythm, D034; supersedes the old 44px)
- Background: bg-primary
- Border: border-subtle bottom
- Position: absolute 46px frameless band; `-webkit-app-region: drag` with
  `no-drag` on interactive controls; macOS reserves the left ~76px for traffic
  lights (only when the sidebar is collapsed), Windows/Linux reserve the right
  112px for native window controls
- Title cluster (task title) flexes and shows at most the first 10 Unicode
  characters plus an ellipsis; the full title remains in the native tooltip.
  The right cluster (model picker, action icons) is `flex: 0 0 auto`
  and is never squeezed by a long title. The conversation surface keeps a
  `min-width` so its content is not crushed on narrow windows.
- Project scope is available from the title tooltip but is not rendered as a
  second visible label.
- macOS fullscreen resets the left reserve to 8px (mirrors the sidebar header).
- Sticky: `z-sticky`
- Items: left-aligned controls, right-aligned actions

### 2.4 States

| Element | Default | Running | Error | No workspace |
|---|---|---|---|---|
| Task title | session title (or untitled), capped at 10 characters with an ellipsis when needed | same, plus a compact pulsing status dot | same | same |
| Model selector | clickable dropdown | disabled during stream | clickable | clickable (no provider warning) |
| New task / Search | icon buttons | same | same | same |
| Abort button | hidden | visible, accent-hover pulse | hidden | hidden |
| Project name | title tooltip only | same | same | omitted |

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
The sidebar body is reserved for Sessions and Projects; the footer exposes the
Plugins destination beside Settings. Projects is managed through Settings →
Project archive, while Pull requests and Scheduled are not rendered in the
sidebar.

Section-level create and sort controls stay visually quiet at rest and reveal
when the owning Sessions or Projects toolbar is hovered or keyboard-focused.
Project-group `+` and overflow controls follow the same hover/focus treatment;
their hit areas remain in the layout so revealing them does not shift labels.

### 3.2 Anatomy

```text
Expanded (~275px, D034/D070):
+---------------------------+
| [lights]          [⌕][◧] |  macOS
| [π] PI-Desktop    [⌕][◧] |  Windows/Linux
| SESSIONS         [msg+][↕]|
|   • Path-less session   ↕|
| PROJECTS            [dir+]|
| [v] project-A      [+] … |
|   • Project session      |
| project-B      [>] [+] … |
|                           |
| [version]       [⚙][@][☾][bell]|
+---------------------------+

Collapsed (48px):
+----+
| ──  |
| ses |
| ses |
| ──  |
| [⚙][@][☾][bell] |
+----+
```

### 3.3 Typography

Primary left-rail chrome stays body-sized so destinations remain readable next
to the 14px chat body. Session and project/group titles use the adjacent compact
tier; weight, indentation, and disclosure icons preserve their hierarchy:

| Surface | Token | Notes |
|---|---|---|
| Footer action icons | `--text-base` (14px) | Settings, Extensions, theme, notifications |
| Session / thread titles | `--text-md` (13px) | Compact list content |
| Project / group titles, empty copy | `--text-md` (13px) | Hierarchy comes from weight and indentation |
| Section labels (`SESSIONS`, `PROJECTS`) | `--text-sm` (12px) | Uppercase secondary labels |
| Footer profile name + profile menu items | `--text-base` (14px) | Identity cluster matches nav body |
| Footer status / profile menu secondary | `--text-sm` (12px) | Secondary line only |

Do not render primary sidebar list content below `--text-md`. Keep row heights
(≈28–32px) so density stays WorkBuddy/Codex-like while primary actions remain
visually distinct from list content.

### 3.4 States

| State | Behavior |
|---|---|
| Expanded | Full session titles visible |
| Collapsed | Icon rail — hover shows tooltip with session title |
| Active session | Accent-blue outlined status ring plus active row background |
| Selecting session | Destination row receives the active treatment immediately while transcript/workspace resolution continues |
| Session in progress | Orange breathing dot; static under reduced motion |
| Session completed | Green check mark when the row is not selected |
| Session failed | Red circled alert mark when the row is not selected |
| Hover session | bg-tertiary background |
| Active project | Header carries active state; topbar follows that workspace; composer exposes no workspace identity |
| Collapsed project | Header remains visible; child conversations are hidden |
| Archived row | Hidden by default; visible in the explicit archived view |
| No retained project | Compact Open project entry; standalone Sessions rows remain available |
| Empty group | Muted one-line empty state; group create action remains available |
| Footer idle | Transparent 58px band; build and action controls remain visually quiet |
| Footer hover/focus | Only the targeted control receives the semantic hover/focus treatment |
| Profile menu open | Profile trigger is active; 280px menu opens 8px above the footer |

### 3.5 Interactions

- Click the project directory row (chevron, folder, label, or remaining
  disclosure hit area): activate its path when necessary, then toggle only
  that project's conversation group; retain the other project groups
- Click session: activate its bound project when necessary, switch the active
  session, and show the last message on the first painted frame. Session
  activation resets any manual-scroll state inherited from the previous
  transcript and must not flash the new transcript's top or an old scroll
  position before settling at the bottom.
- Hovering a session row for 120ms or keyboard-focusing it starts one coalesced
  transcript prefetch. Selection reuses an in-flight or recent cached result,
  revalidates it in the background, and never waits for an older superseded
  session read before starting the latest read.
- On Windows/Linux, click the PI-Desktop brand to return the main pane to the
  chat home while preserving the active conversation and workspace; macOS
  intentionally omits this brand control from the sidebar header
- Click the footer Plugins icon immediately right of Settings to open the
  Extensions destination; the icon exposes the localized label on hover/focus
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
- Sessions and Projects heading actions reveal together when their toolbar is
  hovered or keyboard-focused; the controls remain keyboard-reachable while
  visually hidden at rest
- Right-click the `Sessions` heading or empty standalone-list chrome: open a
  single-item create menu that creates/reuses a path-less temporary session
- Project overflow: switch, open folder, pin/unpin, archive/restore, close
  retained tab. Open folder reveals the project directory in the system file
  manager for the selected project row.
- Conversation overflow: pin/unpin, archive/restore, Create branch, delete.
  Create branch is disabled while that conversation is running; success
  activates the independent child session and focuses the composer.
- The `Sessions` toolbar places the sort button before the message-plus New Chat
  control. The sort menu and every other body-level sidebar menu remain
  content-sized and open 4px to the right of their trigger or pointer. Their
  left edge never flips to the trigger's left side; the surface has a viewport
  width cap for narrow windows. The sort choices remain Recently updated,
  Created date, Oldest first, and Name; pinned rows stay ahead of unpinned rows.
  A stored `manual` compatibility value requires no drag-reorder UI.
- Project groups use compact vertical spacing so adjacent directories and
  conversation rows read as one dense navigation list rather than detached
  cards. Directory `+` and overflow actions remain hidden until hover or
  keyboard focus, without changing the directory label's position.
- Sidebar toggle: expanded-header icon beside Search + keyboard shortcut; the
  collapsed main titlebar retains an Expand sidebar icon; when the work panel is
  open, the session-pane top-right hosts the sole panel collapse control
- Click the local profile trigger: open or close the identity menu containing
  Settings, Logs, and Theme
- Click the footer bell: open or close the durable notification inbox

### 3.6 Accessibility

- Projects and Sessions headings have localized names; each disclosure and
  create action has a scope-specific accessible name
- Under `lang=zh-CN`, section labels keep normal tracking and skip
  `text-transform: uppercase` so two-glyph labels are not letter-spaced apart
- Session groups use semantic `section` containers
- Active session: `aria-current="true"`
- Every visible session indicator has a localized accessible name and tooltip;
  color is reinforced by ring, dot, check, or alert geometry
- Project directory rows expose `aria-expanded` and `aria-controls`; menu
  check/radio items expose `aria-checked`
- Hover-hidden section and project actions remain in the tab order and reveal
  through `:focus-within`; keyboard focus never depends on pointer hover
- Collapsed state: each icon has `aria-label` with session title
- Keyboard: arrow keys navigate session list
- Footer Settings, Plugins, Theme, and notification controls expose localized
  accessible names and visible focus treatment
- The profile trigger exposes `aria-haspopup="menu"` and its expanded state;
  the menu has a stable accessible relationship to the trigger
- The notification trigger has a localized accessible name containing the
  unread count, exposes `aria-expanded`/`aria-controls`, and never relies on
  the badge color alone
- Profile and notification popovers portal to `document.body` with fixed
  positioning so the main chat pane cannot paint over them; work-panel tool
  context menus use the same body-level floating layer


### 3.7 Brand and icon contract

- The visible shell name is `PI-Desktop`; Codex is not used as the renderer
  identity.
- `BrandLogo` imports canonical `build/icon_1024.png` through Vite for light
  mode, and `build/logo_dark.png` for dark mode. The component subscribes to
  `document.documentElement[data-theme]` via a `MutationObserver` and swaps the
  source at runtime for the sidebar and startup splash without a reload. The
  empty-home hero uses `HomeMascotLogo` at 100px: its transparent sprite is
  compiled from the remaining supplied `docs/ip` frame sheets into nine static-
  pose groups (50 frames total). Each mount randomly selects one group and
  plays only that group; reduced motion holds its first frame. The
  expanded/collapsed sidebar remains 20px/18px and the startup splash 64px.
  Home and thread-docked composer prompt rows do not render a leading brand
  icon.
- Project and Temporary session creation controls render the dedicated
  message-plus session icon. Generic
  `IconPlus` remains reserved for adding non-session entities.
- Icons are decorative when a localized text label or accessible name is
  present; click, keyboard, and focus behavior remain unchanged.
- The expanded sidebar brand is a localized button with a 20px logo and the
  shell name on Windows/Linux; pointer or keyboard activation navigates to the
  chat home. macOS hides this brand and right-aligns Search then Collapse
  sidebar in the same 46px row as the native traffic lights. Fullscreen keeps
  the brand hidden while reclaiming the native-chrome padding.

### 3.8 MVP constraints

- Expanded sidebar search filters the visible session tree in place; the
  collapsed rail continues to use the global command palette
- No drag-to-reorder contract; `manual` is a persisted compatibility value
- Project tabs do not create another host workspace or a second main pane

### 3.9 Project group contract

Each retained project is one labeled `section` keyed by normalized full path.
The header owns project-level controls; the child list owns conversation-level
controls.

| Element | Contract |
|---|---|
| Group root | localized project name; hover and keyboard focus expose the full path in a portaled tooltip plus an accessible description without changing row geometry |
| Directory disclosure | single full-row target with `aria-expanded` / `aria-controls`; may activate an inactive project before toggling, but never archives |
| Project pin | presentation priority only; no host row deletion/move |
| Project archive | omitted from default view; restorable from archived view |
| Project close | removes retained tab only; durable project/sessions remain |
| Session list | exact-path matches only; no basename grouping |
| Active group | exactly one group reflects the selected host workspace |
| Task state | In-progress, selected, completed, and failed indicators update by session without replacing the visible transcript; precedence is in-progress, selected, then terminal outcome |

### 3.10 Local profile footer contract

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
|   TurnOutcomeCard                    |
|   InlineReviewCard · modified App.tsx +8 −2 |
|   PermissionCard                     |
|   ...                                |
+--------------------------------------+
| Composer (docked in thread view;     |
| bottom-reserved on empty home, D204) |
+--------------------------------------+
```

### 4.3 Layout

- Background: bg-primary
- Max content width: 720px (messages), centered
- Scroll behavior: auto-scroll to bottom on new message while pinned; the first
  upward manual movement pauses auto-scroll without a snap-back; send / retry /
  regenerate re-pins and jumps to bottom
- Destination entry uses one short opacity/translate transition. Streaming
  updates occur inside the mounted surface and never replay this transition.
- The transcript's bottom reserve is **height-aware**, not a fixed gap. The
  docked composer measures its real rendered height (it grows with multi-line
  drafts) and publishes it as the `--composer-dock-height` custom property on
  `:root`; `.thread-content` reserves `calc(var(--composer-dock-height) + 16px)`
  so the last message sits ~16px above the box and is never overlapped even as
  the draft grows. `.jump-latest-btn` and `.minimap-rail` anchor to the same
  variable so they stay just above the composer.

### 4.4 States

| State | Behavior |
|---|---|
| Empty | Restrained hero + optional onboarding checklist in a scrollable content region, with a bottom-reserved home composer and no starter-card or contextual quick-action layer (D111/D204/D206) |
| Streaming | Auto-scroll follows while pinned; new tokens append |
| Active progress | Immediately after send, before the first assistant or tool event, a compact localized `Working…` status with elapsed time appears inline. It yields to concrete thinking, tool, and answer rows, while a permission card owns the approval state; no large generic progress card is rendered. |
| Turn outcome | After a failed turn, a session-scoped recovery card summarizes the interruption and tool evidence. Completed turns use the existing transcript and message-scoped InlineReviewCard without an extra success card; failed turns can retry without losing the transcript. |
| Turn start (send / retry / regenerate) | Re-pins and jumps to bottom even if the user had scrolled up |
| Idle (after stream) | Auto-scroll unlocked; user can scroll freely |
| Message-scoped review snapshot | Each successful workspace Write/Edit tool row is followed by one compact InlineReviewCard carrying that message's added/modified/deleted status and explicit addition/deletion totals. Its hunks sit behind an expandable disclosure: every review card (inline and in the Review tab) is collapsed by default, and the user expands it on demand. The card remains after a Git commit, never becomes a bottom/global entry, and offers hash-guarded rollback without leaking into another session's transcript. |

### 4.5 Accessibility

- `role="log"` for transcript container
- `aria-live="polite"` on transcript for new message announcements
- Scroll-to-bottom button appears when user scrolls up during stream
- InlineReviewCard uses a native button with `aria-expanded` and
  `aria-controls`. Its localized accessible name includes the path, status,
  addition count, and deletion count; the visible text and color are not the
  only status signal.
- Empty-home task entry starts in the always-visible bottom composer. There is
  no starter-card or contextual quick-action layer between the hero and
  composer.
- The failed-turn recovery card is a labelled `role="status"` region with
  explicit text actions. It uses icon geometry plus text, never color alone;
  Retry preserves the existing prompt and Continue returns focus to the
  composer. Completed turns do not render this card.

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
+---------------------------------------+
| ◫ App.tsx ⌄        drag      | [×][>] |  header, 46px
+---------------------------------------+
| Tools                       ¦ menu    |
|  ▌◫ Review               [×]¦         |
|   > Terminal            •   ¦         |
|   ◎ Browser                 ¦         |
|   ▤ Files                   ¦         |
|  ------------------------   ¦         |
| Open items                  ¦         |
|   ▤ App.tsx              [×]¦         |
+---------------------------------------+
| Active resource body                  |
|  Review: recorded changes + diff      |
|  Terminal: xterm host                 |
|  Browser: URL bar + preview           |
|  Files: tree + file viewer            |
+---------------------------------------+
 ▌ active row edge marker   • open, inactive
^ 10px transparent resize hit area on the left edge
```

### 5.2.1 Light-theme surface

- Panel body uses quiet inset paper (`#fafafa`); the 46px header band and tool
  chrome (review toolbar, browser chrome, file viewer header) stay white
- The header exposes one unified context trigger. Its menu lists the four tools
  (Review, Terminal, Browser, Files) in a fixed order first — each row showing
  its own open state and, once open, its own close control — and, after a
  divider, only the further resources the transcript opened. No entry appears
  twice. Rows use a neutral fill with a straight 2px left edge marker for the
  active row, never color alone; the trailing close slot is always reserved so
  labels and open dots never shift between rows. The menu fades in over ≤4px with
  `--motion-duration-fast` / `--motion-ease-out` and is static under
  `prefers-reduced-motion` (D173)
- The 46px header follows a "context left, actions right" model: the unified
  context trigger anchors the left and shows the active tool icon and ellipsized
  label; a right action cluster is pinned to the right edge behind a thin
  divider, so the close / collapse controls never shift with the label length.
  The gap between the two remains a window-drag region. The collapse control
  uses a right chevron so it reads as "push the panel away", not "open a panel"
- Active tabs, file-tree rows, diff headers, and the resize handle ease hover
  fills with `--motion-duration-fast` / `--motion-ease-out`
- Browser URL and empty-tool chrome share the light inset field treatment used
  by Settings controls (D148)

### 5.3 States

| State | Behavior |
|---|---|
| Closed (default) | Not rendered; startup has no retained tabs. `Cmd/Ctrl + J` reveals the active session's panel context without creating a tab. Inline review cards remain available in the transcript because they are message-scoped and do not require the work panel. |
| Open | Docked flex row right of the main pane; opened by an artifact or `Cmd/Ctrl + J` at a fixed committed width of 244–720px (default 280px). Its flex allocation eases from zero to the committed width so MainChat reflows continuously. It occupies client-area space and never expands the OS window (ADR 0033). |
| Multiple artifacts | The current-resource header keeps one readable label at the panel minimum; its bounded menu lists the tools first and then the transcript-opened resources in first-open order, with full-path tooltips and independent close controls |
| Session switch | The destination session's retained open state, tabs, active tab, and Browser resource replace the previous session's panel context atomically; neither context is deleted |
| Resizing | The left divider follows anchored pointer delta or keyboard input. Pointer changes preview once per animation frame and commit width plus reservation only on release; Escape, pointer cancellation, or lost capture restores both. Native window-edge resize changes MainChat only. |
| No workspace | Each tab renders its own "open a project" empty state |
| Constrained work area | The panel stays at its committed width; MainChat reflows to absorb it and may fall below its 360px target on small windows (ADR 0033) |

### 5.4 Interactions

- Trigger: file/URL references, BrowserPreview, and completed-command artifacts
  create/activate their resource tab in the originating session's runtime
  context. BrowserPreview events carry `sessionId`, and the renderer retains
  that session's preview path/URL as its Browser resource. Successful workspace
  Write/Edit artifacts create/activate Review in the originating session.
  `Cmd/Ctrl + J` reveals the active session's retained panel context without
  creating a resource; with no active session it does nothing. The shortcut is
  ignored while Settings is the active page.
  Background artifacts may update that retained context but never reveal it,
  resize the window, or change visible selection/focus. The transcript does
  not create a global Review changes launcher: each successful workspace
  Write/Edit row owns only its adjacent InlineReviewCard, and another session
  cannot render that card in its transcript. Repeated resources deduplicate
  within the originating session.
- Review truth: host-core adds one bounded `details.review` record to each
  successful workspace Write/Edit result. The renderer reads that record from
  the owning transcript message, so status, counts, and hunks describe exactly
  what that row changed and remain available after a commit, restart, or
  workspace switch. The Review tab is the same session's chronological change
  history, not a current-worktree scan; it reuses the same message-owned cards,
  each collapsed by default until the user expands it. Its rollback action
  calls the host; the host compares the current content with the recorded
  post-tool hash and
  returns a conflict without overwriting later work.
- Unified context menu: while the panel is visible, one context trigger in the
  header opens a single dropdown. Its top section lists the open resources in
  first-open order (rows select a resource and retain per-resource close
  controls); a divider separates it from the create-new section listing Review,
  Terminal, Browser, and Files as stable items. Activating a closed tool creates
  it through `openWorkPanelTab`; activating an open tool selects its singleton
  tab. The active tool combines a neutral fill with a 2px edge marker, and open
  inactive tools show a small status dot. The trigger disappears with the panel
  and remains available after `Cmd/Ctrl + J` reveals the panel. Artifact
  triggers still create and activate resources atomically; the shortcut only
  reveals the existing context.
- Resource header: the 46px header shows the active resource icon and
  ellipsized label. Its context chevron opens the bounded unified menu described
  above; the header's trailing close button closes the current resource
  directly. Arrow keys, Home, End, and Escape operate the menu; opening the menu
  hides the native Browser preview until it closes.
- Tab close: closing an active tab selects its right neighbor, then its left;
  closing the last tab hides the panel. The panel-level collapse control lives
  in the session pane top-right (not the work-panel content header) and hides the
  panel without deleting the runtime tab set; a later artifact reopens it.
  Terminal mounts only after its first command artifact and stays mounted while
  its tab exists so the PTY and scrollback survive switches.
- Context change: selecting another session atomically projects that session's
  retained `{open, tabs, activeTabId, browserResource}` state. The previous
  session's context remains in renderer memory and is restored when selected
  again. A workspace selection with no active conversation hides the panel.
  Every context remains bound to its originating session/workspace, so relative
  file and Browser resources are never reinterpreted against another workspace.
- Resize: pointer drag on the left-edge handle; `ArrowLeft` / `ArrowRight`
  adjust it in 16px steps (`Shift` uses 32px), `Home` / `End` reach the current
  fixed 244px / 720px limits, and double-click restores the default width.
  Pointer math is anchored to the press position and starting committed width,
  so grabbing the handle cannot jump the divider. Move events are
  frame-coalesced; release
  commits once, while Escape, pointer cancellation, and lost capture cancel.
  The 10px hit area keeps a global column-resize cursor and suppresses text
  selection during the gesture. The live preview changes renderer columns only;
  a successful commit updates the committed preferred width. Native window edges
  resize MainChat by reflow only, never the panel or its preference (ADR 0033).
- Persistence: all session contexts are renderer runtime state only. On app
  startup, open state, tabs, active-tab selection, file requests, and Browser
  resources reset; only the committed preferred `{width}` remains in
  localStorage `pi.desktop.workPanel`. The renderer always requests a native
  reservation width of 0, so the OS window never expands (ADR 0033). Collapse
  and final-tab close and a divider commit update only the committed preferred
  width. Target updates are idempotent. The panel reflows MainChat inside the
  fixed window; on constrained work areas chat may fall below its 360px target.
  Maximized/fullscreen geometry is unaffected. Background session artifacts
  never update the visible panel. The renderer changes panel presentation only
  after the latest (zero-width) reservation request succeeds; a rejected or
  superseded request keeps the last confirmed presentation state
  (D163, ADR 0032).

### 5.5 Accessibility

- `<aside>` landmark. The current-resource control exposes
  `aria-haspopup="menu"` / `aria-expanded` / `aria-controls`, keeps its visible
  label as its accessible name, and its `role="menu"` dropdown groups rows under
  labelled `role="group"` sections. Rows are `menuitemradio` / `aria-checked`
  buttons that take real DOM focus (`tabIndex={-1}`) inside `role="none"`
  wrappers, so ArrowDown/ArrowUp/Home/End move focus across rows only and never
  through the trailing close buttons; Delete/Backspace closes the focused row.
  Escape and Tab close the menu and return focus to the trigger. Each resource
  body remains a `role="tabpanel"`
- Resize handle: focusable `role="separator"` with
  `aria-orientation="vertical"`, a localized label, dynamic
  `aria-valuemin` / `aria-valuemax` / `aria-valuenow`, visible focus, and
  Arrow/Home/End keyboard control. Escape cancels an active pointer gesture.
- Every resource close and the sole session-pane panel collapse button expose
  localized names

### 5.6 MVP constraints

- Tab content specs: Review has host-guarded rollback but no line comments;
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
| Active | neutral-accent outlined ring, active bg highlight, text-primary |
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
- Sidebar body-level menus opened from toolbar or row triggers remain
  content-sized and use the same fixed rule as right-click menus: open 4px to
  the anchor's right without flipping to the left. Their surface width is
  capped for narrow viewports. This includes the Sessions sort menu,
  session/project overflow menus, and section create menus.
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
turns, lightweight tool activity rows, and permission cards for a session.
Provider-level assistant fragments separated by tool calls remain distinct in
storage but compose into one assistant turn until the next user message.

### 7.2 Anatomy

```text
+----+-------------------------------------+
|map | [User MessageBubble]                |
|rail| [Thinking disclosure]               |
|    | [Assistant Turn]                    |
|    |   [Assistant fragment]              |
|    |   [ToolCallRow]                     |
|    |   [PermissionCard] (interrupt)      |
|    |   [Assistant fragment (resume)]     |
|    |   [Meta + one action toolbar]       |
|    | [User MessageBubble]                |
|    | ...                                 |
+----+-------------------------------------+
```

### 7.3 States

| State | Behavior |
|---|---|
| Session activation | Re-pin and position at the last record during layout, before the transcript's first painted frame |
| Session transition | Previous complete view remains stable and non-interactive until the deferred destination tree is ready; current stream updates are not deferred |
| Streaming | New tokens append; auto-scroll only while pinned to bottom |
| Turn start | Send / retry / regenerate re-pins follow mode and jumps to bottom |
| Thinking-only streaming | Transcript opens; disclosure stays open; no empty answer bubble or duplicate Working row |
| Idle | Scrollable; no auto-scroll |
| Permission pending | PermissionCard inserted inline; transcript continues after resolution |
| Context checkpoint | Existing transcript remains visible; compaction adds one divider row after the message it covers and one warning toast |
| Error | Error MessageBubble with actionable retry link |

### 7.4 Interactions

- Scroll: the first upward scroll movement immediately pauses auto-scroll,
  cancels pending follow work, and shows the "scroll to bottom" floating button;
  stream or resize updates cannot pull the viewport back down; send / retry /
  regenerate re-pins and jumps to bottom
- Hover message: copy action appears
- Assistant fragments emitted before and after tool calls compose into one
  `role="article"` turn. The turn exposes one trailing meta row and one action
  toolbar; Copy joins all contentful fragments in order, while Fork and
  Regenerate use the last contentful assistant message as the durable boundary.
- Toggle Thinking disclosure: expand/collapse reasoning independently from the
  final answer; streaming reopens it while reasoning is arriving
- Hover code block: copy button appears
- Hover or focus a minimap marker: show the localized sender and a bounded
  plaintext preview; multiple assistant fragments produced within one user
  turn are combined into one AI-response marker and preview; nearby markers
  magnify horizontally without reflowing the rail
- Click a minimap marker: smoothly scroll its message near the top of the
  transcript viewport
- Scroll the transcript: update the active minimap marker against an anchor
  near the upper third of the viewport
- Show the minimap rail only while the transcript overflows one page; if
  content fits the viewport, hide the rail even when two or more markers exist
- Center the minimap stack inside the unobstructed vertical span below the
  46px titlebar and above the docked composer. As marker count grows, compress
  marker pitch and spacing so every marker remains inside that span rather
  than entering the native window drag region
- Follow-scroll requests from stream events and content resize are coalesced to
  at most one pending animation frame. A new token cannot cancel and recreate
  already scheduled follow work.
- An upward manual scroll takes priority over a pending follow frame, including
  sub-threshold trackpad movement that remains close to the bottom. Downward
  scrolling re-pins only after the viewport returns within 48px of the bottom.
- Minimap content resize checks only overflow. Message-position measurement is
  reserved for scrolling, marker identity changes, and viewport resize, so a
  streamed content height update does not scan every message twice.
- Context compaction never removes, collapses, or replaces visible message
  rows. It adds one non-message divider row per compaction, anchored after the
  last message that checkpoint covers; the row ends whatever assistant turn it
  falls inside, and a row whose anchor no longer exists is not drawn. The
  `new_context` tool is a normal tool call and reaches the processing group like
  any other.

### 7.5 Accessibility

- `role="log"` container
- `aria-live="polite"` for new content announcements
- Each user message and composed assistant turn: `role="article"` with
  `aria-label` describing sender
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
- The minimap renders only when at least two eligible turn markers exist **and**
  the transcript content overflows one viewport (scrollHeight > clientHeight).
  Each visible user message creates one marker; all contentful assistant
  fragments until the next user message create one AI-response marker anchored
  to the first contentful fragment. Tool-only rows do not create markers or
  split an AI response, and a one-page transcript never shows the rail.
- Marker previews are capped at 280 source characters and are display-only
- Derived visible rows, minimap rows, and activity grouping are memoized by the
  `messages` snapshot. Completed message rows, composed assistant turns, and
  activity groups keep stable render boundaries while only the current stream
  fragment changes.

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
  never a fixed accent tint), borderless, `radius-lg-plus` with a tighter
  bottom-right corner, capped at `min(82%, 600px)` so short prompts read as
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
- Tool-mediated assistant output uses one visual turn from the preceding user
  message to the next user message. Intermediate provider message boundaries
  remain visible as ordered markdown fragments around activity disclosures but
  do not create additional meta rows or action toolbars. The single Copy action
  copies all contentful fragments in order; Fork and Regenerate target the last
  contentful fragment so existing durable transcript semantics remain intact
  (D157).
- Assistant meta: optional model badge + compact Codex-style context inspector
  under the answer. The inspector keeps a small remaining-capacity ring beside
  the `Context` label and percentage; low capacity changes the semantic color
  without making color the only signal. Hover or keyboard focus opens a
  non-modal, scrollable panel with a clear remaining-token header, used/window
  counts, a used-capacity meter, and compact turn/speed summary cells. Provider
  and tool sections carry explicit reported/estimated source badges. The
  provider section shows exact input/output/cache/reasoning usage and the
  provider-reported cache hit rate (`cacheRead / (input + cacheRead)`) when
  cache-read metadata is available; generation speed is a completed-turn value
  in tokens per second and is not updated while a response is streaming. The
  panel also lists each unique tool type from the
  assistant turn in first-seen execution order, with its call count, aggregated
  argument/result footprint, share bar, and cumulative duration. Provider
  totals are exact; the context-window total uses the same `pi-ai` model
  metadata as the agent sidecar, while unknown models fall back to the provider
  catalog or the default window. Tool rows are explicitly marked as estimates
  because providers do not report per-tool context allocation. The panel is
  portaled to the document body as a fixed viewport overlay, flips
  above or below the trigger, clamps to viewport margins, and repositions on
  transcript scrolling or window resize so no transcript clipping ancestor can
  hide it (D103, D184). When the active session has an installed context
  checkpoint, the panel adds one muted line between the provider and tool
  sections — how many times the session has compacted and the newest summary's
  estimated token cost — and renders nothing there otherwise. The transcript
  shows one row per compaction; this line adds what those rows cannot, next to
  what the context is currently spent on (D203).
- Gap: 12px vertical padding between consecutive message rows (denser than
  consumer chat, closer to WorkBuddy task transcript); assistant turns add a
  little extra bottom air so a completed answer separates from the next prompt
- Font: text-base (14px) for body; text-sm (13px) mono for code
- Tool activity: tool-name classification selects a semantic 15px icon;
  `fork`, `fork_agent`, `fork_task`, and `fork_session` use the GitFork branch
  icon instead of the generic tool glyph.

### 8.4 States

| State | Appearance |
|---|---|
| Streaming | accent left rail along the whole assistant turn (fragments + tool rows); the rail's space is always reserved so it fading in/out never reflows text; content grows |
| Thinking streaming | disclosure open; answer bubble omitted until answer text exists |
| Complete | no streaming rule; full rendered markdown |
| Error | assistant error card in transcript; localized summary + stable code; details disclosure opens to redacted provider response, provider/model IDs, and copy action; retriable failures show Retry and configuration failures show Open settings |

### 8.4a Context compaction row

Not a bubble: a full-width divider between transcript rows, drawn after the last
message its checkpoint covers.

- One centered label — how many times the session has compacted — with a hairline
  rule filling the space on both sides, using `--ds-border-subtle`.
- A second muted segment states the summary's estimated token cost, or that no
  summary was generated (the no-summary family).
- `--ds-text-muted` at `--text-2xs` with tabular numerals; the detail segment
  steps up to `--ds-text-secondary`. Margins match the transcript's row rhythm.
- `role="separator"`. No actions, no hover state, no selection, no disclosure.
  Nothing about a checkpoint is editable, so the row is informational only.

### 8.5 Accessibility

- User: `aria-label="User message"`
- Assistant: `aria-label="Assistant message"`
- Thinking trigger exposes localized Show/Hide labels, `aria-expanded`, and an
  `aria-controls` relationship to the reasoning panel
- Context inspector trigger is keyboard focusable, exposes a localized
  remaining percentage and token count, and reveals the same breakdown on
  hover or focus
- Timestamps: `aria-label` with full time string, visual shows relative time

### 8.6 MVP constraints

- No message reactions/annotations
- No edit user message (deferred)
- Copy assistant answer excludes thinking text

### 8.7 Markdown & code rendering (implemented)

Renderer: `apps/desktop/src/components/Markdown.tsx` + `apps/desktop/src/lib/shiki.ts`
+ prose styles under `.prose-chat` / `.code-block` in `styles/prose.css`.

- **Streaming without jank**: runtime content chunks render directly, without a
  second renderer-side typewriter or animation-frame state loop. Source splits
  into top-level blocks via `marked`'s lexer; each block renders through a
  memoized `<ReactMarkdown>`. While streaming only the tail block re-parses
  (incremental re-lex from the last block boundary), so cost stays linear in
  message length. A Mermaid fence stays in the normal source-code presentation
  until its matching closing fence arrives; partial streamed diagrams never
  enter the diagram parser.
- **Plugins**: `remark-gfm` (tables, task lists, strikethrough, autolinks),
  `remark-math` + `rehype-katex` (inline `$…$`, display `$$…$$`). Raw HTML is
  parsed by `rehype-raw` and immediately constrained by the extended
  `rehype-sanitize` default schema; only the renderer-owned audio/video/source
  additions are admitted. KaTeX's Vite-inlined WOFF2 fonts are allowed by the
  renderer's `font-src 'self' data:` CSP directive.
- **Mermaid diagrams (D165)**: a completed `mermaid` fenced block in assistant
  answer prose renders through the official Mermaid package. The dependency is
  dynamically imported only when a diagram approaches the viewport; Mermaid's
  global theme configuration and render calls are serialized. Diagram source
  is capped at 20,000 characters and graph edges at 500. Strict security,
  protected configuration keys, disabled HTML labels/links, and a second
  DOMPurify SVG-profile pass precede insertion. Unsafe external/media elements,
  `foreignObject`, event-capable links, and URL attributes are removed. Invalid
  or oversized input falls back to a readable source view. The toolbar toggles
  diagram/source and copies the original source; light/dark theme changes
  re-render the SVG. Thinking prose deliberately keeps `mermaid` fences as
  source code so a collapsed reasoning trace cannot start diagram layout.
- **Syntax highlighting**: Shiki singleton with the JavaScript regex engine
  (no wasm), themes `one-light`/`one-dark-pro` following `data-theme`.
  A coding-focused local catalog exposes 48 canonical grammars plus common
  aliases; each grammar lazy-loads on its first matching fence tag with a
  plain-mono fallback until ready. Tags outside that catalog remain readable
  plain text instead of pulling the full Shiki language distribution into the
  application. The canonical catalog is `astro`, `bat`, `c`, `cpp`, `csharp`,
  `css`, `dart`, `diff`, `docker`, `dotenv`, `go`, `graphql`, `groovy`, `hcl`,
  `html`, `ini`, `java`, `javascript`, `json`, `jsonc`, `jsonl`, `jsx`,
  `kotlin`, `lua`, `make`, `markdown`, `mdx`, `mermaid`, `nginx`, `php`,
  `powershell`, `prisma`, `proto`, `python`, `ruby`, `rust`, `scala`,
  `shellscript`, `sql`, `svelte`, `swift`, `terraform`, `toml`, `tsx`,
  `typescript`, `vue`, `xml`, and `yaml`. Streaming code re-tokenizes only
  changed lines by chaining GrammarState (per-line cache), so per-frame cost
  is constant regardless of block size.
- **Code block chrome**: `.code-block` single-surface card (radius-md-plus,
  hairline border; dark `#282c34`, light `#fafafa` — matching One Dark Pro /
  One Light editor bg). Header is transparent (language tag left, copy right);
  body `pre`/`code`/token spans have **no nested background**, so Shiki token
  colors sit on the one card surface. Body text at text-sm-plus /
  leading-relaxed with horizontal scroll and tab-size 2.
- **Prose**: calmer chat density — body at text-base / leading-prose with
  pretty wrapping; heading ramp h1 `text-xl` (hairline underline) → h2
  `text-lg-plus` → h3 `text-lg` → h4 `text-base-plus` → h5/h6 `text-base`
  secondary; blockquotes use a 3px neutral rule over a soft plate;
  hr is a faded center gradient; lists use quieter markers and flex task
  rows; inline code gets a hairline border + soft gray tint; tables wrap
  in `.table-wrap` (rounded shell, header row, even-row wash, hover wash);
  display math sits in a subtle inset plate. Thinking prose reuses the same
  hierarchy at text-sm-plus / secondary color.
- **Light theme**: paper-quiet surfaces — links use soft underlined ink
  (not hard black/blue), inline code `#f2f2f2`, fenced code cards use One
  Light `#fafafa` (no nested wash / drop shadow), blockquotes `#f6f6f6`,
  tables on white with `#f3f3f3` header / `#fafafa` zebra. Dark fenced code
  uses One Dark Pro `#282c34`.
- **Links**: plain click previews in the work panel; modified click keeps
  `target="_blank"` so main routes through `shell.openExternal`; in-window
  navigation stays blocked.
- **Long transcript behavior**: `.thread-scroll` sets `overflow-anchor: none`
  (pinned-follow owns the scroll position), `.message-row` uses
  `content-visibility: auto`, and offscreen Mermaid diagrams defer loading and
  layout until they approach the viewport.

---

## 9. ToolCallRow

### 9.1 Purpose

Lightweight inline disclosure row showing a semantic tool action, its primary
argument hint, status, and a readable rendering of the result. It follows D071
and is intentionally not an elevated card.

Consecutive tool calls form one ChatGPT-style processing group. The group is
collapsed by default and its header shows `Processing · 12s` while active or
`Processed for 12s` after completion. Expanding it reveals the ordered tool
activity rows and their nested result disclosures.

### 9.2 Anatomy

```text
[sparkle] Processed for 12s  3 steps        [›]
          ├─ [file] Read /src/foo.ts        [›]
          ├─ [search] Searched TODO  24 matches   [›]
          └─ [terminal] Ran pnpm test  exit 1     [›]
             ├─ Command      [copy]
             │  pnpm test
             ├─ Output       [copy]
             │  3 passing
             └─ Errors       [copy]
                1 failing
```

- The leading Lucide icon reflects the action type: file, folder, search,
  edit, terminal, web, or generic tool.
- The group header owns the elapsed timer and step count. It stays in the
  transcript after completion and remains collapsed unless explicitly opened.
- The processing group spans the full available assistant column, so expanded
  result details keep a usable width even when the header or payload is short.
- The visible label is a natural-language action (`Read`, `Ran`, `Searched`),
  not the raw function name. Running actions use the progressive form.
- The primary argument is a clamped single-line monospace hint.
- Result chips follow the hint: exit code (error hue), match/file counts,
  replacement count, written or read size, `truncated`, `scratch`. A successful
  exit earns no chip — the row status already says so.
- The disclosure chevron is quiet until hover/focus or expansion.

### 9.3 Expanded blocks

The expanded body is a list of labeled blocks, never a JSON dump (D192). The
pi-ai result envelope carries the structured payload in `details` and repeats it
as text for the model; only the structured half is rendered, so no byte appears
twice.

| Tool | Blocks |
|---|---|
| Read | `File content` — syntax highlighted from the file extension |
| Write | `Written content` — highlighted from the target extension |
| Edit | `Changes` — compact diff, only when no ReviewChangeCard owns one |
| Bash | `Command` (shell), `Output`, `Errors` (error hue); empty channels omitted |
| Glob | `Files` — clickable workspace paths |
| Grep | `Matches` — grouped by file with a `line` gutter and clickable path headings for `outputMode: content`; a clickable path list for `filesWithMatches`; `path` → hit count fields for `count` |
| any host `notice` | `Note` — neutral, after the blocks it qualifies (search scoping, clipped long lines, Read window) |
| any failure | `Error` — message plus code, listed first |
| unmapped payload | scalar entries as label/value fields; long or multi-line strings as their own labeled block; nested objects as JSON |

- Arguments appear as an `Input` field block only when the result blocks did not
  already carry them, or for opaque tools (`use`, `fork`, `fetch`) whose
  arguments are the interesting part. The argument already shown as the row hint
  is not repeated.
- Every block exposes a compact copy action that copies the full payload, not
  the visible slice.

### 9.4 Layout

- Outer row: transparent, borderless, shadowless, approximately 24px high
- Icon: 15–16px; disclosure chevron: 12px
- Header gap: 4px; expanded body inset: 24px
- Chips: monospace `--text-2xs`, hairline border, error hue for exit codes
- Code, file list, match list and field blocks: `font-mono text-sm`,
  independently copyable, capped at 260px with internal scrolling
- Diff blocks reuse the review card's `.diff-line` rails
- Only expanded content receives an inset surface and subtle border

### 9.5 States

| State | Header treatment | Expanded content |
|---|---|---|
| Running | Progressive action + shimmer + spinner | Latest partial output |
| Success | Past-tense action + result chips; no green success badge | Result blocks, then arguments if not already shown |
| Error | Past-tense action + compact danger status; auto-expanded | Error note first, then arguments |
| Denied | Muted `Denied` status | Permission result when available |

### 9.6 Interactions

- Click the row: expand/collapse the result blocks; successful rows default
  collapsed and failed rows open automatically.
- Click the processing header: expand/collapse the ordered activity list.
  Processing groups default collapsed, including while the turn is active.
- Failed groups use an explicit `Failed after {elapsed}` header. Expansion uses
  a short height/opacity transition and keeps collapsed content inert.
- Running updates replace the latest partial output in place. Blocks are built
  on expansion only, so streaming ticks stay cheap.
- Results are presented before arguments so the primary result has higher
  information priority.
- File paths and Grep hit headings open in the work panel when they resolve
  under the workspace root; paths outside it stay plain text.
- Host truncation markers remain visible and cannot be bypassed by expansion.
  Rendered lists and diffs are capped and report the hidden remainder.
- Syntax highlighting is skipped above 100 KB or 800 lines.

### 9.7 Accessibility

- `role="region"` with `aria-label="Tool call: {toolName}"`
- Status announced through localized `aria-label` text
- Expand/collapse: `aria-expanded` + `aria-controls`
- Copy actions carry `aria-label="Copy {block label}"`
- Keyboard focus uses the standard inset focus ring

### 9.8 MVP constraints

- No word-level diff refinement; the Edit diff is line-based
- No cross-row activity grouping until turn boundaries are available to the
  transcript component

### 9.9 Delegation rows (D201, ADR 0062)

A `Task` call is a ToolCallRow like any other, with the `delegate` action icon
and one extra header element: a quiet chip naming the delegate it ran, taken
from the rows it produced or, before any arrived, from the call's own `agent`
argument. The row hint is the call's short `description`.

```text
└─ [bot] Delegated  code-reviewer  check the store diff   [›]
   ├─ task                                        [copy]
   │  Review the changes in src/stores for …
   ├─ Details
   │  status  completed   turns  4   toolCalls  9
   └─ [bot] What code-reviewer did          3 steps
      ├─ [thinking] Thought for 2s                [›]
      ├─ [file] Read /src/stores/app-store.ts     [›]
      └─ The queue drops a request by id, so …
```

- A delegation is **always** expandable, even with no result blocks: the brief,
  the report and the delegate's own rows all live in the body.
- Block order is brief in, report out, counters last: the `task` argument as an
  `input` block, the report as the output block, then a `Details` block holding
  the counters pi handed back — `status`, `turns`, `toolCalls`, and `usage` when
  present. `agent` is omitted because the header chip already shows it, and an
  `error` is rendered as the leading error block, not as a counter. The
  delegate's own rows follow the whole body, so the summary reads before the
  detail.
- A failed delegation shows its error instead of an empty report.
- The delegate's rows render inside a `.subagent-run` block, indented behind a
  hairline rail, headed by the agent name and a step count. They collapse with
  the `Task` row, so a transcript at rest reads as one line per delegation.
- Nesting is one level deep by construction: a delegate has no `Task` tool.
- Delegate rows are ordinary rows inside that block — tool rows with their own
  disclosures, thinking rows, and answer rows — so no new presentation is needed
  for what a delegate does.
- **The report is printed exactly once.** When the delegate produced an answer
  row, that row is the report and the body's output block is suppressed; when it
  produced none (aborted, capped, failed), the body prints it.
- Delegate rows never appear in the turn stream, the minimap, or a processing
  group of their own; grouping is by the parent's rows only
  (`03-runtime/04-data-storage.md` §4.7a).
- Runs are rebuilt from the message list on every render, so group memoization
  compares them by row identity and length rather than by object identity —
  otherwise a streaming delegate would freeze at its first row.

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

The redacted args preview uses the ToolCallRow block presentation (§9.3): a
command reads as shell, file content as code, everything else as label/value
fields. It is never a JSON dump.

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

## 10A. PlanApprovalCard

### 10A.1 Purpose

Inline approval surface for the exact Markdown bytes submitted by the same pi
Agent and preserved in a new immutable `.pi/plan/*.md` artifact. It is distinct
from `PermissionCard`: it approves a Plan → Agent transition and an explicit
execution permission mode, not an individual tool call.

### 10A.2 Content

The card renders the host-issued request identity, structured title and
question, an opener for the exact `.pi/plan/*.md` path, status, and absolute
expiry. Opening the artifact reads the host-written file; renderer edits do
not change the approved bytes. Inline Markdown, SHA-256, byte size, and
revision/feedback controls are not rendered card content.

### 10A.3 Actions and states

| State | Actions | Contract |
|---|---|---|
| Pending | Approve, Reject | request is live and proposal/session/turn/tool-call/version scoped |
| Resolving | all actions disabled | retain the proposal until host result |
| Approved | no actions | same Agent continues in Agent with selected permission mode |
| Queued / Running | no actions | approved execution is active and tied to the same approval row |
| Rejected | no actions | run stops and session remains Plan |
| Expired / Interrupted | no actions | failed closed; a new plan must be submitted unless approval already committed, in which case session remains Agent |

Approve opens the explicit Ask / Accept edits / Auto choice with Ask selected for
each new proposal, independent of any prior approval choice. Reject carries no
permission mode. The renderer keeps the latest proposal/execution snapshot per
session only for the current renderer lifetime from live Host events, while only
a pending snapshot has actions or gates the Composer. Renderer reload calls
`plans.pending` and restores a still-pending row with its original deadline while
the host remains alive. It does not rehydrate rejected, expired,
approved/completed, or interrupted terminal cards; a terminal card may remain
visible and non-actionable only until reload. Startup recovery interrupts
pending/queued/running fields before serving RPC, restores no actionable stale
approval, and never replays execution. Pending unapproved work remains Plan and
already-approved interrupted execution remains Agent; the UI is not required to
present the interrupted terminal snapshot after restart.

### 10A.4 Accessibility

- The card is a session-scoped `region` with a localized plan title.
- Approval, reject, and abort controls have explicit labels and
  keyboard focus.
- The selected permission mode exposes radio semantics and its Plan Bash
  consequence is available in the accessible description.
- Resolution does not navigate to another session or take focus from a
  different session.

---

## 11. Composer

### 11.1 Purpose

Input area at the bottom of MainChat for composing and sending prompts. Supports multi-line, mode/permission context display, and abort; model selection remains in the topbar.

### 11.2 Anatomy

```text
+----------------------------------------------+
| [Agent/Plan] [Thinking] [permission mode]    |
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
- The solid/near-opaque surface uses no `backdrop-filter`; focus-within adds a
  1px lift and token shadow without forcing transcript repaint through a blur
  layer.
- Border: border-default top
- Padding: px-4 py-3 inner textarea
- Font: text-sm for both Agent and Plan; mode changes semantics and tool
  controls, not the typography
- Bottom-anchored: fixed at bottom of MainChat area

### 11.4 States

| State | Appearance | Actions |
|---|---|---|
| Idle (no model) | textarea active, send button disabled + tooltip "Configure a model first" | Agent link remains available in model menu |
| Idle (ready) | textarea active, send button enabled | Send active |
| New session (reasoning model) | Thinking trigger shows the model's highest published level | User may select any published level, including Off when supported |
| New session / switch while another session is running | textarea active, send button enabled for the destination session's own run state | Send active, Abort hidden unless the destination session itself is running |
| Running | textarea disabled, abort button visible | Abort active, Send hidden |
| Context checkpoint | Same as Running until durable checkpoint completion; intermediate `turn_end` does not reactivate controls. A retained-tail fallback remains Running and shows a warning toast | Abort active, Send hidden |
| Permission pending | textarea disabled (per [03-permission-ux.md](03-permission-ux.md) §7) | Send disabled, abort visible |
| Plan / planning | textarea active while idle; Plan badge and permission chip visible | inspect, send, or submit plan |
| Plan / awaiting approval | transcript shows the title/question, artifact opener, expiry, and status for the exact `.pi/plan/*.md` approval; draft is preserved read-only and composer controls remain blocked for that session | approve or reject |
| Plan / queued or running | Agent badge remains selected; queue/running state is visible and composer remains blocked | abort; no replay control |
| Plan / planning after rejected, expired, or interrupted proposal | Plan chip remains visible and editable | send a later prompt; submit a new plan; no execution action |
| No workspace | textarea active, warning banner "No project — tools limited" | Send enabled |

### 11.5 Interactions

- Enter: send message (configurable: Shift+Enter for newline)
- Shift+Enter: newline in textarea
- Escape: when textarea focused, clears input or blurs (not abort)
- Abort: stops running turn and cancels pending permission
- `turn_end` is not an idle signal. The composer, model/mode controls, and
  session actions remain blocked through subsequent tool turns and blocking
  automatic checkpoint generation until `agent_end` or `error`. A manual-only
  checkpoint becomes idle on its matching `compaction_end`.
- Auto-grow: textarea measures wrapped visual lines, starts at one visible
  line, expands through seven lines, then scrolls internally; deleting content
  shrinks it back to one line
- Text correction off (D145): composer textarea sets `spellCheck={false}`,
  `autoCorrect="off"`, and `autoCapitalize="off"` so browser/OS spelling and
  autocorrect never rewrite coding prompts
- Runtime chips keep descenders fully visible (D150): the Thinking, permission,
  and mode triggers in the Composer use compact line-height rather than
  `leading-none` under overflow. The topbar model trigger still ellipsizes long
  IDs.
- Mode, provider/model, permission, and shell-default changes update the
  active session/settings only while idle; they are disabled while a turn or
  active pending Plan or Goal approval exists. Approval actions are the exception
  while awaiting approval. The Composer-left Agent/Plan/Goal chip is the sole mode
  control and cycles Agent → Plan → Goal → Agent on click; the topbar model picker
  remains a model-only control. Palette and Composer slash mode commands use the
  same active-session configuration path; after host confirmation resolves an
  approval, the approval surface is removed rather than remaining as a terminal
  action card.
- A new session whose inherited default model supports reasoning starts with
  Thinking enabled at that model's highest published level. Non-reasoning
  models and missing capability metadata start at `off`; reopening or reusing
  an existing session preserves its durable selection.
- The model menu lists only enabled, runnable providers with a default model.
- For a reasoning-capable active model, a separate Thinking trigger appears
  immediately to the right of the mode chip and before the permission
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
- The Plan permission chip remains visible beside the mode selector. It shows
  the effective Ask / Accept edits / Auto posture. In Plan and Goal, its help text
  says that Bash is confirmed under Ask or Accept edits and may mutate without a
  confirmation under Auto; it does not imply that Write/Edit/plugin tools are
  available.
- Goal shares the Plan approval surface (D198). The bar reads its copy from the
  proposal's `kind`, so a goal contract shows "Goal approval", "Open goal", and
  "Working toward goal" while the layout, permission split-button, expiry
  reconciliation, and terminal-status behavior stay identical.

### 11.6 Accessibility

- `role="textbox"` with `aria-label="Message input"`
- Editable text controls never enable browser spellcheck or autocorrect (D145)
- Send button: `aria-label="Send message"`
- Abort button: `aria-label="Abort active turn"`
- Disabled send: `aria-disabled="true"` with tooltip explanation
- Thinking levels use radio-menu semantics inside a localized Thinking group;
  the selected level exposes `aria-checked="true"`

### 11.7 MVP constraints

- Pasting one or more OS clipboard files or images saves their bytes into the
  originating session's scratch directory and inserts `@<absolute-path>` text;
  text-only paste keeps the browser's native textarea behavior (D197,
  ADR 0059)
- No inline binary/ImageContent payloads or attachment preview chips; the
  prompt remains text-only and the agent follows the inserted paths with its
  file tools
- No voice input

### 11.8 Slash commands, @ file references, and clipboard files (D123–D125, D197, ADR 0024, ADR 0059)

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
- The Agent/Plan mode aliases can prefix a prompt in the same draft:
  `/agent-mode <prompt>` and `/plan-mode <prompt>` apply the mode first, then
  send `<prompt>` through the normal prompt path so the user turn remains in
  the transcript. An alias-only mode command remains local. The composer is
  cleared only after the local action or prompt dispatch is accepted; a failed
  dispatch retains the complete draft for retry.
- A paste containing files is intercepted only when the clipboard exposes at
  least one `File`. The renderer transfers bounded file bytes, name, and MIME
  metadata to Electron main with the durable session id. Main validates the
  session, writes unique sanitized files under
  `<data_dir>/scratch/<sessionId>/pasted/`, and returns absolute paths. The
  composer inserts each path using the same `@` reference formatting as the
  file menu; paths containing whitespace are quoted. A home composer creates
  or reuses a durable session before saving. The scratch lifecycle removes
  pasted files with the session and never dirties the workspace git tree.
- A paste containing files is intercepted only when the clipboard exposes at
  least one `File`. The renderer transfers bounded file bytes, name, and MIME
  metadata to Electron main with the durable session id. Main validates the
  session, writes unique sanitized files under
  `<data_dir>/scratch/<sessionId>/pasted/`, and returns absolute paths. The
  composer inserts each path using the same `@` reference formatting as the
  file menu; paths containing whitespace are quoted. A home composer creates
  or reuses a durable session before saving. The scratch lifecycle removes
  pasted files with the session and never dirties the workspace git tree.
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
| No sessions | "Start your first conversation" | "New Task" button → focus composer |
| No provider | "No model provider configured" | "Add provider" link → Settings → Agent → Providers |
| No project (Agent or Plan) | "No project open — workspace tools unavailable" | "Open folder" button → ProjectPicker |
| Session empty (first message) | "Ask PI-Desktop to do anything" placeholder (home variant "Ask anything", D094/D066) | N/A |

### 15.3 Layout

- Chat home empty: single scrollable stack (hero → optional checklist) centered
  in MainChat, with a bottom-reserved composer sibling; task entry starts
  directly in that composer without a starter-card or quick-action layer
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

**Status: merged into the global search surface.** The command palette overlay was removed; its command list (built-in + plugin commands) now renders as the "Commands" section inside `SearchDialog` (opened with Cmd/Ctrl+K or Cmd/Ctrl+Shift+P). Defined in [04-builtin-commands.md](04-builtin-commands.md) and surfaced by the global search component spec.

### 16.2 Anatomy

```text
+----------------------------------------------+
| [search input]                               |
| ───────────────────────────                  |
| Results list (scrollable)                    |
|   Category: Session                          |
|     ▸ New Task                               |
|     ▸ Delete Current Session                 |
|   Category: Mode                             |
|     ▸ Switch to Plan                         |
|     ▸ Switch to Agent                        |
|   Category: Turn                             |
|     ▸ Abort Active Turn                      |
| ...                                          |
+----------------------------------------------+
```

### 16.3 Layout

- Position: centered overlay, max-width 480px, max-height 360px
- Background: bg-elevated-opaque (elevated floating surface, consistent with `.dialog` / `.search-dialog`), radius-lg-plus, shadow-dialog
- Z-index: `z-command-palette` (60)
- Backdrop: semi-transparent bg-primary (0.5 opacity)

### 16.4 Interactions

- Search: filters commands by title and keywords
- Keyboard: arrow up/down navigate, Enter execute, Escape close
- Click: execute command

### 16.5 Accessibility

- The standalone palette overlay no longer exists; commands are part of the global search dialog (`role="dialog"`, `aria-label` from `nav.search`).
- The "Commands" section uses the same `role="listbox"` / `role="option"` semantics as the other search result groups.
- Search input auto-focused on open; arrow up/down navigate, Enter executes, Escape closes.

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
18. Native edges resize MainChat by reflow without compressing the fixed work panel;
    panel visibility and divider commits update the committed preferred width,
    and cancelled divider gestures restore the prior width (ADR 0033)
19. Expanded sidebar session titles, project/group titles, and empty-state copy
    use the 13px compact token while primary sidebar actions remain at 14px
