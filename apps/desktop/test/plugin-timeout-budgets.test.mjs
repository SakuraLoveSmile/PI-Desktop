import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// A plugin tool call crosses four processes, and each layer has its own
// deadline. Every inner budget must stay below the one around it, or the outer
// layer times out first and the inner layer's own error never reaches the
// model. The constants live in TypeScript and Rust, so this reads the sources.
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const source = (path) => readFileSync(join(repoRoot, path), "utf8");

function constMs(src, name) {
  const match = src.match(new RegExp(`const ${name}(?::\\s*u64)?\\s*=\\s*([\\d_]+)\\s*;`));
  assert.ok(match, `${name} not found`);
  return Number(match[1].replaceAll("_", ""));
}

const pluginRuntime = source("apps/desktop/electron/main/plugin-runtime.ts");
const pluginMcp = source("apps/desktop/electron/main/plugin-mcp.ts");
const sharedTimeouts = source("packages/shared/src/rpc-timeouts.ts");
const hostTools = source("crates/host-core/src/tools/mod.rs");
const hostPermissions = source("crates/host-core/src/permissions.rs");

test("plugin completion and MCP calls fit inside the plugin tool budget", () => {
  const tool = constMs(pluginRuntime, "PLUGIN_TOOL_TIMEOUT_MS");
  assert.ok(constMs(pluginRuntime, "PLUGIN_COMPLETE_TIMEOUT_MS") < tool);
  assert.ok(constMs(pluginMcp, "MCP_CALL_TIMEOUT_MS") < tool);
});

test("host-core dispatch outlasts the plugin tool budget and matches its TS mirror", () => {
  const hostDispatch = constMs(hostTools, "DESKTOP_TOOL_DISPATCH_TIMEOUT_MS");
  assert.ok(constMs(pluginRuntime, "PLUGIN_TOOL_TIMEOUT_MS") < hostDispatch);
  assert.equal(constMs(sharedTimeouts, "DESKTOP_TOOL_DISPATCH_TIMEOUT_MS"), hostDispatch);
  assert.equal(
    constMs(sharedTimeouts, "PERMISSION_TIMEOUT_MS"),
    constMs(hostPermissions, "PERMISSION_TIMEOUT_MS"),
  );
});
