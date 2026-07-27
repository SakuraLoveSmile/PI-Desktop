import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

const appSource = await readFile(
  new URL("../src/App.tsx", import.meta.url),
  "utf8",
);
const mainSource = await readFile(
  new URL("../electron/main/index.ts", import.meta.url),
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

test("work panel docks as an app-shell column, not a main-pane overlay", () => {
  // Rendered after the main pane closes, as a shell sibling.
  assert.match(appSource, /<\/section>\s*\{workPanelOpen && \(?\s*<WorkPanel/);
  // Docked column participates in flex layout instead of overlaying.
  assert.match(globalStyles, /\.work-panel \{[^}]*flex: 0 0 auto/s);
  assert.doesNotMatch(
    globalStyles.match(/\.work-panel \{[^}]*\}/s)?.[0] ?? "",
    /position:\s*absolute/,
  );
});

test("work panel renders only dynamic artifact tabs with close controls", () => {
  const headerIndex = panelSource.indexOf('<header className="work-panel-header">');
  const tabsIndex = panelSource.indexOf('className="work-panel-tabs no-drag"');
  const bodyIndex = panelSource.indexOf('<div className="work-panel-body">');

  assert.ok(headerIndex > -1 && tabsIndex > headerIndex && bodyIndex > headerIndex);
  assert.match(panelSource, /tabs\.map\(\(tab\) =>/);
  assert.doesNotMatch(panelSource, /TOOL_TABS\.map|WelcomePane|work-welcome/);
  assert.match(panelSource, /role="tablist"/);
  assert.match(panelSource, /role="tab"/);
  assert.match(panelSource, /aria-selected=\{selected\}/);
  assert.match(panelSource, /aria-controls=\{`work-panel-surface-\$\{tab\.id\}`\}/);
  assert.match(panelSource, /role="tabpanel"/);
  assert.match(panelSource, /className="work-panel-tab-close"/);
  assert.match(panelSource, /closeTab\(tab\.id\)/);
  assert.doesNotMatch(panelSource, /collapsePanel/);
  assert.doesNotMatch(panelSource, /work-panel-collapse/);
  assert.match(appSource, /data-action="collapse-work-panel"/);
  assert.match(appSource, /SessionPaneWorkPanelCollapse/);
  assert.match(panelSource, /activeTabRef\.current\?\.scrollIntoView/);
  assert.match(panelSource, /inline:\s*"nearest"/);
  assert.doesNotMatch(panelSource, /work-panel-rail/);
  assert.match(
    globalStyles,
    /\.work-panel-tabs \{[^}]*display:\s*flex;[^}]*overflow-x:\s*auto;/s,
  );
  assert.match(globalStyles, /\.work-panel-tab-close \{[^}]*opacity:\s*0;/s);
  assert.doesNotMatch(globalStyles, /\.work-panel-rail(?:-btn)?\s*\{/);
});

test("work panel starts closed with no tabs and persists width only", () => {
  assert.match(storeSource, /workPanelOpen:\s*false/);
  assert.match(storeSource, /workPanelTabs:\s*\[\]/);
  assert.match(storeSource, /activeWorkPanelTabId:\s*null/);
  assert.match(storeSource, /JSON\.stringify\(\{ width \}\)/);
  const persistenceBlock =
    storeSource.match(/function saveWorkPanelWidth[\s\S]*?\n\}/)?.[0] ?? "";
  assert.doesNotMatch(persistenceBlock, /workPanelContexts|tabs|open/);
});

test("work panel resizing preserves a readable main pane", () => {
  assert.match(panelSource, /const MAIN_PANE_MIN_WIDTH = 360;/);
  assert.match(panelSource, /window\.innerWidth - sidebarWidth - MAIN_PANE_MIN_WIDTH/);
  assert.match(panelSource, /\.sidebar, \.sidebar-rail/);
  assert.match(globalStyles, /\.main-pane \{[^}]*min-width:\s*360px;/s);
});

test("work panel window growth is excluded from persisted launch bounds", () => {
  assert.match(mainSource, /let panelWindowWidthOffset = 0;/);
  assert.match(
    mainSource,
    /width:\s*bounds\.width - panelWindowWidthOffset/,
  );
  assert.match(
    mainSource,
    /panelWindowWidthOffset = Math\.max\(0, panelWindowWidthOffset \+ applied\)/,
  );
});

test("Windows work panel toggles without resizing the frameless window", () => {
  assert.match(
    storeSource,
    /function canResizeWindowForPanel\(\) \{\s*return window\.piDesktop\?\.platform !== "win32";/,
  );
  assert.match(
    storeSource,
    /function expandWindowForPanel\(width: number\) \{\s*if \(!canResizeWindowForPanel\(\)\) \{\s*panelWindowGrowth = 0;\s*return;/,
  );
  assert.match(
    storeSource,
    /function shrinkWindowForPanel\(width: number\) \{\s*if \(!canResizeWindowForPanel\(\)\) \{\s*panelWindowGrowth = null;\s*return;/,
  );
  assert.match(
    storeSource,
    /if \(canResizeWindowForPanel\(\) && get\(\)\.workPanelOpen && next !== prev\)/,
  );
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
    /openedVisiblePanel = affectsVisibleSession && !context\.open/,
  );
  assert.match(
    openForSessionBlock,
    /\.\.\.\(affectsVisibleSession[\s\S]*workPanelOpen:\s*true[\s\S]*:\s*\{\}\)/,
  );
  assert.match(
    openForSessionBlock,
    /if \(openedVisiblePanel\) expandWindowForPanel/,
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
