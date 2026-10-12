import "./runtime-test-harness.js";
import { describe, it, vi, expect } from "vitest";
import { classifyAgentError } from "../agent-errors.js";
import { describeProviderFetchFailure } from "../provider-transport-recovery.js";
import { getGlobalDispatcher } from "undici";
import { createRuntime } from "./runtime-test-harness.js";

describe("DesktopAgentRuntime live activity", () => {

  it("keeps retry diagnostics bounded and falls back to captured HTTP status", async () => {
    const runtime = createRuntime({ onEvent: vi.fn() });
    (runtime as any).providerResponseStatus = 503;

    expect(
      (runtime as any).retryActivityError({
        code: "PROVIDER_ERROR",
        message: "503: upstream unavailable",
        retriable: true,
      }),
    ).toEqual({
      code: "PROVIDER_ERROR",
      message: "503: upstream unavailable",
      providerStatus: 503,
    });

    await runtime.dispose();
  });

  it("surfaces the transport errno while a network failure retries", async () => {
    const onEvent = vi.fn();
    const runtime = createRuntime({ onEvent });
    const classified = classifyAgentError(
      Object.assign(new TypeError("fetch failed"), {
        cause: Object.assign(
          new Error("getaddrinfo ENOTFOUND api.example.com"),
          {
            code: "ENOTFOUND",
            syscall: "getaddrinfo",
            hostname: "api.example.com",
          },
        ),
      }),
    );
    const activityError = (runtime as any).retryActivityError(classified);

    // The retry popover renders exactly this object, so the user learns which
    // transport layer is failing instead of only that the provider is
    // unreachable.
    expect(activityError).toEqual({
      code: "NETWORK_ERROR",
      message: "fetch failed",
      networkCode: "ENOTFOUND",
    });

    (runtime as any).setAgentActivity({
      phase: "retrying",
      since: 100,
      attempt: 2,
      retryDelayMs: 2_000,
      error: activityError,
    });
    const statusEvent = onEvent.mock.calls
      .map(([envelope]) => (envelope as any).event)
      .find((event) => event.type === "status");
    expect(statusEvent?.status.activity).toMatchObject({
      phase: "retrying",
      error: { networkCode: "ENOTFOUND" },
    });

    await runtime.dispose();
  });

  it("stamps request size, message count and compaction generation on provider diagnostics", async () => {
    const runtime = createRuntime({ onEvent: vi.fn() });
    (runtime as any).providerRequestMessages = 42;
    (runtime as any).providerRequestBytes = 180_000;
    (runtime as any).activeCompaction = { details: { generation: 3 } };

    expect(
      (runtime as any).providerErrorWithDiagnostics(
        {
          code: "NETWORK_ERROR",
          message: "fetch failed",
          retriable: true,
          details: { networkCategory: "dns", networkCode: "ENOTFOUND" },
        },
        "stream",
        1_500,
        2,
      ).details,
    ).toEqual({
      networkCategory: "dns",
      networkCode: "ENOTFOUND",
      phase: "stream",
      requestMessages: 42,
      requestBytes: 180_000,
      compactionGeneration: 3,
      providerWaitMs: 1_500,
      streamMs: 2,
    });

    await runtime.dispose();
  });

  it("keeps the network diagnosis on the emitted assistant error", async () => {
    const onEvent = vi.fn();
    const runtime = createRuntime({ onEvent });
    const error = classifyAgentError(
      Object.assign(new TypeError("fetch failed"), {
        cause: Object.assign(new Error("connect ECONNRESET"), {
          code: "ECONNRESET",
        }),
      }),
    );

    (runtime as any).finalizeCurrentAssistant("error", error);

    // The event envelope is what the logger persists as `agent/session.log`
    // and what the renderer shows, so this is the surface the diagnosis has to
    // survive on (ADR 0212).
    const events = onEvent.mock.calls.map(([envelope]) => envelope as any);
    expect(events.at(-1)?.event).toMatchObject({
      type: "message_end",
      message: {
        role: "assistant",
        error: {
          code: "NETWORK_ERROR",
          details: { networkCategory: "reset", networkCode: "ECONNRESET" },
        },
      },
    });

    await runtime.dispose();
  });

  it("reports the captured transport cause instead of the flattened message", async () => {
    const runtime = createRuntime({ onEvent: vi.fn() });
    // The reporter's log line (issue #234): a bare `fetch failed`, a stream
    // phase, a two-millisecond "stream", and 112s of provider wait. pi-ai had
    // already flattened the Error, so the text-only classifier can only say
    // "unknown" — the fetch wrapper still held the cause chain.
    const flattened = classifyAgentError("fetch failed");
    expect(flattened).toMatchObject({
      code: "NETWORK_ERROR",
      details: { networkCategory: "unknown" },
    });
    (runtime as any).providerFetchFailure = describeProviderFetchFailure(
      Object.assign(new TypeError("fetch failed"), {
        cause: Object.assign(new Error("read ECONNRESET"), {
          code: "ECONNRESET",
          syscall: "read",
        }),
      }),
      "https://chatgpt.com/backend-api/codex/responses",
    );

    expect(
      (runtime as any).providerErrorWithDiagnostics(
        flattened,
        "stream",
        112_442,
        2,
      ).details,
    ).toMatchObject({
      networkCategory: "reset",
      networkCode: "ECONNRESET",
      networkSyscall: "read",
      // No response ever arrived, so this is not a started stream — the
      // synthetic `message_start` pi-agent-core emits for a stream that ended
      // without `start` must not read as one.
      phase: "request",
      providerWaitMs: 112_442,
      streamMs: 2,
    });

    await runtime.dispose();
  });

  it("rebuilds the shared transport only once the same origin fails twice", async () => {
    const runtime = createRuntime({ onEvent: vi.fn() });
    const failure = describeProviderFetchFailure(
      Object.assign(new TypeError("fetch failed"), {
        cause: Object.assign(new Error("read ECONNRESET"), {
          code: "ECONNRESET",
        }),
      }),
      "https://chatgpt.com/backend-api/codex/responses",
    );
    const before = getGlobalDispatcher();

    (runtime as any).recoverProviderTransport(failure);
    // One unanswered attempt is what a retry is for; the pool stays.
    expect(getGlobalDispatcher()).toBe(before);
    (runtime as any).recoverProviderTransport(failure);
    // The second one has spent its retry on the same dead pool.
    expect(getGlobalDispatcher()).not.toBe(before);

    await runtime.dispose();
  });

  it("emits status phases for quiet provider and delegation intervals", async () => {
    const onEvent = vi.fn();
    const runtime = createRuntime({ onEvent });
    const setActivity = (runtime as any).setAgentActivity.bind(runtime);

    setActivity({ phase: "starting", since: 50 });
    setActivity({ phase: "waiting-model", since: 100 });
    setActivity({ phase: "preparing", since: 150 });
    setActivity({
      phase: "compacting",
      since: 180,
      reason: "threshold",
    });
    setActivity({ phase: "recovering", since: 190 });
    setActivity({
      phase: "retrying",
      since: 200,
      attempt: 2,
      retryDelayMs: 4000,
      error: {
        code: "PROVIDER_RATE_LIMITED",
        message: "429: too many requests",
        providerStatus: 429,
      },
    });
    setActivity({
      phase: "waiting-subagents",
      since: 300,
      subagentCount: 2,
      agents: [
        { name: "explorer", lastPhase: "tool", lastToolName: "Read" },
        { name: "fixer", lastPhase: "thinking" },
      ],
    });

    const statuses = onEvent.mock.calls
      .map(([envelope]) => (envelope as any).event)
      .filter((event) => event.type === "status")
      .map((event) => event.status.activity);
    expect(statuses).toEqual([
      { phase: "starting", since: 50 },
      { phase: "waiting-model", since: 100 },
      { phase: "preparing", since: 150 },
      { phase: "compacting", since: 180, reason: "threshold" },
      { phase: "recovering", since: 190 },
      {
        phase: "retrying",
        since: 200,
        attempt: 2,
        retryDelayMs: 4000,
        error: {
          code: "PROVIDER_RATE_LIMITED",
          message: "429: too many requests",
          providerStatus: 429,
        },
      },
      {
        phase: "waiting-subagents",
        since: 300,
        subagentCount: 2,
        agents: [
          { name: "explorer", lastPhase: "tool", lastToolName: "Read" },
          { name: "fixer", lastPhase: "thinking" },
        ],
      },
    ]);
    expect(runtime.getStatus().activity).toEqual({
      phase: "waiting-subagents",
      since: 300,
      subagentCount: 2,
      agents: [
        { name: "explorer", lastPhase: "tool", lastToolName: "Read" },
        { name: "fixer", lastPhase: "thinking" },
      ],
    });

    (runtime as any).clearAgentActivity();
    expect(runtime.getStatus().activity).toBeUndefined();
    await runtime.dispose();
  });

  it("refreshes waiting-subagents with the child tool currently running", async () => {
    const onEvent = vi.fn();
    const runtime = createRuntime({ onEvent });
    const record = {
      delegationId: "explorer-id",
      agentName: "explorer",
      status: "running",
      startedAt: 1,
      completion: Promise.resolve(),
      resolveCompletion: () => {},
      abort: () => {},
      stopRequested: false,
      turns: 0,
      toolCalls: 0,
      lastActivityAt: 1,
      lastPhase: "waiting-model",
      startedEpoch: 1,
    };
    (runtime as any).delegations.set(record.delegationId, record);
    (runtime as any).beginDelegationWait([record]);
    expect(runtime.getStatus().activity).toEqual({
      phase: "waiting-subagents",
      since: expect.any(Number),
      subagentCount: 1,
      agents: [{ name: "explorer", lastPhase: "waiting-model" }],
    });

    (runtime as any).noteDelegationActivity(record, {
      sessionId: "s",
      ts: 1,
      event: {
        type: "tool_start",
        toolCallId: "t1",
        toolName: "Read",
        args: { path: "a.ts" },
      },
    });
    expect(runtime.getStatus().activity).toMatchObject({
      phase: "waiting-subagents",
      subagentCount: 1,
      agents: [
        { name: "explorer", lastPhase: "tool", lastToolName: "Read" },
      ],
    });

    (runtime as any).noteDelegationActivity(record, {
      sessionId: "s",
      ts: 2,
      event: {
        type: "message_update",
        message: {
          id: "m1",
          role: "assistant",
          content: "",
          thinking: "scan",
          createdAt: "2026-01-01T00:00:00.000Z",
          status: "streaming",
        },
        deltaThinking: "scan",
      },
    });
    expect(runtime.getStatus().activity).toMatchObject({
      agents: [
        { name: "explorer", lastPhase: "thinking", lastToolName: "Read" },
      ],
    });

    const statusCount = onEvent.mock.calls.filter(
      ([envelope]) => (envelope as any).event?.type === "status",
    ).length;
    (runtime as any).noteDelegationActivity(record, {
      sessionId: "s",
      ts: 3,
      event: {
        type: "message_update",
        message: {
          id: "m1",
          role: "assistant",
          content: "",
          thinking: "scan more",
          createdAt: "2026-01-01T00:00:00.000Z",
          status: "streaming",
        },
        deltaThinking: " more",
      },
    });
    expect(
      onEvent.mock.calls.filter(
        ([envelope]) => (envelope as any).event?.type === "status",
      ).length,
    ).toBe(statusCount);

    await runtime.dispose();
  });
});
