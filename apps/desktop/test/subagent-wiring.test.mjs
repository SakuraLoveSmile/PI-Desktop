import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const mainSource = await readFile(
  new URL("../electron/main/index.ts", import.meta.url),
  "utf8",
);
const sidecarSource = await readFile(
  new URL("../../../packages/agent-runtime/src/sidecar.ts", import.meta.url),
  "utf8",
);
const hostSessionsSource = await readFile(
  new URL("../../../crates/host-core/src/sessions.rs", import.meta.url),
  "utf8",
);

test("every launch resolves the subagent catalog and its pinned models", () => {
  assert.match(mainSource, /loadSubagentDefinitions,\n  resolveSubagentProviders,/);
  // The catalog is re-read per prompt, registry documents included, so an edit
  // in the UI takes effect on the next turn with no restart (D202).
  assert.match(mainSource, /await loadSubagentDefinitions\(projectPath, \{/);
  assert.match(
    mainSource,
    /userDocuments: await activeUserSubagentDocuments\(projectPath\),/,
  );
  assert.match(mainSource, /await resolveSubagentProviders\(\{/);
  assert.match(mainSource, /subagents: subagentCatalog\.definitions,/);
  assert.match(mainSource, /subagentProviders: subagentBindings\.providers,/);
  // Discovery problems must not fail the turn, only be reported.
  assert.match(mainSource, /"subagent definitions have problems"/);
});

test("the sidecar forwards both subagent params to the runtime", () => {
  assert.match(sidecarSource, /subagents\?: SubagentDefinition\[\];/);
  assert.match(
    sidecarSource,
    /subagentProviders\?: Record<string, RuntimeProviderConfig>;/,
  );
  // Once for the reuse check, once for the constructor: a changed catalog must
  // rebuild the runtime rather than silently keep the old delegates.
  assert.equal(sidecarSource.match(/^\s+subagents,$/gm)?.length, 2);
  assert.equal(sidecarSource.match(/^\s+subagentProviders,$/gm)?.length, 2);
});

test("persisted subagent rows keep their attribution", () => {
  assert.match(
    mainSource,
    /function subagentTagged\(message: UiMessage, envelope: AgentEventEnvelope\)/,
  );
  assert.match(mainSource, /message: subagentTagged\(event\.message, envelope\),/);
  assert.match(mainSource, /started\?\.parentToolCallId/);
  assert.match(mainSource, /started\?\.agentName/);
  // host-core round-trips both through the message `meta` object.
  assert.match(hostSessionsSource, /pub parent_tool_call_id: Option<String>/);
  assert.match(hostSessionsSource, /meta_obj\.insert\("parentToolCallId"\.into\(\)/);
  assert.match(hostSessionsSource, /\.get\("agentName"\)/);
});

test("a permission request names the delegate that asked", () => {
  assert.match(mainSource, /const asking = activeToolCalls\.get\(/);
  assert.match(mainSource, /asking\?\.agentName \? \{ agentName: asking\.agentName \}/);
  assert.match(mainSource, /asking\?\.parentToolCallId/);
});
