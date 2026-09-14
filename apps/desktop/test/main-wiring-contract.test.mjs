import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

// Wiring in the composition root and in the plugin services factory is not
// covered by any behavioural test: those modules import Electron, so they cannot
// be loaded here. Two regressions shipped that way — a required `getHost`
// dependency dropped from a factory call in `index.ts`, and the docked-view half
// of the browser-state fan-out dropped from `plugin-services.ts` — and both were
// invisible to the suite. These checks read the sources the way
// `rpc-lifecycle-contract.test.mjs` does.

const here = dirname(fileURLToPath(import.meta.url));
const mainDir = join(here, "..", "electron", "main");
const read = (relative) => readFileSync(join(mainDir, relative), "utf8");

/** Body of `export type Name = { ... }`, brace-matched. */
function interfaceBody(source, name) {
  const start = source.indexOf(`export type ${name} = {`);
  assert.ok(start >= 0, `interface ${name} not found`);
  return braceBody(source, source.indexOf("{", start));
}

/** Body of the first `({ ... })` argument of `callee(`. */
function callArgument(source, callee) {
  const call = source.indexOf(`${callee}({`);
  assert.ok(call >= 0, `call to ${callee} not found`);
  return braceBody(source, source.indexOf("{", call));
}

function braceBody(source, openIndex) {
  assert.ok(openIndex >= 0, "opening brace not found");
  let depth = 0;
  for (let index = openIndex; index < source.length; index += 1) {
    const character = source[index];
    if (character === "{") depth += 1;
    else if (character === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(openIndex + 1, index);
    }
  }
  throw new Error("unbalanced braces");
}

/**
 * Required top-level member names of an interface. Members are indented two
 * spaces in these files, so a deeper indent belongs to a nested object literal
 * and a `*` line belongs to a doc comment.
 */
function requiredKeys(body) {
  return body
    .split("\n")
    .map((line) => /^ {2}([A-Za-z_$][\w$]*)(\?)?\s*[:(]/.exec(line))
    .filter((match) => match && match[2] !== "?")
    .map((match) => match[1]);
}

function assertPassesRequiredKeys(interfaceSource, interfaceName, callSource, callee) {
  const keys = requiredKeys(interfaceBody(interfaceSource, interfaceName));
  assert.ok(keys.length > 3, `${interfaceName} should declare several members`);
  const argument = callArgument(callSource, callee);
  const missing = keys.filter(
    (key) => !new RegExp(`(^|\\n)\\s*${key}\\s*[,:]`, "m").test(argument),
  );
  assert.deepEqual(
    missing,
    [],
    `${callee} must pass every required ${interfaceName} member`,
  );
}

test("the composition root passes every required factory dependency", () => {
  const index = read("index.ts");
  assertPassesRequiredKeys(
    read("bootstrap/startup.ts"),
    "StartupDependencies",
    index,
    "registerApplicationStartup",
  );
  assertPassesRequiredKeys(
    read("runtime/plans.ts"),
    "PlanRuntimeDependencies",
    index,
    "createPlanRuntime",
  );
  assertPassesRequiredKeys(
    read("runtime/event-persistence.ts"),
    "EventPersistenceDependencies",
    index,
    "createEventPersistence",
  );
  assertPassesRequiredKeys(
    read("runtime/sidecar.ts"),
    "SidecarRuntimeDependencies",
    index,
    "createSidecarRuntime",
  );
  assertPassesRequiredKeys(
    read("runtime/host.ts"),
    "HostRuntimeDependencies",
    index,
    "createHostRuntime",
  );
});

test("the IPC registrar passes every required agent IPC dependency", () => {
  assertPassesRequiredKeys(
    read("ipc/agent-ipc.ts"),
    "AgentIpcDependencies",
    read("ipc/register.ts"),
    "registerAgentIpc",
  );
});

test("browser state reaches every plugin surface", () => {
  const services = read("services/plugin-services.ts");
  const state = braceBody(
    services,
    services.indexOf("{", services.indexOf("const emitBrowserState")),
  );
  // The renderer plus both plugin surfaces: dropping one of them is silent,
  // because each surface simply stops updating.
  assert.match(state, /sendToRenderer\(IPC\.event\.browserState, state\)/);
  assert.match(state, /pluginPanels\.broadcast\("browser:state", state\)/);
  assert.match(state, /pluginViews\.broadcast\("browser:state", state\)/);
});

test("a finished turn is announced to every plugin surface", () => {
  const services = read("services/plugin-services.ts");
  const announce = braceBody(
    services,
    services.indexOf("{", services.indexOf("const announceTurnEnded")),
  );
  assert.match(announce, /plugins\.broadcastEvent\("session:turnEnded", \[payload\]\)/);
  assert.match(announce, /pluginPanels\.broadcast\("session:turnEnded", payload\)/);
  assert.match(announce, /pluginViews\.broadcast\("session:turnEnded", payload\)/);
});
