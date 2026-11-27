# PI-UI-1122: copy and download chat images from the image itself

Status: 待体验 (code validated; merged as PR #100, merge commit `3a709f373`, and shipped in v0.15.22). Project: `fork-pi-desktop`. Created: 2026-11-19 (Asia/Taipei).
Tier: T1 (user-visible feature; no new IPC, no permission change).
Branch: `feat/20261119-pi-ui-1122-chat-image-copy`.
Worktree: `/Users/sakurasep/Documents/Code/Project/Project Worktree/fork-pi-desktop/20261119-feat-pi-ui-1122-chat-image-copy`.
Merged as [PR #100](https://github.com/SakuraLoveSmile/PI-Desktop/pull/100) on 2026-11-19 (merge commit `3a709f373`) and shipped in v0.15.22 ([PI-REL-01522](PI-REL-01522-macos-release.md)). Merge and release are tracked separately from acceptance; 已验收 is the user's.

## Request and source

Adopt upstream [vastsa/PI-Desktop#1951](https://github.com/vastsa/PI-Desktop/pull/1951)
(`feat(chat): copy and download images from the image itself`, feature commit
`4145f6478c0faff6fc4d8fd7a22041e16a887fd7`, author zszz3). Upstream CI green at
intake. Cherry-pick `-x` preserves authorship and the source line.

## Behavior change

- Markdown local/generated images gain **Copy image** and **Download image** on
  right-click, listed before the existing file actions.
- The generated-image viewer gains a copy button and Cmd/Ctrl+C (unless text is
  selected); copy feedback is an inline status (toasts sit below the modal top
  layer). The viewer/card image menu portals into the dialog's top layer.
- Copy writes PNG (JPEG/JPG/WebP re-encoded via canvas); download names come from
  the URL path without query/fragment, local paths keep their file name.
- No new IPC channel and no main-process permission change.

## Adaptations to the fork

- `ContextMenu.tsx`: restored the fork version and added only the PR's portal
  contribution — `container?: HTMLElement | null` prop, `portalToContainer`
  helper (`createPortal(visiblePortalContent(node), container)` else
  `portalToBody`), `createPortal`/`visiblePortalContent` imports. The fork has no
  `ContextMenuSubmenu`, so the upstream submenu threading is not applicable; the
  upstream item-rendering drift (IconCheck/submenu structure) was not adopted.
- `Markdown.tsx`: `fileTarget` drops upstream's `localToolsAllowed` gate (the
  fork's Markdown never had it); the menu condition becomes
  `openFileMenu && (fileTarget || copyItems.length > 0)`.
- `GeneratedImageViewer.tsx`: dropped upstream drift imports
  (`useSlotSessionId`, `useChatNativeFilesAllowed`/`useChatSessionCapability` —
  the fork lacks these hooks) and the `nativeFilesAllowed` reveal gating; kept
  the fork's unconditional reveal button and added the copy button/status/menu.
- `transcript-reading-position`-style upstream-only infrastructure: none needed.
- Tests, respecting the fork's behavior-test ratchet (no new/changed source-regex
  signatures):
  - `chat-file-reveal-menu.test.mjs`: retired the two obsolete source assertions
    (`openFileMenu(event, { path: localRef… })` and the old `localRef &&
    openFileMenu` condition); reduction only, baseline lowered.
  - `generated-image-context-menu.test.mjs`: kept the four real-hook behavior
    tests; removed the two source-regex wiring tests so the new file adds no
    source/CSS regex assertions.
  - `image-clipboard.test.mjs`, `image-download-name.test.mjs`: pure behavior
    tests, adopted as-is.

## Validation

| Check | Result |
| --- | --- |
| desktop `tsc --noEmit` | pass |
| new image tests (clipboard/download-name/context-menu/reveal-menu) | 25 pass |
| `node --test apps/desktop/test/*.test.mjs` (full) | 4445 tests, 4441 pass, 0 fail, 4 skipped |
| `check-style-tokens` | style tokens OK |
| `check-test-quality` | pass after reduction-only baseline lower (8115 -> 8113) |
| docs `check-locales` / `check-docs` | 95 pairs / 652 pages |
| `generate-scenario-index --check` | 138 suites, 168 ids, current |
| `check-architecture` / `check-agent-policy` | pass |
| `electron-vite build` (candidate) | pass |
| `node scripts/e2e-image-chat.mjs` (real Electron) | pass — `ok:true`, 7 scenarios incl. result-download, batch generation, collapsed previews; clean exit 0 |

Environment: macOS arm64, Node 22.23.2, dependency overlay from the primary
checkout; library `dist` built locally with direct `tsc`. Host binary: primary
`target/debug/pi-desktop-host-core` from `main`; this slice changes no Rust code.

## Risks and remaining work

- The clipboard write itself is manual, matching upstream's own E2E stance
  ("the clipboard step itself is manual"); copy payload selection and PNG
  re-encoding are unit-tested, the image menu behavior-tested. Automated
  image-chat E2E covers download/viewer regression.
- Markdown image menu items are covered by typecheck + the shared image-menu
  behavior tests rather than a dedicated source assertion (retired to respect the
  ratchet); residual risk is the thin Markdown wiring, exercised by image-chat.