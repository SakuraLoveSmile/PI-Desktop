import assert from "node:assert/strict";
import test from "node:test";
import { dirname, join } from "node:path";
import { register } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
register(pathToFileURL(join(here, "helpers/ts-import-hooks.mjs")));
const { ClipboardHistory, CLIPBOARD_HISTORY_MAX_ENTRIES, CLIPBOARD_HISTORY_MAX_TEXT_BYTES } =
  await import("../electron/main/clipboard-history.ts");

test("clipboard history establishes a baseline, interleaves text and images, and clones bytes", async (t) => {
  let now = Date.parse("2026-08-21T00:00:00.000Z");
  let current = { type: "text", text: "before the app started" };
  const history = new ClipboardHistory({
    read: async () => current,
    now: () => now,
    pollIntervalMs: 60_000,
  });
  t.after(() => history.stop());

  await history.start();
  assert.deepEqual(history.getHistory(), []);

  current = { type: "text", text: "hello" };
  now += 1000;
  await history.poll();
  current = {
    type: "image",
    format: "png",
    data: new Uint8Array([1, 2, 3]),
    width: 2,
    height: 3,
  };
  now += 1000;
  await history.poll();

  const result = history.getHistory();
  assert.equal(result.length, 2);
  assert.equal(result[0].type, "image");
  assert.deepEqual([...result[0].data], [1, 2, 3]);
  assert.equal(result[1].type, "text");

  result[0].data[0] = 99;
  assert.deepEqual([...history.getHistory()[0].data], [1, 2, 3]);
});

test("consecutive duplicates refresh the timestamp without creating entries", () => {
  let now = Date.parse("2026-08-21T00:00:00.000Z");
  const history = new ClipboardHistory({ read: async () => null, now: () => now });

  history.recordText("same", new Date(now).toISOString());
  now += 5000;
  history.recordText("same", new Date(now).toISOString());

  const result = history.getHistory();
  assert.equal(result.length, 1);
  assert.equal(result[0].capturedAt, new Date(now).toISOString());
});

test("host writes are captured even when the value was the startup baseline", async (t) => {
  const current = { type: "text", text: "same as before startup" };
  const history = new ClipboardHistory({
    read: async () => current,
    pollIntervalMs: 60_000,
  });
  t.after(() => history.stop());

  await history.start();
  history.recordText(current.text);
  await history.poll();

  assert.deepEqual(history.getHistory().map((entry) => entry.text), [current.text]);
});

test("history skips oversized text and enforces the entry cap", () => {
  const history = new ClipboardHistory({ read: async () => null });
  history.recordText("x".repeat(CLIPBOARD_HISTORY_MAX_TEXT_BYTES + 1));
  assert.deepEqual(history.getHistory(), []);

  for (let index = 0; index < CLIPBOARD_HISTORY_MAX_ENTRIES + 1; index += 1) {
    history.recordText(`entry-${index}`);
  }
  const result = history.getHistory();
  assert.equal(result.length, CLIPBOARD_HISTORY_MAX_ENTRIES);
  assert.equal(result[0].type, "text");
  assert.equal(result[0].text, `entry-${CLIPBOARD_HISTORY_MAX_ENTRIES}`);
  assert.equal(result.at(-1).text, "entry-1");
});
