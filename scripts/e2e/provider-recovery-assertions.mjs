import assert from "node:assert/strict";
export function verifyProviderRecovery(cases) {
  assert.equal(cases.length, 5);
  const expectedCounts = [3, 2, 3, 11, 24];
  const expectedDelays = [1000, 2000, 4000, 8000, 8000, 8000, 8000, 8000, 8000, 8000];
  const summary = cases.map((result, index) => {
    const events = result.events
      .filter((e) => e.sessionId === result.sessionId)
      .map((e) => e.event);
    const errors = events.filter((e) => e.type === "error");
    const retries = events
      .filter((e) => e.type === "status" && e.status.activity?.phase === "retrying")
      .map((e) => e.status.activity);
    const assistants = result.detail.session.messages.filter(
      (m) => m.role === "assistant",
    );
    const tools = result.detail.session.messages.filter((m) => m.role === "tool");
    assert.equal(result.requests.length, expectedCounts[index], result.name);
    assert.equal(result.retryShot, true, `${result.name}: retry countdown visible`);
    assert.equal(
      events.filter((e) => e.type === "agent_end").length,
      1,
      `${result.name}: one terminal lifecycle`,
    );
    if (index !== 3) {
      assert.equal(errors.length, 0);
      // Tool-only responses have no visible content, so Main omits those
      // empty assistant rows. Public lifecycle and tool history below still
      // prove all twelve successful responses and eleven actual executions.
      assert.equal(assistants.length, 1);
      assert(assistants.every((m) => m.status === "complete"));
      assert.equal(assistants.at(-1).content, "RECOVERED_699");
      assert(result.text.includes("RECOVERED_699"));
      assert(!result.text.includes("NETWORK_ERROR"));
    } else {
      assert.equal(errors.length, 1);
      assert.equal(errors[0].error.code, "NETWORK_ERROR");
      assert.equal(errors[0].error.details.retryAttempt, 10);
      assert.equal(assistants.filter((m) => m.status === "error").length, 1);
      assert.deepEqual(
        retries.map((r) => r.attempt),
        [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
      );
      assert.deepEqual(
        retries.map((r) => r.retryDelayMs),
        expectedDelays,
      );
      assert(result.text.includes("NETWORK_ERROR") && result.text.includes("继续"));
    }
    if (index === 3) {
      const gaps = result.requests.slice(1).map((r, i) => r.at - result.requests[i].at);
      assert(
        gaps.every((gap, i) => gap >= expectedDelays[i] - 50),
        "real backoff timing",
      );
    }
    if (index === 4) {
      const toolIds = Array.from({ length: 11 }, (_, tool) => `call_${tool}`);
      const completed = events.filter((event) => event.type === "message_end" && event.message.role === "assistant")
        .map((event) => event.message);
      assert.equal(completed.length, 12, "eleven tool-only responses and one final response completed");
      assert.equal(new Set(completed.map((message) => message.id)).size, 12, "successful responses retain separate identities");
      assert(completed.every((message) => message.status === "complete"));
      assert(completed.slice(0, -1).every((message) => message.content === ""));
      assert.equal(completed.at(-1).content, "RECOVERED_699");
      assert.deepEqual(events.filter((event) => event.type === "tool_start").map((event) => event.toolCallId), toolIds,
        "each Read starts exactly once despite provider retries");
      assert.deepEqual(events.filter((event) => event.type === "tool_end").map((event) => event.toolCallId), toolIds,
        "each Read settles exactly once despite provider retries");
      assert.equal(tools.length, 11, "eleven actual tools preserved");
      assert.deepEqual(tools.map((message) => message.toolCallId), toolIds, "ordered durable tool history retained");
      assert(
        tools.every((m) => m.toolName === "Read" && m.toolStatus === "success"),
        "all real Reads succeeded",
      );
      assert.equal(
        result.requests.at(-1).toolResults,
        11,
        "successful tool context retained at final response",
      );
      for (const request of result.requests) {
        assert.deepEqual(request.toolResultIds, toolIds.slice(0, Math.floor((request.nth - 1) / 2)),
          `request ${request.nth}: completed tool context survives every retry`);
      }
      assert.deepEqual(
        retries.map((r) => r.attempt),
        Array(12).fill(1),
      );
      assert.deepEqual(
        retries.map((r) => r.retryDelayMs),
        Array(12).fill(1000),
      );
    }
    return {
      name: result.name,
      requests: result.requests.length,
      retries: retries.length,
      durationMs: result.requests.at(-1).at - result.requests[0].at,
      successfulTools: tools.filter((m) => m.toolStatus === "success").length,
      terminalError: errors[0]?.error ?? null,
      behaviorVerified: true,
      exhaustedRetryDiagnosticPresent:
        index === 3 ? errors[0].error.details.retryAttempt === 10 : null,
    };
  });
  return summary;
}
