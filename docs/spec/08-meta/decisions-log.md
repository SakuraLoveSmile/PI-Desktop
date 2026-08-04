# Decisions Log

> Baseline delta: `0.3.0` → `0.4.12`
> Date: `2026-07-28`
> Status: Accepted for implementation

This log freezes previously open questions into concrete decisions.

## A. High-priority architecture decisions

| ID | Topic | Decision | Rationale |
|---|---|---|---|
| D001 | Electron ↔ Rust transport | **Rust sidecar + stdio JSON-RPC (NDJSON)** | Simple isolation, debuggable, replaceable later |
| D002 | SQLite ownership | **Rust host-core owns SQLite exclusively** | Single writer, clearer privilege boundary |
| D003 | Default mode | **Agent** | Product is an agent desktop, not pure chat |
| D004 | Chat tool policy | **Chat is read-only** (`Read`/`Glob`/`Grep` only) | Safer default split between Chat and Agent |
| D005 | Permission timeout | **120s → deny** | Fail closed, do not hang forever |
| D006 | `allow-session` scope | **By `toolName`** | Simple UX; workspace sandbox still enforces path safety |
| D007 | `~/.pi` compatibility | **No auto-import in MVP** | Keep config ownership clean in `~/.pi-desktop` |
| D008 | Node runtime packaging | **Dev uses system Node; release runs the bundled sidecar on the Electron binary via `ELECTRON_RUN_AS_NODE=1` (no separate Node shipped)** | Unblock M1–M4; resolved at M5, see 03-runtime/07-process-model §6 |
| D009 | Plugin runtime isolation | **Target = separate process; M4 may use host-managed sandboxed runtime** | Ship plugin foundation pragmatically without weakening API gateway |
| D010 | First release platform | **macOS arm64 only** | Focus acceptance and packaging |

## B. Secondary implementation defaults

| ID | Topic | Decision |
|---|---|---|
| D011 | TS schema validation | **typebox** |
| D012 | i18n library | **i18next + react-i18next** |
| D013 | Bash execution style in M3 | **Non-interactive only** (no PTY yet) |
| D014 | Command palette shortcut | **Cmd/Ctrl + Shift + P** |
| D015 | Plugin tool exposed name | **Forced prefix** `plugin_<pluginIdSafe>_<toolName>` |
| D016 | Uninstall plugin data | **Delete by default**, optional keep-data later |
| D017 | enable → load failure | **Auto fallback to disabled** |
| D018 | Plugin secrets in settings | **Not allowed in MVP** |
| D019 | Plugin session summary access | **Denied by default** |
| D020 | Auto-update | **Post-MVP** |
| D021 | First-run onboarding | **Inline checklist (not modal wizard)** |
| D022 | Local telemetry | **Local logs only in MVP (no remote telemetry)** |


## C. Provider & model coverage decisions (0.3.4)

| ID | Topic | Decision | Rationale |
|---|---|---|---|
| D023 | Provider coverage goal | **Universal market coverage** (not a tiny fixed vendor list) | Globalization + real coding workflows |
| D024 | Coverage strategy | **pi-ai native providers + first-class OpenAI-compatible + custom providers** | Maximum reach without rewriting every SDK |
| D025 | Model allowlist | **No closed product allowlist** | Models churn; power users need free-form IDs |
| D026 | Catalog sources | **bundled snapshot + discovery/refresh + user-defined** | Works offline and stays current |
| D027 | Default identity | **Model selection is `(providerId, modelId)`** | Same model id can exist on many gateways |
| D028 | Secrets | **OS safeStorage (or controlled fallback) via secretRef; never in provider JSON** | Security boundary with Rust host ownership |
| D029 | Local models | **Supported through OpenAI-compatible local gateways** | Ollama/LM Studio/vLLM without special-case architecture |
| D030 | Connection test | **First-class host method before trusting provider for runs** | Fail early, actionable setup UX |
| D031 | Secrets backend | **OS safeStorage primary + encrypted file fallback** | Robust on macOS first release |
| D032 | Workspace ignore | **security denylist + defaults + `.pi-desktopignore`** | Safe/predictable tool FS behavior |
| D033 | Tool result limits | **256KB/4000 lines defaults with explicit truncation markers** | Protect context & UI |

## D. Codex visual parity decisions (0.3.5+)

Gold source: local Codex electron captures; latest row wins where rows conflict.

| ID | Topic | Decision | Rationale |
|---|---|---|---|
| D034 | Desktop visual baseline | **Codex electron-dark 1:1 shell (charcoal gray, floating composer, ~275px sidebar)** | Match local Codex usability and density; keep PI-Desktop product branding |
| D035 | Shell display name | *(superseded by D094)* **UI chrome uses shellName "Codex"; product/about remains PI-Desktop** | Satisfy visual 1:1 replica goal while preserving product identity in about/settings |
| D036 | Theme chrome tokens | **All shell chrome (nav, threads, chips, title buttons) uses semantic `--ds-*` text/surface tokens; no raw gray-0 text in light mode** | Light macOS default was unusable when nav used white ink on `#f3f3f3` |
| D037 | Dark sidebar surface | **Dark sidebar uses `#000000` (Codex `surface-under`); main pane stays `#181818` (`gray-900`)** | Match electron-dark sideBar vs main surface separation |
| D038 | Dark composer plate | *(superseded by D047, then D061)* Dark floating composer uses solid `#212121` with stronger elevation shadow than light | Codex elevated-primary must read as a box against `#181818`; transparent mix alone looks flat |
| D039 | Stage Manager bounds | **Permanent host watchdog restores footprint while width/height remain collapsed** | 20s burst was insufficient under Stage Manager thrash |
| D040 | Composer intelligence control | *(superseded by D091)* Custom effort chip opens a popover (effort radio + model heading + settings) instead of cycling on click | Replaced because the control changed labels without configuring pi |
| D041 | Profile footer | *(superseded by D113)* **Custom footer opens profile menu (Settings / Logs / Theme); cloud badge remains update stand-in** | D113 replaces the cloud/update stand-in and generic gear row with a truthful local-profile footer |
| D042 | Projects page | *(superseded by D066 index table)* Projects is a card grid of recent/active local workspaces with pin + glyph color (localStorage recents) | Match Codex Projects destination density without cloud project backend |
| D043 | Settings shell | *(superseded by D062/D063 full-page shell)* Settings uses left nav rail on sidebar surface + content pane (General/Providers/Plugins/About) | Closer to Codex settings IA than a top-only tab strip |
| D044 | Destination list chrome | **PRs/Scheduled/Plugins use shared dest-row list + filter chips; light cards white elevated** | Match Codex destination density without full cloud backends |
| D045 | Home empty stack | **Empty chat keeps composer in home flow (not absolute bottom-only dock); refined by D047 split grow** | Initial fix for large empty gap; D047 corrects dual-grow vertical model |
| D046 | Composer placeholder | *(superseded by D094)* **Empty draft uses Codex placeholder (EN/zh-CN) instead of blank** | Empty white plate read as broken without ink; match the earlier visual gold copy |
| D047 | Home split grow | *(geometry superseded by D111)* **Empty home used upper/lower grow regions (hero items-end + composer justify-end); dark box uses Codex elevation-prominent** | Match electron dual grow; D111 replaces dual-grow portal with a scrollable flow stack to stop composer/card collisions |
| D048 | Sidebar recents label | *(superseded by D088)* **Recents section uses live Codex gold label EN `Recents` / zh-CN `最近` (not asar-only `Tasks`/`任务`)** | Visual gold + live coding shell section heading between plugins and thread list |
| D049 | Home suggestion cards | *(superseded by D131)* **Empty home shows 4 ambient cards under hero (auto-fit row) and prefills starter prompts on click** | D131 removes the card row and prompt-prefill entry points from the empty home |
| D050 | Empty composer plate height | *(superseded by D055, then D061)* Home empty composer min-height ~112px (compact); model chip shows model id (effort stays in menu) | Match Codex empty plate density; model chip chrome closer to electron model picker trigger |
| D051 | Sidebar nav density | *(session-list IA superseded by D088; row density retained)* **Nav rows ~32px pitch, recents rows ~28–31px, section label `最近`/`Recents`** | Close light-home sidebar residual vs cx-home-clean |
| D052 | Home vertical + night box polish | *(workspace-chip surface superseded by D095; remaining guidance retained)* **Upper pb ~62px (hero first-ink ~y305); light chips `#f3f3f3`; light composer elevation stronger; dark home composer solid `#212121`; toolbar controls 28px** | Close residual heat at hero y≈300 and composer band; night plate must not flatten into `#181818` |
| D053 | Stage Manager CG detection | **CG bounds helper matches any window layer by pid; missing-CG needs streak≥3 before shelf recovery; avoid permanent alwaysOnTop** | alwaysOnTop floating layer broke layer-0 helpers and caused restore thrash |
| D054 | Empty draft row + infinity cue | *(∞ cue superseded by D094; leading brand cue superseded by D160)* **Composer auto-resize must never collapse empty textarea height (<28px); keep a visible brand cue left of draft; solid disabled send (`#bdbdbd` light); denser placeholder ink; night plate solid `#212121`** | Empty `height:0` auto-resize hid placeholder and read as broken night/light box; gold draft row needs visible mark + ink density |
| D055 | Empty plate draft Y | *(plate-height guidance superseded by D061; workspace-chip density superseded by D095)* Home empty shell min-height ~148px (bottom-aligned) so draft densest ink ≈y556 vs gold; chips compact 28px | 112px plate left draft ~30px low; grow plate upward without moving toolbar footing |
| D056 | Empty-home workspace chips | *(superseded by D095)* **Hide project/Local/branch capsule on empty home always; show only in thread-docked composer** | cx-home-clean empty gold has no capsule band above the plate even with project title |
| D057 | Home mark + hero title optical | *(home mark superseded by D094; title guidance retained)* **Empty-home Codex mark uses denser stroke; short workspace basenames display as `PI-Desktop` for gold title span** | Hero residual was thin mark + short project label under-inking title vs Codex gold |
| D058 | Home content width + dark ink tokens | **Home dual-grow max width uses `768px` (not `48rem` under 14px root); home horizontal pad 12px; hero title/night controls use theme tokens; night home plate scoped to dark only** | `48rem` at 14px root shrank plate ~120px vs Codex gold; hardcoded light hero ink made night title unreadable |
| D059 | Light disabled send ink | **Disabled send chip `#8e8e90` + white arrow (not `#bdbdbd`)** | Pixel-match cx-home-clean empty send control |
| D060 | Light New task ghost row | **Light empty-home New task is transparent (no solid chip); only hover wash** | Gold has icon+label without filled pill; filled `#e8` chip was main nav residual |
| D061 | Empty plate Y + night elevated-primary | **Home empty plate min-height 140px + wrap bottom pad 16px (top ~y536–538 / draft ~y552 / foot shadow ~y674); light+dark home plates use elevated-primary fill and downward elevation (no upward omni glow); dark fill `#212121f5`** | Plate was high with pre-plate halo; solid night plate + heavy omni shadow diverged from Codex elevated-primary and gold foot band |
| D062 | Settings Codex shell | **Settings uses Codex grouped rail (Personal/Integrations) + search + Back to app; content is elevated row panels; Providers/Plugins retained for local-first; MCP empty state under Integrations** | Destination parity gap; prior 4-item flat rail diverged from Codex settings IA |
| D063 | Settings full-page takeover | **Settings replaces app sidebar with Codex full-page shell: back+search+icon groups (Personal/Integrations/Coding), elevated permission/general cards, local Providers/Plugins retained** | Nested settings-inside-main-pane diverged from live Codex settings gold |
| D064 | Settings general content parity | **Basics card rows match Codex: default open target, language, menu bar, bottom panel; nav adds Pets/Appshots; sun/pet/snapshot icons; pill selects** | Closer 1:1 to live Codex settings gold content band |
| D065 | Settings general gold polish | **Permission rows include blue Learn more links + full-access risk copy; open-target pill shows VS Code glyph; Agent uses circular-arrow icon; Integrations order Appshots→Plugins→Browser→Computer→MCP; Enter-to-send moves to Agent** | Residual gaps vs cx-settings-try after full-page shell |
| D066 | Home-with-project chrome + projects index | *(composer intelligence label superseded by D091; workspace-chip portion superseded by D095)* Home shows workspace chips when project open (no ∞); home placeholder 随心输入/Ask anything; footer gear+help; Projects page is Codex index (search/columns/expand/actions) using setProject | Gold cx-home-clean with project + projects-index-page parity |
| D067 | Home suggestion glyphs + chip gap | *(suggestion-glyph portion superseded by D131; composer chip-gap portion superseded by D095)* **Suggestion icons match Codex (code/hammer/refresh/bug) with blue/purple/green/orange tones; composer chip gap 8px and denser capsule** | D131 removes the cards; D095 remains authoritative for composer spacing |
| D068 | Recents row actions + fixture titles | *(sidebar actions superseded by D088, then reorganized by D093; fixture-title guidance retained)* **Active/hover recent rows show pin + panel trailing actions; capture/fixtures prefer Chinese titled empty sessions (同步代码) over bare New task** | Gold sidebar selected row chrome; reduce selection residual |
| D069 | Destination title scale + dark New task ghost | **Destination page titles use Codex 28px/560 weight; New task is transparent ghost in dark too; capture drops English noise fixtures and pins 同步代码** | PR/Projects title mismatch; dark New task read as selected chip |
| D070 | Settings gold metric polish | **Settings rail 275px/#f4f4f4; denser nav; content title offset; 32×20 accent toggles; Account arrow-up-right; 14px cards; 720px content band** | Residual vs cx-settings-try (rail width, toggle size, title Y, external mark) |
| D071 | Transcript interaction parity | **Tool calls render as Codex-style lightweight disclosure rows (caret + name + mono arg hint + spinner/status, clamped inset body) replacing boxed cards; auto-scroll only while pinned to bottom with floating jump-to-latest pill (send / retry / regenerate re-pin per D151); shimmer Working… line with elapsed time; hover copy on messages and code blocks** | Boxed tool cards and forced scrollIntoView diverged from Codex transcript feel; spec 7.4 scroll pause was unimplemented |
| D072 | Typography/radius token enforcement | **All font-size/weight/line-height/letter-spacing/border-radius values must use `@theme` token vars (`--text-*` ramp with `-plus` half-steps, `--font-weight-*` incl. 520/560, `--leading-*`, `--tracking-*`, 12-step `--radius-*`); raw literals in CSS and TSX arbitrary utilities are blocked by `scripts/check-style-tokens.mjs` wired into `pnpm lint`; pixel values preserved exactly (no visual change)** | ~130 scattered literals drifted from any scale; design-system doc §5.2/§6.2 tables were stale vs implementation |
| D073 | Full renderer i18n coverage | **Every user-visible renderer string flows through i18next (`en` source of truth, `zh-CN` via `satisfies EnglishCatalog`): ContextPanel/CommandPalette/PermissionDialog wired; toast/aria/title/placeholder literals keyed; session default titles come from `i18n.t` with a shared case-insensitive `isDefaultSessionTitle` matcher covering legacy titles across locales; proper nouns (VS Code, Finder) and native language names stay untranslated** | Six components bypassed i18n entirely; default-title matching was duplicated in store and Sidebar and missed zh "新对话" |
| D131 | Empty home without suggestion cards | **The empty chat home renders the hero, optional first-run checklist, and composer only. The four Explore / Build / Review / Fix suggestion cards, their colored glyphs, and their prompt-prefill actions are removed. This supersedes D049/D067 and the card-specific clauses of D111 while retaining its single scrollable flow layout.** | The direct composer is the primary task entry; removing the decorative starter row makes the empty state quieter and more compact without removing actionable onboarding |
| D133 | Project index moves to Settings archive | *(five-destination count/order superseded by D166; flat-list presentation superseded by D168)* **The home sidebar no longer has a standalone Projects destination. Settings adds Project archive (zh-CN: 项目归档) after Import and before Info, bringing the compact directory to Basics / Model configuration / Import / Project archive / Info. The archive reuses the durable Projects index and always includes archived records, with search, add, activate, task expansion, pin, archive/restore, and close actions. Project and session groups remain in the home sidebar for active work. Global search exposes the archive as a Settings result, not a standalone page. This supersedes the standalone-destination clauses of D042/D066 and D090's four-destination limit without changing project storage or activation semantics.** | Active project work already lives in retained sidebar groups; moving historical project management into Settings reduces primary navigation while keeping recovery and archive controls discoverable. |
| D168 | Project archive presentation redesign | **Project archive renders three stacked bands: an overview banner (intent sentence, primary Add project, and four derived counters for projects, open, archived, sessions), a toolbar (search with clear affordance and live match count, plus a Recent/Name sort segmented control), and a grouped index whose always-visible sections run Pinned / All projects / Archived with per-section counts, one settings panel per section, and hairline row separators. Rows carry a disclosure control, glyph, name with Active/Open/pinned/Archived tags, one meta line (shortened monospace path, branch, session count), relative last-active time, and hover/focus-revealed New task plus row menu; the menu groups create/edit above pin, archive/restore, and destructive Close, and dismisses on Escape or outside press. Archived rows are grouped and softened, never hidden or filtered, so D133's no-visibility-toggle rule still holds. This supersedes D133's flat-list presentation without changing project storage, search matching, session batching, or activation semantics.** | The flat single-list archive gave equal weight to pinned, working, and archived records and hid its disclosure and row actions behind hover, so scanning a long durable index meant reading every row. Grouping with derived counters and an explicit sort makes state legible at a glance while keeping archived history permanently reachable. |

## E. M5 hardening decisions (0.4.0)

| ID | Topic | Decision | Rationale |
|---|---|---|---|
| D078 | macOS signing lanes | **Static config stays unsigned (`identity: null`) for local builds; `scripts/release-macos.sh` injects Developer ID + hardened runtime + optional notarization from env** | Contributors build without certs; releases sign per 06-delivery/06-release-runbook |
| D079 | App icon / brand mark v1 | **`build/icon_1024.png` is the canonical PI-Desktop logo; `scripts/make-icon.py` derives `build/icon.icns` without overwriting the PNG; packaged macOS builds, `pnpm dev`, and renderer chrome reuse those assets** | Keep one visual identity across development, renderer, and packaged lanes while preventing the derivation script from restoring the obsolete generated mark |
| D080 | Backend supervision | **Child exit rejects in-flight RPCs immediately; backoff restarts (0.5s→4s, max 3 per 2min); `hostStatus` events drive renderer degradation UI** | Crash recovery without hangs; fail visible, not silent |
| D081 | Renderer sandbox | **`sandbox: true` with fully bundled CJS preload; production CSP drops `unsafe-eval` and localhost connect-src** | Electron security baseline; verified by `test:e2e:boot` |
| D082 | Log channels | *(superseded in part by D182)* **app/host/agent NDJSON files with 5MB rotation (keep 2 rotated) via main-process Logger; audit channel stays in host-core SQLite** | Diagnosable failures without unbounded growth; audit needs queryability |
| D083 | Window state | **Persist last good bounds to `window-state.json` (min 960×640 to restore); Stage Manager shelf recovery keeps the Codex footprint; capture runs force deterministic bounds** | Users keep their window; shelf recovery and pixel captures stay deterministic |
| D084 | Cross-platform shell strategy | **The Bash tool runs bash on every platform, resolved once per process: `PI_DESKTOP_BASH` override → Unix well-known paths + PATH → Windows `bash.exe` derived from Git for Windows (git on PATH, standard install dirs, then PATH minus the WSL `System32` launcher); Unix uses `bash -lc`, Windows `bash -c` + `CREATE_NO_WINDOW`; no bash bundled in installers; missing shell surfaces stable `SHELL_NOT_FOUND` with install guidance** | Agent-generated commands are POSIX-flavored, so PowerShell/cmd would fork prompts and skills; the app already requires git, and on Windows Git for Windows ships bash — detection beats bundling (~300MB, GPLv2 obligations, duplicate installs) |
| D085 | Toast system v2 | **Single global toast stack (`ToastHost` + store queue) replaces the string `setToast`: `showToast(message, {variant, duration})` with info/success/warning/error variants (Lucide icon tinted by semantic token on a neutral elevated plate), auto-dismiss 4s / error 8s / 0 sticky owned by the system (no caller timers), hover pause, max 4 with dedupe, enter/exit motion + reduced-motion-safe removal, `aria-live` + role status/alert; usage rules in 08-component-spec §17** | Old toast was a bare fixed div: no variants or stacking, and most call sites never cleared it so messages persisted forever; callers hand-rolled timeouts |
| D086 | Storage schema v2 | **Single `pi.sqlite` (host-core exclusive) rebuilt per 03-runtime/04: `kv` namespaces replace `meta`/`settings` and host plugin settings; `projects` replaces the workspace singleton; transcripts become canonical block arrays (`messages.content_json` + extracted `text`, ms-integer times, O(1) per-session `seq`, stable `mid` rowid) with `turns` carrying state-machine status + usage rollups and FTS5 trigram search; new `models` catalog, `artifacts`, `scheduled_tasks`+`task_runs` (moved out of Electron's JSON, fixing a D002 violation); indexed prunable `audit_log`; `PRAGMA user_version` migrations with pre-migration `.bak`; dead `plugins`/`provider_models` tables dropped (registry.json stays authoritative)** | v1 schema was a lossy UI projection (no turns/usage/blocks/attachments), ordered by `MAX+1` scans, had zero secondary indexes, two dead tables, RFC3339 text times, and scheduled tasks bypassing host ownership; spec'd features (artifacts view, cost chips, run history, project grouping, global search, catalog refresh) had no storage to land on |
| D087 | Immersive composer context rail | *(superseded by D095)* **Project / Local / branch remain one rail, but the rail now attaches directly to the composer shell, shares its theme surface and sole elevation, and drops the visible 8px gap plus independent capsule shadow; supersedes the gap portion of D067** | The detached capsule and differently colored plate made context and prompt input read as unrelated controls instead of one Codex-style immersive composer |
| D089 | Composer draft height | **The prompt textarea shows one visible line by default, auto-grows from wrapped content through seven visible lines, scrolls internally beyond line seven, and contracts as content is removed; the home shell is content-driven instead of keeping D061's fixed 140px minimum** | Preserve transcript space and Codex-like density while keeping multiline editing usable |
| D088 | Scoped home sidebar sessions | *(superseded by D093 only for the one-current-project and no-row-actions limitations)* **Replace the Recents aggregate with one current-project session group plus persistent path-less Temporary sessions; keep other projects in the Projects index; remove Recents pin/panel row actions; scope empty-draft reuse and explicit `+` creation by project context** | D093 retains exact-path grouping, scoped draft reuse, and the Temporary boundary while allowing several retained project groups and scoped organization actions |

## F. Baseline 0.4.2 product decisions

| ID | Topic | Decision | Rationale |
|---|---|---|---|
| D090 | Compact settings directory | *(four-destination count and order superseded by D133)* **Settings retains the D063 full-page shell and D070 visual metrics, but its rail contains exactly Basics, Agent, Import, and Info in that order. Appearance moves into Basics; Providers moves into Agent. Plugin management remains in the app shell's existing Plugins destination, with load/enable/disable/uninstall available there, and is not duplicated in Settings. This supersedes the broader grouped navigation and standalone Appearance/Providers/Plugins placements in D062–D065, plus D070's Account-specific rail metric.** | Remove empty, low-value, and duplicate destinations while keeping every shipped workflow reachable and making the local-first settings surface easier to scan |
| D091 | Composer runtime configuration | **Mode and provider/model controls update the active session and are read from that session by the pi prompt path; controls without an end-to-end runtime implementation are not rendered.** | Prevent decorative effort/attachment controls and keep every visible composer action operational |
| D092 | Responsive settings content | **The settings content fills the width available after the fixed 275px rail and pane gutters, resizing through CSS flex layout with the native window. This supersedes only D070's fixed 720px content band and the corresponding visual-metric retention in D090.** | Use wide desktop windows efficiently without adding renderer resize state or changing the compact settings directory |
| D104 | Settings rail menu rename | *(Agent label superseded by D110; directory order superseded by D133)* **Settings rail destination labels are Basics / Agent / Import / Info (zh-CN: 基础 / 智能体 / 导入 / 信息). Destination IDs remain general / agent / import / about; only user-facing labels change. This renames the D090 compact directory labels without changing order, contents, or deep-link targets.** | Shorter, action-oriented labels scan faster while preserving the compact directory |

## G. Baseline 0.4.3 sidebar and project decisions

| ID | Topic | Decision | Rationale |
|---|---|---|---|
| D093 | Sidebar organization, retained project tabs, and session workspace isolation | **The renderer retains normalized open-project paths and local project/session presentation metadata for pin, archive, collapse, sort, and optional compatibility order. The sidebar renders one independently collapsible group per retained path plus Temporary sessions. User-facing sort modes are recent, created, oldest, and name; `manual` remains a persisted compatibility value without a new reorder gesture. Activating a group reuses `project.set`, so the shell still has one selected host workspace. Tool execution resolves its root from the durable session project, and per-session turns/grants remain independent when another tab becomes active. Archive and close are non-destructive.** | Preserve a multi-repository working set and make long conversation lists manageable without creating multiple host workspace singletons or allowing an active-tab switch to redirect a background session's tools |
| D094 | Renderer product branding | *(docked composer logo superseded by D160)* **All user-visible shell identity uses `PI-Desktop`: the sidebar shell name, composer placeholder, and settings copy. `BrandLogo` imports canonical `build/icon_1024.png` through Vite for the home hero, expanded/collapsed sidebar, and docked composer; new-session controls use a dedicated message-plus icon. `Codex` remains only where it identifies an external import source or a design reference.** | Remove accidental third-party branding and vector approximations from the product surface while preserving import compatibility and the Codex-derived layout system |
| D135 | Distinct sidebar task status indicators | **Conversation rows reserve one compact leading status slot with semantic, shape-distinct states: neutral-accent outlined ring for selected, warning-orange breathing dot for in progress, success-green check for completed, and error-red circled alert for failed. Precedence is in progress, selected, then latest terminal outcome. Starting a new turn clears the prior outcome; abort produces no failure. Every state has localized accessible text and reduced motion makes the in-progress dot static.** | The prior running dot reused the accent token and disappeared when idle, making selected, active work, completion, and failure difficult to scan or distinguish by more than row background |

## H. Baseline 0.4.4 composer decisions

| ID | Topic | Decision | Rationale |
|---|---|---|---|
| D095 | Remove composer workspace context rail | **The home and thread-docked composer variants never render the passive project / Local / branch rail or reserve layout/elevation for it. Project selection, session binding, branch metadata, and workspace-scoped tools remain available through non-composer surfaces. This supersedes the context-rail portions of D052, D055, D056, D066, D067, and D087.** | The rail duplicated navigation, showed two passive values, and could display misleading fallback branch metadata while consuming prompt space |

## I. Baseline 0.4.5 thinking-mode decisions

| ID | Topic | Decision | Rationale |
|---|---|---|---|
| D096 | End-to-end thinking mode | **Thinking level is session-scoped with canonical values `off|minimal|low|medium|high|xhigh|max`; capability resolution and nearest-level clamping drive the Composer and pi request; thinking streams and persists separately from final answer text; schema v3 and protocol v2 carry the new fields.** | Restore reasoning controls only after model capability, persistence, IPC, sidecar, pi runtime, event, storage, and transcript paths are all operational |
| D102 | Custom provider thinking presets | **Settings expose Off / On-off only / Graded (plus advanced custom lists). On-off only persists `supportedThinkingLevels: ["off","high"]`; Graded clears the sparse override and uses the conservative default set; Composer renders only the resolved set and never invents graded options for boolean-like models such as mimo.** | Custom OpenAI-compatible endpoints often expose boolean thinking rather than a full effort ladder |

## K. Work panel decisions

| ID | Topic | Decision | Rationale |
|---|---|---|---|
| D097 | Docked work panel replaces context panel | **The right side hosts a docked, drag-resizable (320–min(720px, 60vw)) work panel with Review / Terminal / Browser / Files tabs, toggled by the titlebar button or Cmd/Ctrl+J; `{open, tab, width}` persist in localStorage. The former ContextPanel overlay and its `context.*` copy are removed; workspace/model/status live in composer chips and Settings.** | Codex-parity working surface for inspecting agent output; the info-only overlay duplicated data available elsewhere |
| D098 | Review tab reads the git working tree *(superseded by D180)* | **Historical decision: Review rendered the workspace's uncommitted state through the git CLI.** | Superseded because commits erased message-level evidence and could not support safe per-message rollback |
| D099 | Terminal tab is a real PTY | **Terminal runs an interactive login shell in the active workspace via node-pty in the Electron main process with xterm.js in the renderer; sessions are keyed per workspace, survive tab switches and panel close through a main-side replay ring, and die with the app.** | Codex parity requires a usable terminal, not a command replay; PTY ownership stays in main so the sandboxed renderer never touches processes |
| D100 | Browser tab embeds a WebContentsView | **The preview browser is a main-process WebContentsView with renderer-driven bounds sync, hardened (deny popups→external, deny permission requests, http(s)-only navigation, isolated persist partition); it hides while blocking overlays (palette, permission dialog, settings) are open. The user drives it; the agent does not.** | Recommended modern embedding without webview-tag caveats; hide rules resolve its compositor z-order over renderer overlays |
| D138 | Session-scoped inline permission requests | **Tool approval is an inline PermissionCard owned by its originating `sessionId`, never a global dialog. Different sessions retain independent pending requests and absolute timeout deadlines; background message/tool/permission events update only scoped state and never activate, cover, or focus another conversation. Resolution and cleanup match both session and request identity. This supersedes only D100's permission-dialog overlay/hide clause; palette, search, settings, and other blocking surfaces retain their existing browser hide behavior.** | Concurrent agents must not steal the active workflow or overwrite each other's approval requests; the existing protocol already carries the required session/request identity. |
| D139 | Navigation intent and shortcut event guards | **Every explicit session, project, page, fork, or history navigation begins or reuses one renderer navigation intent; asynchronous work commits visible state only while that intent remains current. Global shortcuts ignore modifier-only and IME composition events, while history navigation also ignores key-repeat events.** | Late session/project loads and incomplete keyboard events must not cause unexplained page or history jumps. |
| D128 | Artifact-driven work panel tabs | **The work panel has no empty manual entry point, welcome chooser, titlebar/menu command, or Cmd/Ctrl+J shortcut. A file/URL/BrowserPreview/successful-command artifact creates and activates a closeable top tab; successful active-session workspace Write/Edit artifacts create and activate the singleton Review tab. File tabs are keyed by lexically normalized path, singleton tool tabs deduplicate, closing the active tab selects its right neighbor then left, closing the last tab hides the panel, and the sole panel-level control collapses it without deleting retained runtime tabs. Changing the visible session or workspace closes and clears tabs so relative resources never cross context boundaries. Startup is closed with no tabs; only panel width persists, while temporary OS-window expansion is excluded from launch bounds. Background-session, failed, and scratch writes do not steal focus. This supersedes D097's fixed tab entry points and `{open, tab}` persistence, refines D098's automatic refresh, and supersedes only D112's welcome-chooser clause.** | Match Codex's output-driven work surface, avoid an empty tool launcher, and make each visible tab correspond to work the session actually produced or explicitly previewed. D128 corrects the initially duplicated D119 identifier; D119 remains the transcript file-store decision. |
| D140 | Session-owned dirty-workspace transcript review entry *(superseded by D179)* | **After a session produces a successful workspace Write/Edit, its transcript ends with one explicit Review changes command outside collapsed activity groups while that Git working tree remains dirty; other sessions in the same project do not inherit the command. It reports the capped file count and addition/deletion totals and creates, reopens, or activates D128's singleton Review tab. The entry and Review share one workspace-keyed diff refreshed on workspace activation, successful Write/Edit/Bash completion (500ms debounce), explicit Review refresh, and window focus; sequenced requests discard prior-workspace responses. Clean and non-Git results clear review ownership for that workspace; clean, non-Git, missing-workspace, and failed-refresh states hide the entry. Review ownership is renderer-memory state discarded on relaunch with D142's work-panel contexts. This is a contextual artifact/status entry, not the empty manual launcher forbidden by D128.** | Automatic panel opening alone leaves no discoverable return path after collapse or tab close, while session ownership prevents unrelated conversations from claiming project-wide edits. Sharing the real diff makes the conversation entry accurate and keeps Review deduplicated. |
| D179 | Message-scoped inline review cards *(superseded by D180)* | **Historical decision: each successful workspace Write/Edit row rendered a card by matching the current workspace diff.** | Superseded because current Git state disappears after commit and cannot provide message-owned rollback |
| D180 | Message-owned review snapshots and guarded rollback | **Successful workspace Write/Edit results carry bounded `details.review` evidence: snapshot id, message/tool id, path, operation, added/modified/deleted status, +/− counts, hunks, and rollback state. The host stores pre-tool bytes and before/after hashes outside the workspace under the session, and the renderer derives the adjacent card and chronological Review history from transcript messages only. `review.rollback` verifies the current post-tool hash before restoring prior bytes or removing a newly-created file; conflicts never overwrite later edits. Session deletion and startup cleanup remove snapshots; forked evidence is visible but non-reversible.** | A message-owned snapshot survives Git commits, separates same-path edits, and makes rollback explicit without trusting mutable repository state |
| D142 | Session-scoped work-panel runtime contexts | **Each conversation owns an in-memory work-panel context containing open state, ordered tabs, active tab, and Browser resource. Session selection atomically projects that context, switching away never deletes it, and switching back restores it. File/URL/BrowserPreview/command/Review artifacts are recorded against their originating `sessionId`; BrowserPreview renderer events therefore carry `sessionId`. Background artifacts may update their retained context but never open, activate, resize, navigate, or focus the visible panel. A workspace selection without an active conversation hides the panel, and relative resources remain bound to their session/workspace. Relaunch discards every context and Browser resource; only panel width persists. This supersedes only D128's requirement to close and clear tabs when the visible session or workspace changes; D128's artifact triggers, deduplication, close/collapse behavior, and no-launcher rule remain unchanged. No process ownership boundary changes.** | Permission-gated tools can finish while another conversation is loading or visible. A global destructive tab set either flashes open before being cleared or loses the originating conversation's tools; session-keyed renderer state preserves continuity without allowing background work to steal focus or making transient resources durable. |
| D154 | Work-panel activity rail and resource switcher | **Once an artifact has opened the work panel, a 44px activity rail exposes Review, Terminal, and Browser as one-click 32px tool buttons; opening a missing tool still uses D128's `openWorkPanelTab` path. The 46px content header shows and closes the active resource and exposes a bounded keyboard-operable switcher for every open tool/file resource. The panel minimum becomes 364px so the rail preserves the previous 320px content floor *(width clamp superseded by D167)*. This replaces the horizontally scrolling top tabs and hidden empty-header context menu while preserving D128's artifact-driven panel entry, resource deduplication/order, close-neighbor behavior, and session-scoped runtime ownership.** | High-frequency tools should be visible and spatially stable, while long or numerous file names need a labeled overflow surface rather than compressing every action into one titlebar row. |
| D157 | One visual assistant turn per user turn | **Provider-level assistant messages separated by thinking/tool activity remain distinct canonical transcript records, but ChatTranscript composes all records after one user message and before the next into one `role=article` assistant turn. Ordered markdown fragments and activity disclosures remain visible; only the composed turn owns the trailing aggregate model/usage row and Copy/Fork/Retry toolbar. Copy joins all contentful fragments with paragraph breaks; Fork and Retry use the last contentful assistant record as their durable boundary.** | Tool-capable providers close and reopen assistant messages around every tool call. Rendering those transport boundaries as separate responses duplicated action toolbars and made one agent run look like many AI replies. |
| D162 | Latest-wins cached session switching | **The renderer marks the newest selected row immediately, coalesces session-detail prefetch/load work, retains an LRU-style five-transcript memory cache, and starts the newest transcript read without waiting for superseded reads. Workspace alignment may overlap transcript IO; navigation generations gate the atomic visible commit. ChatSurface keeps the previous complete view non-interactive while React defers a changed session tree, then paints the destination at its final record. Cached snapshots are always revalidated.** | The former global selection promise queue made every click wait behind obsolete full-transcript JSONL reads, while one synchronous long Markdown commit delayed visible feedback. Latest-wins IO plus a stable deferred frame matches Codex-style navigation without weakening session/workspace isolation. |
| D156 | Independent native-window and work-panel resize ownership | *(responsive-clamp and no-native-reservation clauses superseded by D163)* **Electron Main exclusively owns BrowserWindow bounds at a 1040x700 minimum, while the renderer owns a persisted preferred work-panel width. The divider uses anchored, frame-coalesced preview and commit-on-release; Escape, pointer cancellation, and lost capture roll back. Native window-edge resize never rewrites the panel preference. This supersedes D083's restore minimum and removes the `window/resizeBy` delta channel and resize-attribution heuristic.** | Circular ownership made divider release resize the OS window a second time, introduced async races and platform differences, moved windows near display edges, and rewrote a panel preference during unrelated native resize. |
| D163 | Native width reservation for the fixed work panel | *(width range superseded by D167)* **An open docked panel keeps one committed fixed width in `364..720`; native window/sidebar changes never clamp it. Renderer sets the visible target through idempotent `window/setWorkPanelReservation({width: 0 | 364..720}) -> {requested, reserved}`: open requests the committed width, collapse/final close requests zero, and divider commit updates it. In normal state Main adds available native work-area width and reverses it symmetrically, so chat stays stable when the full target fits; otherwise the panel remains fixed and chat absorbs `requested - reserved`. Native edges resize chat only. Maximized/fullscreen requests defer until normal; display/work-area changes reconcile the target against current available width without reapplying it during ordinary same-display movement. Persisted base bounds exclude reservation width and its x shift, and background artifacts cannot alter the visible reservation. This supersedes ADR 0029/D156 clauses that clamp the panel inside current client width or prohibit panel-driven target geometry, while preserving Main bounds ownership and divider gesture rules (ADR 0032).** | A docked tool should not take width from chat when the display can extend the normal window, and resizing chat should never squeeze the tool. A bounded target-state reservation provides Codex-like behavior without restoring non-idempotent deltas or circular preference updates. |
| D167 | Slimmer default work-panel width | **The docked work panel opens at a 280px committed default (one third narrower than D163's 420px) and clamps to `244..720px`; the renderer constant, the Electron reservation validator, and the `.work-panel` CSS floor share those bounds. Double-click on the divider restores 280px. The 44px-rail-plus-320px-content rationale behind D154's 364px floor no longer applies now that tools live in the header switcher, so the floor scales with the default. Persisted wider widths stay valid and are unchanged on upgrade; the 720px maximum, divider gesture rules, and inert-reservation behavior (ADR 0033) are untouched.** | The panel opened wider than most review/terminal/file content needs, taking readable width from chat inside the fixed client area, and the old 364px floor made a narrower default unreachable. |
| D164 | Dual-locale in-app product changelog | **Product "what's new" text for app updates is maintained as a dual EN/zh-CN catalog in `packages/shared` (`CHANGELOG`). Electron Main formats notes for the discovered `availableVersion` using the product UI locale and attaches them as optional `UpdateState.releaseNotes` plain text on the existing updates IPC/event path. The ambient banner and Settings → Info Updates row show a compact What's new section when notes exist. English is the source of truth; zh-CN mirrors versions and highlight counts. GitHub auto-generated release bodies remain web-only and are not the in-app source. No new feed URL, notes channel, or renderer-owned remote fetch is introduced (extends D120 / ADR 0022).** | Users need bilingual release highlights at update time without a second network surface or weakening Main's sole ownership of update delivery. |

## L. Transcript presentation decisions

| ID | Topic | Decision | Rationale |
|---|---|---|---|
| D101 | WorkBuddy-inspired transcript density | **User turns render as compact right-aligned soft plates (`min(78%, 560px)`, subtle border + hairline shadow). Assistant turns stay transparent full-width prose (max 720px). Message row vertical padding tightens to 10px. Hover/focus-within reveals quiet copy chips under each turn (right-aligned for user, left-aligned for assistant). Streaming assistant answers use a thin accent left rule. No mascot, reactions, or cost-chip UI yet.** | Current right-aligned user bubbles were underspec'd and visually sparse versus WorkBuddy's task chat; denser plates improve scanability without abandoning the Codex/developer restraint |
| D103 | Per-message model + token meta and retry | **Completed assistant turns surface modelId + token usage chips under the answer (tokens-only; hover breakdown for input/output/cache/reasoning). Usage is attached on runtime message_end from pi-ai Usage, persisted in message meta_json, and reloaded with the transcript. Action row adds Retry, which re-sends the nearest preceding user prompt. No currency pricing and no like/dislike.** | WorkBuddy per-message meta improves trust/scanability; token totals already flow from the provider while priced cost still needs a catalog |
| D105 | In-place regenerate for assistant turns | **Regenerate truncates the session transcript to the nearest preceding user prompt (exclusive of that prompt and everything after), disposes the live pi-agent for the session, and re-sends the prompt so the new assistant/tool tail replaces the discarded branch instead of stacking a duplicate turn.** | Users expect regenerate to rewrite the current turn; append-only retry polluted long sessions and left stale answers above the redo |
| D106 | Preserve user hard newlines in transcript | **User bubbles render plaintext with hard newlines intact. Composer only trims leading/trailing whitespace; transcript uses `message-user-text` with `white-space: pre-wrap` (no forced mid-glyph word-break) so multi-line prompts never collapse into one paragraph. Copy and session reload keep the original line breaks.** | Multi-line prompts (code snippets, lists, pasted blocks) are common in coding agents; collapsing newlines makes the transcript hard to re-read and re-edit |
| D107 | Configuration provider studio | **Settings → Agent uses a provider studio: summary hero, segmented defaults, collapsible OpenAI-compatible composer, and card-based provider management with secret badges, thinking presets, test connection, and make-default/delete actions. This refines the Providers presentation inside the compact settings directory without adding rail destinations.** | Dense stacked forms and cramped list rows made multi-provider setup hard to scan and over-emphasized secondary fields |
| D110 | Model configuration label + add-provider dialog | **Settings rail label for the agent destination is Model configuration (zh-CN: 模型配置). Adding a provider opens a modal dialog instead of an inline collapsible composer; the destination id remains `agent`.** | Clarify the model-setup purpose of the tab and reduce page churn while editing provider credentials |
| D108 | Conversation minimap only when overflowing | **The left-edge conversation minimap rail renders only when at least two visible user/assistant messages exist and the transcript overflows one viewport (`scrollHeight > clientHeight`). Short one-page threads hide the rail; streaming growth, content resize, and window resize re-evaluate visibility.** | A navigation rail is noise when every message already fits on screen; overflow is the signal that jump/preview navigation is useful |
| D109 | ChatGPT-style regenerate revision history | **Regenerate archives the discarded assistant/tool tail under a stable `revisionRootId` family in `message_revisions` (schema v4). The live root user turn carries `revisionCount` / `activeRevision` and a quiet `current / total` pager switches linear variants in place. First regenerate stores the original branch as revision 1; later regenerates append new branches and mark the newest active. No free-form branch tree.** | Users expect regenerate to keep prior answers reachable like ChatGPT; D105 in-place rewrite alone deleted history that was still useful for comparison |
| D111 | Empty home scroll stack | *(card-specific clauses superseded by D131)* **Empty chat home is a single scrollable vertical stack inside `home-main-content`. Short windows top-align and scroll; content stays in document flow and the home composer remains non-docked.** | Dual-grow + absolute portal let the home composer overlap guidance on shorter windows; flow layout preserves every remaining block without collision |
| D112 | Readable chat beside the work panel | *(dynamic width clamp superseded by D163; welcome chooser superseded by D128)* **MainChat has a 360px readability target beside the panel. D163 preserves it through native width reservation whenever the display work area can supply the complete committed panel width; otherwise MainChat absorbs the unavoidable shortfall while the panel remains fixed.** | A panel-only width cap could leave roughly 109–205px for chat at supported window sizes; native reservation now preserves chat without compressing the tool surface. |
| D113 | WorkBuddy-inspired local profile footer | **The expanded sidebar ends in a transparent 58px footer. Its 44px profile trigger contains a 30px circular local-user glyph, two-line `Custom` + `Local profile` / `本地配置` identity, and a chevron; a separate 32px Help shortcut opens Settings → Info. The 280px profile menu opens 8px above the footer with a repeated identity header, divider, and Settings / Logs / Theme actions, preserving Escape, outside-click, arrow-key, and focus-restore behavior. This supersedes D041; no cloud account, notification, share, or update capability is implied.** | Adapt WorkBuddy's avatar-and-actions footer grammar to PI-Desktop's truthful local-only capabilities while improving identity hierarchy and eliminating the stale cloud stand-in |
| D137 | Glyph-only message toolbars; edit means edit-the-prompt | **Message toolbars carry icons only: the label lives in a CSS hover/focus tooltip (`data-tip`) plus `aria-label`, never as a visible chip caption (worded buttons stay only on error surfaces). Edit moves off the assistant answer onto the user turn: it opens the prompt in an inline textarea (slash turns seed the typed `command` form so the resend re-expands the template) and saving replays the D105/D109 regenerate path with the new text in the same session — the replaced prompt and its whole answer tail are archived as a revision, so the existing `current / total` pager walks back to the original. Editing the assistant's own text and its fork-into-a-child-session variant (D134) are dropped; Fork stays as the explicit divergence action.** | Four worded chips under every answer read as a sentence and crowded the transcript; and the useful correction is almost always "I asked it wrong", which users expect to re-run in place with history intact (ChatGPT semantics) rather than to hand-edit the model's words in a new session |
| D165 | Safe lazy Mermaid diagrams in assistant answers | **A completed `mermaid` fence in assistant answer prose renders as a theme-aware SVG after entering the near-viewport band. Partial stream fences and all thinking prose stay source code. The renderer dynamically loads official Mermaid, serializes its global theme renders, caps source at 20,000 characters and edges at 500, locks strict/no-HTML/no-link configuration, and applies a second SVG-profile sanitizer. Invalid or oversized diagrams fall back to visible copyable source; the diagram toolbar toggles source and copies it.** | Diagrams improve architecture and flow explanations, but parsing partial streams or every offscreen historical fence would undermine direct-stream and fast-session-switch behavior. Strict bounded local rendering adds the capability without a new protocol, network, or Electron privilege boundary. |

## M. Agent runtime decisions

| ID | Topic | Decision | Rationale |
|---|---|---|---|
| D114 | Per-session scratch directory for agent temp files | **Each session gets `<data_dir>/scratch/<sessionId>/` as a second containment root for `Read`/`Write`/`Edit` (absolute paths only; relative paths stay workspace-bound). The path is advertised in the system prompt and as `PI_SCRATCH_DIR` in Bash. Scratch writes auto-allow without a permission card and are excluded from the artifacts table. Scratch is created lazily, deleted with the session, and swept at startup (orphans, >7 days stale). Glob/Grep/BrowserPreview remain workspace-only; chat mode stays read-only.** | Temp/intermediate files (one-off scripts, downloaded data, drafts) were dirtying the user's project and git status; a host-owned root with identical lexical + symlink defenses keeps the sandbox model intact while giving the model a legitimate place for scratch work |
| D115 | Permission modes: global default + per-session override | *(composer presentation superseded by D132)* **A permission mode governs high-risk tool approval: `ask` (confirm everything, default), `accept-edits` (auto-allow Write/Edit, confirm Bash/plugins), `auto` (auto-allow all). Global default lives in settings `defaultPermissionMode`; each session stores `permission_mode` (schema v5, default `inherit`) which overrides it when not inherit. Resolution: session override → global default → ask, enforced solely in host-core `tools.execute`. Chat mode's hard deny outranks every mode. Settings exposes a segmented global control.** | Confirming every Write/Edit made long agent runs high-friction, but a single global toggle is too coarse — trusted scratch sessions and risky repo sessions need different postures; keeping enforcement host-side preserves the security boundary |
| D132 | Composer permission menu shows effective modes only | **The agent-mode composer chip and menu expose only `ask`, `accept-edits`, and `auto`, with the effective mode selected directly and no global-default/inherit entry or provenance label. Choosing an item stores that explicit session override. Existing `inherit` persistence and resolution from D115 remain unchanged until the user chooses a mode. This supersedes only D115's composer-presentation clause.** | The inherited entry repeated a selectable mode and exposed storage provenance instead of the permission posture the user is choosing; presenting the three effective modes makes the control direct without changing host enforcement |
| D116 | Provider failures as assistant messages | **Every provider/model turn failure is attached to a durable `role=assistant`, `status=error` transcript message through optional `UiMessage.error`. The message shows a localized summary and stable code, keeps redacted provider detail behind an accessible disclosure, and offers context-appropriate Retry or Settings actions. Message-bound failures never use toast/global banner presentation and never re-enter later model context.** | Errors belong to the failed turn; preserving them in the transcript makes the response diagnosable after session switches/restarts without contaminating the next model request or exposing credentials |
| D127 | Context-preserving reseed + transport retry | **Reseeding a recreated pi runtime from the persisted transcript restores tool call/result pairs (from tool rows' `toolCallId`/`toolArgs`/`toolResult`) in addition to user/assistant text and thinking. Interrupted tool rows restore as errored results; orphaned tool rows get a synthesized call-only assistant carrier so pairs stay adjacent and well-formed. Failed assistant turns stay transcript-only. Separately, request setup uses one bounded pi-ai retry for transient transport/provider failures; post-response stream recovery is defined by D186.** | Text-only reseed collapsed a session's context after any runtime recreation (regenerate/edit, config change, restart): the model lost every tool result it had gathered and — seeing its own history answer without visible tool use — stopped calling tools, degrading agent sessions into bare chat. The incident trigger was a single un-retried provider timeout that forced the user into regenerate. D127 corrects the initially duplicated D120 identifier; D120 remains the earlier application-update decision frozen by baseline 0.4.6. |
| D136 | pi-ai owns known-model metadata | **For every model resolved from the pinned pi-ai catalog, Electron main passes the complete pi model snapshot to the sidecar and PI-Desktop replaces only connection identity. Provider Settings and the model menu do not override reasoning support, thinking levels, context/output limits, temperature, or compatibility. Unknown free-form ids remain usable through an explicit generic text-only, non-reasoning fallback. This supersedes D102 and the provider-override clauses of D096/D107.** | A second desktop-owned model matrix discarded pi metadata, drifted from adapter behavior, and made model semantics depend on conflicting configurations; fixes for known models now belong in pi-ai or a pi-ai upgrade. |
| D137 | Segmented tool and model latency logs *(UI clause superseded by D184)* | **Every `tools.execute` call is timed in segments instead of one opaque duration: host-core emits a `tool timing` line on the `host` channel and persists `prompted`, `permissionWaitMs`, `overheadMs`, and `totalMs` next to the existing `durationMs` on `tool_execute` / `tool_denied` audit rows; the sidecar writes greppable `[timing] kind=tool …` (`hostRttMs`) and `[timing] kind=model …` (`providerWaitMs`, `streamMs`, including failed/aborted turns) lines to the `agent` channel, suppressible with `PI_DESKTOP_TIMING=0`. The original no-UI clause is superseded by D184; logging remains unchanged.** | "Executing a command is slow" was undiagnosable from the logs: approval waiting, the tool body, and the provider round trip were indistinguishable, so a 45s gap between two audit rows with 0ms durations gave no clue whether it was the user, the model, or the host. Splitting the stages makes the answer readable without reproducing the run. |
| D158 | Turn-boundary context checkpoint compaction | **PI-Desktop reuses pi-agent-core's context estimation, session-context, and compaction primitives but owns the orchestration and durability. After every `turn_end`, before any next provider request, the runtime evaluates model-aware soft/hard budgets. A transient deduplicated instruction can ask the model to call the internal `CompactContext` tool; the tool's normal activity row is visible/durable, while the instruction is not. Crossing the hard budget forces checkpoint generation and blocks the request on failure. A final atomic tool batch that reaches half the hard budget is fairly head/tail-truncated only in the checkpoint copy, with explicit markers and every call/result envelope retained; original transcript rows remain complete. Exact provider overflow removes the failed assistant from model context, creates one checkpoint, and retries once. Host protocol v6 appends checkpoint records beside the untouched visible JSONL transcript; restart, late truncation, and included-boundary forks preserve the newest valid checkpoint. Disabling automatic compaction removes the tool and all automatic threshold/overflow recovery, while `/compact` remains available. OpenCode DCP is an AGPL-3.0 behavioral reference only and is neither linked nor copied (ADR 0030).** | pi's end-of-run-only behavior cannot protect long tool loops, and a model reminder alone cannot guarantee provider safety. Reusing pi's tested compaction format while adding a deterministic `turn_end` gate prevents another provider request from crossing the known window, retains user-visible history, and avoids importing an incompatible plugin/runtime and license boundary. |
| D185 | Lazy per-turn tool activation | **The sidecar keeps a complete local tool registry but sends only the mode core set, `CompactContext` when enabled, and local `ToolSearch` on each new prompt. `BrowserPreview`, plugin tools, `Skill`, and plugin-development helpers appear as bounded compact catalog entries and are activated by exact-name or capability search; the next turn receives their schemas, native pi-ai deferred search is used when supported, and the set resets before the next user prompt. Host permissions, containment, timeouts, and audits are unchanged.** | Full tool schemas made simple first requests disproportionately large and repeated optional capability cost across turns. A pi-style active set preserves core coding ergonomics while making ancillary tools pay-as-you-go and provider-independent. |
| D186 | Bounded provider stream recovery and diagnostics | **Provider request setup uses one bounded pi-ai retry. A transient `STREAM_FAILED`, `NETWORK_ERROR`, or `TIMEOUT` after streaming starts is replayed once in the same turn after abortable backoff; the failed assistant is removed from model context and its visible message id is reused. A second failure is terminal. Provider `AppError.details` carries only bounded phase, timing, provider status/code, and retry-attempt diagnostics. Mutation guidance uses one fresh read/regeneration after an `Edit` mismatch; a second failed `Edit` for the same path returns a terminating tool hint instead of repairing old patch artifacts.** | Unbounded or regenerate-driven recovery made transient stream termination expensive and made patch loops consume turns without new information; finite runtime budgets preserve context and user control while keeping failures diagnosable (ADR 0050). |

## N. Notification decisions

| ID | Topic | Decision | Rationale |
|---|---|---|---|
| D117 | Durable task notification inbox | **Rust host-core exclusively owns a schema-v6 `notifications` table and atomically inserts one structured `task.completed` / `task.failed` row when `session.endTurn` moves a running turn to completed/error only if Electron reports that result was not already visible. Renderer supplies the current chat session through an allowlisted viewing-context IPC; Main suppresses insertion only when its window is visible/focused and that session matches, while unknown, background, hidden, or unfocused state fails safe to notification. `turn_id UNIQUE` prevents duplicates, abort is silent, session deletion cascades, and only the newest 200 rows remain. The titlebar bell exposes exact unread count, All/Unread, row mark-read/session activation, mark-all-read, and clear with complete keyboard/accessibility behavior. Protocol v4 adds singular `notification.list/markRead/markAllRead/clear`; `session.endTurn` returns an inserted record, Electron emits renderer `notification.changed`, and only while the main window is unfocused it also shows a native system notification whose click restores/focuses the window and emits `notification.activated`. Persisted rows contain structured kind/session/turn/error data plus the session-name snapshot, never localized notification title/body prose. No permission, scheduled-reminder, plugin, preference, or cloud-notification capability is implied; D113's profile footer remains unchanged.** | Notifications should recover task outcomes the user did not see, not duplicate a result already visible in the current chat. A bounded host-owned inbox keeps background/unfocused outcomes durable and navigable without violating SQLite ownership, duplicating events, or turning every terminal event into notification history. |

## O. Desktop shell decisions

| ID | Topic | Decision | Rationale |
|---|---|---|---|
| D118 | Platform application menu and window chrome | **macOS installs a conventional system application menu and keeps hidden-inset traffic lights. Windows/Linux use the shared 46px frameless shell with localized File/Edit/View/Window/Help menus and renderer-drawn minimize/maximize-or-restore/close controls. Both menu surfaces route renderer-owned actions through a fixed `AppMenuCommand` allowlist; renderer menus route native editing/window actions through a separate fixed allowlist. Target packaging builds the local release host before Electron packaging. This adds platform-ready shell behavior but does not reverse D010: Windows/Linux release qualification remains post-MVP.** | A default Electron menu leaves macOS shell commands incomplete, while a frameless Windows/Linux window otherwise loses both application menus and window controls. Shared allowlists keep behavior consistent without exposing an arbitrary privileged command bridge. |
| D120 | Application update delivery | **Electron Main exclusively owns a fixed GitHub Releases feed, update polling, typed state, and install lifecycle. Development is disabled; packaged macOS and non-AppImage Linux use notify-and-link delivery, while Windows NSIS and Linux AppImage download in-app and install on quit. Renderer IPC cannot provide feed URLs. Automatic failures stay ambient, explicit checks surface status, and downloaded state remains actionable. The updater always forces `allowPrerelease = false` so prerelease installs (for example `0.2.0-rc.6`) track GitHub's latest stable release instead of electron-updater's default same-channel pin. D126 later publishes every platform feed produced by the tag matrix while macOS remains manual until a signed channel is qualified.** | Keep package installation outside the sandboxed renderer, match delivery to each installer format, and provide one consistent state across menus, Settings, and the update banner (ADR 0022). Without the stable-channel pin, RC builds never surface newer stables because electron-updater treats `rc` as a custom channel. |
| D121 | Branded macOS development host | **`pnpm dev` on macOS launches electron-vite through a fingerprinted, ad-hoc-signed PI-Desktop copy of the installed Electron host bundle under `.cache/electron-dev/`. The generated bundle changes only development host metadata, executable name, bundle identifier, and the ICNS resource; it never mutates `node_modules`. Windows/Linux keep the stock development executable, while packaged lanes remain electron-builder-owned.** | AppKit ignores runtime app-name/menu overrides for the top-level application identity and takes the native menu name and About icon from the host bundle; a branded development host is required for parity with packaged PI-Desktop. |
| D129 | Menu-free Windows/Linux window chrome | **The application menu is a macOS system-menu surface only. Windows/Linux retain the shared frameless 46px titlebar and renderer-drawn minimize/maximize-or-restore/close controls, but render no File/Edit/View/Window/Help menu inside the window and reserve no left-side titlebar space for one. Existing application, editing, zoom, fullscreen, and close shortcuts remain available through renderer/native web-content handling; update checks remain reachable from Settings -> Info. This supersedes only the Windows/Linux renderer-menubar portions of D118 and ADR 0021.** | An in-window desktop menu duplicates macOS-specific system-menu chrome, consumes navigation space, and does not belong in PI-Desktop's frameless Windows/Linux titlebar. |
| D130 | Sidebar-footer notification entry | **The durable notification Bell moves from the main titlebar to the separate `32px` action at the right of the expanded sidebar footer, replacing D113's Help shortcut. Its unread badge and complete D117 inbox behavior remain unchanged; the popover opens above and to the right of the footer, and no duplicate Bell remains in the main titlebar. This supersedes only the entry-location clauses of D113 and D117.** | Notification history belongs with the persistent local profile controls and the footer position keeps the main titlebar quiet while preserving a compact, familiar status entry. |
| D141 | Canonical Windows native application identity | **Electron Main sets the product name before readiness and registers `com.pi-desktop.app` as the Windows process AppUserModelID before creating any window. That ID is the existing electron-builder/NSIS application ID; Windows packaging explicitly retains `PI-Desktop` for the executable and Start menu shortcut. Native notification attribution, notification settings, taskbar grouping, installed shortcuts, and packaged executable identity must expose `PI-Desktop`, not the stock Electron host. D121 remains unchanged: Windows development may use the stock Electron executable while its OS-facing runtime identity uses the canonical AUMID.** | `app.setName` changes Electron's internal name but not the Windows identity used by notifications and shell integration. One stable ID across runtime and packaging prevents both the observed notification-source leak and adjacent shell-brand drift without changing the published NSIS upgrade identity. |

## P. Transcript storage decisions

| ID | Topic | Decision | Rationale |
|---|---|---|---|
| D119 | Transcript file store; SQLite index-only | **Schema v7: message content moves out of SQLite into per-session JSONL files under `~/.pi-desktop/sessions/` — `<id>.jsonl` (a session-header line, then one canonical block-array message line per message, RFC3339 stamps) plus an append-only `<id>.revisions.jsonl` for regenerate branches. `messages` drops `content_json`/`meta_json` and becomes a pure index (ordering, promoted filter columns, extracted `text` feeding FTS); `message_revisions` swaps `messages_json` for `message_count`, with `is_active` tracked in the DB only. Writes are file-first then index transaction; reads skip unknown/torn lines and dedupe repeated message ids keep-last; full rewrites are temp-file + atomic rename; session files are deleted only with their session and never age/orphan-swept. Opening a pre-v7 database archives it as `pi.sqlite.v6.bak` and bootstraps fresh — an explicit breaking reset, with all v1–v6 migration code removed. RPC wire format is unchanged, so Electron/renderer/importers need no changes.** | The database grew without bound carrying tool args/results and thinking payloads; codex/claude-code-style per-session files keep transcripts human-readable, greppable, and portable while SQLite stays a small, fast index (list, search, badges). A dev-phase breaking reset was chosen over migration machinery. |
| D122 | Independent conversation session fork | **Protocol v5 adds host-owned `session.fork`: an idle source's complete active canonical transcript is copied into a new independent session with remapped message/tool-call ids and inherited project/provider/model/mode/thinking/permission configuration. Turns, regenerate revisions, notifications, artifacts, session grants, scratch/runtime state, pin state, and parent-child lineage are not copied. Create branch activates the child; D109 remains unchanged because no message-level branch tree is introduced.** | A single host-owned snapshot preserves canonical blocks and persistence consistency while giving users a Codex-style divergence workflow without conflating independent conversations with regenerate variants. |
| D134 | Assistant response fork and reversible edit | *(edit clause superseded by D137)* **The completed-assistant toolbar exposes Copy, Fork, Edit, and Regenerate but no Delete. Fork calls the existing host-owned `session.fork` with optional `throughMessageId`, producing an independent session whose canonical transcript ends at that response. Edit uses the same isolated child, replaces only the selected assistant text there, and stores original/edited tails as a two-entry D109 revision family so the existing pager can restore either. Both require an idle source, remap message/tool-call ids, and never share the source session id, runtime, transcript, revisions, or provider cache state.** | Response-level divergence and correction should remain reversible without mutating the source or letting an edited history reuse cached runtime state built from different assistant content. |

## Q. Still deferred


1. Exact marketplace domain / provider IDs
2. Private marketplace auth mechanism
3. Signature key distribution operational details
4. Remote catalog update channel details (URL/signature)
5. Exact recommended default model per vendor preset

The full open list lives in [open-questions.md](open-questions.md); this
section mirrors only marketplace/catalog items still blocking nothing.

## U. Settings rail iconography

| ID | Topic | Decision | Rationale |
|---|---|---|---|
| D143 | Settings directory rail icons | **The five settings destinations use fixed Lucide glyphs: Basics=`SlidersHorizontal`, Model configuration=`Bot`, Import=`Download`, Project archive=`Archive`, Info=`Info`. Refresh/rotate glyphs are not used on this rail.** | Prior mapping reused Settings/RefreshCcw/RotateCw, which read as generic gear/reload rather than the destination semantics; monochrome Lucide keeps the compact directory scannable. |
| D166 | Settings directory split into AI and Shortcuts destinations | **The Settings rail grows from five to seven destinations in order: Basics (`SlidersHorizontal`), 全局 AI/AI (`Sparkles`, new), Shortcuts (`Keyboard`, new), Model configuration (`Bot`), Import (`Download`), Project archive (`Archive`), Info (`Info`). Permissions and Context management move from Basics to the new AI destination; Keyboard shortcuts moves from Basics to the new Shortcuts destination; Developer moves from Basics to Info. Basics keeps only Appearance and Defaults. This supersedes the five-destination count/order of D133 and the five-icon set of D143 (adding `Sparkles` and `Keyboard`) without changing any setting's semantics, the full-page shell, or rail metrics.** | Basics accumulated six unrelated cards, burying global AI behavior (permission mode, context compaction) and shortcut configuration alongside look-and-feel; splitting them gives each concern a scannable home while keeping provider/connection config separate in Model configuration. |

## R. Decision rules going forward

- Architecture-boundary changes require a new ADR
- Implementation defaults can be updated in this log + related specs
- Any reversal of D001–D010 requires explicit baseline bump

## S. Composer input decisions

| ID | Topic | Decision | Rationale |
|---|---|---|---|
| D123 | Composer slash commands, three sources | **Typing `/` at position 0 of the composer opens an inline command menu merging (a) pi prompt templates from `<workspace>/.pi/prompts/*.md` and `~/.pi/agent/prompts/*.md` (project overrides user-global on name conflict; frontmatter `description`/`argument-hint`), (b) builtin palette commands through slash aliases defined in one registry shared with palette search, and (c) plugin palette commands. On send, builtin/plugin invocations execute locally through the existing renderer switch / `commandPalette/execute` without creating a session or prompting the model; template invocations are expanded in the Electron main `agent/prompt` handler before persistence (`parseCommandArgs` + `substituteArgs` from pi-agent-core), persisting `content = expanded` plus a new optional `command` field carrying the typed form; unknown `/foo` is sent as literal text.** | Reuses pi's exact CLI semantics and template assets, keeps agent reseed faithful (reseed replays `content`), and keeps the transcript readable by rendering the typed invocation as a chip (ADR 0024). |
| D124 | `@` file references are plain-text light references | **`@` at a token boundary opens a fuzzy file menu over a workspace index served by the new Electron-only channel `pi-desktop/fs/index` (files+dirs, `git ls-files -co --exclude-standard` fast path with ignore-set walk fallback, 8000-entry cap with truncation flag, short TTL cache, workspace-rooted, fails soft without a workspace). Accepting inserts literal text — `@rel/path ` for files (quoted `@"a b.txt" ` when the path has spaces), `@dir/` without trailing space for directories — and the prompt is sent unchanged: the model follows references with its Read tool in both chat and agent modes. No content inlining and no attachment conversion.** | Matches pi CLI interactive semantics exactly, avoids context inflation and truncation rules, and keeps user-driven file browsing out of the agent tool/permission path per ADR 0019. |
| D125 | Composer autocomplete interaction and IME contract | **One menu component anchored above the composer, full composer width, focus always stays in the textarea. Keys while open: ↑/↓ cycle with wraparound, Enter/Tab accept, Escape closes only the menu (takes precedence over the composer's clear/blur Escape), typing filters live; Enter never sends while an item is highlighted, and an empty result list counts as closed. The menu closes on outside mousedown, blur, deleting past the trigger character, or session switch. All key handling and trigger detection sit behind the IME guard (`isComposing || keyCode === 229` plus composition start/end tracking): during composition nothing triggers, updates, or intercepts, and state is re-evaluated on compositionend.** | First explicit IME rule in the spec — zh-CN Enter-to-send plus candidate confirmation must never fight the menu; uniform insert-then-dispatch keeps two-Enter flows fast and predictable. |
| D144 | Sidebar primary chrome at 14px | **Expanded sidebar primary chrome (New task, Plugins, session titles, footer identity name, profile menu actions) uses `--text-base` (14px). Project/group titles and empty-state copy use `--text-md` (13px). Section labels use `--text-sm` (12px). Primary sidebar content must not use the micro `--text-xs` band.** | 13px sidebar body felt undersized next to the 14px chat surface; bumping only primary chrome keeps density while restoring visual balance without a global type-scale change. |
| D145 | Disable browser text correction on editable fields | **Every text `input` and `textarea` in the desktop renderer disables browser text correction: `spellCheck={false}`, `autoCorrect="off"`, and `autoCapitalize="off"`. Shared `Input`/`Textarea` primitives default these values; raw fields (composer, message edit, command palette, global search, settings/plugins/projects search, model search, browser URL bar, provider model combo) set them explicitly. Checkboxes and non-text controls are unchanged.** | Coding prompts, paths, model ids, and URLs must not be red-underlined or auto-mutated by Chromium/OS text correction; the shell is an application, not a document editor. |

| D146 | Startup splash + motion tokens | **While bootstrap is incomplete the renderer shows a branded full-window startup splash (logo, shell name, tagline, accessible `app.starting`, soft progress bar) instead of plain status text. After `ready`, the splash holds a short minimum dwell (~420ms), then fades out (~280ms) over the mounted shell. Global motion uses CSS tokens `--motion-duration-{fast,normal,slow}` and `--motion-ease-{out,in,standard}` with shared overlay/surface enter keyframes; interactive transitions prefer these tokens. Reduced motion collapses splash/overlay motion to near-zero and freezes the progress bar. Crash chrome uses `app.uiCrashed`.** | Boot is a first-run moment that previously felt unfinished; a short branded splash communicates readiness without decorative theatre, and shared motion tokens make shell transitions consistent and silkier while remaining feedback-only. |
| D147 | Interaction detail polish (selection, CJK labels, motion fills) | **Copyable surfaces use theme-aware `::selection` (text-primary mix), `caret-color`, and `accent-color` on the monochrome ramp; focus rings mix accent with transparent (no white wash). High-traffic chrome (jump-latest, stop, menus, search rows, notifications, work-panel tab close, brand chip) transitions via `--motion-duration-fast`. Scrollbars are 8px with a stronger hover thumb. Empty-home stack gap is 24px. Under `lang=zh-CN`, section labels drop uppercase/wide tracking. Undefined `--radius-token-row` is replaced by `--radius-sm`.** | Residual gold-polish gaps after the neutral accent + motion-token pass: browser-blue selection, abrupt hover fills, Latin-only label styling on Chinese chrome, and one undefined radius token. |
| D150 | Composer runtime chip descenders | **Composer toolbar chips (Chat/Agent, Thinking, permission mode, model ID) keep labels fully inked inside the 28px capsule: chip and label line-height is `--leading-compact`, chips do not clip with `overflow: hidden` on the control, and the model label uses horizontal ellipsis without `leading-none`. Descenders on `g`/`y`/`p`/`q`/`j` must remain visible in light and dark.** | `leading-none` plus truncate overflow crushed glyph descenders on model IDs and labels such as Agent / Accept edits, making the bottom toolbar look cut off. |
| D151 | Send re-pins transcript follow | **Starting a turn via send, retry, or regenerate always re-pins transcript follow mode, hides the jump-to-latest pill, and scrolls to the bottom before new content arrives. Manual scroll during a turn still pauses follow; the jump control remains the only non-turn way to resume. This refines D071 without restoring forced scroll on every token.** | Users who scroll up to inspect history still expect the next prompt they send to land at the latest exchange; leaving follow paused after send hid the new turn behind the jump pill. |
| D152 | Direct runtime stream rendering | **Assistant content renders each runtime stream chunk directly through the incremental Markdown block cache. The renderer does not add a requestAnimationFrame typewriter state loop. KaTeX's Vite-inlined fonts remain local-only assets and are admitted by the narrow `font-src 'self' data:` CSP directive.** | The duplicate animation loop could trip React's nested-update guard during sustained streams, while the previous CSP blocked bundled math fonts and produced console errors. |
| D153 | Reasoning sessions default to maximum thinking | **A newly created session whose inherited default model supports reasoning starts at the highest canonical entry in that model's pi-published `supportedThinkingLevels`. Non-reasoning models and missing capability metadata start at `off`; existing sessions retain their durable choice. This refines D096 without adding a provider override.** | Reasoning-capable models should use their strongest available effort by default while preserving explicit per-session choices and pi-ai's model authority. |


## T. Release delivery decisions

| ID | Topic | Decision | Rationale |
|---|---|---|---|
| D126 | Three-platform release delivery (lifts D010) | **Tag builds publish every artifact the matrix produces to the GitHub Release: macOS dmg/zip (arm64), Windows NSIS x64, Linux AppImage + deb (x64), each with blockmaps and the platform's `latest*.yml` electron-updater feed. Publishing the feeds activates D120's in-app update lanes for Windows NSIS and Linux AppImage; macOS stays in notify-and-link mode until a signed channel is qualified. The NSIS artifact name is pinned space-free (`PI-Desktop-Setup-${version}.${ext}`) because GitHub asset URLs mangle spaces. D010's macOS-only scope is lifted per the baseline-bump rule (baseline `0.4.7`); the release pipeline itself was qualified end-to-end on v0.1.1-rc.1/v0.1.1.** | The pipeline builds and validates all three platforms on every tag anyway; keeping installers as expiring Actions artifacts (90-day retention) withheld them from users without adding safety. Publishing the update feeds is the point of shipping: platforms with in-app lanes update silently, and future platform regressions surface through real installs instead of unused artifacts. |

## 2026-07-28 — Plugin marketplace, panels, and high-risk APIs

- Official local marketplace provider can browse/search/install `.piplug` packages with checksum verification.
- Plugin panels run in sandboxed isolated windows via `pluginBridge`.
- High-risk plugin host APIs (`fs.write`, `net.fetch`, clipboard, openExternal) are available only with explicit grants.
- Per-plugin auto-update is supported; permission-expanding upgrades require review.

## 2026-07-28 — Official plugin marketplace repository

- Dedicated repo `vastsa/pi-desktop-plugins` is the official marketplace source.
- PI-Desktop fetches `catalog.json` remotely (cached under `~/.pi-desktop/plugins/market/`).
- Plugin maintainers pack sources with repo scripts and publish by pushing to that repository.
- Local bundled catalog remains fallback only when remote fetch fails.

## 2026-07-28 — Marketplace template + detail pane

- Official warehouse gained a practical template plugin `demo.workspace-summary` and CONTRIBUTING guide.
- PI-Desktop marketplace UI now opens a detail pane with README, changelog, and version list via `market.getDetail`.

## 2026-07-28 — Sidebar type balance

- Expanded sidebar primary chrome uses `--text-base` (14px) instead of `--text-md` (13px).
- Project/group titles step to `--text-md`; section labels stay secondary at `--text-sm`.
- Decision D144: keep micro tokens off primary left-rail content so the rail matches body readability without changing the global type ramp.

## 2026-07-28 — Chat markdown prose redesign

- Assistant markdown (`.prose-chat`) was restyled for denser, calmer transcript reading: clearer heading hierarchy, accent-tinted blockquotes, quieter list markers, bordered inline code, zebra/hover tables, and inset code cards with monospace language tags.
- Thinking prose reuses the same hierarchy at secondary color / `text-sm-plus` so reasoning stays visually subordinate to the answer.
- Renderer behavior (streaming block split, GFM/math, Shiki) is unchanged; this is a presentation-only pass in `globals.css` + component/design specs.

## 2026-07-28 — Neutral gray accent (no blue brand)

- `--ds-accent` / `--ds-accent-hover` / `--ds-accent-soft` / `--ds-info` now resolve to the gray scale (dark: white→gray-100→gray-300; light: `#1a1c1f`→`#303030`→`#5d5d5d`) instead of Codex blue.
- Markdown links, blockquotes, focus rings, plugin CTAs, toggles, and selected-session rings inherit the neutral accent automatically via tokens.
- Project color dots and docs/specs updated to drop blue as the brand accent.

## 2026-07-28 — Plugins page light-theme token pass

- Marketplace/plugin chrome CSS dropped raw blue-slate fallbacks (`#4f7cff`, `#2a3144`, `#121826`, …) and now consumes only `--ds-*` tokens.
- Tabs, actions, search, cards, permission modal, and badges adapt to light/dark via the neutral gray accent system.

## 2026-07-28 — Markdown light-theme paper pass

- Light `.prose-chat` / `.code-block` surfaces were retuned for white chat paper: softer underlined links, flat gray code cards (no muddy shadow), quieter blockquotes/tables/kbd/math, and secondary thinking ink.
- Dark markdown treatment is unchanged in spirit (inset charcoal code, light-gray links via accent-soft).

## 2026-07-28 — One Dark Pro code highlighting

- Chat fence highlighting switched from `github-light`/`github-dark` to `one-light`/`one-dark-pro`.
- Code cards paint a single editor surface (`#fafafa` / `#282c34`); nested `pre`/`code`/token backgrounds are forced transparent so there is no double wash.

## 2026-07-28 — Disable text correction on editable fields

- Shared `Input`/`Textarea` primitives default `spellCheck={false}`, `autoCorrect="off"`, and `autoCapitalize="off"`.
- Composer, message edit, palette/search fields, settings/plugins/projects search, model search, browser URL bar, and provider model combo follow the same contract.
- Decision D145: browser/OS spelling and autocorrect chrome stays off across the desktop shell.

## 2026-07-28 — Startup splash and motion tokens

- Boot path paints `StartupSplash` (brand mark, shell name, tagline, progress bar) until host/settings bootstrap finishes.
- Shared CSS motion tokens and overlay/surface enter keyframes polish dialogs, search, toasts, and interactive fills.
- Decision D146: splash is boot feedback with reduced-motion-safe exit; catalogs gain `app.uiCrashed` and finish zh-CN empty-home/custom copy.

## 2026-07-28 — Interaction detail polish

- Theme-aware `::selection`, `caret-color`, and `accent-color` keep copy/edit chrome on the neutral gray accent ramp.
- Hover fills on jump-latest, stop, composer-plus, search rows, profile/notification menus, and work-panel tab close use shared motion tokens.
- CJK section labels under `:lang(zh-CN)` use normal tracking without forced uppercase.
- Empty-home stack gap clamped to 24px; scrollbars refined to 8px with hover thumb; brand chip radius uses `--radius-sm`.
- Decision D147.

## 2026-07-28 — Work panel / settings light-surface polish

- Light work panel uses a quiet `#fafafa` inset column with a white header band so it separates from white chat paper without a heavy border.
- Browser URL, generic field controls, shortcut keycaps, segment tracks, and toggle knobs receive light-theme surfaces and focus rings aligned with settings pills.
- File tree, diff headers, resize handle, and destination filters ease hover fills with shared motion tokens.
- Light dialog scrim softens to 28% ink so elevated white dialogs stay readable.
- Decision D148.

## 2026-07-28 — User-facing i18n copy pass

- English and zh-CN catalogs rewrite high-traffic shell copy away from internal
  jargon: local service instead of host/backend, AI provider instead of bare
  provider, project instead of workspace in user strings, marketplace refresh
  instead of "from repo", temporary chats, and calmer status/error phrasing.
- Empty states, onboarding, settings help, plugin permissions, and notifications
  explain outcomes in plain language while keeping stable i18n keys and
  interpolation names.
- Decision D149.

## 2026-07-28 — Composer runtime chip descenders

- Model, mode, thinking, and permission chips no longer use `leading-none` under
  overflow clipping; labels use `--leading-compact` so descenders stay visible.
- Long model IDs still ellipsize horizontally via `.model-chip-label`.
- Decision D150.

## 2026-07-28 — Send re-pins transcript follow

- Starting a turn from send, retry, or regenerate re-pins the transcript and
  jumps to the bottom even if the user had scrolled up through history.
- Stream follow remains paused only for manual scroll during an active turn;
  the jump-to-latest pill still resumes follow without starting a new turn.
- Decision D151.

## 2026-07-28 — Direct runtime stream rendering

- Assistant responses now display the runtime's progressive chunks directly
  through the incremental Markdown block cache, without a second per-frame
  React state loop.
- Renderer CSP admits only local and Vite-inlined data fonts, allowing bundled
  KaTeX glyphs without opening a remote font origin.
- Decision D152.

## 2026-07-28 — Reasoning sessions default to maximum thinking

- New sessions inherit the app's default model and select its highest
  pi-published thinking level when that model supports reasoning.
- Non-reasoning or unresolved models remain `off`, while existing sessions keep
  their stored thinking preference.
- Decision D153.

## 2026-07-28 — Work-panel activity rail

- The open work panel now keeps Review, Terminal, and Browser in a compact
  44px activity rail with clear active/open states.
- The content header shows the active resource, closes it directly, and uses a
  bounded keyboard-operable switcher for all open tool and file resources.
- The former horizontally scrolling tabs and hidden header context menu are
  removed; artifact-driven panel opening and session ownership are unchanged.
- Decision D154.

## 2026-07-28 — Sidebar project/session list type density

- Sidebar project group titles and session/thread titles step one token quieter
  than the previous body-chrome sizing so dense lists scan more cleanly.
- Session titles use `--text-md` (13px); project/group titles and empty-state
  copy use `--text-sm` (12px). Primary chrome (New task, Plugins, footer) stays
  at `--text-base`.
- Decision D155; superseded by D159 for the expanded sidebar's primary list
  content.

## 2026-07-28 — Independent window and work-panel resizing

- Native window edges now resize only the Electron shell; work-panel open,
  collapse, close, and divider commits leave outer bounds unchanged.
- The divider uses anchored pointer delta, frame-coalesced preview, rollback on
  cancellation, and a wider stable hit area. Responsive clamping no longer
  overwrites the persisted preferred width.
- Removed the renderer-to-Main `window/resizeBy` channel, programmatic resize
  attribution, and panel-specific window-state offset.
- Decision D156; ADR 0029.

## 2026-07-28 — Single assistant toolbar per user turn

- Provider-level assistant messages separated by tool calls remain canonical
  transcript records for model reseeding, persistence, and fork boundaries.
- The chat transcript composes every assistant/thinking/tool record after one
  user message and before the next into one visual assistant turn, preserving
  order while exposing one aggregate meta row and one Copy/Fork/Retry toolbar.
- Copy joins all contentful assistant fragments; Fork and Retry target the last
  contentful assistant record. Decision D157.

## 2026-07-28 — Turn-boundary context checkpoint compaction

- PI-Desktop now evaluates context after every `turn_end`, before the next
  provider request, with a transient soft reminder and a deterministic hard
  checkpoint guard.
- Durable checkpoint records rebuild model context without deleting or hiding
  visible transcript messages; exact provider overflow receives one compacted
  retry.
- The implementation reuses pi-agent-core primitives. OpenCode DCP remains an
  AGPL-3.0 behavioral reference, not a dependency or copied implementation.
- Decision D158; ADR 0030.

## 2026-07-28 — Sidebar typography aligned with the global body scale

- Expanded-sidebar session titles return to `--text-base` (14px), matching the
  app body and primary sidebar chrome; project/group titles and empty-state copy
  return to the adjacent `--text-md` (13px) tier.
- Section labels and secondary metadata remain at `--text-sm` (12px), and the
  existing compact row pitch, truncation, and sidebar dimensions are unchanged.
- Decision D159; supersedes D155 and restores D144's primary-list hierarchy.

## 2026-07-28 — Icon-free composer prompt row

- Home and thread-docked composer prompt rows render no leading brand icon;
  draft text and placeholder ink align directly with the input gutter.
- The canonical logo remains in the home hero, sidebar, native application
  identity, startup splash, and About surfaces. Session-creation controls keep
  their dedicated message-plus icon. Decision D160; ADR 0031.

## 2026-07-28 — Smooth latest-wins session switching

- Session rows now acknowledge the newest selection immediately, prefetch on
  deliberate hover/focus, coalesce detail reads, and retain five recent
  transcripts for warm revisits with background revalidation.
- Superseded transcript reads no longer block the latest request. Workspace
  alignment overlaps transcript IO where summary metadata permits, while the
  navigation generation still owns the only visible commit.
- The previous complete transcript remains as a dimmed, non-interactive frame
  while React prepares a changed session's Markdown tree; reduced motion uses a
  static progress track. Decision D162.

## 2026-07-28 — Compact sidebar session titles

- Expanded-sidebar session titles use `--text-md` (13px), matching the compact
  project/group tier while primary actions and footer identity remain at
  `--text-base` (14px).
- Row height, truncation, indentation, weight, and sidebar dimensions remain
  unchanged.
- Decision D161; refines D159's session-title size.

## 2026-07-29 — Native width reservation for the fixed work panel

- The docked panel now keeps its committed `364..720px` width while open;
  native edges resize MainChat only.
- Open, collapse/final close, and divider commit set one idempotent native-width
  target. Chat remains stable when the work area can reserve the full width and
  absorbs only the unavoidable shortfall otherwise.
- Maximized/fullscreen geometry waits for normal state. Persisted base bounds
  exclude reservation width/x shift, and background artifacts cannot change the
  visible target.
- Decision D163; ADR 0032 (the window-expansion portion is superseded by ADR 0033:
  the work panel is an internal dock that never expands the OS window). This
  supersedes the contrary portions of D156 and ADR 0029.

## 2026-07-29 — Dual-locale in-app product changelog

- Ship EN + zh-CN product highlights in `packages/shared` and attach them to
  `UpdateState.releaseNotes` from Electron Main when an update is discovered.
- The update banner and Settings → Info surface a compact What's new list in
  the active product locale without a new feed or IPC domain.
- Release tagging requires updating both locale catalogs before the tag build.
- Decision D164; extends D120 / ADR 0022.

## 2026-07-29 — Release process: mandatory dual-locale changelog gate

- Stable app version bumps / tags **must** update
  `packages/shared/src/changelog.ts` (EN + zh-CN) before the tag; shipping
  without catalog entries is a release process failure (D164).
- Codified in the release runbook §4.1, AI development workflow matrix +
  forbidden practices, change checklist, `AGENTS.md`, and `scripts/release.mjs`
  header so agents and humans hit the same gate.
- GitHub auto-generated release notes remain web-only.

## 2026-07-29 — Bounded atomic tool batches in context checkpoints

- Automatic compaction now bounds an oversized final parallel tool-result
  batch inside the checkpoint copy instead of repeatedly failing at the same
  transcript boundary.
- The retained copy preserves every call/result envelope, distributes text
  budget fairly with explicit head/tail truncation markers, and omits duplicate
  provider-irrelevant details; original transcript rows remain complete.
- Decision D158; amends ADR 0030's previous policy of blocking an indivisible
  batch above the retained-tail cap.

## 2026-07-29 — Safe lazy Mermaid diagrams in assistant answers

- Completed `mermaid` fences in answer prose render through a dynamically
  loaded, theme-aware Mermaid chunk only near the viewport; partial streams and
  thinking prose remain source code.
- Rendering is serialized and bounded at 20,000 source characters / 500 edges.
  Strict Mermaid configuration plus DOMPurify SVG sanitization removes links,
  embedded media, foreign HTML, and URL attributes before DOM insertion.
- Invalid or oversized diagrams fall back to source with copy and view controls;
  no IPC, storage, process, CSP, or external-network boundary changes.
- Decision D165.

## 2026-07-31 — Slimmer default work-panel width

- The docked work panel now opens at 280px instead of 420px, a third narrower,
  and its fixed clamp becomes `244..720px`.
- `WORK_PANEL_DEFAULT_WIDTH`, `WORK_PANEL_MIN_WIDTH` (renderer and Electron
  Main), and the `.work-panel` CSS floor stay in sync; divider double-click
  restores the new default.
- D154's 364px floor was sized for a 44px activity rail beside 320px of content;
  the rail became a header switcher, so the floor scales with the default.
- Persisted wider widths remain valid, and the 720px maximum is unchanged.
- Decision D167; supersedes the width clamp in D154/D163 and ADR 0033 §4.

## 2026-07-31 — Project archive presentation redesign

- Settings → Project archive is rebuilt as three bands: an overview banner with
  four derived counters, a search + Recent/Name sort toolbar, and a grouped
  index in the order Pinned / All projects / Archived with per-section counts.
- Rows gain an always-visible disclosure control, state tags, a single meta line
  (path, branch, session count), a relative last-active time, and a quick New
  task action beside the row menu; the menu now groups create/edit above pin,
  archive/restore, and Close and dismisses on Escape or outside press.
- Archived records stay grouped and softened rather than filtered, so the
  destination still has no visibility toggle (D133). Project storage, search
  matching, batch-of-eight session reveal, and activation semantics are
  unchanged.
- Decision D168; supersedes D133's flat-list presentation.

## 2026-07-31 — Plugins page redesign

- The Plugins page is rebuilt as four bands: an overview band with four derived
  counters (installed, enabled, updates, high-risk access), a header that keeps
  one contextual primary action and moves check-updates / apply-auto-updates /
  install-package / load-local into an overflow menu, a segmented
  Installed / Marketplace switch carrying counts, and the tab body.
- Installed rows group by state as Needs attention / Updates available /
  Active / Turned off inside one hairline-separated panel. `status: "error" |
  "load_error"` and `errorMessage` are now surfaced instead of dropped; row
  actions collapse to a hover-revealed panel button plus an overflow menu
  (auto-update, Uninstall as a danger item) beside an always-visible switch.
- Permissions are tiered from the risk column of
  `07-plugins/13-plugin-permissions-matrix.md`: risk-tinted chips with collapsed
  overflow on rows, and High / Medium / Low sections in the detail sheet and the
  install dialog. Upgrade reviews tag permissions the new version adds as New,
  and the install queue deduplicates the declared set against the diff.
- Details move from a nested sidebar to a right-side sheet (scrim, Escape and
  outside-press dismiss, sticky install action, selectable version rows).
  Marketplace cards render a monogram glyph and never fetch `iconUrl`, so the
  renderer performs no remote image loads.
- Decision D169; supersedes the flat list, pill tabs, and inline detail pane of
  `07-plugins/07-plugin-marketplace.md` §7/§14.

## 2026-07-31 — Renderer stylesheet split into per-surface partials

- `apps/desktop/src/styles/globals.css` becomes an import-only entry point. The
  rules move into 22 partials in the same directory, each owning one surface:
  `tokens`, `base`, `chrome`, `chat-shell`, `composer`, `sidebar-threads`,
  `messages`, `prose`, `ui-kit`, `overlays`, `theme-overrides`,
  `composer-menus`, `settings`, `destinations`, `projects`, `sessions`,
  `work-panel`, `providers`, `chat-links`, `composer-autocomplete`, `plugins`,
  `responsive`.
- Import order **is** the cascade and must not be reordered: tokens and base
  first, feature layers in build order, the responsive / reduced-motion tail
  last so it can still override what precedes it.
- The split is contiguous — no rule changed position relative to another. The
  joined partials reproduce the pre-split file byte for byte, and the built
  renderer CSS is byte-identical before and after, so Tailwind v4 resolves the
  `@theme` block from `tokens.css` unchanged.
- Style assertions load the effective cascade through
  `apps/desktop/test/helpers/styles.mjs`, which inlines the local `@import`
  lines in declaration order. Tests must not read a partial directly.
- Sidebar session styles live in both `sidebar-threads.css` and `sessions.css`
  because the original file interleaved them; the file headers cross-reference.
- The design-token scales now live in `styles/tokens.css`; the guard in
  `scripts/check-style-tokens.mjs` walks the whole `src` tree and is unaffected.
- Decision D170; the single-file layout assumed by `04-ux/07-ui-design-system.md`
  §Typography and `04-ux/08-component-spec.md` no longer holds.


## 2026-07-31 — Plugin skills activation and the plugin devkit

- `contributes.skills` is activated. `PluginRuntime.getSkills()` reads each
  declared skill file at prompt time, only for plugins granted
  `agent.prompt.inject`, and only through the containment guard the gated `fs`
  APIs use. The agent runtime renders a `# Plugin skills` section capped at
  16 KiB total and 8 KiB per skill — its own budget, not the 32 KiB instruction
  chain of ADR 0037 — and orders it after the built-in skills but before
  project instructions, so a user's own files keep the last word. Runtime reuse
  keys on a skills digest, so enabling a plugin, revoking the permission, or
  editing a skill file retires the idle runtime instead of reusing a stale
  prompt. Closes roadmap gap R2.
- Plugin authoring ships as a first-party package, `@pi-desktop/plugin-devkit`,
  which owns `scaffold` / `check` / `pack` over one implementation shared by the
  `pi-plugin` CLI, the `PluginScaffold` / `PluginCheck` / `PluginPack` agent
  tools served from Electron main, and the plugins page's New plugin from
  template action. `check` reproduces the rules host-core enforces, so passing
  it implies install will pass; `pack` writes store-only (method 0) `.piplug`
  entries because `extract_zip_bytes` accepts nothing else. Closes roadmap gap
  R3's template and `check`/`pack` items.
- A bundled plugin was rejected as the delivery vehicle: a plugin cannot produce
  a `.piplug` (no archive API in `HOST_API_ALLOWLIST`) and scaffolding would
  need high-risk `fs.write.workspace` for a capability the application should
  provide itself.
- The built-in `plugin-development` skill activates only for plugin workspaces —
  a plugin `manifest.json` at the workspace root, or a loaded development plugin
  inside it — so an ordinary session pays only for three tool descriptions.
- Development plugins are watched and hot reload on save, debounced 300 ms,
  ignoring `node_modules` / `.git` / `dist` / `target`, capped at 16 plugins, and
  re-armed across restarts. A reload can never widen a permission set: the
  manifest is compared against the set approved when the folder was picked and a
  new permission stops the reload with `PERMISSION_DENIED`, while removed
  permissions do take effect. A failed reload keeps the watch so the fixing save
  recovers the plugin, and reports through a toast plus `pluginChanged` —
  host-core has no RPC for a runtime-side load failure, so the registry row does
  not move to `load_error`. Closes roadmap gap R3's hot-reload item.
- Decision D171; recorded as ADR 0039.
- The prompt-injection half of this decision was replaced the same day by
  D174: skills now reach the model as a catalog plus a `Skill` tool. The devkit,
  hot-reload and workspace-gate clauses stand unchanged.

## 2026-07-31 — Creating a plugin from a template opens the folder

- Creating a plugin from a template now also opens the chosen folder as the
  active project (`workspace.set`, which registers the project and switches to
  chat), not just as a loaded development plugin. Loading only makes the plugin
  run; development needs the sources inside the workspace the agent, the file
  panel and the built-in `plugin-development` skill all read, and requiring the
  user to re-pick the same folder through Open folder was pure friction.
- The activation runs in the renderer through the existing `activateProject`
  action rather than from the template IPC handler, so project state, the sidebar
  project list and the navigation intent guard keep their single owner.
- The success toast distinguishes the two outcomes: if the folder cannot be
  opened as a project the plugin stays loaded and the toast says only that,
  instead of claiming a workspace that is not there.
- Loading an existing local plugin folder (Load local plugin) deliberately keeps
  its current behavior: running someone else's plugin is not a reason to switch
  the user's project.
- Decision D172; no ADR — this completes the flow ADR 0039 describes.

## 2026-07-31 — Work panel header menu: tools first, no duplicated entries

- The unified header menu lists the four tools (Review, Terminal, Browser,
  Files) first, in a fixed order, and only then — after a divider, and only when
  they exist — the resources the transcript opened. The previous layout listed
  every open tool twice: once in the resource switcher and again in the
  create-new section, which made "open" and "switch to" indistinguishable.
  Each tool row now carries its own open state and its own close control, so a
  single row is the whole affordance for that tool.
- Activating a tool that is already open activates its existing tab instead of
  replacing it with a fresh singleton, so the Browser keeps its URL. The header
  action cluster is pinned right (`margin-left: auto`) so the close/collapse
  controls no longer slide with the label length, and the trailing close slot in
  each row is always reserved so labels and open dots never shift.
- Menu rows own real DOM focus (WAI-ARIA menu pattern) rather than a roving
  highlight: the trigger's ArrowDown/ArrowUp opens on the active or last row,
  Arrow/Home/End walk rows only, Delete/Backspace closes the focused row while
  the menu stays open with focus on its neighbor, and Escape/Tab/selection
  return focus to the trigger. Only a session switch dismisses the menu
  implicitly — selecting a row closes it explicitly, so the previous
  active-tab-keyed auto-dismiss (which fired whenever a background artifact
  changed the active tab) is gone.
- Missing `panel.tabs.file` was the reason a bare Files tab showed a literal
  `file` label; the catalogs now carry it plus `panel.tools`, and the obsolete
  `panel.openTool` is removed.
- Decision D173; no ADR — presentation and input handling only, inside the
  existing work-panel architecture (ADR 0033).

## 2026-07-31 — Plugin skills are model-invoked

- `contributes.skills` is activated at load time behind `agent.prompt.inject`.
  Each entry may be a path or `{ path, id?, name?, description? }`; front matter
  in the document supplies `name` / `description` when the manifest does not.
- The base system prompt carries only a catalog — skill id, name, and a
  description trimmed to 240 chars. Bodies are not in the prompt; the model
  fetches one through a built-in `Skill` tool that Electron main serves locally
  against `plugins.loadSkillBody(id)`, so the sidecar never holds skill text.
- Caps: 32 skills per plugin, 128KB per document. A manifest without
  `agent.prompt.inject` still validates — skills predate the permission gate — and
  the runtime simply skips them.
- Skill ids join the runtime-reuse key in `packages/agent-runtime/src/runtime.ts`,
  so enabling or disabling a plugin rebuilds the runtime instead of serving a
  stale catalog.
- Rejected: user-facing slash commands. A skill is guidance the agent should
  reach for when a task calls for it, not a command the user has to know exists.
- Decision D174; closes the "parsed but never activated" gap in
  `07-plugins/14-plugin-roadmap.md` R2.

## 2026-07-31 — Plugin themes ship CSS files

- `contributes.themes` declares `{ id, label, path, base? }` and requires
  `ui.theme`. `path` is a plugin-relative `.css` file; `base` (`light` | `dark`,
  default `dark`) names the palette the overrides layer on.
- The main process reads the file and runs `sanitizeThemeCss()`: no `@import`, no
  `url()` outside `data:`, no unparseable `url(`, no `javascript:` /
  `expression(`, no markup sequences, 256KB cap, 8 themes per plugin. The
  renderer receives finished text over `plugin/themes` and injects it into one
  `<style id="pi-plugin-theme">` appended after the app's own stylesheets.
- `AppSettings.theme` widens to `plugin:<pluginId>:<themeId>`. When the providing
  plugin is disabled, uninstalled, or fails to load, the app falls back to
  `system` rather than rendering an unstyled shell.
- Rejected: a token-JSON contribution. It would have been safer to validate, but
  it can only express the tokens we thought to enumerate; a stylesheet lets a
  theme reach a surface the token list forgot, and the sanitizer plus
  append-order rule bound the risk to appearance.
- Decision D175.

## 2026-07-31 — Plugin MCP servers over stdio and remote HTTP

- `contributes.mcpServers` declares `{ id, label?, transport }` plus exactly one
  transport's fields: `stdio` takes `command` / `args` / `env`, `http` takes
  `url` / `headers`. Permissions are separate: `mcp.server.local` for stdio,
  `mcp.server.remote` for HTTP.
- `apps/desktop/electron/main/plugin-mcp.ts` speaks protocol `2025-06-18` —
  `initialize`, `tools/list`, `tools/call` — as NDJSON over stdio or streamable
  HTTP/SSE. Budgets: 10s connect, 100s per call, 8 `tools/list` pages, 4MB per
  stdio line, 64 tools per server, 8 servers per plugin. Connection is lazy;
  teardown follows unload.
- Discovered tools register as `plugin_<pluginIdSafe>_<serverId>_<toolName>` in
  the existing plugin tool map, so they inherit the audit trail, the timeout, and
  the disable switch with no new routing. They are always `risk: "medium"`: the
  schema and description come from a third party, so a self-declared risk level
  is not trustworthy.
- `env` and `headers` resolve only from the plugin's own settings via
  `{ "setting": "<key>" }`; the host environment is never passed through (D018).
  A stdio child gets `PATH`, temp/locale vars, and the declared values — nothing
  else. `command` must be a bare PATH name or plugin-relative; `url` must be
  `https` unless the host is loopback.
- Both transports ship rather than stdio alone: a hosted MCP endpoint is common
  enough that stdio-only would have pushed plugins to wrap it in a local shim,
  which is strictly worse — an extra process and an unreviewable proxy.
- Decision D176; ADR [0038](../../adr/0038-plugin-mcp-bridge.md).

## 2026-07-31 — Resident plugin services and their restart policy

- `contributes.services` declares `{ id, label?, autoRestart? }` behind
  `background.service`, at most 4 per plugin. The plugin calls
  `pi.services.register({ id, start, stop })`; the broker calls `start` after
  `onLoad` (5s budget) and `stop` before `onUnload`, so a service is never live
  outside the plugin's own lifetime.
- A service lives in the plugin's `utilityProcess`, so a crash takes it down with
  the process and the supervisor restarts the whole plugin: backoff 1s, 2s, 4s,
  8s, 16s capped at 30s; at most 5 attempts; a process that survives 60s is
  healthy and the counter resets. `autoRestart: false` opts out. After the last
  attempt the plugin stays `failed` — a visible failure beats a silent crash
  loop.
- Per-service state (`starting` | `running` | `stopped` | `failed`) and the
  restart count are read over `plugin/services` and rendered as chips on the
  Plugins page; every transition emits `pluginChanged` with `reason: "service"`
  and a `plugin.service.*` audit entry.
- Manual enable / disable outranks the supervisor: an explicit action cancels the
  pending timer and clears the attempt counter.
- Decision D177; ADR
  [0040](../../adr/0040-plugin-resident-services-and-message-bus.md).

## 2026-07-31 — Inter-plugin message bus routes declared topics only

- `pi.bus.publish` / `subscribe` require `bus.publish` / `bus.subscribe` **and** a
  matching entry in `contributes.bus`: publishers list concrete topics,
  subscribers list patterns. A granted permission alone routes nothing, so the
  manifest stays a complete description of what a plugin says and hears.
- Topics are dot-separated segments (`[a-zA-Z0-9][a-zA-Z0-9_-]*`, ≤8 segments,
  ≤128 chars). `*` matches one segment; `**` matches one or more trailing
  segments and may appear only last.
- Routing lives in the broker. A message carries `topic`, `from`, `payload`, and
  a host-assigned `at`; the publisher is excluded from its own fan-out; delivery
  is fire-and-forget over a new one-way `{ t: "event" }` frame, so a wedged
  subscriber cannot stall the sender. That frame also makes the previously
  stubbed `pi.events.on` / `off` real.
- Caps: 64KB per payload, 16 subscriptions per plugin, 100 publishes per rolling
  10s window, failing with `LIMIT_EXCEEDED` / `RATE_LIMITED` and an audit line.
- A payload conveys data, never capability: receiving a message grants the
  subscriber nothing it did not already hold, so a topic should be treated as
  public within the app.
- Decision D178; ADR
  [0040](../../adr/0040-plugin-resident-services-and-message-bus.md).

## 2026-08-02 — Bash tool inherits the user's login-shell PATH

- On Unix, the first Bash call probes the user's login shell for its PATH —
  `$SHELL` (fallback `/bin/zsh` → `/bin/bash` → `/bin/sh`) with `-lic
  'printf %s "$PATH"'` — so `-l` sources login files and `-i` sources the
  interactive rc, matching a fresh terminal. The probe is bounded to 5s and
  cached per process (`OnceLock`); only the last stdout line is kept (rc
  banners are ignored), stderr is discarded (missing-tty noise), and a
  non-zero exit, missing shell, or timeout silently falls back to the host
  PATH.
- Every Bash subprocess gets the probed PATH injected via `cmd.env("PATH",
  ...)`; `bash -lc` still re-runs the bash profile at startup (conda/brew
  hooks may prepend/dedupe/reorder entries on top of the injected base).
  Agent commands remain POSIX bash; the resolved bash binary is unchanged.
  Windows keeps `bash -c` with the host environment (no change).
- Fixes macOS Finder/Dock launches where `bash -lc` alone cannot see nvm,
  pnpm, or Homebrew tooling initialized in `~/.zshrc` / `~/.zprofile`.
- Decision D181; ADR
  [0045](../../adr/0045-bash-inherits-user-login-path.md).

## 2026-08-02 — Route process logs into category files

- The `app`, `host`, and `agent` channels remain local NDJSON files, but each
  channel is now a directory containing focused `<category>.log` files. App
  records use explicit lifecycle/session/tool/permission/plugin/provider/
  persistence/updater/diagnostics/terminal/runtime categories; host and agent
  stderr is classified into the same categories, with timing lines isolated
  in `timing.log`.
- Every record carries a `category` field. Child stderr is buffered by line,
  decoded as UTF-8, and stripped of ANSI control sequences before it is
  persisted. Unknown child output goes to `runtime.log`.
- Rotation remains 5 MB with two rotated files, but the limit applies to each
  category file. The logger uses byte length for UTF-8 records and treats
  rotation and disk failures as best effort. Existing flat log files are not
  deleted during migration.
- Decision D182; ADR [0046](../../adr/0046-categorized-process-logs.md).

## 2026-08-02 — Context usage inspector

- Replace the oversized context ring with a compact Codex-style trigger that
  combines a remaining-capacity ring, `Context` label, and percentage. Hover
  and keyboard focus open a non-modal panel with the context window, exact
  provider input/output/cache/reasoning usage, aggregate generation speed in
  `tokens/s`, and each unique tool type in first-seen execution order.
- Tool rows aggregate repeated calls and expose call count, argument tokens,
  result tokens, total estimated footprint, share bar, and cumulative known
  duration. Runtime estimates use pi-agent-core's existing four-characters-
  per-token heuristic; provider-reported usage remains the authoritative total
  and the UI labels tool rows as estimates.
- Generation speed is a completed-turn snapshot from provider output and final
  stream duration; active assistant streams do not show a live token-rate
  counter.
- The context-window total comes from the matching `pi-ai` model metadata used
  by the agent sidecar; provider metadata and the 128K default remain fallbacks
  for unknown models.
- `UiMessage.responseDurationMs`, `UiMessage.toolUsage`, and the optional
  `tool_end.toolUsage` event field are additive, so older persisted messages
  and peers remain readable.
- The inspector panel is rendered at the document body level as a fixed,
  collision-aware viewport overlay. It follows transcript scroll and window
  resize, flips around the trigger, and clamps to viewport margins instead of
  being clipped by the transcript scroll container.
- The inspector resolves its context-window total from the same `pi-ai` model
  record passed to the agent sidecar, enriching cached/discovered model rows;
  provider metadata and the 128K default remain fallbacks for unknown models.
- Decision D184; ADR [0047](../../adr/0047-context-usage-inspector.md).

## 2026-08-02 — Lazy per-turn tool activation

- The sidecar keeps a complete local registry but sends only the mode's core
  tools, `CompactContext` when enabled, and local `ToolSearch` on a new prompt.
  Agent follows pi's coding-agent core (`Read`/`Bash`/`Edit`/`Write`), while
  Chat keeps (`Read`/`Glob`/`Grep`). Agent-mode `Glob`/`Grep`,
  `BrowserPreview`, plugin tools, `Skill`, and plugin-development helpers are
  represented by bounded compact catalog entries instead of full parameter
  schemas.
- An exact-name or capability search activates at most four matches for the
  next model turn. `addedToolNames` lets pi-ai providers with native deferred
  search serialize those definitions at the load point; other providers use
  the rebuilt active tool list. Activation resets before the next user prompt.
- Host permissions, workspace and scratch containment, timeouts, and audit
  behavior are unchanged. Persisted tool results retain activation markers for
  valid transcript reconstruction.
- Decision D185; ADR [0048](../../adr/0048-lazy-per-turn-tool-activation.md).

## 2026-08-04 — Bound provider stream recovery and diagnostics

- Provider request setup now has one bounded pi-ai retry. A transient stream,
  network, or timeout failure after streaming begins gets one same-turn retry
  with a short abortable backoff; the failed assistant is removed from model
  context and the visible assistant id is reused.
- `terminated` and equivalent incomplete stream messages map to
  `STREAM_FAILED`. A second failure remains terminal and carries bounded phase,
  timing, provider status/code, and retry-attempt diagnostics when available.
- Mutation recovery is explicitly finite: use `Edit` for one unique local
  replacement, use `Write` for a coherent rewrite, then allow one fresh
  read/regeneration after a mismatch. A second same-path `Edit` failure emits
  the terminating tool hint instead of repairing an old patch artifact.
- Decision D186; see [ADR 0050](../../adr/0050-bounded-provider-stream-recovery.md).

## 2026-08-04 — Recover automatic compaction failures with a retained tail

- Automatic threshold and provider-overflow compaction failures now attempt a
  deterministic, aggressively bounded retained-tail checkpoint before ending
  the turn. The previous checkpoint summary is preserved when available, the
  complete visible transcript remains untouched, and host persistence plus the
  hard-budget recheck remain mandatory.
- The summary input is preflighted against the model window so an obviously
  oversized summary request goes directly to the bounded recovery path instead
  of waiting for a provider rejection or timeout.
- The lifecycle event marks recovery with `fallback: "retained_tail"`, so the
  renderer keeps the run active and shows a warning. Manual `/compact` remains
  fail-fast and never silently discards historical context.
- Decision D158; amends ADR 0030 and adds ADR 0049.
