# ADR 0072: Add a global plugin launcher

- Status: Accepted for implementation
- Date: 2026-08-11
- Deciders: PI-Desktop core
- Related: D211 · [Settings IA](../spec/04-ux/06-settings-ia.md) ·
  [Interaction patterns](../spec/04-ux/09-interaction-patterns.md) · E2E-120

## Context

Installed plugin panels are reachable from the Plugins destination, but opening
one interrupts the user's current work and requires pointer navigation. A
system-wide shortcut needs a dedicated native window: the normal renderer
cannot receive keys while PI-Desktop is unfocused, and the existing plugin panel
host should remain the only authority that opens plugin UI.

Chinese plugin names also need useful keyboard search without requiring an
author to add aliases to every manifest.

## Decision

1. Add the shared, customizable `openPluginLauncher` shortcut, defaulting to
   `Alt+Space`. Electron renders it as Option+Space on macOS and Alt+Space on
   Windows/Linux and registers it with `globalShortcut` after application boot.
   The focused main window also intercepts Alt+Space so Windows still works when
   the operating system declines the global registration.
2. Electron main owns one lazy, centered, frameless 620×440 utility window on
   the display nearest the pointer. It is non-resizable, absent from the
   taskbar, always on top while visible, and hides on blur or Escape. macOS uses
   a panel window visible across workspaces; no platform receives native window
   controls.
3. The sandboxed launcher renderer uses the existing preload and the additive
   Electron-only toggle, dismiss, and shown channels. It lists plugins through
   the existing plugin API and opens a result through the existing sandboxed
   panel host; no plugin permission or host-core boundary changes.
4. Only enabled, ready plugins with a panel are candidates. Search normalizes
   name, id, and description and derives tone-free full pinyin and pinyin
   initials from the display name. Up/Down selects, Enter or click opens, Escape
   dismisses, and IME composition never dispatches.

## Consequences

- A plugin panel can be opened without navigating away from the current task.
- The shortcut remains visible and resettable in Settings → Shortcuts.
- `pinyin-pro` is bundled into renderer output rather than shipped as a runtime
  package tree.
- An unavailable global chord is logged; the focused Windows fallback remains
  usable, but another application or OS reservation can still prevent a truly
  global invocation.
- The IPC additions are Electron-local and additive; protocol v9 and storage
  schema v11 do not change.

## Alternatives considered

### Reuse global search

Rejected. Global search is part of the main renderer and cannot appear while
the application is unfocused without first restoring the entire main window.

### Open plugins directly from a native menu

Rejected. A static menu cannot provide Chinese/pinyin fuzzy search and would
need to be rebuilt for every plugin lifecycle change.

### Put pinyin aliases in plugin manifests

Rejected. It makes search quality depend on every plugin author and duplicates
data that can be derived consistently at query time.
