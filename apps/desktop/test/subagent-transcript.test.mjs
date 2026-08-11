import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const transcriptSource = await readFile(
  new URL("../src/components/ChatTranscript.tsx", import.meta.url),
  "utf8",
);
const storeSource = await readFile(
  new URL("../src/stores/app-store.ts", import.meta.url),
  "utf8",
);
const messagesCss = await readFile(
  new URL("../src/styles/messages.css", import.meta.url),
  "utf8",
);

test("a live delegate row keeps the attribution its stream carried", () => {
  // Without these the row would render as a top-level tool call until the
  // session was reloaded from host-core.
  assert.match(
    storeSource,
    /envelope\.parentToolCallId\n\s+\? \{ parentToolCallId: envelope\.parentToolCallId \}/,
  );
  assert.match(storeSource, /envelope\.agentName \? \{ agentName: envelope\.agentName \}/);
});

test("delegate rows render under their Task row, one level in", () => {
  assert.match(transcriptSource, /delegate\?: SubagentRun/);
  assert.match(
    transcriptSource,
    /\{open && delegate \? \([\s\S]*?<SubagentRunRows[\s\S]*?run=\{delegate\}[\s\S]*?agentName=\{agentName\}/,
  );
  assert.match(transcriptSource, /function SubagentRunRows\(/);
  assert.match(transcriptSource, /<div className="subagent-run">/);
  // The nested rows are the same components, so a delegate's tool calls and
  // reasoning read exactly like the parent's.
  assert.match(transcriptSource, /<ToolRow message=\{item\.message\} \/>/);
  assert.match(transcriptSource, /className="subagent-answer"/);
});

test("a Task row is expandable and names the delegate it used", () => {
  assert.match(
    transcriptSource,
    /hasToolDetails\(message\) \|\| Boolean\(delegate\)/,
  );
  assert.match(transcriptSource, /TOOL_ACTION_KEYS.*delegate: "chat\.toolDelegated"/s);
  assert.match(transcriptSource, /TOOL_RUNNING_KEYS.*delegate: "chat\.toolDelegating"/s);
  assert.match(transcriptSource, /className="tool-row-agent"/);
  assert.match(transcriptSource, /case "delegate":\n\s+return <IconBot/);
});

test("the report is printed once: in the body, or as the nested answer", () => {
  assert.match(
    transcriptSource,
    /const nestedReport = delegate\?\.items\.some\(\(item\) => item\.kind === "answer"\)/,
  );
  assert.match(
    transcriptSource,
    /\.\.\.\(nestedReport \? \{ hideDelegateReport: true \} : \{\}\)/,
  );
});

test("memoized activity rows compare delegate runs by their rows", () => {
  // Runs are rebuilt on every message change, so an identity check would
  // freeze a streaming delegate's rows.
  assert.match(
    transcriptSource,
    /function activityItemsEqual\([\s\S]*?subagentRunsEqual\(previous\.delegate, next\.delegate\)/,
  );
  assert.equal(transcriptSource.match(/activityItemsEqual\(/g)?.length, 3);
});

test("the nested run is visibly one level inside the call", () => {
  assert.match(
    messagesCss,
    /\.subagent-run > \.disclosure-collapse-rail::before \{[^}]*background: var\(--ds-border-default\)/,
  );
  assert.match(messagesCss, /\.subagent-run \{[^}]*margin: 2px 0 8px 24px/);
  assert.match(messagesCss, /\.subagent-run-count \{[^}]*margin-inline-start: auto/);
  assert.match(messagesCss, /\.tool-row-agent \{/);
});

test("parallel Task rows render as one accessible delegation topology", () => {
  assert.match(
    transcriptSource,
    /const hasSubagentTopology = delegateItems\.length > 1/,
  );
  assert.match(
    transcriptSource,
    /<SubagentTopology key="subagent-topology" items=\{delegateItems\} \/>/,
  );
  assert.match(transcriptSource, /className="subagent-topology" aria-labelledby=/);
  assert.match(transcriptSource, /className="subagent-topology-agents"/);
  assert.match(transcriptSource, /role="list"/);
  assert.match(transcriptSource, /variant="topology"/);
  assert.match(transcriptSource, /className="subagent-topology-node-header"/);
  assert.match(transcriptSource, /aria-expanded=\{open\}/);
  assert.match(transcriptSource, /aria-controls=\{hasDetails \? detailsId : undefined\}/);
});

test("the topology uses semantic low-noise surfaces and responsive connectors", () => {
  assert.match(messagesCss, /\.tool-activity-group\.has-subagents \{/);
  assert.match(messagesCss, /\.subagent-topology \{[^}]*display: grid/);
  assert.match(messagesCss, /\.subagent-topology-node \{[^}]*var\(--ds-border-default\)/);
  assert.match(messagesCss, /\.subagent-topology-node\.outcome-completed/);
  assert.match(messagesCss, /\.subagent-topology-node\.outcome-failed/);
  assert.match(
    messagesCss,
    /@container subagent-activity \(max-width: 520px\)[\s\S]*?\.subagent-topology/,
  );
  assert.match(messagesCss, /\.subagent-topology-node-header:focus-visible/);
});
