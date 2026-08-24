# ADR 0117: Preserve the Windows taskbar entry for native minimize

- Status: Accepted
- Date: 2026-08-24
- Deciders: PI-Desktop core
- Related: D216, D252, E2E-124, ADR 0078

## Context

The tray-resident minimize decision in D216 hides the main window from the
operating system's window list. On Windows, clicking the taskbar button of the
focused window is a native minimize/restore toggle. Electron reports the
minimize half of that toggle through the main window's `minimize` event. The
current handler then calls `window.hide()`, which removes the taskbar entry and
leaves only the tray icon as a restore path.

## Decision

1. On Windows, the main window's native `minimize` event is not converted to
   `window.hide()`. The OS completes the minimize, so the main window remains
   represented by its taskbar entry.
2. The renderer-drawn Windows minimize button and the Windows native-menu
   minimize action continue to call the explicit tray-resident hide path. The
   macOS/Linux native minimize event behavior remains tray-resident.
3. The existing restore path continues to restore and focus the same window.
   Clicking the taskbar entry while the window is merely covered therefore
   keeps its existing bring-to-front behavior; no new IPC, storage, or host
   protocol contract is needed.

## Consequences

- Windows has an intentional distinction between an OS taskbar toggle and an
  explicit in-app minimize action.
- A Windows taskbar-minimized window remains reachable from the taskbar, while
  explicit tray-hidden windows remain reachable from the resident tray icon.
- Background work and window bounds persistence are unchanged.
