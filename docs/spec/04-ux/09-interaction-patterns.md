# 09. Interaction Patterns

> Design system tokens: [07-ui-design-system.md](07-ui-design-system.md)  
> Component anatomy: [08-component-spec.md](08-component-spec.md)  
> Permission UX: [03-permission-ux.md](03-permission-ux.md)  
> Command palette: [04-builtin-commands.md](04-builtin-commands.md)

## 1. Keyboard shortcuts baseline

### 1.1 Global shortcuts

| Shortcut | Action | Context |
|---|---|---|
| `Cmd/Ctrl + Shift + P` | Open command palette | Global (D014) |
| `Cmd/Ctrl + N` | New chat/session | Global |
| `Cmd/Ctrl + O` | Open project | Global |
| `Cmd/Ctrl + W` | Close window | Global |
| `Cmd/Ctrl + ,` | Open settings | Global |
| `Cmd/Ctrl + B` | Toggle sidebar | Global |
| `Cmd/Ctrl + [` | Previous destination | Global |
| `Cmd/Ctrl + ]` | Next destination | Global |
| `Cmd/Ctrl + .` | Abort active turn | Global (same as abort button) |
| `Cmd/Ctrl + K` | Open command palette | Global |

### 1.2 Chat context shortcuts

| Shortcut | Action | Context |
|---|---|---|
| `Enter` | Send message | Composer focused |
| `Shift + Enter` | Newline | Composer focused |
| `Escape` | Clear input / blur composer | Composer focused |
| `Cmd/Ctrl + ↑` | Scroll to top of transcript | Transcript focused |
| `Cmd/Ctrl + ↓` | Scroll to bottom of transcript | Transcript focused |

### 1.3 Command palette shortcuts (within palette)

| Shortcut | Action | Context |
|---|---|---|
| `↑ / ↓` | Navigate results | Palette open |
| `Enter` | Execute selected command | Palette open |
| `Escape` | Close palette | Palette open |

### 1.4 Shortcut rules

- macOS application-menu shortcuts are discoverable through system-menu
  accelerators. Windows/Linux shortcuts remain available without rendering an
  application menubar; command-only shortcuts are discoverable via command
  palette search (keyword "shortcut" or "keybinding").
- Shortcuts must not conflict with macOS system shortcuts or common browser shortcuts
- Never override `Cmd/Ctrl + C`, `Cmd/Ctrl + V`, `Cmd/Ctrl + A`, `Cmd/Ctrl + S`
- Shortcuts are consistent across macOS (Cmd) and Windows/Linux (Ctrl)
- A modifier-only keydown and an IME composition/229 keydown never dispatch a
  command. Repeated keydown events do not repeatedly traverse destination
  history; each back/forward chord advances at most once per physical press.
- Command-only shortcut changes require updating the command palette metadata;
  native roles and visible application-menu accelerators remain menu-owned

### 1.5 Platform application menus

- macOS application-menu accelerators dispatch the same allowlisted shell
  commands as renderer controls. Native Edit/View/Window roles retain
  platform text-editing, zoom, fullscreen, hide, and quit behavior.
- Windows/Linux render no application menu in the window. Their frameless
  titlebar keeps sidebar actions at the left edge and native window controls at
  the right edge. While the work panel is open, its sole collapse control sits
  in the session pane top-right ahead of those window controls rather than in
  the work-panel content header. Destination history has no visible back/forward
  controls and remains available through the renderer shortcuts. The first
  transcript row starts below the 46px titlebar control band so user and
  assistant content cannot overlap the minimize, maximize/restore, or close
  targets. F10 and Shift+F10 are not consumed by shell chrome.
- Windows/Linux keep New Task, Open Project, Settings, close-window,
  zoom, fullscreen, search, command-palette, and sidebar shortcuts through
  renderer key handling. Standard editing shortcuts remain native web-content
  behavior.
- Developer tools are opt-in. With developer mode enabled, Main handles F12 on
  every platform and Ctrl+Shift+I on Windows/Linux; macOS exposes its native
  developer-tools role in View. With the mode disabled these product entry
  points remain unavailable, and disabling it closes an open console.
- Main queues native commands until the renderer acknowledges that its menu
  event subscription is active on macOS. Closing and recreating a window
  resets this handshake.
- Frameless minimize, maximize/restore, and close controls remain outside the
  drag region. Maximize state is queried on mount and updated from native
  window events, so the restore affordance never depends only on optimistic
  renderer state.

### 1.6 Sidebar project and conversation organization

The sidebar is a path-keyed presentation of host-owned projects and sessions.
The `Sessions` heading appears first and contains path-less conversations plus
their create and sort controls. Its bounded list keeps standalone work visible
without consuming the full sidebar. The following `Projects` section heading
exposes the project picker above retained project groups. Several project groups
may be retained while exactly one workspace supplies the visible shell context.

#### Project tab lifecycle

1. **Open** — selecting a project from Settings → Project archive or the picker adds its
   normalized path to the retained set and activates it. Existing tabs remain.
2. **Activate** — selecting a different group calls the existing `project.set`
   bridge. Its path then drives topbar identity, active workspace state, and
   new-task scope.
3. **Collapse** — disclosure state belongs to each project path. Collapsing
   hides children only; it neither changes the selected session nor stops a
   run. The directory row is one full-width disclosure target containing its
   chevron, folder, and label: selecting an inactive directory activates it
   first, and every directory-row click toggles that group's children without
   changing any other group's state. Project actions are separate sibling
   controls and never toggle the directory.
4. **Close** — closing removes only the retained tab. If it was active, the
   last remaining tab is selected or the visible workspace is cleared. Durable
   projects, sessions, and transcripts remain.

#### Organization actions

- **Pin** toggles presentation priority. Pinned projects/conversations appear
  before unpinned rows within the selected secondary order.
- **Archive** is non-destructive. Archived rows are hidden by default,
  available through Show archived, and restorable. Archiving does not cancel
  a turn or delete a transcript.
- **Create branch** snapshots an idle conversation's complete active
  transcript into an independent session in the same project/Temporary scope.
  The command is disabled while the source runs. Success selects the child and
  focuses the composer; failure leaves the source visible and unchanged.
- Archiving the visible conversation/project first moves the visible context
  to a non-archived sibling. With no sibling, a conversation receives a fresh
  draft in the same scope and a project clears the visible workspace; the app
  never leaves a hidden archived row as the active context.
- **Sort** offers Recently updated (`recent`), Created date (`created`),
  Oldest first (`oldest`), and Name (`name`). Missing/invalid values fall back
  to `recent`. A persisted `manual` value is accepted for compatibility, but
  no drag or manual-reorder interaction is promised in this baseline.
- Presentation changes are saved best-effort. Storage failure must not block
  project activation, session selection, or agent execution.

#### Session isolation across tabs

- Selecting a project-scoped conversation activates its project before loading
  the transcript. Selecting a Temporary conversation clears the visible
  workspace.
- Run state, permission grants, and streamed events are keyed by session id.
  A project/tab switch does not abort a background turn or copy its events into
  the visible transcript. Background message, tool, completion, and permission
  events never activate their session, change the visible project/page, or move
  focus. Their work-panel artifacts and Browser resource update only the
  originating session's retained renderer context and do not reveal or resize
  the visible panel. Only an explicit session/notification activation navigates
  and projects the destination session's retained panel context.
- Every tool call resolves `workspaceRoot` from the originating durable
  session, not from the currently selected project tab. Background completion
  refreshes the matching row without redirecting the active conversation.

#### Focus and semantics

- Project directory rows expose `aria-expanded` and `aria-controls`;
  new-project/new-session controls have scope-specific accessible names, and
  sort/archive menu choices expose their checked state. Active session rows
  retain `aria-current`.
- Toggling disclosure or a menu action keeps focus on its control. Selecting a
  project/session returns focus to the composer after loading.
- Sort, archive, restore, pin, Create branch, and close actions remain
  keyboard-reachable;
  they cannot exist only as pointer-hover affordances.

### 1.6 Local profile footer

- The `44px` profile trigger toggles the menu; its chevron and
  `aria-expanded` state change together.
- The `280px` menu opens `8px` above the transparent footer band. Opening it
  moves focus to the first actionable row after the non-interactive identity
  header and divider.
- `ArrowDown` / `ArrowUp` wrap among Settings, Logs, and Theme. `Home` and
  `End` move to the first and last action.
- `Escape` closes the menu and restores focus to the profile trigger. A pointer
  press outside closes it without stealing focus from the pointer target.
- Selecting Settings, Logs, or Theme closes the menu before performing the
  action. Theme applies the next theme value without reopening the menu.
- The separate `32px` Help button bypasses the profile menu and navigates
  directly to Settings → Info.
- Collapsing the sidebar closes the menu and restores the collapsed rail's
  normal navigation state.

### 1.7 Notification inbox (D117)

#### Event-to-surface flow

1. Renderer reports the current chat's session id to Electron Main; navigating
   away clears it. Main combines this hint with its own window visibility and
   focus state when a turn reaches `completed` or `error`.
2. If the exact finishing session is already visible in the focused window,
   `session.endTurn` closes the turn without inserting a notification. Any
   background session or unfocused/hidden window creates the durable record.
   An `aborted` turn never creates one.
3. Electron emits `notification.changed` to every live renderer so the bell
   badge and currently open inbox refresh.
4. If the main window is focused, no other surface appears. If it is
   unfocused and native notifications are supported, Electron shows one
   platform notification derived from the event kind and session title. On
   Windows, the banner is attributed to the canonical PI-Desktop
   AppUserModelID shared with the NSIS package and taskbar identity.
5. Clicking the native notification shows/restores and focuses the main
   window, then emits `notification.activated { sessionId }`.
6. Renderer activation selects the bound project when present, loads the
   session, and focuses the transcript/composer using the same path as an inbox
   row click. Native and in-app activation must not diverge.

#### Popover behavior

- Bell click toggles the non-modal popover; a second click, Escape, or outside
  press closes it. Escape restores focus to the bell.
- Opening preserves the most recently selected `All` / `Unread` filter for the
  current renderer lifetime and never marks rows read implicitly.
- Arrow keys move through rows with wrap disabled; `Home` / `End` jump to the
  first/last row; Enter/Space marks the row read and activates its session.
- Mark all read updates every unread row in one host transaction. Clear
  removes all inbox rows in one host transaction. Both operations are
  idempotent, refresh the exact unread count, and leave sessions/turns intact.
- The renderer does not synthesize notification records from stream events.
  Host-core's unique `turn_id` is the exactly-once boundary across repeated
  terminal updates, renderer reloads, and process restarts.
- All visible event labels and native title/body strings are localized at the
  presentation boundary from structured fields; persisted rows never contain
  localized prose.

### 1.8 Artifact-driven work panel resources (D128, D140, D142, D154)

- The shell exposes no empty or unconditional work-panel launcher,
  application-menu command, or global shortcut. An artifact trigger atomically
  creates or reuses its resource, activates it, and opens the panel.
- File resources use normalized paths as identity. Review, Terminal, and
  Browser are singletons; repeated triggers preserve resource order and
  activate the existing resource.
- Once open, the panel's 44px activity rail makes Review, Terminal, and Browser
  one-click actions. The active-resource header opens an ordered resource
  switcher with pointer and keyboard selection plus per-item close controls.
- Every resource can be closed from the switcher, and the active resource has
  a direct header close control. Closing the active resource selects the right
  neighbor, then the left; closing the final tab hides the panel. The separate
  panel collapse control in the session pane top-right hides the panel without
  deleting tabs.
- On every platform, opening, hiding, or internally resizing the panel keeps
  native window bounds unchanged. Native window-edge drag resizes only the
  shell and does not rewrite the panel's preferred width (D156, ADR 0029).
- A successful workspace Write/Edit creates or activates Review in its
  originating session. Failed and scratch writes do not. Background-session
  artifacts update only their retained context and never open, activate, resize,
  or focus the visible panel.
- When a session has produced a successful workspace Write/Edit and that Git
  working tree has changes, a compact Review changes command remains visible at
  the end of that session's transcript independently of the activity disclosure
  state. It reports files and addition/deletion totals and creates, reopens, or
  activates the singleton Review tab. Other sessions in the same project do not
  inherit the command. Clean, non-Git, and no-workspace states do not render it;
  clean and non-Git results also clear the workspace's prior session ownership.
- The transcript and Review consume one workspace-keyed diff state. Workspace
  activation, debounced agent mutation, Review refresh, and window focus
  refresh that state; request sequencing prevents a late response from a prior
  workspace from changing the visible entry.
- Terminal mounts only after a command artifact opens it and remains mounted
  across tab switches while that tab exists.
- Each session retains `{open, tabs, activeTabId, browserResource}` in renderer
  memory. Selecting another session swaps the visible context atomically and
  switching back restores it; selecting a workspace without an active
  conversation hides the panel. Session/workspace identity remains attached to
  every relative resource, preventing cross-context reinterpretation.
- Relaunch discards every session context, including Browser resources; only
  the committed preferred panel width persists. Native window state is stored
  independently from normal bounds, including when the app closes while
  maximized or before a pending bounds-save debounce completes. Temporary
  responsive panel clamping is not persisted.

### 1.9 Application updates (D120)

- Electron Main checks the fixed release feed 15 seconds after packaged app
  startup and every 6 hours afterward. Development builds remain disabled.
  The checker always tracks GitHub's latest stable release
  (`allowPrerelease = false`), so installs that still carry a prerelease
  version such as `0.2.0-rc.6` are offered the newer stable tag instead of
  staying pinned to the same prerelease channel.
- Settings → Info and application-menu checks share one typed update state.
  Manual checks expose up-to-date or error feedback; automatic failures do not
  open a toast or ambient banner.
- Manual delivery (`darwin` and non-AppImage Linux) stops at `available` and
  offers the fixed GitHub Releases page. In-app delivery (Windows NSIS and
  Linux AppImage readiness builds) automatically advances through
  `downloading` to the stable `downloaded` state.
- `downloaded` remains actionable until Restart to update or normal app quit;
  later scheduled/manual checks do not replace it with `checking`.
- A compact update notice appears in the main pane's top-right safe area only
  for manual `available`, in-app `downloading`, or `downloaded`. It stays clear
  of the bottom composer at every supported window size and draft height. The
  notice uses a stable icon/title/message hierarchy, shows determinate download
  progress when available, and keeps the relevant action inside the same
  surface. Dismissal suppresses the current version-and-status stage; a later
  stage such as `downloaded` appears again.
- D126 tag releases publish all platform manifests and installers. Windows
  NSIS and Linux AppImage therefore use the in-app lane; macOS and Linux deb
  remain notify-and-link delivery modes.

## 2. Streaming message behavior

### 2.1 Token rendering

- Tokens append to the current assistant MessageBubble as they arrive
- Renderer displays runtime stream chunks directly; it does not enqueue a
  second requestAnimationFrame-driven typewriter state loop
- Rendering uses incremental markdown parse — do not re-render the entire message on each token
- Cursor indicator: subtle pulsing accent dot or line at the end of streaming content
- When stream completes: cursor indicator replaced by success state (2s fade)

### 2.2 Auto-scroll

- Auto-scroll to bottom on each new token group (throttled: check every 100ms, not every token)
- User manual scroll up: pause auto-scroll
- Sending a new prompt, retrying, or regenerating always re-pins follow mode and jumps to the bottom before the turn continues, even if the user had scrolled up
- "Scroll to bottom" floating button appears when user is >200px from bottom during stream
- Click "Scroll to bottom" button: resumes auto-scroll and snaps to bottom
- Stream completion: if user was auto-scrolling, keep at bottom; if manual, stay at position

### 2.3 Stream interruption

- If connection drops mid-stream: show error state on partial message
- Partial message is preserved — not deleted
- User sees "Stream interrupted" with retry option

## 3. Abort running agent

### 3.1 Trigger methods

- Topbar abort button (visible during running state)
- Keyboard shortcut: `Cmd/Ctrl + .`
- Command palette: `builtin.agent.abort`

### 3.2 Abort behavior

1. Cancel the current agent turn immediately
2. Cancel any pending permission request (per [03-permission-ux.md](03-permission-ux.md) §7)
3. Partial assistant message is preserved with "(aborted)" label
4. Any running tool calls show "(aborted)" status
5. Composer re-activates (unblocked)
6. Abort is idempotent — pressing abort when already aborting does nothing

### 3.3 Abort UX

- Abort button changes to "Aborting..." briefly (100ms), then disappears
- No confirmation dialog for abort — it is always immediate
- Aborted message gets a muted "(aborted)" suffix, not deleted

## 4. Long content collapse / expand

### 4.1 Collapse thresholds

| Content type | Default state | Collapse threshold | Expand limit |
|---|---|---|---|
| Assistant markdown message | Expanded | 50 lines → collapsed to 20 lines visible | Full |
| Tool activity input | Row collapsed | Always behind disclosure | 220px scroll region |
| Tool activity output | Row collapsed | Always behind disclosure | 220px scroll region (per D033 host cap) |
| Bash output | Row collapsed | Always behind disclosure | 220px scroll region |
| Error messages | Expanded | No collapse | — |

### 4.2 Collapse indicator

- Tool activity starts as a lightweight collapsed row; failed calls open
  automatically so the error remains local to its invocation.
- Consecutive tool activity is wrapped in one collapsed processing group. Its
  header updates elapsed time once per second while active, freezes after the
  next transcript message, and exposes the number of contained steps.
- Expanding the processing group reveals the ordered rows; each row retains its
  own nested disclosure for output and input.
- Activating the row reveals clamped output first and raw input second.
- Each section scrolls internally and exposes its own copy action.
- The disclosure chevron rotates on expansion. Reduced-motion disables
  non-essential shimmer/rotation animation.

### 4.3 Tool result truncation

- Per D033: tool results exceeding 256KB or 4000 lines are truncated with explicit markers
- Truncation marker: `[truncated: output exceeded 256KB or 4000 lines]` (host-enforced, see [16-tool-result-limits](../03-runtime/16-tool-result-limits.md))
- Truncated content is never silently omitted — always marked
- Disclosure expansion does not load content beyond the host-enforced cap

## 5. Permission interrupt flow

### 5.1 Flow sequence

```text
Agent calls high-risk tool
  → PermissionCard inserted inline in transcript
  → Composer disabled (cannot send new prompt)
  → Countdown starts (120s)
  → User responds: Allow once / Allow session / Deny
  → Card transitions to resolved state
  → Composer re-enabled
  → Agent continues or receives denial result
```

### 5.2 Multiple pending permissions

- Each session has at most one active permission card because that agent loop
  is paused; multiple sessions may wait independently.
- Abort cancels only the active session's pending permission.
- Timeout (120s from original receipt) auto-denies only the matching request;
  switching sessions never resets the deadline.

### 5.3 Focus management during permission

- A visible permission card is announced through `aria-live` without forcing
  focus. A background session's card is not mounted and cannot move focus.
- Action buttons are tab-reachable within the card
- After resolution: focus returns to composer
- Full spec: [03-permission-ux.md](03-permission-ux.md)

## 6. Toast vs inline error

### 6.1 Toast notifications (use for)

| Scenario | Toast type | Duration | Rationale |
|---|---|---|---|
| Provider connection test result | Success/Error | 4s/8s | Transient feedback, not blocking workflow |
| Plugin load/unload success | Success | 4s | Confirmation of background action |
| Settings saved | Success | 4s | Quick confirmation |
| Manual menu update check failure | Error | 8s | Direct feedback for an explicit command |

### 6.2 Inline errors (use for)

| Scenario | Inline placement | Rationale |
|---|---|---|
| Tool call failure | Error state on ToolCallCard | Context-dependent, user needs to see which tool failed |
| Permission denial | Resolved state on PermissionCard | Already inline, part of conversation flow |
| Stream interruption | Error state on MessageBubble | Belongs to the message that failed |
| Provider/model turn failure | Assistant error message in transcript | Keeps summary, stable code, redacted detail, and recovery action attached to the failed turn |
| Provider configuration validation error | Inline in settings form | User needs to see which field is wrong |
| Application update status/error | Settings → Info Updates row | Preserves the latest Main-owned state without interrupting background checks |
| Composer validation (no model) | Disabled state + tooltip on send button | Immediate context |

### 6.3 Rules

- Never use toast for errors that are tied to a specific message or tool call
- Assistant error detail uses a keyboard-operable disclosure with
  `aria-expanded` / `aria-controls`; it is open on first render so the provider
  response is immediately discoverable, and supports copying the redacted text
- Never use inline error for transient background operations (plugin load, connection test)
- Toasts stack vertically, newest on top, at top-center
- Error toasts require manual dismiss or timeout at 8s (longer than success)
- Success toasts auto-dismiss at 4s

## 7. Focus management

### 7.1 Focus flow on page load

1. Composer textarea receives initial focus in main chat view
2. Settings pages: first interactive element receives focus
3. Command palette: search input receives focus on open

### 7.2 Focus flow after actions

| Action | Focus target |
|---|---|
| New session created | Composer textarea |
| Session switched | Composer textarea |
| Message sent | Composer textarea (cleared, ready for next) |
| Stream completed | Composer textarea (re-enabled) |
| Permission resolved | Composer textarea |
| Abort completed | Composer textarea |
| Command palette closed | Previously focused element |
| Dialog closed | Previously focused element |
| Notification popover closed with Escape | Notification bell |
| Notification row/native notification activated | Activated session composer after transcript load |

### 7.3 Focus trap

- Command palette: focus trapped within palette while open
- Settings modals: focus trapped
- Escape always closes the trapped surface and returns focus

### 7.4 Focus ring rules

- Only show focus ring on `focus-visible` (keyboard focus), not on click/mouse focus
- Focus ring: 2px accent color border, 2px offset from element edge
- Per [07-ui-design-system.md](07-ui-design-system.md) §6.4
- Never remove focus rings globally — accessibility requirement

### 7.5 Text selection

- Application chrome is non-selectable by default to prevent accidental
  selection while clicking or dragging the shell.
- Editable controls (`input`, `textarea`, `select`, and
  `[contenteditable]`) preserve normal text editing and `Cmd/Ctrl+A/C/V`
  behavior.
- Transcript prose, rendered Markdown, code blocks, and tool input/output
  remain text-selectable for inspection and copying.
- Interactive controls nested inside selectable content remain
  non-selectable and must keep their click and keyboard behavior.
- Selection rules must not disable `focus-visible` feedback or native window
  drag regions.

## 8. Drag / drop

### 8.1 MVP status

Work-panel width resizing is implemented in MVP:

- The 10px left-edge separator anchors to the press position and starting
  width, then follows pointer delta without jumping.
- The width clamps to
  `364px–min(720px, 60vw, viewport − visible sidebar − 360px)`.
- Pointer movement is frame-coalesced. Pointer release persists one committed
  preferred width; Escape, pointer cancellation, and lost capture roll back.
- Native window or sidebar resize changes only the effective clamp. When room
  returns, the persisted preferred width is restored.
- Panel open, collapse, close, and divider resize never modify native window
  bounds. Native window-edge resize never modifies the panel preference.
- The MainChat surface keeps its 360px reserve throughout supported window
  geometry.

The following gestures remain reserved for future milestones:

- Drag project/session items to assign manual order
- File drag into the composer has no attachment behavior until the pi prompt
  contract supports persisted file payloads

### 8.2 Spec reservation

When drag/drop is implemented, these patterns should apply:

- Drag handle must be visible on hover (no invisible drag affordance)
- Drop targets highlight with accent border during hover
- Cancel drag with Escape
- Drag feedback: opacity 0.5 on source, accent outline on target

## 8a. Composer autocomplete (D123–D125)

### 8a.1 Triggers

- `/` opens command mode only when it is the first character of the input
  and the cursor is still inside that first token (no whitespace typed yet).
  A space after the command name closes the menu; arguments are free text.
- `@` opens file mode when the token containing the cursor starts with `@`
  and the character before `@` is start-of-input, whitespace, or one of the
  pi delimiters (`"`, `'`, `=`). The query is the text between `@` and the
  cursor; a query containing `/` matches across path segments. A quoted
  token (`@"…`) is treated as one token until the closing quote.
- Pasting text never opens a menu unless the caret lands inside a valid
  trigger token.

### 8a.2 Keyboard while open

- ↑/↓ move the highlight with wraparound; Home/End are left to the textarea.
- Enter / Tab accept the highlighted item; Enter never sends while the menu
  has a highlighted item (this precedes the Enter-to-send setting, which
  otherwise keeps its behavior).
- Escape closes only the menu — it takes precedence over the composer's
  "clear input or blur" Escape and must not propagate to overlay handlers.
- Any other typing re-filters in place; zero matches behaves as closed.

### 8a.3 IME (first normative IME rules)

- All autocomplete key handling sits behind the standard guard
  (`isComposing || keyCode === 229`).
- During active composition the trigger detector neither opens, updates,
  nor closes the menu; state re-evaluates on `compositionend`.
- Enter that confirms an IME candidate never sends and never accepts a menu
  item; ↑/↓ during candidate navigation belong to the IME.

### 8a.4 Close and focus rules

- Close on: outside mousedown, textarea blur, deleting past the trigger
  character, session or workspace switch, accepting an item (except `@dir/`
  continuation, which keeps the menu open on the deeper query).
- Focus stays in the textarea for the menu's whole lifecycle (input-retained
  overlay); the menu is never a focus trap and never steals the caret.

## 9. Scroll behavior

### 9.1 Transcript scrolling

- Default: auto-scroll to bottom on new content during stream while pinned
- User scroll up: pauses auto-scroll, shows "↓ Scroll to bottom" button
- User send / retry / regenerate: re-pins, hides the jump control, and jumps to the latest content so the new turn is visible
- Scroll-to-bottom button: position fixed at bottom-right of transcript area, offset 12px
- Button appears when viewport bottom is >200px from transcript bottom
- Click button: scrolls to bottom, resumes auto-scroll
- Button disappears when at bottom

### 9.2 Sidebar scrolling

- The standalone Sessions body is capped at five compact rows and scrolls
  internally when additional sessions exist.
- Retained project groups occupy the remaining sidebar height and scroll in a
  separate region. Both regions stay independent from the footer and primary
  navigation.
- No horizontal scroll in sidebar
- Scroll indicators use the platform's subtle overlay treatment without
  changing either region's width.

### 9.3 Settings scrolling

- Settings content scrolls independently within main area
- Left nav (settings sections) is sticky, does not scroll

## 10. Reduced motion

### 10.1 Policy

All animations must respect `prefers-reduced-motion: reduce`:

1. **Suppress:** streaming pulse, expand/collapse transitions, dropdown slide, hover color transitions
2. **Keep (instant):** state changes still occur (card status changes, loading → complete) but with no transition duration
3. **Never remove:** focus rings, status colors, layout positioning — these are structural, not decorative

### 10.2 Implementation

```css
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
  }
}
```

This does not prevent state changes — it makes them instant.

### 10.3 Affected patterns from this doc

| Pattern | Normal | Reduced motion |
|---|---|---|
| Streaming pulse | accent pulse on left border | static accent border (no pulse) |
| Tool card expand/collapse | 200ms transition | instant toggle |
| Hover state transition | 150ms background change | instant color change |
| Startup splash | Brand splash + progress, min dwell then fade out | Instant static splash, no bar motion, instant reveal |
| Dialog / search enter | overlay-in + surface-in via motion tokens | Near-zero duration enter |
| Scroll-to-bottom button fade-in | 150ms opacity | instant appear |
| Toast slide-in | 200ms slide | instant appear |
| Modal/dialog enter | 300ms fade+scale | instant appear |
| Notification popover enter | menu-scale/fade token | instant appear |

### 10.4 Programmatic scrolling

- Jump-to-latest and minimap navigation use smooth scrolling only when the OS
  has not requested reduced motion.
- Pinned stream following is frame-coalesced and uses instant scroll updates;
  it does not start overlapping smooth-scroll animations for token groups.
- Resize observers schedule work and never synchronously measure every
  transcript row from their callback.

## 11. Acceptance criteria

1. All keyboard shortcuts in §1 are functional and do not conflict with system shortcuts
2. Enter sends message; Shift+Enter inserts newline in composer
3. Abort immediately cancels running turn and pending permissions without confirmation dialog
4. Long content (>50 lines for messages, >10 for args, >20 for results) is collapsed by default with expand link
5. Tool results exceeding 256KB/4000 lines show truncation marker per D033
6. Permission interrupt inserts inline card, disables composer, shows countdown, and re-enables after resolution
7. Toasts used for transient background operations; inline errors used for context-specific failures
8. Focus returns to composer after session switch, message send, permission resolution, and abort
9. Background message, tool, completion, and permission events never change
   the active session/project/page or keyboard focus; concurrent permission
   requests remain independently actionable in their originating transcripts,
   and background artifacts update only their session's retained work-panel
   context
10. Focus rings visible on `focus-visible` only, 2px accent offset 2px
11. Command palette traps focus; Escape returns to previous focus
12. All animations respect `prefers-reduced-motion: reduce` — state changes are instant, no decorative motion
13. Project/session rows support non-destructive pin/archive, independent
    project collapse, and the documented user-facing sort modes
14. Shell chrome does not create accidental text selections, while editable
    controls and transcript/code/tool content remain selectable and copyable
15. Retained project tabs survive restart; activating one changes the selected
    shell workspace without redirecting background session tool roots
16. Drag/manual reorder is not implemented; `manual` remains a compatibility
    value and future drag patterns follow §8
17. Completed and failed turns appear exactly once in the durable inbox;
    aborted turns never appear
18. All/Unread, mark-all-read, clear, row activation, Escape/focus restore, and
    arrow/Home/End keyboard navigation behave as documented in §1.7
19. Native notifications appear only while the main window is unfocused and
    their activation focuses the window and opens the corresponding session
20. Streamed message updates stay within the chat render boundary; shell
    navigation, composer, completed rows, and work-panel content do not rerender
    solely because the current assistant message appended content
21. Native window-edge resize and work-panel divider resize remain independent;
    divider cancellation rolls back, and responsive clamping does not replace
    the persisted panel preference
