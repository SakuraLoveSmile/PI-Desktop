import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

const [composer, api, main, saver, protocol] = await Promise.all([
  read("../src/components/Composer.tsx"),
  read("../src/lib/api.ts"),
  read("../electron/main/index.ts"),
  read("../electron/main/composer-paste.ts"),
  read("../../../packages/shared/src/protocol.ts"),
]);

test("composer keeps text paste native and materializes clipboard files", () => {
  assert.match(composer, /onPaste=\{pasteClipboardFiles\}/);
  assert.match(composer, /if \(!files\.length\) return;/);
  assert.match(composer, /event\.preventDefault\(\);/);
  assert.match(composer, /file\.arrayBuffer\(\)/);
  assert.match(composer, /formatFileInsert\(file\.path, "file"\)/);
  assert.match(composer, /await newSession\(\)/);
});

test("paste IPC is a typed renderer-to-main bridge", () => {
  assert.match(protocol, /composerPasteFiles: "pi-desktop\/composer\/pasteFiles"/);
  assert.match(api, /pasteFiles: \(sessionId: string, files: ComposerPasteFile\[\]\)/);
  assert.match(api, /IPC\.invoke\.composerPasteFiles/);
  assert.match(main, /host\.call\("session\.get", \{ id: sessionId \}\)/);
  assert.match(main, /saveComposerPasteFiles\(dataDir, sessionId, files\)/);
});

test("pasted bytes stay in the session scratch directory", () => {
  assert.match(saver, /join\(dataDir, "scratch", sessionId, "pasted"\)/);
  assert.match(saver, /basename\(normalized\)/);
  assert.match(saver, /writeFile\(path, bytes, \{ flag: "wx" \}\)/);
  assert.match(saver, /MAX_TOTAL_BYTES/);
});
