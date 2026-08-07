# 07. UI Design System

## 1. Goals

1. Provide a **single source of truth** for visual tokens, component foundations, and layout metrics across PI-Desktop
2. Ensure **high readability and contrast** in both light and dark themes — this is a developer workstation, not a marketing surface
3. Map all design decisions to **Tailwind CSS tokens** so that spec → implementation is unambiguous
4. Enable **future shadcn-like primitive extraction** without re-specifying foundations

## Visual baseline (Codex-aligned)

The desktop shell targets a 1:1 visual match with the local Codex desktop client (ChatGPT.app electron-dark): charcoal surfaces (`#181818`), neutral gray scale (not blue-slate), ~275px sidebar, 46px toolbar rhythm, and a floating pill composer. Semantic token names remain stable; values follow the Codex gray system with a **neutral gray accent** (no blue brand accent).

## 2. Non-goals

1. A consumer-brand identity system with vibrant gradients or playful illustrations
2. A full component library spec (that is [08-component-spec.md](08-component-spec.md))
3. Custom font services or CDN font hosting — use local bundling
4. Complex theme marketplace or user-customizable color palettes (MVP: system/light/dark only)
5. Pixel-perfect Figma handoff artifacts

## 3. Visual principles

| Principle | Application |
|---|---|
| **Clarity over decoration** | No ornamental borders, gradients, or hero images. Every visual element carries information. |
| **Developer density** | Compact spacing, small-but-readable type, minimal marketing whitespace. Information-rich, not sparse. |
| **Dark-base defaults** | Dark theme is the primary theme for a coding agent. Light must be fully supported but is secondary. |
| **Restraint** | One accent color family. No rainbow status colors — use semantic token names (success, warning, error). |
| **Motion as feedback** | Animations convey state change (streaming, loading, expand/collapse). Never decorative. |
| **Keyboard-first** | Focus rings, tab order, and shortcut labels are primary UX, not afterthoughts. |

### 3.1 Text selection

PI-Desktop behaves like a desktop application shell, so accidental drag
selection is suppressed for chrome by default. The selection contract is:

- Navigation, titlebar chrome, buttons, labels, badges, menus, and other
  controls are not text-selectable.
- `input`, `textarea`, `select`, and editable content remain selectable so
  users can edit drafts, search, and use native `Cmd/Ctrl+A/C/V` behavior.
- Transcript message bodies, rendered Markdown, code blocks, and tool
  input/output remain selectable for copy and inspection.
- New document-like surfaces must opt into the shared `.selectable` class (or
  an equivalent explicit `user-select: text` rule).
- The Electron renderer sets both `user-select` and `-webkit-user-select`;
  selection rules must not remove focus-visible rings or window drag regions.
- Copyable selection paint uses the monochrome accent contract via
  `::selection` (`color-mix` of `--ds-text-primary` at ~18% over the surface,
  text remains `--ds-text-primary`). Browser-default blue highlights are not
  allowed on shell surfaces.
- `caret-color` and `accent-color` resolve to `--ds-text-primary` /
  `--ds-accent` so native carets and form accents stay on-theme.
- Focus-visible rings use `color-mix(in oklab, var(--ds-accent) 80%, transparent)`
  (no white wash that drifts off the neutral ramp).

### 3.2 Locale-aware chrome labels

Section labels that use Latin micro-style (`text-transform: uppercase` +
`letter-spacing: wide`) must relax under `:lang(zh-CN)`:

- `letter-spacing` returns to `--tracking-normal`
- `text-transform` is `none` (CJK has no case and wide tracking splits glyphs)

Applies to sidebar section labels, settings rail group labels, destination
section labels, and keyboard-shortcut group labels.

### 3.3 Product identity and marks

The visible product identity is **PI-Desktop**, even where the shell borrows
Codex as a visual reference. The identity contract is deliberately small:

- The sidebar shell name, settings copy, and composer placeholder use
  `PI-Desktop`; `Codex` is reserved for the external session-import source or
  historical design-reference text.
- `build/icon_1024.png` is the canonical logo. `BrandLogo` imports it through
  Vite so the renderer bundle, development Dock, and packaged application all
  use the same visual asset.
- On macOS, both development and packaged launches expose `PI-Desktop` as the
  native application-menu name. The native About panel uses the PI-Desktop
  name, version, and canonical icon; no stock Electron name or icon is visible.
  Development launches use a generated branded host bundle because AppKit
  reads this identity from the host bundle rather than Electron runtime APIs.
- On Windows, Electron Main registers the canonical `com.pi-desktop.app`
  AppUserModelID before readiness. The runtime ID, packaged executable name,
  and NSIS shortcut identity stay aligned so native notifications,
  notification settings, and taskbar groups identify the app as `PI-Desktop`
  rather than Electron.
- The home hero logo is 40px. Expanded/collapsed sidebar logos are 20px/18px.
  Composer prompt rows do not render a leading brand icon in either home or
  thread-docked mode. The image keeps its native colors in both themes and is
  not replaced by a theme-tinted vector approximation.
- New-session controls use the dedicated message-plus icon at 15–16px. The
  generic plus icon remains reserved for non-session additions such as adding
  a project.
- Marks are decorative (`aria-hidden`); the surrounding controls provide the
  localized accessible names and keyboard behavior.

## 4. Color tokens

### 4.1 Semantic token naming

All color references in components use **semantic token names**, never raw hex values.

```text
--color-bg-primary        → main background (chat area, panels)
--color-bg-secondary      → sidebar, cards, nested surfaces
--color-bg-tertiary       → hover states, elevated surfaces
--color-bg-inset          → code blocks, inset areas
--color-text-primary      → main body text
--color-text-secondary    → secondary/label text
--color-text-muted        → disabled, placeholder, hint
--color-border-default    → default borders
--color-border-subtle     → subtle separators (divider lines)
--color-accent            → primary accent (CTA, active states)
--color-accent-hover      → accent hover
--color-success           → success/run states
--color-warning           → warning/caution states
--color-error             → error/denied states
--color-info              → informational states
```

### 4.2 Dark theme (primary)

| Token | Hex | Tailwind mapping | Usage |
|---|---|---|---|
| `--color-bg-primary` | `#181818` | Codex `gray-900` | Main surface |
| `--color-bg-sidebar` / under | `#000000` (dark) / `#f3f3f3` (light) | Codex `surface-under` / gray-75 | Sidebar rail |
| `--color-bg-secondary` | `#212121` | Codex `gray-800` | Elevated surfaces, composer |
| `--color-bg-tertiary` | `#282828` | Codex `gray-750` | Hover / opaque elevated |
| `--color-bg-inset` | `#0d0d0d` | Codex `gray-1000` | Code blocks, deepest inset |
| `--color-text-primary` | `#FFFFFF` | Codex `gray-0` | Body text |
| `--color-text-secondary` | `rgba(255,255,255,0.70)` | Codex secondary | Labels, secondary |
| `--color-text-muted` | `#5d5d5d` | Codex `gray-500` | Disabled, hints |
| `--color-border-default` | `rgba(255,255,255,0.08)` | Codex border | Default borders |
| `--color-border-subtle` | `rgba(255,255,255,0.05)` | Codex border subtle | Subtle separators |
| `--color-accent` | `#FFFFFF` (dark) / `#1a1c1f` (light) | inverted gray ink | Primary accent, CTA |
| `--color-accent-hover` | `#EDEDED` (dark) / `#303030` (light) | gray-100 / gray-700 | Accent hover |
| `--color-accent-soft` | `#AFAFAF` (dark) / `#5d5d5d` (light) | gray-300 / gray-500 | Soft accent, links |
| `--color-success` | `#22C55E` | `text-green-500` | Success, run complete |
| `--color-warning` | `#F59E0B` | `text-amber-500` | Warning, caution |
| `--color-error` | `#EF4444` | `text-red-500` | Error, denied |
| `--color-info` | `#6366F1` | `text-indigo-500` | Informational |

### 4.3 Light theme (Codex electron-light)

Neutral gray scale only — no blue-slate surfaces. Chrome components must consume semantic `--ds-*` tokens so light ink stays dark on `#f3f3f3` / `#ffffff`.

| Token | Hex / value | Usage |
|---|---|---|
| `--color-bg-primary` | `#ffffff` | Main surface |
| `--color-bg-secondary` / sidebar | `#f3f3f3` (gray-75) | Sidebar surface |
| `--color-bg-tertiary` | `#f3f3f3` | Nested / hover base |
| `--color-bg-inset` | `#ededed` (gray-100) | Code blocks, inset |
| `--color-text-primary` | `#1a1c1f` | Body + brand |
| `--color-text-secondary` | `color-mix(#1a1c1f 70%, transparent)` | Nav items, chips, thread titles |
| `--color-text-muted` | `#5d5d5d` (gray-500) | Section labels |
| `--color-text-faint` | `#afafaf` (gray-300) | Placeholder |
| `--color-border-default` | `color-mix(#1a1c1f 8%, transparent)` | Default borders |
| `--color-border-subtle` | `color-mix(#1a1c1f 5%, transparent)` | Sidebar edge / dividers |
| `--color-accent` | `#1a1c1f` | Primary accent, CTA, footer badge (neutral ink) |
| `--color-success` / warning / error | green-500 / orange-500 / red-500 | Status |

**Invariant:** never paint chrome text with raw `gray-0` (`#fff`) under `data-theme="light"`. Use `--ds-text-primary` / `--ds-text-secondary`.

Shared buttons must use semantic theme tokens for both their surface and ink:
primary actions pair `--ds-accent` with `--ds-bg-primary`, while secondary
actions use the opaque `--ds-bg-secondary` surface with primary text and a
visible semantic border. Hover states use the corresponding accent/tertiary
tokens rather than opacity-only changes, so actions remain legible in dark
and light themes.

Light-surface polish (D148):

- Docked work panel uses quiet inset paper (`#fafafa`) with a white header band and a combined create trigger in the header so the tool column stays on content without a heavy divider.
- Shared form fields, browser URL, settings segment tracks, and shortcut keycaps use `#f5f5f5` inset fills with a 0.5px ink stroke; focus lifts to white with a neutral ring.
- Settings toggles keep a near-black on-track and force a white knob in light mode.
  Off/on track and knob colours come from the `--ds-switch-*` theme tokens; a
  per-theme `:root[data-theme="…"] .settings-toggle` background override
  out-specifies `.settings-toggle.on` and strands the on-state on the off fill.
- Switch off-state carries a dim fill plus a 1px inset ring so an empty track
  still reads as a control; the dark-theme off knob stays light (`--gray-300`)
  so the knob does not disappear into the track.
- Dialog scrim softens to ~28% ink so elevated white dialogs remain readable.

### 4.4 System theme behavior

- `system` theme follows `prefers-color-scheme` media query
- Transition between themes must not flash white when switching to dark on launch
- Initial load: detect system preference before first paint (Electron preload can relay this)
- Native controls inherit the active `color-scheme`. Opened Settings select
  lists also set opaque semantic foreground/background colors explicitly so
  Windows Chromium does not fall back to an unreadable system palette.

### 4.5 Sidebar task status semantics

Compact task rows reserve one `12px` leading status slot. State is never
communicated by color alone, and each status consumes an existing semantic
token rather than introducing a decorative palette:

| State | Semantic color | Shape / motion | Meaning |
|---|---|---|---|
| Selected | neutral accent | static outlined ring | current conversation |
| In progress | warning orange | filled dot with a restrained breathing pulse | agent is producing or executing |
| Completed | success green | check mark | latest unread task turn completed |
| Failed | error red | circled alert mark | latest unread task turn failed |

Precedence is `in progress → selected → completed/failed`. Starting another
turn clears the prior terminal outcome; abort clears the live indicator without
creating a failure. Opening a conversation acknowledges its unread terminal
outcome: the terminal mark clears immediately and the matching durable task
notification is marked read so the mark cannot return after a notification
refresh or app restart. Outcomes already marked read never produce a terminal
mark. Reduced-motion mode disables the breathing animation while retaining its
orange fill and localized accessible name.

### 4.6 Tailwind CSS variable stub

The following CSS custom properties stub is the canonical bridge between spec tokens and Tailwind classes. It is **not an app source file** — it documents the intended mapping for implementation.

```css
/* === Design System Token Bridge (spec reference, not runtime file) === */
/* Dark theme (default) */
:root[data-theme="dark"] {
  --color-bg-primary:       #181818;
  --color-bg-secondary:     #212121;
  --color-bg-tertiary:      #282828;
  --color-bg-inset:         #0d0d0d;
  --color-text-primary:     #FFFFFF;
  --color-text-secondary:   rgba(255,255,255,0.70);
  --color-text-muted:       #5d5d5d;
  --color-border-default:   #282828;
  --color-border-subtle:    #212121;
  --color-accent:           #FFFFFF;
  --color-accent-hover:     #EDEDED;
  --color-success:          #22C55E;
  --color-warning:          #F59E0B;
  --color-error:            #EF4444;
  --color-info:             #6366F1;
}

/* Light theme */
:root[data-theme="light"] {
  --color-bg-primary:       #FFFFFF;
  --color-bg-secondary:     #FFFFFF;
  --color-bg-tertiary:      #F1F5F9;
  --color-bg-inset:         #F1F5F9;
  --color-text-primary:     #181818;
  --color-text-secondary:   #475569;
  --color-text-muted:       #94A3B8;
  --color-border-default:   #E2E8F0;
  --color-border-subtle:    #F1F5F9;
  --color-accent:           #1a1c1f;
  --color-accent-hover:     #303030;
  --color-success:          #16A34A;
  --color-warning:          #D97706;
  --color-error:            #DC2626;
  --color-info:             #4F46E5;
}

/* Tailwind v4 theme extension (in tailwind config) */
/* Maps semantic tokens to utility classes */
/*
@theme {
  --color-bg-primary:    var(--color-bg-primary);
  --color-bg-secondary:  var(--color-bg-secondary);
  --color-bg-tertiary:   var(--color-bg-tertiary);
  --color-bg-inset:      var(--color-bg-inset);
  --color-text-primary:  var(--color-text-primary);
  --color-text-secondary: var(--color-text-secondary);
  --color-text-muted:    var(--color-text-muted);
  --color-border-default: var(--color-border-default);
  --color-border-subtle:  var(--color-border-subtle);
  --color-accent:        var(--color-accent);
  --color-accent-hover:  var(--color-accent-hover);
  --color-success:       var(--color-success);
  --color-warning:       var(--color-warning);
  --color-error:         var(--color-error);
  --color-info:          var(--color-info);
}
*/
```

Implementation note: Tailwind v4 supports CSS-first configuration. The `@theme` directive maps custom properties to utility classes (`bg-bg-primary`, `text-text-primary`, etc.). Implementation should validate naming to avoid double-prefix collision (e.g., `bg-bg` is awkward — consider aliasing to `bg-primary`, `text-primary` etc. at the Tailwind level).

## 5. Typography

### 5.1 Font stacks

| Role | Primary | Fallback stack | Tailwind |
|---|---|---|---|
| **UI (sans)** | Inter | `system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif` | `font-sans` |
| **Code (mono)** | JetBrains Mono | `"Fira Code", ui-monospace, "Cascadia Code", "SF Mono", Menlo, Consolas, "DejaVu Sans Mono", monospace` | `font-mono` |

### 5.2 Type scale

All font sizes come from the `--text-*` ramp defined in the `@theme` block of `styles/tokens.css` (imported first by `styles/globals.css`, which is now only an import sequence — see D170). Raw px literals for `font-size`, `font-weight`, `line-height`, and `letter-spacing` are **forbidden** in component CSS and TSX arbitrary utilities (`text-[13px]` etc.) — enforced by `scripts/check-style-tokens.mjs` (runs in `pnpm lint`). `-plus` suffixed tokens are the Codex half-steps between named sizes.

| Token | Size | Usage |
|---|---|---|
| `--text-3xs` | 10.5px | Smallest chrome (kbd hints) |
| `--text-xs` (alias `--text-2xs`) | 11px | Timestamps, badges, tool status |
| `--text-xs-plus` | 11.5px | Muted metadata, menu subtitles |
| `--text-sm` | 12px | Secondary labels, tool rows, sidebar section labels |
| `--text-sm-plus` | 12.5px | Chips, working indicator, code text |
| `--text-md` | 13px | Sidebar session/project titles, empty-state copy, compact chrome |
| `--text-md-plus` | 13.5px | Composer labels, list rows |
| `--text-base` | 14px | Body text, chat messages, input, primary sidebar chrome |
| `--text-base-plus` | 15px | Brand, prominent labels |
| `--text-lg` | 16px | Section headers, card titles |
| `--text-lg-plus` | 18px | Large card titles |
| `--text-xl` | 20px | Page-level emphasis |
| `--text-2xl` | 28px | Destination page titles, home hero |

Line-height tokens: `--leading-none` 1, `--leading-heading` 1.15, `--leading-tighter` 1.2, `--leading-tight` 1.25, `--leading-compact` 1.3, `--leading-compact-plus` 1.35, `--leading-normal` 1.4, `--leading-body` 1.45 (app default), `--leading-relaxed` 1.5, `--leading-chat` 1.55, `--leading-prose` 1.6, `--leading-row` 18px (fixed-height sidebar rows).

Letter-spacing tokens: `--tracking-tighter` −0.03em, `--tracking-tight` −0.02em, `--tracking-normal` 0, `--tracking-wide` 0.02em.

> Note: 14px base is intentional for developer-density. Do not bump to 16px default.
>
> Sidebar primary chrome (nav items, New task, footer identity, profile menu
> actions) uses `--text-base` so the left rail matches main body readability.
> Session titles, project/group titles, and empty-state copy use the compact
> `--text-md` tier; only section labels and secondary metadata use `--text-sm`.
> Never use the micro `--text-xs` band for primary list content.

### 5.3 Code text sizing

- Code blocks and tool output: `--text-sm`/`--text-sm-plus` with `font-mono`
- Inline code within messages: `--text-sm-plus` `font-mono`, soft text-tint background, borderless, rounded
- Chat prose (`.prose-chat`) uses `--text-base` / `--leading-prose` for body, with a heading ramp of `text-xl` → `text-lg-plus` → `text-lg` → `text-base-plus` → `text-base` so multi-block answers stay scannable without document-scale drama. Headings carry no rules/borders (hierarchy comes from size, weight, and space above); links keep a soft permanent underline that firms up on hover instead of relying on color alone; blockquotes are a quiet 2px left rail without a background fill

### 5.4 Weight rules

Weights use `--font-weight-*` tokens only (Codex uses variable-font intermediate weights):

- `--font-weight-normal` 400: default body/label text
- `--font-weight-medium` 500: emphasis, chips, row titles
- `--font-weight-medium-plus` 520: select Codex chrome labels
- `--font-weight-strong` 560: destination page titles (Codex electron metric)
- `--font-weight-semibold` 600: brand, CTA buttons
- Never use 700+

## 6. Spacing, radius, elevation, borders

### 6.1 Spacing scale

| Token | Value | Usage |
|---|---|---|
| `space-0.5` | 2px | Tight inline gaps |
| `space-1` | 4px | Icon-text gaps, badge padding |
| `space-1.5` | 6px | Compact inner padding |
| `space-2` | 8px | Standard inner padding, list gaps |
| `space-3` | 12px | Card inner padding, section gaps |
| `space-4` | 16px | Section margins, composer padding |
| `space-6` | 24px | Panel gaps, major separations |
| `space-8` | 32px | Page-level margins (rare) |

### 6.2 Radius scale

All radii come from `--radius-*` tokens (raw px forbidden, same guard as typography):

| Token | Value | Usage |
|---|---|---|
| `--radius-3xs` | 5px | Inline code |
| `--radius-2xs` | 6px | Small inline chips |
| `--radius-xs` | 7px | Compact buttons, copy buttons |
| `--radius-sm` | 8px | Menu items, tool rows, kbd |
| `--radius-md` | 10px | Buttons, inputs, menus |
| `--radius-md-plus` | 12px | Cards, code blocks, dialogs |
| `--radius-lg` | 14px | Panels, settings cards |
| `--radius-lg-plus` | 16px | Large panels |
| `--radius-xl` | 18px | Message bubbles |
| `--radius-2xl` | 22px | Composer-adjacent large surfaces |
| `--radius-full` | 9999px | Pills, badges, scroll thumbs |
| `--radius-round` | 50% | Circular buttons, avatars, dots |

### 6.3 Elevation / shadows

Dark theme: elevation is expressed via **background surface layering** (bg-secondary → bg-tertiary), not box-shadow.

Light theme: minimal shadows only where layering is insufficient.

| Level | Dark | Light | Usage |
|---|---|---|---|
| `elevation-0` | flat (bg-primary) | flat (bg-primary) | Default surface |
| `elevation-1` | bg-secondary | bg-secondary + `shadow-sm` | Cards, sidebar |
| `elevation-2` | bg-tertiary | bg-tertiary + `shadow-md` | Hover, dropdowns |
| `elevation-3` | bg-tertiary + border-accent | bg-white + `shadow-lg` | Dialogs, overlays |

Sidebar footer (D113): a transparent `58px`-high band with no separator. The
left profile trigger is `44px` high and flexes to fill the available width. It
contains a `30px` circular user glyph, a two-line identity stack (`Custom` at
the primary text size and `Local profile` / localized equivalent as muted
metadata), and a trailing chevron. The notification inbox trigger is a separate
`32px` square Bell icon button on the right, carries the unread badge, and opens
its popover above the footer. Hover and active
states use semantic sidebar surfaces; neither control adds a persistent card
fill.

The profile menu is `280px` wide, opens `8px` above the footer, and uses the
standard opaque elevated-menu surface, subtle border, and dialog shadow. Its
first block repeats the local identity with the same glyph and two-line text,
followed by a divider and compact Settings / Logs / Theme rows.

Toolbar rows are 46px. macOS places traffic lights at `{x:16,y:16}` and keeps
the expanded sidebar's Search and Collapse sidebar icon buttons right-aligned
in that same row. The macOS row omits the sidebar logo/title, reserves `76px`
on the left for native chrome in windowed mode, and reclaims that padding in
fullscreen. Windows/Linux keep the identity and sidebar actions in their first
row and reserve the rightmost 112px for three frameless-window controls. Each
control owns its full share of the 46px-high reserved band. Main, Settings, and
work-panel drag regions must terminate before this reservation rather than
overlap it and rely only on descendant `no-drag`, so every visible control
pixel remains clickable. The band floats over the destination pages, so on
Windows/Linux a page frame and any right-edge detail sheet start below it
instead of placing their own header actions or close control under the window
controls. No application menu is rendered inside the window.
Other menu popovers use the standard opaque elevated-menu surface, `radius-sm`,
subtle border, and dialog shadow; they are never translucent over readable
content.

Composer elevation (Codex `elevation-prominent`):

- stroke: `0 0 0 0.5px` border-heavy mix
- soft: `0 3px 7.5px rgba(0,0,0,0.039)` + `0 0 20px rgba(0,0,0,0.051)` (Codex `#0000000a` / `#0000000d`, both themes)

Shadow token values (light theme only):

```text
shadow-sm:  0 1px 2px rgba(0,0,0,0.05)
shadow-md:  0 2px 8px rgba(0,0,0,0.08)
shadow-lg:  0 8px 24px rgba(0,0,0,0.12)
```

### 6.4 Border rules

| Context | Token | Width | Style |
|---|---|---|---|
| Default separators | `border-subtle` | 1px | solid |
| Card outlines | `border-default` | 1px | solid |
| Focus rings | accent color | 2px | solid, offset 2px |
| Active/pressed | accent color | 1px inset | solid |

## 7. Iconography

### 7.1 Icon set

- **Primary:** Lucide (SVG, MIT license, 24×24 default grid)
- **Alternative:** Heroicons v2 (outline variant)
- Never mix both in the same surface — pick one per implementation file
- **Never use emoji as icons** — emoji are text content, not UI affordances

### 7.2 Sizing

| Context | Size | Stroke width |
|---|---|---|
| Inline with text | 16px (1rem) | 1.5px |
| Buttons, toolbar | 20px (1.25rem) | 2px |
| Empty states | 48px (3rem) | 1.5px |

### 7.3 Color rules

- Default: `text-secondary`
- Hover/active: `text-primary`
- Accent actions: `accent` color
- Disabled: `text-muted`
- Never use colored icon backgrounds in buttons (no icon circles/squares)

## 8. Motion

### 8.1 Duration scale

CSS custom properties on `:root` (D146):

| Token | CSS variable | Duration | Usage |
|---|---|---|---|
| `duration-fast` | `--motion-duration-fast` | 150ms | Hover transitions, color changes |
| `duration-normal` | `--motion-duration-normal` | 200ms | Expand/collapse, slide-in, toast/dialog enter |
| `duration-slow` | `--motion-duration-slow` | 300ms | Panel transitions, boot splash enter |

Interactive surfaces should reference these variables instead of hard-coded
millisecond literals when practical.

### 8.2 Easing

CSS custom properties on `:root` (D146):

| Token | CSS variable | Curve | Usage |
|---|---|---|---|
| `ease-out` | `--motion-ease-out` | `cubic-bezier(0.22, 1, 0.36, 1)` | Default enter / hover / fill transitions |
| `ease-in` | `--motion-ease-in` | `cubic-bezier(0.4, 0, 1, 1)` | Exit animations (toast out, splash out) |
| `ease-standard` | `--motion-ease-standard` | `cubic-bezier(0.2, 0, 0, 1)` | Continuous progress indicators (boot bar) |

- Enter animations: `ease-out`
- Exit animations: `ease-in`
- Spring-like for drag/releases: **not in MVP** (use `ease-out`)

### 8.3 Startup splash (boot feedback)

While Electron bootstrap is not yet ready, the renderer paints a full-window
**startup splash** (`StartupSplash`, `data-testid="startup-splash"`) instead of
plain status text:

- Brand mark (`BrandLogo` 64px), shell name, and tagline from the active catalog
- Accessible status copy via `app.starting` (screen-reader only) with
  `role="status"` / `aria-live="polite"`
- Soft indeterminate progress bar as loading feedback (≤1.1s loop)
- Minimum visible time ~420ms on normal motion to avoid a flash on fast boots
- Exit: 280ms opacity fade (`startup-splash-out`) once `ready` is true, revealing
  the already-mounted shell underneath
- Reduced motion: near-zero enter/exit and a static full-width bar

This is boot-state feedback, not decorative chrome.

### 8.4 Overlay / floating surface enter

Dialogs, search spotlight, and modal backdrops use shared enter keyframes:

- Scrim: `overlay-in` (opacity, `--motion-duration-normal` / `--motion-ease-out`)
- Dark theme scrim stays ~45% black; light theme uses ~28% `#1a1c1f` so white
  dialogs do not sit under a heavy veil (D148)
- Centered surface: `surface-in` (fade + 8px rise + slight scale)
- Top-anchored surface (search): `surface-in-top`

Toast enter/exit keep the existing removal contract (`animationend` on
`toast-out`) while using the motion tokens and a slightly softer scale.

### 8.5 Reduced motion

All motion tokens must respect `prefers-reduced-motion: reduce`:

```css
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    transition-duration: 0.01ms !important;
  }
}
```

Boot splash, overlay/dialog enters, streaming pulse, and continuous bars are
also explicitly suppressed or collapsed to a static state.

> See also [09-interaction-patterns.md](09-interaction-patterns.md) §10.

### 8.6 Prohibited motion

- No parallax
- No continuous background animations (particles, waves)
- No shimmer/skeleton animations longer than 1s loop — use simple fade-in for loading states
- No bounce effects
- No multi-second boot theatrical sequences; splash exits as soon as ready (+ min dwell)

### 8.7 Responsive interaction feedback

High-frequency workstation feedback must remain compositor-friendly and bounded:

- Destination surfaces, the work panel, jump-to-latest control, and inline
  error notices enter once with `opacity` plus a maximum 8px
  `transform`/`scale` offset using `--motion-duration-normal` and
  `--motion-ease-out`.
- Icon, navigation, message-action, tab, and sidebar tool controls provide a
  subtle pressed scale while active. Hover styling never changes element
  dimensions or surrounding layout.
- Composer focus lifts by 1px with a restrained token-based shadow. Its
  near-opaque surface must not use backdrop blur: transcript updates beneath a
  blur layer would force avoidable repaint/compositing work while streaming.
- Inline chat error notices wrap long provider detail and keep their actions
  reachable without introducing horizontal page overflow.
- Stream-driven updates never restart route or shell animations. Every enter
  effect is mount/state-transition feedback, not a response to token arrival.
- Sidebar and work-panel dock transitions animate their allocated `width` and
  `flex-basis` together with the bounded opacity/transform offset. MainChat must
  reflow continuously during the 150–200ms transition, never jump to the final
  dock width before the first painted frame.
- Replaceable streamed message/tool partials may be coalesced until the next
  animation frame; terminal, permission, planning, and error states flush first
  and remain synchronous.
- Reduced-motion mode keeps every state change and scroll destination but uses
  near-zero animation durations and instant rather than smooth programmatic
  scrolling.

## 8.0 Home empty stack (scrollable flow, D111)

Empty composer placeholder: EN `Ask PI-Desktop to do anything` / zh-CN `向 PI-Desktop 下达任意指令`.

Empty chat home uses a **single scrollable vertical stack** inside
`home-main-content` (D111; supersedes the D047 dual-grow portal model):

- Column `flex: 1; min-height: 0; overflow: hidden`
- Inner scroller (`.home-scroll`) is the only vertical overflow surface
- Stack (`.home-stack-inner`) is `min-height: 100%`, content width
  **`min(100%, 768px)`**, **`gap: 16px`** (workstation ceiling), and centers
  the column when the viewport is tall
- Order is always: **hero → contextual quick actions → optional onboarding
  checklist → home composer**. The quick actions render as a compact ghost
  control row without a visible section heading; they prefill the home composer
  or open the project picker and never auto-submit a prompt. The former four
  marketing suggestion cards are not rendered (D131); the checklist remains in
  normal document flow
- Short windows (`max-height ≤ 760px`) top-align the stack and keep every
  block reachable by scrolling; the composer must not cover the checklist
- Composer is **not** absolute-docked on empty home; thread mode keeps the
  bottom dock and reserves its measured height without a full-width fade veil
- Composer radius uses Codex `radius-3xl-base` (**20px** / `1.25rem`)
- Empty-home composer height is content-driven: a one-line draft renders the
  compact shell, grows with the draft through seven visible rows, and then
  keeps the shell stable while the textarea scrolls internally
- Light **New task** control is a **ghost row** (transparent fill, hover wash
  only), not a solid chip
- Empty hero title uses `var(--ds-text-primary)` (light override `#1a1c1f`);
  never hardcode light ink for shared hero styles
- Empty-home branding stays quiet: the hero logo is 40px and the supporting
  welcome paragraph is omitted so the composer remains the visual focus
- Night home composer plate styles are **dark-scoped only** (elevated-primary
  `#212121f5` + standard elevation-prominent)
- Empty draft row keeps **one visible line / 28px optical minimum** so the
  placeholder remains visible; it auto-grows to seven visual lines and
  scrolls internally from line eight onward
- Home and thread-docked prompt rows stay free of leading brand icons so the
  draft aligns directly with the input gutter. Light placeholder ~`#525355`
- Disabled send is a **solid gray chip** (`#8e8e90` light, white arrow), not
  opacity-only fade
- Floating composer plates use one solid semantic surface with no internal
  gradient: `--ds-bg-composer` in light and elevated-primary in dark. A
  hairline stroke plus the restrained `--elevation-prominent` shadow provides
  separation; the transcript reserves the measured dock height instead of
  painting a full-width gradient veil.
- Dark elevated shell reads as elevated-primary (`#212121f5` / gray-800 96%)
  on `#181818` with standard elevation-prominent

## 8.1 Composer workspace chips (Codex parity)

The project / Local / branch controls share one context rail (not three
independent pills). The rail docks directly into the composer shell with no
visible gap, uses the same theme surface, and has no independent drop shadow
or bottom edge. Its rounded top corners, the shell outline, and the shell's
single elevation read as one immersive composite surface. Internal 1px
separators remain. On an empty home without a project the rail is omitted; it
appears on project home and in the thread-docked composer.

## 8.2 Composer runtime controls

The composer renders only controls connected to the active pi session:

- Agent / Plan updates the durable session mode and changes the next pi toolset;
  Plan is the same Agent in planning state.
- The model trigger shows only the active model ID. Its menu selects a
  configured provider/default-model pair for the active session and links to
  Agent.
- A reasoning-capable model exposes a separate Thinking trigger immediately to
  the right of Agent / Plan in the left toolbar group. The trigger shows the
  current level and opens the model's real `supportedThinkingLevels` as a
  compact single-column list with a check on the selected row. The menu fits its
  content, caps at 160px and the available viewport width, and truncates labels
  that exceed that cap. It contains only concrete supported levels, with no
  inherit/default row; models without reasoning support render no trigger.
- Runtime controls are disabled while the active session is running.
- File, photo, and appshot controls remain hidden until their payload contracts
  are implemented end to end.
- The Thinking menu persists changes to the active session and closes after a
  selection. It renders exactly the levels published by pi-ai for the selected
  model. Unknown Custom/OpenAI-compatible models expose no invented reasoning
  action or graded ladder. Changing provider clamps or resets the durable
  session value before the next turn.
- The left-of-input Composer Agent/Plan chip is the sole active-session mode
  control. The top bar has no duplicate mode segmented control. The model
  picker closes and is disabled while an active `pending` Plan approval exists;
  terminal proposal snapshots do not disable it. Each new pending proposal's
  explicit approval selector starts at Ask, regardless of the previous
  proposal's selected mode. Live Host events update the latest checkpoint or
  execution status retained for the current renderer lifetime. A renderer
  reload rehydrates only a pending row through `plans.pending`; terminal cards
  are not restored.
- Local and branch context are non-interactive status labels; the project name
  remains an action because it opens the project picker.
- Runtime chip labels (Agent/Plan, Thinking, permission mode, model ID) use
  `--text-sm` with `--leading-compact` inside the 28px hit target. They must not
  use `leading-none` with overflow clipping: descenders on glyphs such as
  `g`/`y`/`p` stay fully visible. Long model IDs still truncate horizontally via
  ellipsis without crushing the line box (D150).

## 8.3 Thinking disclosure

- Assistant thinking renders before the final answer as a lightweight inline
  disclosure aligned with tool activity rows: transparent transcript surface,
  Sparkles cue, rotating chevron, secondary text, and a subtle left rule only
  around expanded reasoning. It uses semantic theme and focus-ring tokens in
  light and dark modes; it must not introduce a separate inset card.
- The disclosure is open while a thinking-only response is streaming and may
  be toggled independently afterward.
- The trigger is a button with `aria-expanded`, `aria-controls`, and localized
  Show/Hide labels. Collapsed reasoning is hidden from focus and accessibility
  traversal; reduced-motion mode disables shimmer and disclosure transitions.
- Thinking never enters the answer bubble, answer copy action, transcript
  minimap excerpt, or searchable answer text.
- A thinking-only stream opens the transcript surface without an empty answer
  bubble or a duplicate Working indicator.


## 9. Z-index layers

| Layer | Z-index | Usage |
|---|---|---|
| `z-base` | 0 | Default content |
| `z-sticky` | 10 | Sticky headers, topbar |
| `z-dropdown` | 20 | Dropdown menus, select popovers |
| `z-overlay` | 30 | Tooltips |
| `z-dialog` | 40 | Settings and confirmation dialogs |
| `z-toast` | 50 | Toast notifications |
| `z-command-palette` | 60 | Command palette overlay, body-portaled menus/popovers |
| `z-devtools` | 100 | DevTools overlay (non-production) |

Rules:

- Never use `z-index: 9999` or similar arbitrary high values
- Each layer is a fixed offset; no custom z-index outside these layers
- Stacking within a layer uses DOM order, not higher z-values

## 10. Layout shell metrics

These metrics define the AppShell frame. See [08-component-spec.md](08-component-spec.md) for component detail.
Codex parity decisions (D034/D070) supersede any older value here.

| Metric | Value | Notes |
|---|---|---|
| Titlebar row height | 46px | Codex toolbar rhythm (D034); traffic lights {x:16,y:16} |
| Sidebar width (collapsed) | 48px | Icon-only rail |
| Sidebar width (expanded) | ~275px | Codex sidebar width (D034/D070) |
| Main pane minimum readable width | 360px | Target while the fixed window can fit panel + chat; constrained windows reflow chat below it (D163, ADR 0033) |
| Work panel width (closed) | 0px | Hidden by default |
| Work panel width (open) | `244px–720px` (default 280px), fixed at the committed width | the combined create trigger keeps the full panel width on content; the panel is an in-flow column and never expands the OS window (D154/D163, ADR 0033) |
| Composer shell minimum | ~80px | One-line draft + toolbar padding |
| Composer draft height | 1–7 text lines | Auto-grow; internal scroll beyond line 7 |
| Chat message max width | 720px assistant / 560px user plate | Prevent eye-span over-stretch; user turns stay compact |
| Window min width | 1040px | Enforced by Electron as the base chat-shell minimum; an open work panel reflows chat inside the fixed window and may reduce the chat pane below its 360px readability target |
| Window min height | 700px | Enforced by Electron |

An open work panel is a fixed-width in-flow column; it reflows MainChat and
never expands the OS window (ADR 0033). The renderer requests a native
reservation width of 0, so chat width changes by reflow only. The native
browser view follows the renderer-measured panel rect. Persisted normal bounds
are the user's window size. Before collapse motion starts, any native Browser
preview surface is detached because it cannot participate in renderer CSS
animation. Windows keeps the exiting dock opaque during its bounded slide so a
frameless native resize never exposes a full-panel background flash; macOS and
Linux retain the fade-and-slide exit.

### 10.1 Responsive collapse

- The work panel never participates in responsive collapse. It keeps its
  committed `244..720px` width (default 280px) while visible.
- Native window and sidebar changes reflow MainChat. The 360px chat target holds
  when the fixed window can fit panel + chat; otherwise chat reflows below it.
- Panel open/collapse/final close and divider commit update the committed
  preferred width. Native edges resize the window and reflow MainChat.
- Width < 1040px or height < 700px is unsupported and prevented by Electron.

## 11. Component foundations

These are **token-level foundations** for common primitives. Detailed component specs are in [08-component-spec.md](08-component-spec.md).

### 11.1 Button

| Variant | Padding | Height | Font | Radius | Border | Background |
|---|---|---|---|---|---|---|
| Primary | px-3 py-1.5 | 32px | text-sm 500 | radius-sm | none | accent |
| Secondary | px-3 py-1.5 | 32px | text-sm 400 | radius-sm | border-default | bg-secondary |
| Ghost | px-2 py-1 | 28px | text-sm 400 | radius-sm | none | transparent |
| Danger | px-3 py-1.5 | 32px | text-sm 500 | radius-sm | none | error |

### 11.2 Input / textarea

| Property | Value |
|---|---|
| Height (single-line) | 32px |
| Padding | px-3 py-1.5 |
| Font | text-sm font-mono (for composer); text-sm font-sans (for settings) |
| Border | 1px border-default; focus → 2px accent ring offset-2 |
| Background | bg-primary |
| Radius | radius-sm |
| Text correction (D145) | `spellCheck={false}`, `autoCorrect="off"`, `autoCapitalize="off"` on every text input/textarea |

### 11.3 Card

| Property | Value |
|---|---|
| Padding | p-3 |
| Border | 1px border-default |
| Radius | radius-md |
| Background | bg-secondary |
| Hover (interactive) | bg-tertiary, no shadow change |

### 11.4 Dialog / modal

| Property | Value |
|---|---|
| Max width | 480px |
| Padding | p-6 |
| Radius | radius-lg |
| Background | bg-secondary (dark); bg-white (light) + shadow-lg |
| Backdrop | rgba(0,0,0,0.5) with `z-dialog` |
| Close | Escape key + X button top-right |

### 11.5 Tabs

| Variant | Indicator |
|---|---|
| Underline tabs | 2px accent line below active tab |
| Padding | px-3 py-2 text-sm |
| Active | text-primary + accent underline |
| Inactive | text-secondary, hover → text-primary |

### 11.6 Badge

| Variant | Size | Font | Radius | Padding |
|---|---|---|---|---|
| Default | auto | text-xs 500 | radius-sm | px-1.5 py-0.5 |
| Status dot | 8px circle | — | radius-full | — |

Status badge colors: success (green), warning (amber), error (red), info (indigo), muted (slate).

### 11.7 Tooltip

| Property | Value |
|---|---|
| Font | text-xs |
| Padding | px-2 py-1 |
| Radius | radius-sm |
| Background | bg-tertiary (dark); bg-slate-800 (light) |
| Text | text-primary |
| Delay | 300ms show, 100ms hide |
| Max width | 240px |

### 11.8 Toast

Full component contract and usage rules: [08-component-spec.md §17](08-component-spec.md#17-toast).

| Property | Value |
|---|---|
| Position | top-center viewport, 16px from the top edge, `width: min(360px, 100vw − 32px)` |
| Surface | `bg-elevated-opaque` + 1px `border-subtle` + `shadow-dialog` (same family as floating menus) |
| Radius | radius-md-plus |
| Font | text-md, leading-compact-plus |
| Variants | `info` / `success` / `warning` / `error` — 16px Lucide status icon tinted with the semantic token; surface stays neutral (restraint principle) |
| Duration | 4s auto-dismiss; error 8s; `duration: 0` = sticky; hover pauses the timer |
| Stack | vertical, max 4 (oldest dropped), newest nearest the top-center anchor pushing older down; identical message+variant re-raises restart instead of stacking |
| Dismiss | X button on every toast (`toast.dismiss` i18n label) |
| Motion | enter 200ms ease-out slide-down/fade, exit 150ms ease-in fade; reduced-motion → near-zero duration (not `none`, removal listens for `animationend`) |
| Z-index | z-toast (50) |

## 12. State patterns

### 12.1 Interactive states

| State | Background | Text | Border | Cursor | Motion |
|---|---|---|---|---|---|
| Default | per variant | per variant | per variant | default | — |
| Hover | bg-tertiary or accent-hover | text-primary | — | pointer | 150ms |
| Focus | — | — | 2px accent ring offset-2 | default | — |
| Focus-visible | same as focus (only on keyboard focus) | — | 2px accent ring offset-2 | default | — |
| Active/pressed | accent bg, text inverted | text-primary (inverted) | — | pointer | — |
| Disabled | bg-secondary | text-muted | border-subtle | not-allowed | — |
| Loading | same as default + spinner | text-secondary | — | wait | spinner 1s rotate |

### 12.2 Semantic states

| Semantic | Indicator | Color |
|---|---|---|
| Success | icon ✓ or green dot | success token |
| Error | icon ✗ or red dot + inline message | error token |
| Warning | icon ⚠ or amber dot | warning token |
| Running | spinner (neutral) + pulsing border-left | accent token |
| Pending | dimmed + clock icon | muted token |
| Denied | red outline + "Denied" label | error token |

### 12.3 Streaming indicator

- Running agent: neutral-accent spinner in topbar + subtle pulse on left border of latest assistant message
- Completed: spinner replaced by success icon for 2s, then fades
- Error: spinner replaced by error icon, persistent until dismissed

## 13. Content density rules

| Rule | Application |
|---|---|
| **Base padding 8px (space-2)** | Default inner padding for list items, form groups |
| **Message gap 10px** | Between chat message rows — denser WorkBuddy-like transcript |
| **Section gap 16px (space-4)** | Between distinct UI sections (sidebar sections, settings groups) |
| **Panel gap 0px** | Panels touch edge-to-edge with border-subtle separator — no gutters |
| **Compact list rows 28px height** | Sidebar session items, settings list rows |
| **Button rows 32px height** | Standard buttons |
| **Never exceed 24px vertical gap** | Even for "breathing room" — this is a workstation |
| **Max content width 720px** | Chat messages, tool disclosure rows — prevent over-wide eye-span |

## 14. Do / Don't

### Do

- Use semantic tokens (`text-primary`, `bg-secondary`) — never raw hex in component code
- Use `font-mono` for all code, file paths, tool arguments, terminal output
- Provide visible focus rings on every interactive element
- Test contrast ratios: **4.5:1 minimum** for normal text, 3:1 for large text
- Keep motion under 300ms and respect `prefers-reduced-motion`
- Collapse long content by default (tool results, long messages) — see [09-interaction-patterns.md](09-interaction-patterns.md) §4
- Use Lucide/Heroicons SVG icons — never emoji as UI affordances
- Use compact padding and tight spacing — developer density, not consumer spacing
- First launch follows the system theme (see §Theme switching); dark is the primary design target

### Don't

- Don't hardcode `#181818` or any hex value in component JSX — use tokens
- Don't use emoji as icon substitutes (🚀, ✅, ❌ are text, not UI icons)
- Don't add decorative gradients, glass-morphism, or neon effects
- Don't use `z-index` values outside the defined layers
- Don't animate for decoration — motion is feedback only
- Don't set `font-size: 16px` as base — 14px is the workstation default
- Don't use large hero images or marketing-style empty states
- Don't apply rounded corners to full-width panels (sidebar, topbar)
- Don't use `border-radius: 0` on buttons and inputs (use `radius-sm` minimum)
- Don't show raw API keys in any UI surface

## 15. Acceptance criteria

1. All color tokens defined as CSS custom properties with Tailwind `@theme` mapping
2. Dark and light themes render correctly with ≥4.5:1 contrast on all text/background pairs
3. `system` theme follows `prefers-color-scheme` without white-flash on dark startup
4. Typography uses Inter (sans) and JetBrains Mono (mono) with defined fallback stacks
5. Base font size is 14px; no component defaults to 16px body text
6. All interactive elements have visible `focus-visible` rings using accent color
7. All motion respects `prefers-reduced-motion: reduce`
7b. Boot shows the branded startup splash until ready, then exits smoothly
8. No raw hex color values in React component source (only token references)
9. Z-index usage confined to defined layers (no arbitrary values)
10. Layout shell metrics (topbar, sidebar, composer) match spec values in CSS
11. Icon components use Lucide/Heroicons SVG — no emoji icon affordances
12. Spacing values use the defined scale (no arbitrary pixel values in component code)
13. Stream updates do not retrigger destination/shell enter motion or a
    backdrop-filter repaint behind the composer
14. Expanded sidebar session titles, project/group titles, and empty-state copy
    use the 13px compact token without changing the 28–32px row pitch

## Dark floating surfaces (Codex parity)

- Main surface: `#181818` (`gray-900`)
- Sidebar / surface-under: `#000000`
- Floating composer plate: Codex elevated-primary (`#212121f5` / `color-mix(gray-800 96%, transparent)`) with standard elevation-prominent (`0 0 0 .5px` stroke + `0 3px 7.5px #0000000a` + `0 0 20px #0000000d`); no heavier night-only lift
- Light workspace chips capsule: elevated gray `#f4f4f4` (not pure white-on-white)
- Combined workspace chips: elevated translucent plate over main, not flat main gray
- Stage Manager: host re-asserts min bounds while collapsed (permanent watchdog)

## Destination pages

- **Project archive**: the D066 Codex index table (search / expand / actions)
  is embedded in Settings with no duplicate page title or outer page padding;
  the earlier standalone Projects destination and card grid (D042) are
  superseded by D133
- **Settings**: full-page Codex shell per D063/D090/D133/D166 (275px compact
  seven-destination rail, `#f4f4f4` light, elevated content cards, Back to app);
  per D092, the content cards fill the pane width available from the current
  window instead of retaining D070's fixed 720px cap — the earlier in-shell
  200px rail and broad grouped directory are superseded
- Light destination cards use white elevated plates (not flat gray fills)
