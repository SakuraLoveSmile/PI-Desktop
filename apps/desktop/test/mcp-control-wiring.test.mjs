import {
  readAppSourceSync,
  readMainModuleSync,
  readMainSourceSync,
} from "./helpers/source-contracts.mjs";
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { register } from "node:module";
import { pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const desktopRoot = join(here, "..");
register(pathToFileURL(join(here, "helpers/ts-import-hooks.mjs")));
const {
  MCP_CONTROL_BLOCKED_CHANNEL_KEYS,
  MCP_CONTROL_CATALOG_CHANNEL_KEYS,
  createMcpControlOperations,
} = await import("../electron/main/mcp-control.ts");

const main = readMainSourceSync();
const startup = readMainModuleSync("bootstrap/startup.ts");
const shutdown = readMainModuleSync("bootstrap/shutdown.ts");
const registerIpc = readMainModuleSync("ipc/register.ts");
const controlIpc = readMainModuleSync("ipc/mcp-control-ipc.ts");
const controlLifecycle = readMainModuleSync("mcp-control-lifecycle.ts");
const controlSettings = readMainModuleSync("mcp-control-settings.ts");
const preload = readFileSync(join(desktopRoot, "electron/preload/index.ts"), "utf8");
const pluginIpc = readMainModuleSync("ipc/plugin-ipc.ts");
const workspaceIpc = readMainModuleSync("ipc/workspace-ipc.ts");
const extensionIpc = readMainModuleSync("agent-extensions-ipc.ts");
const app = readAppSourceSync();
const api = readFileSync(join(desktopRoot, "src/lib/api.ts"), "utf8");
const protocol = readFileSync(
  join(desktopRoot, "../../packages/shared/src/protocol.ts"),
  "utf8",
);

function ipcInvokeKeys(source) {
  const block = source.match(/invoke:\s*\{([\s\S]*?)\n  \},/)?.[1] ?? "";
  return [...block.matchAll(/^\s+([A-Za-z0-9_]+):/gm)].map((match) => match[1]);
}

test("the optional MCP control server reuses IPC and synchronizes renderer state", () => {
  assert.match(startup, /const invokeIpc = registerIpc\(\)/);
  assert.match(startup, /channels: IPC\.invoke/);
  assert.match(startup, /version: APP_VERSION/);
  assert.match(startup, /mcpControlRendererEvent/);
  assert.match(shutdown, /getMcpControl\(\)\?\.stop\(\)/);
  assert.match(api, /projectPath\?: string \| null/);
  assert.match(api, /selectSessionId\?: string/);
  assert.match(app, /event\.projectPath/);
  assert.match(app, /event\.selectSessionId/);
  assert.match(app, /openProjectPath\(event\.projectPath\)/);
});

test("the startup preference and the settings IPC share one control-plane lifecycle", () => {
  // One lifecycle owns the single `state.mcpControl` slot: the boot path never
  // constructs a server of its own.
  assert.match(startup, /createMcpControlLifecycle\(\{/);
  assert.match(startup, /getServer: \(\) => state\.mcpControl/);
  assert.match(startup, /setServer: \(server\) => \{/);
  assert.match(startup, /await mcpControl\.startFromPreference\(\{/);
  assert.equal([...startup.matchAll(/setActiveMcpControlLifecycle\(/g)].length, 1);
  assert.doesNotMatch(startup, /new McpControlServer\(/);
  assert.doesNotMatch(startup, /process\.env\.PI_DESKTOP_MCP_CONTROL/);
  assert.doesNotMatch(startup, /process\.env\.PI_DESKTOP_MCP_PORT/);

  // The environment rule, the port selection, and the preference file each
  // have exactly one owner.
  assert.equal([...main.matchAll(/"PI_DESKTOP_MCP_CONTROL"/g)].length, 1);
  assert.equal([...main.matchAll(/"mcp-control-settings\.json"/g)].length, 1);
  assert.match(controlSettings, /export function environmentMcpControlOverride/);
  assert.match(controlSettings, /raw === "1"/);
  assert.match(controlSettings, /raw === "0"/);
  assert.match(controlLifecycle, /MCP_CONTROL_PORT_ENV/);
  // Disabling the control plane stops only the server: never an Agent turn.
  assert.doesNotMatch(controlLifecycle, /agentStop|agentAbort|agent\/stop|agent\/abort/);
});

test("the local control plane switch stays renderer-only and off the MCP catalog", () => {
  const invokeKeys = ipcInvokeKeys(protocol);
  assert.ok(invokeKeys.includes("mcpControlGet"));
  assert.ok(invokeKeys.includes("mcpControlSet"));
  assert.match(protocol, /mcpControlGet: "pi-desktop\/mcp\/control\/get"/);
  assert.match(protocol, /mcpControlSet: "pi-desktop\/mcp\/control\/set"/);

  const catalog = new Set(MCP_CONTROL_CATALOG_CHANNEL_KEYS);
  const blocked = new Set(MCP_CONTROL_BLOCKED_CHANNEL_KEYS);
  for (const key of ["mcpControlGet", "mcpControlSet"]) {
    assert.equal(catalog.has(key), false, `${key} must not be externally invocable`);
    assert.equal(blocked.has(key), true, `${key} must stay excluded`);
  }

  // Registered for the renderer only, and the response is a status: it never
  // carries the connection record or the bearer token.
  assert.equal([...registerIpc.matchAll(/registerMcpControlIpc\(/g)].length, 1);
  assert.match(controlIpc, /handle\(IPC\.invoke\.mcpControlGet/);
  assert.match(controlIpc, /handle\(IPC\.invoke\.mcpControlSet/);
  assert.match(controlIpc, /type McpControlStatus/);
  assert.doesNotMatch(controlIpc, /connectionInfo|mcp-control\.json/);
  assert.equal(preload.includes("mcp"), false);
});

test("native picker handlers and secret-write channels stay out of the MCP catalog", () => {
  const pickerKeys = [];
  const handlePattern = /handle(?:WithEvent)?\(\s*IPC\.invoke\.([A-Za-z0-9_]+)/g;
  for (const source of [pluginIpc, workspaceIpc, extensionIpc]) {
    const starts = [...source.matchAll(handlePattern)];
    for (let index = 0; index < starts.length; index += 1) {
      const from = starts[index].index ?? 0;
      const to = index + 1 < starts.length ? (starts[index + 1].index ?? source.length) : source.length;
      const block = source.slice(from, to);
      if (block.includes("showOpenDialog") || block.includes("openProjectPicker")) {
        pickerKeys.push(starts[index][1]);
      }
    }
  }
  assert.ok(pickerKeys.includes("pluginLoadDev"));
  assert.ok(pickerKeys.includes("projectOpen"));

  const catalog = new Set(MCP_CONTROL_CATALOG_CHANNEL_KEYS);
  const invokeKeys = new Set(ipcInvokeKeys(protocol));
  for (const key of pickerKeys) {
    assert.equal(catalog.has(key), false, `${key} is a native picker`);
  }
  for (const key of MCP_CONTROL_BLOCKED_CHANNEL_KEYS) {
    assert.equal(catalog.has(key), false, `${key} must stay excluded`);
    assert.equal(invokeKeys.has(key), true, `${key} must remain an IPC channel`);
  }
  for (const key of MCP_CONTROL_CATALOG_CHANNEL_KEYS) {
    assert.equal(invokeKeys.has(key), true, `${key} is not an IPC.invoke channel`);
  }
  const channels = Object.fromEntries(
    MCP_CONTROL_CATALOG_CHANNEL_KEYS.map((key) => [key, `pi-desktop/${key}`]),
  );
  channels.pluginLoadDev = "pi-desktop/plugin/loadDev";
  channels.secretsSet = "pi-desktop/secrets/set";
  channels.providersCreate = "pi-desktop/providers/create";
  const live = createMcpControlOperations(channels);
  assert.equal(live.some((operation) => operation.id === "plugin/loadDev"), false);
  assert.equal(live.some((operation) => operation.id === "providers/create"), false);
  assert.equal(live.find((operation) => operation.id === "session/configure")?.risk, "dangerous");
});
