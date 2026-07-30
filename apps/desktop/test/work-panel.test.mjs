import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";
import {
  MAIN_PANE_MIN_WIDTH,
  WORK_PANEL_MAX_WIDTH,
  WORK_PANEL_MIN_WIDTH,
} from "../src/lib/work-panel-resize.ts";

const appSource = await readFile(
  new URL("../src/App.tsx", import.meta.url),
  "utf8",
);
const mainSource = await readFile(
  new URL("../electron/main/index.ts", import.meta.url),
  "utf8",
);
const apiSource = await readFile(
  new URL("../src/lib/api.ts", import.meta.url),
  "utf8",
);
const protocolSource = await readFile(
  new URL("../../../packages/shared/src/protocol.ts", import.meta.url),
  "utf8",
);
const panelSource = await readFile(
  new URL("../src/components/workpanel/WorkPanel.tsx", import.meta.url),
  "utf8",
);
const transcriptSource = await readFile(
  new URL("../src/components/ChatTranscript.tsx", import.meta.url),
  "utf8",
);
const storeSource = await readFile(
  new URL("../src/stores/app-store.ts", import.meta.url),
  "utf8",
);
const globalStyles = await readFile(
  new URL("../src/styles/globals.css", import.meta.url),
  "utf8",
);

test("work panel replaces the context panel overlay", async () => {
  await assert.rejects(
    access(new URL("../src/components/ContextPanel.tsx", import.meta.url)),
    { code: "ENOENT" },
  );
  assert.doesNotMatch(appSource, /ContextPanel/);
  assert.doesNotMatch(appSource, /contextOpen/);
  assert.doesNotMatch(appSource, /toggleWorkPanel|nav\.toggleWorkPanel/);
  assert.doesNotMatch(appSource, /key\.toLowerCase\(\) === "j"/);
});

test("work panel is an internal dock that never expands the OS window", () => {
  assert.match(appSource, /presentedWorkPanelOpen/);
  assert.match(appSource, /setPresentedWorkPanelOpen/);
  assert.match(appSource, /workPanelExiting/);
  // Internal-dock redesign (ADR 0033): the panel occupies client-area space
  // and never reserves native window width, so the reservation target is 0.
  assert.match(appSource, /requestedWidth\s*=\s*0/);
  assert.match(appSource, /setWorkPanelReservation\(requestedWidth\)/);
  assert.ok(
    appSource.indexOf("setWorkPanelReservation(requestedWidth)") <
      appSource.indexOf("setPresentedWorkPanelOpen(shouldPresent)"),
    "the native reservation must settle before presentation changes",
  );
  assert.match(appSource, /commitWorkPanelPresentation/);
  assert.doesNotMatch(appSource, /\.finally\(\(\) => \{[\s\S]*setPresentedWorkPanelOpen/);
  // Mount follows presentation commit; exit keep-alive plays work-panel-out
  // before releasing the native reservation and unmounting.
  assert.match(
    appSource,
    /<\/section>\s*\{\(presentedWorkPanelOpen \|\| workPanelExiting\) && \(?\s*<WorkPanel/,
  );
  assert.doesNotMatch(
    appSource,
    /<\/section>\s*\{workPanelOpen && \(?\s*<WorkPanel/,
  );
  assert.match(appSource, /finishWorkPanelExit/);
  assert.match(appSource, /setWorkPanelReservation\(0\)/);
  assert.match(appSource, /onExitAnimationEnd=\{\(\) =>/);
  assert.match(appSource, /finishWorkPanelExit\(workPanelExitGeneration\.current\)/);
  assert.match(panelSource, /browserSetVisible\(false\)/);
  assert.match(panelSource, /nativeSurfaceReadyForExit/);
  assert.match(panelSource, /is-exit-pending/);
  assert.match(panelSource, /exitAnimationReady && "is-exiting"/);
  assert.match(panelSource, /if \(!exitAnimationReady\) return/);
  assert.match(panelSource, /animationName\.startsWith\("work-panel-out"\)/);
  // The panel remains a fixed-width in-flow shell sibling; the window never grows.
  assert.match(globalStyles, /\.work-panel \{[^}]*flex: 0 0 auto/s);
  assert.doesNotMatch(
    globalStyles.match(/\.work-panel \{[^}]*\}/s)?.[0] ?? "",
    /position:\s*absolute/,
  );
  assert.match(globalStyles, /@keyframes work-panel-out/);
  assert.match(globalStyles, /@keyframes work-panel-out-windows/);
  assert.match(
    globalStyles,
    /:root\[data-platform="win32"\] \.work-panel\.is-exiting \{[^}]*animation-name:\s*work-panel-out-windows;/s,
  );
  assert.match(
    globalStyles,
    /@keyframes work-panel-in \{[^}]*translateX\(8px\)/s,
  );
});

test("work panel activity rail exposes tools and keeps resources in a switcher", () => {
  const headerIndex = panelSource.indexOf('className="work-panel-header"');
  const toolListIndex = panelSource.indexOf('className="work-panel-create no-drag"');
  const switcherIndex = panelSource.indexOf('className="work-panel-switcher-trigger"');
  const bodyIndex = panelSource.indexOf('<div className="work-panel-body">');

  assert.ok(toolListIndex > headerIndex && switcherIndex > toolListIndex);
  assert.ok(bodyIndex > headerIndex);
  assert.match(panelSource, /HEADER_TOOLS\.map\(\(\{ kind, Icon \}/);
  assert.match(panelSource, /"work-panel-create-item"/);
  assert.match(panelSource, /aria-expanded=\{createOpen\}/);
  assert.match(panelSource, /data-action=\{`open-work-panel-\$\{kind\}`\}/);
  assert.match(panelSource, /function headerToolTab\(kind: HeaderToolKind\): WorkPanelTab/);
  assert.match(panelSource, /if \(kind === "file"\) return \{ id: "file", kind \}/);
  assert.match(panelSource, /openWorkPanelTab\(headerToolTab\(kind\)\)/);
  assert.match(panelSource, /tabs\.map\(\(tab, index\) =>/);
  assert.match(panelSource, /className="work-panel-switcher-menu"/);
  assert.match(panelSource, /id=\{activeTab \? `work-panel-title-\$\{activeTab\.id\}`/);
  assert.match(panelSource, /role="menuitemradio"/);
  assert.match(panelSource, /aria-checked=\{selected\}/);
  assert.match(panelSource, /data-work-panel-switch-item/);
  assert.match(panelSource, /data-work-panel-menu-item/);
  assert.match(panelSource, /role="tabpanel"/);
  assert.match(panelSource, /className="work-panel-current-close no-drag"/);
  assert.match(panelSource, /className="work-panel-switcher-close"/);
  assert.match(panelSource, /closeTab\(tab\.id\)/);
  assert.doesNotMatch(panelSource, /collapsePanel/);
  assert.doesNotMatch(panelSource, /work-panel-collapse/);
  assert.match(panelSource, /onCollapse/);
  assert.match(panelSource, /work-panel-toolbar-collapse/);
  assert.match(panelSource, /data-work-panel-section="current"/);
  assert.match(panelSource, /panel\.openTool/);
  assert.match(panelSource, /panel\.openItems/);
  assert.match(
    panelSource,
    /blocked=\{[\s\S]*exiting \|\| browserBlocked \|\| switcherOpen \|\| dragWidth !== null[\s\S]*\}/,
  );
  assert.doesNotMatch(panelSource, /onContextMenu|createPortal|work-panel-tools-menu/);
  assert.match(
    globalStyles,
    /\.work-panel-create-menu \{[^}]*position:\s*absolute;[^}]*min-width:/s,
  );
  assert.match(
    globalStyles,
    /\.work-panel-switcher-menu \{[^}]*position:\s*absolute;[^}]*max-height:/s,
  );
  assert.doesNotMatch(globalStyles, /\.work-panel-tabs\s*\{/);
});

test("work panel starts closed with no tabs and persists width only", () => {
  assert.match(storeSource, /workPanelOpen:\s*false/);
  assert.match(storeSource, /workPanelTabs:\s*\[\]/);
  assert.match(storeSource, /activeWorkPanelTabId:\s*null/);
  assert.match(storeSource, /JSON\.stringify\(\{ width \}\)/);
  assert.match(storeSource, /const committedWidth = Math\.round\(width\)/);
  const persistenceBlock =
    storeSource.match(/function saveWorkPanelWidth[\s\S]*?\n\}/)?.[0] ?? "";
  assert.doesNotMatch(persistenceBlock, /workPanelContexts|tabs|open/);
});

test("work panel resizing is independent from the chat viewport", () => {
  assert.equal(MAIN_PANE_MIN_WIDTH, 360);
  assert.equal(WORK_PANEL_MIN_WIDTH, 364);
  assert.equal(WORK_PANEL_MAX_WIDTH, 720);
  assert.match(panelSource, /clampWorkPanelWidth\(width\)/);
  assert.match(panelSource, /workPanelWidthLimits\(\)/);
  assert.doesNotMatch(panelSource, /workPanelWidthContext|viewportWidth|sidebarWidth/);
  assert.doesNotMatch(panelSource, /\.sidebar, \.sidebar-rail/);
  assert.match(globalStyles, /\.main-pane \{[^}]*min-width:\s*0;/s);
  assert.match(mainSource, /displayWorkAreaKey/);
  assert.match(mainSource, /window\.on\("move", reconcileWorkPanelDisplay\)/);
  for (const event of [
    "display-metrics-changed",
    "display-added",
    "display-removed",
  ]) {
    assert.match(mainSource, new RegExp(`screen\\.on\\("${event}"`));
    assert.match(mainSource, new RegExp(`screen\\.removeListener\\("${event}"`));
  }
  assert.match(mainSource, /if \(nextDisplayKey === workPanelDisplayKey\) return/);
  assert.match(mainSource, /if \(isLiveWindow\(\)\) applyWorkPanelReservation\(\)/);
});

test("work panel reservation has a complete renderer-to-main IPC path", () => {
  assert.match(
    protocolSource,
    /windowSetWorkPanelReservation:\s*"pi-desktop\/window\/setWorkPanelReservation"/,
  );
  assert.match(
    apiSource,
    /setWorkPanelReservation:\s*\(width: number\)[\s\S]*IPC\.invoke\.windowSetWorkPanelReservation/,
  );
  assert.match(mainSource, /IPC\.invoke\.windowSetWorkPanelReservation/);
  assert.match(mainSource, /planWorkPanelReservation/);
});

test("native window and work panel resizing have independent owners", () => {
  assert.doesNotMatch(panelSource, /screenX|rightWindowEdgeDelta|ResizeAttributor/);
  assert.doesNotMatch(
    storeSource,
    /windowResizeBy|panelWindowGrowth|expandWindowForPanel|shrinkWindowForPanel/,
  );
  assert.doesNotMatch(mainSource, /windowResizeBy|panelWindowWidthOffset/);
  assert.doesNotMatch(mainSource, /rightWindowEdge|rightEdgeDelta|ResizeAttributor/);
  assert.match(mainSource, /baseWindowBounds/);
  assert.match(mainSource, /workPanelReservation/);
  assert.match(mainSource, /window\.getNormalBounds\(\)/);
  const persistenceBlock =
    mainSource.match(
      /const persistNormalWindowState = \(\) => \{[\s\S]*?\n  \};/,
    )?.[0] ?? "";
  assert.match(
    persistenceBlock,
    /baseWindowBounds\([\s\S]*window\.getNormalBounds\(\)[\s\S]*workPanelReservation/,
  );
  assert.match(persistenceBlock, /writeWindowState\(bounds\)/);
  assert.match(mainSource, /window\.on\("close", \(\) =>/);
  assert.match(mainSource, /persistNormalWindowState\(\)/);
});

test("work panel separator exposes pointer and keyboard resizing", () => {
  assert.match(panelSource, /role="separator"/);
  assert.match(panelSource, /aria-valuemin=\{widthLimits\.min\}/);
  assert.match(panelSource, /aria-valuemax=\{widthLimits\.max\}/);
  assert.match(panelSource, /aria-valuenow=\{Math\.round\(renderWidth\)\}/);
  assert.match(panelSource, /tabIndex=\{0\}/);
  assert.match(panelSource, /startClientX:\s*e\.clientX/);
  assert.match(panelSource, /startWidth/);
  assert.match(panelSource, /workPanelWidthFromPointer/);
  assert.match(panelSource, /requestAnimationFrame/);
  assert.match(panelSource, /event\.key === "ArrowLeft"/);
  assert.match(panelSource, /event\.key === "ArrowRight"/);
  assert.match(panelSource, /event\.key === "Escape" && drag/);
  assert.match(panelSource, /onPointerUp=\{onResizeCommit\}/);
  assert.match(panelSource, /onPointerCancel=\{onResizeCancel\}/);
  assert.match(panelSource, /onLostPointerCapture=\{onResizeCancel\}/);
  assert.match(panelSource, /data-work-panel-resizing/);
  assert.match(globalStyles, /\.work-panel-resize \{[^}]*width:\s*10px;/s);
  assert.match(globalStyles, /touch-action:\s*none/);
  assert.match(globalStyles, /\.work-panel-resize:focus-visible/);
});

test("Electron enforces the responsive shell minimum", () => {
  assert.match(mainSource, /const WINDOW_MIN_WIDTH = 1040/);
  assert.match(mainSource, /const WINDOW_MIN_HEIGHT = 700/);
  assert.match(mainSource, /minWidth:\s*WINDOW_MIN_WIDTH/);
  assert.match(mainSource, /minHeight:\s*WINDOW_MIN_HEIGHT/);
});

test("terminal mounts on demand and survives switches while its tab stays open", () => {
  assert.match(panelSource, /terminalOpen && \(/);
  assert.match(panelSource, /activeTab\?\.kind !== "terminal" && "is-hidden"/);
  assert.match(
    panelSource,
    /<TerminalTab active=\{activeTab\?\.kind === "terminal"\} \/>/,
  );
  assert.match(
    transcriptSource,
    /action === "run" && status === "success"/,
  );
  assert.doesNotMatch(
    transcriptSource,
    /action === "run" && status !== "running"/,
  );
});

test("workspace artifacts attach review to their originating session", () => {
  const bumpIndex = storeSource.indexOf("WORKSPACE_MUTATING_TOOLS.has(toolName)");
  const artifactIndex = storeSource.indexOf("shouldOpenReviewArtifact({");
  const openReviewMatch = storeSource.match(
    /get\(\)\.openWorkPanelTabForSession\(\s*envelope\.sessionId,\s*toolWorkPanelTab\("review"\),?\s*\)/,
  );
  const openReviewIndex = openReviewMatch?.index ?? -1;
  const gateIndex = storeSource.indexOf(
    "if (envelope.sessionId !== get().activeSessionId)",
  );
  assert.ok(bumpIndex > -1, "reviewRev bump exists");
  assert.ok(artifactIndex > bumpIndex, "workspace artifact gate exists");
  assert.ok(openReviewIndex > artifactIndex, "review artifact records its session tab");
  assert.ok(gateIndex > -1, "cross-session gate exists");
  assert.ok(
    openReviewIndex < gateIndex,
    "background artifacts must be recorded before the cross-session early-return",
  );
  assert.match(
    storeSource,
    /shouldOpenReviewArtifact\(\{[\s\S]*toolName,[\s\S]*isError:\s*event\.isError,[\s\S]*result:\s*event\.result/s,
  );
  assert.doesNotMatch(
    storeSource.match(/shouldOpenReviewArtifact\(\{[\s\S]*?\}\)/)?.[0] ?? "",
    /activeSessionId|sessionId/,
  );
});

test("work panel context is retained by session instead of cleared on selection", () => {
  assert.match(storeSource, /workPanelContexts:\s*Record<string, WorkPanelContext>/);
  assert.match(storeSource, /openWorkPanelTabForSession:/);
  const selectBlock =
    storeSource.match(/selectSession: async[\s\S]*?\n  newSession:/)?.[0] ?? "";
  assert.match(
    selectBlock,
    /switchWorkPanelSession\([\s\S]*id/,
  );
  assert.doesNotMatch(selectBlock, /resetWorkPanelContext\(\)/);
  assert.match(
    storeSource,
    /workPanelContexts:[\s\S]*workPanelOpen:[\s\S]*workPanelTabs:[\s\S]*activeWorkPanelTabId:[\s\S]*workPanelFileRequest:/,
  );
});

test("file preview request ids stay unique across session contexts", () => {
  assert.match(storeSource, /let workPanelFileRequestSeq = 0/);
  assert.ok(
    storeSource.match(/seq:\s*\+\+workPanelFileRequestSeq/g)?.length >= 3,
    "open and activation paths must use the shared request sequence",
  );
  assert.doesNotMatch(storeSource, /seq:\s*\([^)]*fileRequest\?\.seq[^)]*\) \+ 1/);
});

test("background panel updates do not replace or resize the visible session", () => {
  const openForSessionBlock =
    storeSource.match(
      /openWorkPanelTabForSession: \(sessionId, tab\) => \{[\s\S]*?\n  \},\n  activateWorkPanelTab:/,
    )?.[0] ?? "";
  assert.ok(openForSessionBlock, "session-scoped tab action exists");
  assert.match(
    openForSessionBlock,
    /pendingSessionSelection === null && state\.activeSessionId === sessionId/,
  );
  assert.match(openForSessionBlock, /workPanelContexts/);
  assert.match(openForSessionBlock, /openWorkPanelTabState/);
  assert.match(
    openForSessionBlock,
    /\.\.\.\(affectsVisibleSession[\s\S]*workPanelOpen:\s*true[\s\S]*:\s*\{\}\)/,
  );
  assert.doesNotMatch(
    openForSessionBlock,
    /setWorkPanelWidth|expandWindowForPanel|windowResizeBy/,
  );
});

test("deleting a session also removes its retained work panel context", () => {
  const deleteBlock =
    storeSource.match(/deleteSession: async[\s\S]*?\n  setSessionSort:/)?.[0] ?? "";
  assert.ok(deleteBlock, "deleteSession action exists");
  assert.match(deleteBlock, /workPanelContexts/);
  assert.match(
    deleteBlock,
    /delete workPanelContexts\[id\]|withoutRecordKey\([^)]*workPanelContexts,\s*id\)/,
  );
});
