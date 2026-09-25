import { readAppSource, readStoreSource, readMainSource, readSettingsSource, readSharedTypesSource } from "./helpers/source-contracts.mjs";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");
const [store, sidebarPreferences, api, app, main, protocol, runtime, titleRuntime, settings, sharedTypes, hostRpc, hostConfigSync] = await Promise.all([
  readStoreSource(),
  read("../src/lib/sidebar-preferences.ts"),
  read("../src/lib/api.ts"),
  readAppSource(),
  readMainSource(),
  read("../../../packages/shared/src/protocol.ts"),
  read("../../../packages/agent-runtime/src/session-title-summarize.ts"),
  read("../src/stores/runtime/session-title-runtime.ts"),
  readSettingsSource(),
  readSharedTypesSource(),
  read("../../../crates/host-core/src/rpc/mod.rs"),
  read("../../../crates/host-core/src/config_sync/domains.rs"),
]);

test("session title summarization is wired through the full desktop path", () => {
  assert.match(protocol, /sessionSummarizeTitle: "pi-desktop\/session\/summarizeTitle"/);
  assert.match(api, /summarizeSessionTitle: \(req: SessionSummarizeTitleRequest\)/);
  assert.match(api, /IPC\.invoke\.sessionSummarizeTitle/);
  assert.match(main, /handle\(IPC\.invoke\.sessionSummarizeTitle/);
  assert.match(main, /resolveAgentRuntimeLaunch\(/);
  assert.match(main, /summarizeSessionTitle\(/);
  assert.match(main, /thinkingLevel: "off"/);
  assert.match(runtime, /completeOneShot\(/);
});

test("automatic title generation runs after the first turn and respects restart-safe custom titles", () => {
  assert.match(store, /event\.type === "agent_end"[\s\S]*triggerAutoTitleSummarization/);
  assert.match(store, /manualTitle/);
  assert.match(store, /!isDefaultSessionTitle\(session\.title\)/);
  assert.match(store, /promptFallbackSessionTitle\(firstUser\.content, ""\)/);
  assert.match(store, /initialSidebarPreferences\.sessionMeta/);
  assert.match(store, /manualTitle: true/);
  assert.match(sidebarPreferences, /manualTitle\?: boolean/);
  assert.match(sidebarPreferences, /raw\.manualTitle/);
  assert.match(store, /kind: "interactive"/);
  assert.match(app, /kind: "task"/);
  assert.match(main, /kind\?: "task" \| "interactive"/);
  assert.match(main, /shouldShowNativeNotification\(/);
});

test("automatic title generation setting and validation tightening contracts", () => {
  // Shared types and host contracts
  assert.match(sharedTypes, /autoGenerateSessionTitles\?: boolean/);
  assert.match(hostRpc, /autoGenerateSessionTitles must be a boolean/);
  assert.match(hostConfigSync, /"autoGenerateSessionTitles"/);

  // Sidebar preferences persistence
  assert.match(sidebarPreferences, /autoTitleAttempted\?: boolean/);
  assert.match(sidebarPreferences, /raw\.autoTitleAttempted/);
  assert.match(sidebarPreferences, /export function markSessionAutoTitleAttempted/);

  // API validation and Settings UI toggle
  assert.match(api, /autoGenerateSessionTitles is invalid/);
  assert.match(settings, /settings\.autoGenerateSessionTitles/);
  assert.match(settings, /autoGenerateSessionTitlesDesc/);

  // Runtime toggle check, pre-IPC persistence, and in-flight guard
  assert.match(titleRuntime, /state\.settings\?\.autoGenerateSessionTitles === false/);
  assert.match(titleRuntime, /meta\.autoTitleAttempted/);
  assert.match(titleRuntime, /state\.sessionMeta\[sessionId\]\?\.autoTitleAttempted/);
  assert.match(titleRuntime, /markSessionAutoTitleAttempted/);
  assert.match(titleRuntime, /persistSessionMeta/);
  assert.match(titleRuntime, /latestState\.settings\?\.autoGenerateSessionTitles === false/);
  assert.match(titleRuntime, /manualSessionTitles\.has\(sessionId\)/);

  // Model output validation tightening
  assert.match(runtime, /URL_PATTERN/);
  assert.match(runtime, /ABSOLUTE_PATH_PATTERN/);
  assert.match(runtime, /truncateGraphemes/);
  assert.match(runtime, /truncateWords/);
});
