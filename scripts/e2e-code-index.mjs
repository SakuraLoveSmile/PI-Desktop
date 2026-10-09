#!/usr/bin/env node
/** Session tool -> real isolated Rust host -> local filesystem/cache. No model calls. */
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rename, rm, symlink, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Host, resolveHostBinary } from "./e2e/host.mjs";
import { buildCodeSearchTool } from "../packages/agent-runtime/dist/code-search.js";

const scratch = await mkdtemp(join(tmpdir(), "pi-code-index-"));
const data = join(scratch, "data");
const alpha = join(scratch, "alpha");
const beta = join(scratch, "beta");
const host = new Host(resolveHostBinary(), data);
const checks = [];
try {
  await mkdir(alpha); await mkdir(beta);
  await writeFile(join(alpha, "source.ts"), "const Marker = 1;\n中文索引\nſearch Kelvin\n");
  await writeFile(join(beta, "private.ts"), "beta-only marker");
  await host.start();
  await host.call("workspace.set", { path: alpha });
  const { provider } = await host.call("providers.create", {
    name: "Code index offline fixture", vendorKey: "custom", type: "openai_compatible",
    protocol: "openai_compatible", baseUrl: "http://127.0.0.1:1/v1", authKind: "none",
    apiStyle: "chat_completions", defaultModelId: "fixture", models: [{ id: "fixture" }],
  });
  const create = async (projectPath) => (await host.call("session.create", {
    title: "Code index isolated fixture", mode: "agent", projectPath,
    providerId: provider.id, modelId: "fixture", permissionMode: "auto",
  })).session;
  const session = await create(alpha);
  const betaSession = await create(beta);
  const tool = buildCodeSearchTool({ host, sessionId: session.id, boundPath: session.projectPath });
  const invoke = async (params) => {
    const result = await tool.execute("offline-code-search", params);
    assert.equal(result.details.ok, true, JSON.stringify(result.details));
    return result.details;
  };
  assert.equal((await invoke({ action: "status" })).index.status, "missing");
  const first = await invoke({ query: "marker" });
  assert.equal(first.hits[0].path, "source.ts");
  assert.equal(first.hits[0].line, 1);
  assert.equal(first.index.status, "fresh");
  assert.equal(first.truncated, false);
  for (const query of ["索引", "SEARCH", "kelvin", "co"]) assert.equal((await invoke({ query })).hits.length, 1);
  assert.equal((await invoke({ query: "const.*1" })).hits.length, 0, "search must be literal");
  checks.push("tool-path-line-results", "literal-short-cjk-unicode");

  await host.call("workspace.set", { path: beta });
  assert.equal((await invoke({ query: "beta-only" })).hits.length, 0, "current workspace cannot redirect a session");
  await assert.rejects(host.call("project.codeSearch", { sessionId: session.id, boundPath: beta, query: "marker" }));
  await assert.rejects(host.call("project.codeSearch", { sessionId: "missing", boundPath: alpha, query: "marker" }));
  const other = await host.call("project.codeSearch", { sessionId: betaSession.id, boundPath: betaSession.projectPath, query: "beta-only" });
  assert.equal(other.hits.length, 1);
  checks.push("session-root-isolation", "forged-binding-denied");

  await writeFile(join(alpha, "source.ts"), "const Noodle = 1;\n中文索引\nſearch Kelvin\n");
  assert.equal((await invoke({ query: "marker" })).hits.length, 0);
  await writeFile(join(alpha, "new.ts"), "new marker");
  assert.equal((await invoke({ query: "marker" })).hits[0].path, "new.ts");
  await rename(join(alpha, "new.ts"), join(alpha, "renamed.ts"));
  assert.equal((await invoke({ query: "marker" })).hits[0].path, "renamed.ts");
  await writeFile(join(alpha, ".pi-desktopignore"), "renamed.ts\n");
  assert.equal((await invoke({ query: "marker" })).hits.length, 0);
  await writeFile(join(alpha, ".pi-desktopignore"), "");
  assert.equal((await invoke({ query: "marker" })).hits[0].path, "renamed.ts");
  await rm(join(alpha, "renamed.ts"));
  assert.equal((await invoke({ query: "marker" })).hits.length, 0);
  checks.push("same-size-edit-create-rename-delete", "ignore-rule-reconciliation");

  await mkdir(join(alpha, "node_modules"));
  await writeFile(join(alpha, "node_modules", "dep.ts"), "excluded secretmarker");
  await writeFile(join(alpha, ".env"), "excluded secretmarker");
  await writeFile(join(alpha, "credential.key"), "excluded secretmarker");
  await writeFile(join(data, "ignore"), "global-ignore.ts\n");
  await writeFile(join(alpha, "global-ignore.ts"), "excluded secretmarker");
  assert.equal((await invoke({ query: "secretmarker" })).hits.length, 0);
  if (process.platform !== "win32") {
    await symlink(join(beta, "private.ts"), join(alpha, "escape.ts"));
    await symlink(beta, join(alpha, "escape-dir"));
    assert.equal((await invoke({ query: "beta-only" })).hits.length, 0);
    checks.push("symlink-escape-denied");
  }
  checks.push("sensitive-default-and-global-ignore");

  await writeFile(join(alpha, "binary.dat"), Buffer.from("budgetmarker\0binary"));
  await writeFile(join(alpha, "large.txt"), "budgetmarker".repeat(100_000));
  const partial = await invoke({ query: "budgetmarker" });
  assert.equal(partial.hits.length, 0);
  assert.equal(partial.index.status, "partial");
  assert(partial.index.skippedFiles >= 2);
  assert.equal(partial.truncated, true);
  await rm(join(alpha, "binary.dat")); await rm(join(alpha, "large.txt"));
  await writeFile(join(alpha, "many.txt"), "resultmarker\n".repeat(60));
  const bounded = await invoke({ query: "resultmarker" });
  assert.equal(bounded.hits.length, 20);
  assert.equal(bounded.truncated, true);
  assert(Buffer.byteLength(JSON.stringify(bounded)) < 32 * 1024);
  for (const params of [{ query: "" }, { query: "x", limit: 51 }, { query: "x", limit: 1.5 }]) {
    await assert.rejects(host.call("project.codeSearch", { sessionId: session.id, boundPath: alpha, ...params }));
  }
  checks.push("partial-coverage-and-output-bounds", "host-argument-validation");

  await access(join(data, "index", "index.db"));
  await host.stop(); await host.start();
  assert((await invoke({ action: "status" })).index.fileCount > 0);
  await invoke({ action: "clear" });
  assert.equal((await invoke({ action: "status" })).index.status, "missing");
  assert.equal((await invoke({ query: "resultmarker", limit: 1 })).hits.length, 1);
  checks.push("restart-persistent-cache", "explicit-clear-and-rebuild");

  console.log("CODE_INDEX " + JSON.stringify({ ok: true, checks, provider: "not-called", state: "isolated-real-host-filesystem" }));
} finally {
  await host.stop();
  await rm(scratch, { recursive: true, force: true });
}
