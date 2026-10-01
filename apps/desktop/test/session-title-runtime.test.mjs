import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

async function load(relative, imports) {
  const file = new URL(relative, import.meta.url);
  const { outputText } = ts.transpileModule(await readFile(file, "utf8"), {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
    },
    fileName: file.pathname,
  });
  const module = { exports: {} };
  new Function("require", "exports", "module", outputText)(
    (id) => {
      assert.ok(Object.hasOwn(imports, id), `unexpected import: ${id}`);
      return imports[id];
    },
    module.exports,
    module,
  );
  return module.exports;
}

const apiCalls = [];
let summarize;
const api = {
  summarizeSessionTitle: (...args) => {
    apiCalls.push(args[0]);
    return summarize(...args);
  },
  renameSession: async (...args) => {
    apiCalls.push({ rename: args });
    return { ok: true };
  },
};
const i18n = { t: (key) => key === "chat.untitledTask" ? "Untitled task" : "New chat" };
const sidebarPreferences = {
  loadSidebarPreferences: () => ({ sessionMeta: {} }),
  saveSidebarPreferences: () => undefined,
};
const policy = await load(
  "../src/stores/runtime/session-title-policy.ts",
  {},
);
const { createSessionTitleRuntime } = await load(
  "../src/stores/runtime/session-title-runtime.ts",
  {
    i18next: { default: i18n },
    "../../lib/sidebar-preferences": sidebarPreferences,
    "../../lib/api": { api },
    "./session-title-policy": policy,
  },
);

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function harness({
  title = "This transcript must not be used",
  messages = [{ role: "user", content: "This transcript must not be used" }],
  role = "lead",
  source,
  autoTitleAttempted = false,
  lastAutoTitle,
  executionId = "execution-a",
} = {}) {
  apiCalls.length = 0;
  let state = {
    settings: {},
    sessions: [{
      id: "session-1",
      title,
      source,
      team: { teamSessionId: "session-1", role },
    }],
    sessionMeta: {
      "session-1": { autoTitleAttempted, lastAutoTitle },
    },
    planCheckpoints: {
      "session-1": {
        id: "proposal-1",
        sessionId: "session-1",
        title: "Approved title",
        question: "Approved question",
        executionState: "running",
        executionId,
      },
    },
    activeSessionId: "session-1",
    messages,
    refreshSessions: async () => undefined,
  };
  const metadataWrites = [];
  const runtime = createSessionTitleRuntime({
    get: () => state,
    set: (update) => {
      const patch = typeof update === "function" ? update(state) : update;
      state = { ...state, ...patch };
    },
    sessionRuntime: { sessionTranscriptCache: new Map() },
    initialSessionMeta: state.sessionMeta,
    persistSessionMeta: (id, meta) => metadataWrites.push({ id, meta }),
  });
  return {
    runtime,
    getState: () => state,
    setState: (next) => { state = next; },
    metadataWrites,
  };
}

test("approved execution title is bounded Unicode metadata, never transcript content", () => {
  const prompt = policy.approvedExecutionTitleInput("題".repeat(6_100), "問");
  assert.equal(Array.from(prompt).length, 6_000);
  assert.ok(prompt.startsWith("Approved task title:"));
  assert.equal(policy.approvedExecutionFallbackTitle("  Approved\n title  "), "Approved title");
});

test("approved execution gets its own persisted attempt and guarded title write", async () => {
  const h = harness({ autoTitleAttempted: true });
  summarize = async () => ({ title: "Summarized task" });
  await h.runtime.triggerAutoTitleSummarization("session-1", {
    executionId: "execution-a",
    proposalTitle: "Approved title",
    proposalQuestion: "Approved question",
  });

  assert.equal(apiCalls.filter((call) => !call.rename).length, 1);
  assert.match(apiCalls[0].userPrompt, /Approved task title: Approved title/);
  assert.doesNotMatch(apiCalls[0].userPrompt, /This transcript must not be used/);
  assert.ok(h.metadataWrites.some(({ meta }) => meta.autoTitleExecutionId === "execution-a"));
  const renameCall = apiCalls.find((call) => call.rename).rename;
  assert.deepEqual(renameCall, [
    "session-1",
    "Summarized task",
    { expectedTitle: "This transcript must not be used", expectedExecutionId: "execution-a" },
  ]);
  assert.equal(h.getState().sessionMeta["session-1"].lastAutoTitle, "Summarized task");
});

test("a completed or interrupted same execution may accept its pending title", async () => {
  for (const executionState of ["completed", "interrupted"]) {
    const h = harness();
    const pending = deferred();
    summarize = () => pending.promise;
    const request = h.runtime.triggerAutoTitleSummarization("session-1", {
      executionId: "execution-a",
      proposalTitle: "Approved title",
    });
    h.setState({
      ...h.getState(),
      planCheckpoints: {
        "session-1": {
          ...h.getState().planCheckpoints["session-1"],
          executionState,
        },
      },
    });
    pending.resolve({ title: `Result after ${executionState}` });
    await request;
    assert.ok(apiCalls.some((call) => call.rename?.[1] === `Result after ${executionState}`));
  }
});

test("an explicitly cancelled or replaced execution cannot apply its pending title", async () => {
  for (const checkpointPatch of [
    { scheduleState: "cancelled" },
    { executionId: "execution-b", executionState: "running" },
  ]) {
    const h = harness();
    const pending = deferred();
    summarize = () => pending.promise;
    const request = h.runtime.triggerAutoTitleSummarization("session-1", {
      executionId: "execution-a",
      proposalTitle: "Approved title",
    });
    h.setState({
      ...h.getState(),
      planCheckpoints: {
        "session-1": {
          ...h.getState().planCheckpoints["session-1"],
          ...checkpointPatch,
        },
      },
    });
    pending.resolve({ title: "Stale result" });
    await request;
    assert.equal(apiCalls.some((call) => call.rename?.[1] === "Stale result"), false);
  }
});

test("ordinary first-turn title still uses the transcript and stays unguarded", async () => {
  const h = harness({
    title: "Build a calendar",
    messages: [
      { role: "user", content: "Build a calendar" },
      { role: "assistant", content: "I will create a calendar app." },
    ],
  });
  summarize = async () => ({ title: "Calendar app" });
  await h.runtime.triggerAutoTitleSummarization("session-1");

  assert.deepEqual(apiCalls[0], {
    sessionId: "session-1",
    userPrompt: "Build a calendar",
    assistantReply: "I will create a calendar app.",
  });
  assert.deepEqual(apiCalls.find((call) => call.rename).rename, [
    "session-1",
    "Calendar app",
    undefined,
  ]);
  assert.equal(h.getState().sessionMeta["session-1"].lastAutoTitle, "Calendar app");
  assert.equal(h.getState().sessionMeta["session-1"].autoTitleAttempted, true);
});

test("duplicate and non-current execution events do not invoke the summarizer", async () => {
  const h = harness();
  let calls = 0;
  summarize = async () => { calls += 1; return { title: "Summarized task" }; };
  const source = { executionId: "execution-a", proposalTitle: "Approved title" };
  await h.runtime.triggerAutoTitleSummarization("session-1", source);
  await h.runtime.triggerAutoTitleSummarization("session-1", source);
  await h.runtime.triggerAutoTitleSummarization("session-1", {
    ...source,
    executionId: "execution-old",
  });
  assert.equal(calls, 1);
});

test("team members and remote/native execution sources are skipped", async () => {
  for (const options of [
    { role: "member" },
    { source: "remote" },
    { source: "pi-native" },
  ]) {
    const h = harness(options);
    let calls = 0;
    summarize = async () => { calls += 1; return { title: "unused" }; };
    await h.runtime.triggerAutoTitleSummarization("session-1", {
      executionId: "execution-a",
      proposalTitle: "Approved title",
    });
    assert.equal(calls, 0);
  }
});

test("team members never get an ordinary first-turn title request", async () => {
  const h = harness({ role: "member" });
  let calls = 0;
  summarize = async () => { calls += 1; return { title: "unused" }; };
  await h.runtime.triggerAutoTitleSummarization("session-1");
  assert.equal(calls, 0);
});

test("disabled generation, legacy custom titles and failed providers do not rename", async () => {
  const disabled = harness();
  disabled.setState({ ...disabled.getState(), settings: { autoGenerateSessionTitles: false } });
  let calls = 0;
  summarize = async () => { calls += 1; return { title: "unused" }; };
  await disabled.runtime.triggerAutoTitleSummarization("session-1", {
    executionId: "execution-a",
    proposalTitle: "Approved title",
  });
  assert.equal(calls, 0);

  const legacy = harness({ title: "User-owned title" });
  await legacy.runtime.triggerAutoTitleSummarization("session-1", {
    executionId: "execution-a",
    proposalTitle: "Approved title",
  });
  assert.equal(calls, 0);

  const knownAutomatic = harness({
    title: "Earlier generated title",
    lastAutoTitle: "Earlier generated title",
  });
  summarize = async () => { throw Object.assign(new Error("provider failure"), { errorCode: "OFFLINE" }); };
  await assert.doesNotReject(knownAutomatic.runtime.triggerAutoTitleSummarization("session-1", {
    executionId: "execution-a",
    proposalTitle: "Approved title",
  }));
  assert.equal(apiCalls.some((call) => call.rename), false);
});

test("a manual rename or newer execution invalidates a pending title result", async () => {
  const h = harness();
  const pending = deferred();
  summarize = () => pending.promise;
  const older = h.runtime.triggerAutoTitleSummarization("session-1", {
    executionId: "execution-a",
    proposalTitle: "Approved title",
  });
  h.runtime.manualSessionTitles.add("session-1");
  pending.resolve({ title: "Must not win" });
  await older;
  assert.equal(apiCalls.some((call) => call.rename), false);

  const next = harness();
  const oldResult = deferred();
  const newResult = deferred();
  let invocation = 0;
  summarize = () => (++invocation === 1 ? oldResult.promise : newResult.promise);
  const oldRequest = next.runtime.triggerAutoTitleSummarization("session-1", {
    executionId: "execution-a",
    proposalTitle: "Approved title",
  });
  next.setState({
    ...next.getState(),
    planCheckpoints: {
      "session-1": { ...next.getState().planCheckpoints["session-1"], executionId: "execution-b" },
    },
  });
  const newRequest = next.runtime.triggerAutoTitleSummarization("session-1", {
    executionId: "execution-b",
    proposalTitle: "Approved title B",
  });
  oldResult.resolve({ title: "Old result" });
  newResult.resolve({ title: "New result" });
  await Promise.all([oldRequest, newRequest]);
  assert.equal(apiCalls.some((call) => call.rename?.[1] === "Old result"), false);
  assert.equal(apiCalls.some((call) => call.rename?.[1] === "New result"), true);
});
