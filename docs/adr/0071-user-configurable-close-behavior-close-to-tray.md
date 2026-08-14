# ADR 0071: User-Configurable Close Behavior with Close-to-Tray

- Status: Accepted for implementation
- Date: 2026-08-12
- Deciders: PI-Desktop core
- Related: D210, ADR 0021, ADR 0025

## Context

On Windows/Linux, closing the main window calls `app.quit()`
(`window-all-closed`), so the app exits and its taskbar entry disappears.
Minimizing is a plain native minimize and keeps the taskbar entry, but users
with long-running chats expect closing the window to keep the app available —
either minimized in the taskbar or resident in the system tray. Different
users want different defaults, and a fixed close-to-tray behavior would
surprise users who expect close to quit.

The app has no tray, no close interception, and no user-facing choice for
this lifecycle decision. macOS is out of scope: the native Dock lifecycle
(close keeps the app in the Dock, `activate` recreates the window) already
matches the desired behavior.

## Decision

1. Windows/Linux close behavior becomes a persisted, user-configurable
   preference with three values:
   - `ask` (default when unset): prompt on close until the user picks.
   - `tray`: closing the window hides it and keeps the app running under a
     system-tray icon; the tray menu restores the window or quits the app.
   - `quit`: legacy behavior — closing the window exits the app.
2. The first close with an unset preference shows a native modal dialog
   (main process) with Cancel / Close to tray / Quit. Picking a non-cancel
   option persists it; Cancel keeps the window open and leaves the
   preference unset.
3. The preference is stored by Electron main in
   `<data>/close-behavior.json` (same ownership pattern as
   `window-state.json`), NOT in host-core settings: it is app-shell
   lifecycle state, read and written only by the main process, and needs no
   host RPC or schema change.
4. Two additive IPC channels expose it to the renderer:
   `pi-desktop/window/closeBehavior/get` (returns `{ behavior, supported }`)
   and `pi-desktop/window/closeBehavior/set`. `supported` is `false` on
   macOS, where the Settings row is hidden.
5. Settings (General tab) renders a three-option radio segment — Ask every
   time / Close to tray / Quit app — for Windows/Linux only. Changing it
   applies immediately and reconciles the tray icon: switching to `tray`
   creates the icon, switching away destroys it.
6. The close handler intercepts `close` only when `tray` exists or the
   preference is `ask`; `before-quit` (`quitting`) and macOS closes always
   fall through, so an explicit quit, the tray Quit item, and the automated
   boot probe are unaffected. `window-all-closed` quits only when no tray
   exists, keeping the app alive when the window is tray-hidden or
   destroyed unexpectedly.
7. The bounds watchdog (`ensureStableBounds`) skips minimized and hidden
   windows, so minimize always stays minimized and a tray-hidden window is
   never force-restored by the Stage-Manager shelf recovery.
8. Known limitation: on Windows system shutdown/logoff, the OS may deliver
   a `close` that is intercepted while the preference is `ask` or `tray`.
   Windows force-terminates the session after its shutdown timeout, so no
   data is lost, but shutdown is not accelerated by the app.

## Alternatives considered

- **Store the preference in host-core settings (`AppSettings`):** rejected
  because it would add a Rust schema field and host RPC surface for pure
  shell lifecycle state that only Electron main consumes.
- **Renderer-drawn first-close dialog:** rejected because the window is
  closing; a native modal keeps the decision in the process that owns the
  close lifecycle and works before the renderer has mounted.
- **Always close-to-tray without a choice:** rejected — it changes the
  meaning of the close button for users who expect exit.
- **Tray icon always present:** rejected; without tray behavior the icon is
  dead weight, so it is created lazily and reconciled with the preference.

## Consequences

- Minimize always keeps the taskbar/dock entry (native minimize).
- Close on Windows/Linux either hides to tray or quits, per user choice,
  remembered across launches and changeable in Settings.
- The tray menu and the first-close dialog reuse the existing
  `@pi-desktop/i18n` catalogs (English and Simplified Chinese).
- No host protocol, storage schema, or macOS behavior changes.
