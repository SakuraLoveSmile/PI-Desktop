import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  clearPendingPermission,
  permissionSecondsLeft,
  setPendingPermission,
} from "../src/lib/pending-permissions.ts";
import { createNavigationIntentController } from "../src/lib/navigation-intent.ts";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");
const [appSource, chatSurfaceSource, transcriptSource, cardSource, storeSource, browserSource] =
  await Promise.all([
    read("../src/App.tsx"),
    read("../src/components/ChatSurface.tsx"),
    read("../src/components/ChatTranscript.tsx"),
    read("../src/components/PermissionCard.tsx"),
    read("../src/stores/app-store.ts"),
    read("../src/components/workpanel/BrowserTab.tsx"),
  ]);

function permission(sessionId, requestId, receivedAt = 1_000) {
  return {
    sessionId,
    requestId,
    toolCallId: `tool-${requestId}`,
    toolName: "Write",
    argsPreview: { path: `${sessionId}.txt` },
    risk: "high",
    reason: "Modify a workspace file",
    receivedAt,
  };
}

test("pending permissions stay isolated by session and request id", () => {
  const first = permission("session-a", "request-a");
  const second = permission("session-b", "request-b");
  const pending = setPendingPermission(
    setPendingPermission({}, first),
    second,
  );

  assert.deepEqual(Object.keys(pending).sort(), ["session-a", "session-b"]);
  assert.equal(
    clearPendingPermission(pending, "session-a", "stale-request"),
    pending,
  );

  const cleared = clearPendingPermission(pending, "session-a", "request-a");
  assert.equal(cleared["session-a"], undefined);
  assert.equal(cleared["session-b"], second);
});

test("a replacement request survives completion of the older request", () => {
  const oldRequest = permission("session-a", "request-old");
  const newRequest = permission("session-a", "request-new");
  const pending = setPendingPermission(
    setPendingPermission({}, oldRequest),
    newRequest,
  );

  const afterOldCompletion = clearPendingPermission(
    pending,
    "session-a",
    "request-old",
  );
  assert.equal(afterOldCompletion, pending);
  assert.equal(afterOldCompletion["session-a"], newRequest);
});

test("permission countdown uses its absolute receipt time", () => {
  assert.equal(permissionSecondsLeft(1_000, 1_000), 120);
  assert.equal(permissionSecondsLeft(1_000, 61_001), 60);
  assert.equal(permissionSecondsLeft(1_000, 121_000), 0);
  assert.equal(permissionSecondsLeft(1_000, 180_000), 0);
});

test("permission approval is an inline transcript card, never a global dialog", () => {
  assert.doesNotMatch(appSource, /PermissionDialog/);
  assert.doesNotMatch(chatSurfaceSource, /PermissionDialog/);
  assert.doesNotMatch(appSource, /Boolean\(permission\)/);
  assert.match(chatSurfaceSource, /pendingPermission=\{activePermission\}/);
  assert.match(transcriptSource, /key=\{pendingPermission\.requestId\}/);
  assert.match(transcriptSource, /permission=\{pendingPermission\}/);
  assert.doesNotMatch(cardSource, /className="overlay"|className="dialog"/);
  assert.doesNotMatch(cardSource, /role="alertdialog"/);
  assert.match(cardSource, /role="region"/);
  assert.match(cardSource, /disabled=\{resolving\}/);
  assert.match(cardSource, /requestAnimationFrame/);
  assert.match(cardSource, /showToast/);
  assert.doesNotMatch(cardSource, /<section[^>]*aria-live=/);
  assert.match(cardSource, /permissionSecondsLeft\(permission\.receivedAt\)/);
  assert.match(browserSource, /palette or search/);
  assert.doesNotMatch(browserSource, /permission dialog/);
});

test("background permission events update only session-scoped state", () => {
  assert.match(
    storeSource,
    /pendingPermissions:\s*Record<string, PendingPermission>/,
  );
  assert.doesNotMatch(storeSource, /permission\?:\s*ToolPermissionRequest/);
  const backgroundBlock = storeSource.match(
    /if \(envelope\.sessionId !== get\(\)\.activeSessionId\)[\s\S]*?return;/,
  )?.[0];
  assert.ok(backgroundBlock);
  assert.match(backgroundBlock, /setPendingPermission/);
  assert.doesNotMatch(
    backgroundBlock,
    /selectSession|activeSessionId:\s*|messages:\s*|page:\s*/,
  );
  assert.match(
    storeSource,
    /resolvePermission: async \(sessionId, requestId, decision\)/,
  );
  assert.match(
    storeSource,
    /clearPendingPermission\([\s\S]*state\.pendingPermissions,[\s\S]*sessionId,[\s\S]*requestId/,
  );
  const abortBlock = storeSource.match(/abort: async[\s\S]*?\n  openProject:/)?.[0] ?? "";
  assert.match(abortBlock, /Promise\.allSettled/);
  assert.match(abortBlock, /decision: "deny"/);
  assert.match(abortBlock, /pendingPermission\?\.requestId/);
});

test("new navigation intents invalidate older asynchronous commits", async () => {
  const navigation = createNavigationIntentController();
  let releaseOlder;
  const olderGate = new Promise((resolve) => {
    releaseOlder = resolve;
  });
  const committed = [];

  const older = (async () => {
    const intent = navigation.begin();
    await olderGate;
    if (navigation.isCurrent(intent)) committed.push("older");
  })();
  const newerIntent = navigation.begin();
  if (navigation.isCurrent(newerIntent)) committed.push("newer");
  releaseOlder();
  await older;

  assert.deepEqual(committed, ["newer"]);
});

test("session and page navigation share the latest-intent guard", () => {
  assert.match(storeSource, /createNavigationIntentController/);
  assert.match(storeSource, /let sessionSelectionQueue: Promise<void>/);
  assert.match(storeSource, /opts\?\.navigationIntent \?\? beginNavigationIntent\(\)/);
  assert.match(storeSource, /sessionSelectionQueue\.then\(selectLatest, selectLatest\)/);
  assert.ok(
    storeSource.match(/navigationIntentIsCurrent\(intent\)/g)?.length >= 12,
    "navigation intent must be checked after asynchronous boundaries",
  );
  assert.match(storeSource, /setPage: \(page, opts\) => \{\s*beginNavigationIntent\(\)/);
  assert.match(storeSource, /activateProject: async \(path, opts\)/);
  assert.match(storeSource, /clearProject: async \(opts\)/);
});
