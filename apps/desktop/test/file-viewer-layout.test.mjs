import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

import { loadStyles } from "./helpers/styles.mjs";

const stylesPromise = loadStyles();
const filesTabPromise = readFile(
  new URL("../src/components/workpanel/FilesTab.tsx", import.meta.url),
  "utf8",
);

function block(source, selector) {
  const index = source.indexOf(selector);
  assert.notEqual(index, -1, `missing rule: ${selector}`);
  return source.slice(index, source.indexOf("}", index));
}

test("the markdown file preview is a padded reading surface", async () => {
  const styles = await stylesPromise;
  const body = block(styles, ".file-viewer-body {");
  const container = block(styles, ".file-viewer-markdown {");

  assert.match(container, /box-sizing: border-box/);
  assert.match(container, /width: 100%/);
  assert.match(container, /min-width: 0/);
  assert.match(container, /padding: 16px 20px 24px/);
  // A viewer-owned query: declared on the ancestor body so descendants can query it.
  assert.match(body, /container-type: inline-size/);
  assert.match(body, /container-name: fileViewer/);
});

test("the reading measure is capped and centred", async () => {
  const styles = await stylesPromise;
  const cap = block(styles, ".file-viewer-markdown > * {");

  assert.match(cap, /max-width: 880px/);
  assert.match(cap, /margin-inline: auto/);
});

test("narrow panels lose padding through the viewer's own container query", async () => {
  const styles = await stylesPromise;
  const index = styles.indexOf("@container fileViewer (max-width: 480px)");
  assert.notEqual(index, -1, "missing the narrow container query");
  const query = styles.slice(index, styles.indexOf("\n}\n", index));

  assert.match(query, /\.file-viewer-markdown \{/);
  assert.match(query, /padding: 12px 14px 20px/);
});

test("heading hierarchy stays restrained inside the viewer", async () => {
  const styles = await stylesPromise;

  assert.match(block(styles, ".file-viewer-markdown h1 {"), /font-size: var\(--text-lg-plus\)/);
  assert.match(block(styles, ".file-viewer-markdown h2 {"), /font-size: var\(--text-lg\)/);
  assert.match(block(styles, ".file-viewer-markdown h3 {"), /font-size: var\(--text-base-plus\)/);

  assert.match(
    block(styles, ".file-viewer-markdown h1,\n.file-viewer-markdown h2,\n.file-viewer-markdown h3,"),
    /margin: 1\.1em 0 0\.4em/,
  );
  assert.match(block(styles, ".file-viewer-markdown > :first-child {"), /margin-top: 0/);
});

test("tables and code keep smaller shells and roomier cells in the viewer", async () => {
  const styles = await stylesPromise;

  assert.match(
    block(styles, ".file-viewer-markdown .table-wrap,"),
    /border-radius: var\(--radius-xs\)/,
  );
  assert.match(block(styles, ".file-viewer-markdown th,"), /padding: 7px 10px/);
});

test("the global chat hierarchy this feature rides on is untouched", async () => {
  const styles = await stylesPromise;

  // These are the transcript's rules. Changing them would move chat, Team
  // records, subagent records and the table fullscreen preview.
  assert.match(block(styles, ".prose-chat h1 {"), /font-size: var\(--text-xl\)/);
  assert.doesNotMatch(block(styles, ".prose-chat .table-wrap {"), /border:/);
  assert.match(block(styles, ".code-block {"), /border-radius: var\(--radius-md-plus\)/);
  assert.doesNotMatch(block(styles, ".prose-chat th {"), /white-space: nowrap/);
});

test("the viewer keeps the resolved document directory and its four controls", async () => {
  const filesTab = await filesTabPromise;

  // Relative links and images must still resolve against the owning document.
  assert.match(filesTab, /baseDir=\{fileDirOf\(selected\)\}/);

  // The frozen toolbar is back, path, size, reveal. Copy/export live in the
  // table preview and maximise in the work panel header, not here.
  assert.match(filesTab, /t\("panel\.files\.back"\)/);
  assert.match(filesTab, /t\("panel\.files\.reveal"\)/);
  assert.match(filesTab, /className="file-viewer-path" title=\{selected\}/);
  assert.match(filesTab, /className="file-viewer-size"/);
  assert.doesNotMatch(filesTab, /panel\.files\.(copy|export|maximize)/);
});
