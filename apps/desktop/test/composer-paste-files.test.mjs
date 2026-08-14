import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { basename, join } from "node:path";
import { tmpdir } from "node:os";
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
  assert.match(
    composer,
    /createFileReference\(file\.path, file\.name, sessionId\)/,
  );
  assert.match(composer, /setFileReferences\(\(current\) => \[/);
  assert.match(
    composer,
    /serializeComposerFileReferences\(value, activeFileReferences\)/,
  );
  assert.match(
    composer,
    /const hasDraftContent = Boolean\(value\.trim\(\) \|\| activeFileReferences\.length\)/,
  );
  assert.match(composer, /el\.setSelectionRange\(selectionStart, selectionEnd\)/);
  assert.doesNotMatch(composer, /formatFileInsert\(file\.path, "file"\)/);
  assert.match(composer, /await materializeDraftSession\(\)/);
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
  assert.match(saver, /return \{ path, name, mimeType, size: bytes\.byteLength \}/);
});

test("paste results separate display names from unique storage paths", async () => {
  const { saveComposerPasteFiles } = await import(
    "../electron/main/composer-paste.ts"
  );
  const root = await mkdtemp(join(tmpdir(), "pi-composer-paste-"));
  try {
    const files = await saveComposerPasteFiles(root, "session-1", [
      {
        name: "C:\\Users\\lan\\image.png",
        mimeType: "image/png",
        data: new Uint8Array([1, 2, 3]).buffer,
      },
      {
        name: "/tmp/other/image.png",
        mimeType: "image/png",
        data: new Uint8Array([4, 5]).buffer,
      },
    ]);

    assert.deepEqual(files.map((file) => file.name), ["image.png", "image.png"]);
    assert.notEqual(files[0].path, files[1].path);
    assert.match(basename(files[0].path), /^pasted-.+-image\.png$/);
    assert.notEqual(basename(files[0].path), files[0].name);
    assert.deepEqual(
      Array.from(await readFile(files[0].path)),
      [1, 2, 3],
    );
    assert.deepEqual(Array.from(await readFile(files[1].path)), [4, 5]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
