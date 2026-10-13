import assert from "node:assert/strict";
import test from "node:test";
import { register } from "node:module";
register(new URL("./helpers/ts-import-hooks.mjs", import.meta.url));
const { resumeGoalAndRefreshSessions } = await import("../src/features/chat/goal/goal-resume-session.ts");
const { createSessionSlice } = await import("../src/stores/slices/session-slice.ts");
const { api } = await import("../src/lib/api.ts");

test("resume refreshes restored Agent/Ask settings without resetting the running transcript or navigation", async (t) => {
  const messages = [{ id: "stream", role: "assistant", content: "Working", status: "streaming" }];
  const heldSession = { id: "goal-session", mode: "goal", permissionMode: "auto" };
  const restoredSession = { ...heldSession, mode: "agent", permissionMode: "ask" };
  let state = { sessions: [heldSession], sessionMeta: {}, activeSessionId: heldSession.id,
    page: "chat", messages, isRunning: true, runningSessions: { [heldSession.id]: true } };
  const commits = [];
  t.mock.method(api, "listSessions", async () => ({ sessions: [restoredSession] }));
  const slice = createSessionSlice({ get: () => state, set: (update) => {
    const patch = typeof update === "function" ? update(state) : update;
    commits.push(patch); state = { ...state, ...patch };
  }, decorateSessions: (sessions) => sessions });
  const resumed = { execution: { id: "execution", sessionId: heldSession.id }, hold: { state: "resumed", version: 2 } };
  const result = await resumeGoalAndRefreshSessions({ sessionId: heldSession.id, executionId: "execution", expectedVersion: 1 }, {
    resume: async () => resumed, refreshSessions: slice.refreshSessions, onRefreshFailed: () => assert.fail("unexpected refresh failure"),
  });
  assert.equal(result, resumed);
  assert.equal(state.sessions[0].mode, "agent"); assert.equal(state.sessions[0].permissionMode, "ask");
  assert.equal(state.messages, messages); assert.equal(state.isRunning, true);
  assert.equal(state.activeSessionId, heldSession.id); assert.equal(state.page, "chat");
  assert.deepEqual(commits.map((patch) => Object.keys(patch)), [["sessions"]]);
});

test("switching sessions during resume never navigates back; refresh failure does not reject an accepted turn", async () => {
  const input = { sessionId: "original", executionId: "execution", expectedVersion: 1 };
  let currentSession = input.sessionId;
  let refreshes = 0, warnings = 0;
  const result = { execution: { id: input.executionId, sessionId: input.sessionId }, hold: { state: "resumed" } };
  assert.equal(await resumeGoalAndRefreshSessions(input, {
    resume: async () => { currentSession = "new-session"; return result; },
    refreshSessions: async () => { refreshes++; throw new Error("Host temporarily unavailable"); },
    onRefreshFailed: () => { warnings++; },
  }), result);
  assert.equal(currentSession, "new-session"); assert.equal(refreshes, 1); assert.equal(warnings, 1);
});

test("failed resume or mismatched returned execution cannot refresh another session's settings", async () => {
  const input = { sessionId: "original", executionId: "execution", expectedVersion: 1 };
  let refreshes = 0;
  const deps = { refreshSessions: async () => { refreshes++; }, onRefreshFailed() {} };
  await assert.rejects(resumeGoalAndRefreshSessions(input, { ...deps, resume: async () => { throw new Error("CONFLICT"); } }), /CONFLICT/);
  await assert.rejects(resumeGoalAndRefreshSessions(input, { ...deps,
    resume: async () => ({ execution: { id: "other-execution", sessionId: input.sessionId } }) }), /GOAL_EXECUTION_SCOPE_MISMATCH/);
  assert.equal(refreshes, 0);
});
