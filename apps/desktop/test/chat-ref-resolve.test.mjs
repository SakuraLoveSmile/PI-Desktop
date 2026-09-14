import assert from "node:assert/strict";
import test from "node:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { register } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
register(pathToFileURL(join(here, "helpers/ts-import-hooks.mjs")));
const { parseChatRef, resolveChatFileRef } = await import(
  "../electron/main/chat-ref-resolve.ts"
);

/**
 * Partial-path completion for chat file references.
 *
 * The reported defect: an agent writes `/root/dir/openimage.js` in a tool call
 * but names only `openimage.js` in its reply, so the click resolved to a
 * workspace-root path that does not exist and the panel opened blank. The
 * contract under test is the product priority — the open project answers
 * first, the session scratch store second — plus the "best" rule inside one
 * root: longest matching tail, then shallowest path.
 */

function tempTree(name, files) {
  const root = mkdtempSync(join(tmpdir(), `pi-chat-ref-${name}-`));
  for (const file of files) {
    const target = join(root, ...file.split("/"));
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, `${file}\n`);
  }
  return root;
}

function relOf(match, root) {
  return match ? match.relativePath : null;
}

test("a workspace-relative hit is exact and wins over every other root", async () => {
  const workspace = tempTree("ws", ["openimage.js"]);
  const scratch = tempTree("scratch", ["openimage.js"]);
  const match = await resolveChatFileRef("openimage.js", { workspace, scratch });
  assert.equal(match?.root, "workspace");
  assert.equal(match?.matchedBy, "exact-relative");
  assert.equal(relOf(match, workspace), "openimage.js");
  assert.equal(match?.absolutePath, join(workspace, "openimage.js"));
});

test("a multi-segment relative hit is exact before any fuzzy rule", async () => {
  const workspace = tempTree("ws", ["src/dir/a.ts"]);
  const match = await resolveChatFileRef("src/dir/a.ts", { workspace });
  assert.equal(match?.matchedBy, "exact-relative");
  assert.equal(match?.relativePath, "src/dir/a.ts");
});

test("a bare leaf name resolves through the workspace index", async () => {
  const workspace = tempTree("ws", ["src/dir/openimage.js"]);
  const match = await resolveChatFileRef("openimage.js", { workspace });
  assert.equal(match?.root, "workspace");
  assert.equal(match?.matchedBy, "basename");
  assert.equal(match?.relativePath, "src/dir/openimage.js");
});

test("the reported case: a POSIX absolute path from a tool call is completed by tail", async () => {
  // The agent printed `/root/dir/openimage.js`; on this machine the real file
  // only ever existed as `src/dir/openimage.js` inside the project.
  const workspace = tempTree("ws", ["src/dir/openimage.js"]);
  const match = await resolveChatFileRef("/root/dir/openimage.js", { workspace });
  assert.equal(match?.root, "workspace");
  assert.equal(match?.matchedBy, "path-suffix");
  assert.equal(match?.relativePath, "src/dir/openimage.js");
});

test("a longer matching tail beats a bare leaf name", async () => {
  const workspace = tempTree("ws", ["deep/openimage.js", "src/dir/openimage.js"]);
  const match = await resolveChatFileRef("dir/openimage.js", { workspace });
  assert.equal(match?.matchedBy, "path-suffix");
  assert.equal(match?.relativePath, "src/dir/openimage.js");
});

test("the shallowest candidate wins when the tail length ties", async () => {
  const workspace = tempTree("ws", ["a/b/openimage.js", "openimage.js"]);
  const match = await resolveChatFileRef("openimage.js", { workspace });
  assert.equal(match?.relativePath, "openimage.js");
});

test("the project answers before the session scratch store", async () => {
  const workspace = tempTree("ws", ["notes/openimage.js"]);
  const scratch = tempTree("scratch", ["openimage.js"]);
  const match = await resolveChatFileRef("openimage.js", { workspace, scratch });
  assert.equal(match?.root, "workspace");
  assert.equal(match?.relativePath, "notes/openimage.js");
});

test("the session scratch store answers when the project has nothing", async () => {
  const workspace = tempTree("ws", ["src/index.ts"]);
  const scratch = tempTree("scratch", ["deeper/openimage.js"]);
  const match = await resolveChatFileRef("openimage.js", { workspace, scratch });
  assert.equal(match?.root, "scratch");
  assert.equal(match?.relativePath, "deeper/openimage.js");
  assert.equal(match?.matchedBy, "basename");
});

test("an absolute scratch path matches exactly inside that root", async () => {
  const workspace = tempTree("ws", ["src/index.ts"]);
  const scratch = tempTree("scratch", ["tmp/openimage.js"]);
  const absolute = join(scratch, "tmp", "openimage.js");
  const match = await resolveChatFileRef(absolute, { workspace, scratch });
  assert.equal(match?.root, "scratch");
  assert.equal(match?.matchedBy, "exact-absolute");
  assert.equal(match?.relativePath, "tmp/openimage.js");
  assert.equal(match?.absolutePath, absolute);
});

test("the attachment store is the last root searched", async () => {
  const scratch = tempTree("scratch", []);
  const attachments = tempTree("attachments", ["openimage.js"]);
  const match = await resolveChatFileRef("openimage.js", { scratch, attachments });
  assert.equal(match?.root, "attachments");
  assert.equal(match?.relativePath, "openimage.js");
});

test("a path that exists nowhere resolves to null instead of a guess", async () => {
  const workspace = tempTree("ws", ["src/index.ts"]);
  const scratch = tempTree("scratch", ["other.js"]);
  assert.equal(
    await resolveChatFileRef("missing/openimage.js", { workspace, scratch }),
    null,
  );
  assert.equal(await resolveChatFileRef("openimage.js", {}), null);
  assert.equal(
    await resolveChatFileRef("openimage.js", { workspace: tempTree("empty", []) }),
    null,
  );
});

test("ignored directories are not searched", async () => {
  const workspace = tempTree("ws", ["node_modules/openimage.js", ".git/openimage.js"]);
  assert.equal(await resolveChatFileRef("openimage.js", { workspace }), null);
});

test("a directory with a matching name never matches", async () => {
  const workspace = tempTree("ws", ["openimage.js/placeholder.txt"]);
  assert.equal(await resolveChatFileRef("openimage.js", { workspace }), null);
});

test("a content-addressed attachment blob resolves against the attachment store", async () => {
  const digest = "a".repeat(64);
  const attachments = tempTree("attachments", [digest]);
  const scratch = tempTree("scratch", []);
  const match = await resolveChatFileRef(`attachments/${digest}`, {
    scratch,
    attachments,
  });
  assert.equal(match?.root, "attachments");
  assert.equal(match?.relativePath, digest);
  assert.equal(match?.absolutePath, join(attachments, digest));
  // A blob whose payload is gone must not resolve to a path guess.
  assert.equal(
    await resolveChatFileRef(`attachments/${"b".repeat(64)}`, { attachments }),
    null,
  );
});

test("line and column references are stripped before matching", async () => {
  const workspace = tempTree("ws", ["src/a.ts"]);
  const match = await resolveChatFileRef("src/a.ts:12:4", { workspace });
  assert.equal(match?.relativePath, "src/a.ts");
});

test("the composer sigil and quoting are tolerated", async () => {
  const workspace = tempTree("ws", ["src/a.ts"]);
  assert.equal((await resolveChatFileRef("@src/a.ts", { workspace }))?.relativePath, "src/a.ts");
  assert.equal(
    (await resolveChatFileRef('@"src/a.ts"', { workspace }))?.relativePath,
    "src/a.ts",
  );
});

test("parseChatRef rejects home paths, escapes, and oversized tokens", () => {
  assert.equal(parseChatRef("~/secrets.txt"), null);
  assert.equal(parseChatRef("../../etc/passwd"), null);
  assert.equal(parseChatRef(""), null);
  assert.equal(parseChatRef("   "), null);
  assert.equal(parseChatRef(`${"a".repeat(600)}.ts`), null);
  assert.deepEqual(parseChatRef("./src/../src/a.ts"), {
    segments: ["src", "a.ts"],
    absolute: false,
  });
  assert.deepEqual(parseChatRef("/root/dir/a.ts"), {
    segments: ["root", "dir", "a.ts"],
    absolute: true,
  });
});
