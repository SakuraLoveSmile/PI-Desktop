# 06. Settings Information Architecture

## 1. Settings root (Codex full-page shell)

Settings is a **full-window page** that replaces the app sidebar + main chrome (Codex electron behavior):

- Left settings rail only (sidebar surface `#f4f4f4` light / `#000` dark), **~275px** (Codex gold at 1200-wide)
- Top of rail: traffic-light clearance, **Back to app** (`返回应用`), pill **Search settings…**
- The 46px top band across both the rail and content pane is a native window
  drag region; interactive controls remain explicitly non-draggable
- A compact navigation directory with icons, in this exact order:
  1. **Basics**
  2. **Model configuration**
  3. **Import**
  4. **Project archive**
  5. **Info**
- No additional settings destinations or placeholder navigation rows are shown
- Main content pane on primary surface with large section title + elevated
  rounded cards of rows. Its content uses the full width available after the
  fixed rail and pane gutters, and resizes continuously with the window.

## 2. Section contents

### Basics
- **Appearance** card:
  - theme system/light/dark (select + theme cards)
  - native select triggers and their opened option lists use the active theme's
    readable foreground/background pairing on macOS, Windows, and Linux
- Permission defaults, file-open target, language override, menu-bar behavior,
  and bottom-panel behavior are not rendered until their host-backed settings
  schemas and runtime effects exist.

### Model configuration (`agent` tab)
- **Studio hero**: provider count, ready count, and current default provider/model summary
- **Defaults** card:
  - default mode via segmented control (Agent / Chat)
  - default model id
  - Enter to send as a switch (local preference; not on Codex General gold)
- **Providers** studio:
  - OpenAI-compatible add-provider dialog (opened from Add provider / empty-state CTA)
  - provider cards with avatar initials, host, default model, secret status, thinking mode, and test / make-default / delete actions
  - empty state with primary add action
  - API keys are never shown raw after save

### Import
- Scan supported local agent stores and review candidates through
  `SessionImportPanel`
- Source and project-path grouping behavior follows
  [08-component-spec §18](08-component-spec.md#18-sessionimportpanel)

### Project archive
- Reuses the durable Projects index as a settings-scale management surface
- Always includes archived records and keeps archived rows visually muted
- Supports project search, add, activate, project-session expansion, pin,
  archive/restore, and close
- Activating a project or project session returns to chat; archive and close
  actions keep Project archive open even when the active workspace changes

### Info
- app/host/protocol versions + open logs
- Updates row with the current delivery state and one applicable action:
  Check for updates, View release, or Restart to update

## 3. Navigation rules

- Profile footer / command palette open Settings full page (default Basics)
- Composer model menu and provider setup actions deep-link to the Providers
  card inside Agent
- Plugin management remains available from the app shell's independent
  **Plugins** destination, including load, enable, disable, and uninstall; it is
  not duplicated in Settings
- Project archive is indexed by Settings search and is not duplicated as a home
  sidebar destination or standalone global-search page
- Back to app returns to chat shell

## 4. Acceptance

1. Opening Settings hides the coding app sidebar (full-page takeover)
2. Rail shows search + back and exactly Basics, Model configuration, Import,
   Project archive, and Info in that order
3. Appearance is part of Basics and has no standalone rail destination
4. Providers is part of Agent and has no standalone rail destination
5. Plugins has no Settings destination; the app-shell Plugins page supports
   load, enable, disable, and uninstall
6. Basics shows only the host-backed Appearance card
7. Provider secrets never display raw key values
8. Model configuration shows the provider studio (hero + defaults + add dialog + cards) rather than a dense always-on form dump
9. Row descriptions use semantic secondary text and maintain at least 4.5:1
   contrast against their card surface in both light and dark themes
10. Dragging the empty top band from either side of Settings moves the native
   window without blocking Back, search, or navigation controls
11. Resizing the window expands or contracts the content cards with the
    available content pane; the fixed rail and pane gutters remain intact and
    the page does not gain horizontal overflow
12. Project archive always exposes archived records and can restore them without
    duplicating the index in the app shell
13. Info renders disabled, checking, up-to-date, available, downloading,
    downloaded, and error update states without adding another destination
14. Native select option lists remain readable in both light and dark themes,
    including when Chromium delegates the opened list surface to Windows

## 5. Basics chrome metrics

The shell retains the Codex gold chrome while allowing the content pane to use
the current window width:

| Token | Value |
|---|---|
| Rail width | ~275px |
| Rail light bg | `#f4f4f4` |
| Active nav pill | denser 6px/10px pad, ~8px radius, gray mix on rail |
| Section title | 28px / 560, first baseline ~y70 |
| Content width | Full available pane width after rail and gutters |
| Card radius | ~14px elevated stroke |
| Toggle | **32×20** thumb 16, accent blue on (not green) |
| Open-target pill | leading VS Code glyph |
