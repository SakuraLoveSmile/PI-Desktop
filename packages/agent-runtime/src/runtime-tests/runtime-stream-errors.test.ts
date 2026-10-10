import "./runtime-test-harness.js";
import { describe, it, vi, expect } from "vitest";
import { createRuntime, assistantMessage } from "./runtime-test-harness.js";

describe("DesktopAgentRuntime assistant thinking events", () => {

  it.each(["context-validation", "context-estimation", "request-preparation"])(
    "terminates a local %s failure without retry or overflow recovery",
    async (phase) => {
      const onEvent = vi.fn();
      const runtime = createRuntime({ onEvent });
      const internal = runtime as any;
      internal.providerResponseStatus = 429;
      internal.infiniteProviderRetry = true;
      const claim = vi.spyOn(internal, "claimProviderRetry");
      const message = {
        ...assistantMessage({ content: [], stopReason: "error" }),
        errorMessage: "context length exceeded; fetch failed; private request body",
        errorDetails: {
          code: "LOCAL_REQUEST_ERROR",
          phase,
          message: "private request body",
          causeName: "TypeError",
        },
      };
      await internal.handleAgentEvent({ type: "message_start", message });
      await internal.handleAgentEvent({ type: "message_end", message });
      const events = onEvent.mock.calls.map(([envelope]) => (envelope as any).event);
      const failure = events.find((event) => event.type === "error");
      expect(failure?.error).toMatchObject({
        code: "INTERNAL",
        retriable: false,
        details: { origin: "local", phase, causeName: "TypeError" },
      });
      expect(failure?.error.details).not.toHaveProperty("providerStatus");
      expect(JSON.stringify(events)).not.toContain("private request body");
      expect(events.filter((event) => event.type === "error")).toHaveLength(1);
      expect(events.find((event) => event.type === "message_end")?.message.status).toBe("error");
      expect(claim).not.toHaveBeenCalled();
      expect(internal.pendingProviderRetry).toBeUndefined();
      expect(internal.pendingOverflow).toBe(false);
      expect(internal.providerTransientRetryAttempt).toBe(0);
      expect(internal.providerRateLimitRetryAttempt).toBe(0);
      await runtime.dispose();
    },
  );

  it("preserves cancellation carried by a local preparation error", async () => {
    const onEvent = vi.fn();
    const runtime = createRuntime({ onEvent });
    const internal = runtime as any;
    const message = {
      ...assistantMessage({ content: [], stopReason: "error" }),
      errorMessage: "local preparation cancelled",
      errorDetails: {
        code: "LOCAL_REQUEST_ERROR",
        phase: "request-preparation",
        message: "cancelled",
        causeName: "AbortError",
      },
    };
    await internal.handleAgentEvent({ type: "message_start", message });
    await internal.handleAgentEvent({ type: "message_end", message });
    const events = onEvent.mock.calls.map(([envelope]) => (envelope as any).event);
    expect(events.find((event) => event.type === "message_end")?.message.status).toBe("aborted");
    expect(events.some((event) => event.type === "error")).toBe(false);
    expect(internal.pendingProviderRetry).toBeUndefined();
    await runtime.dispose();
  });

  it("turns a provider model failure into an error message and event", async () => {
    const onEvent = vi.fn();
    const runtime = createRuntime({ onEvent });
    const handleAgentEvent = (runtime as any).handleAgentEvent.bind(runtime);

    await handleAgentEvent({
      type: "message_start",
      message: {
        role: "assistant",
        content: [],
      },
    });
    await handleAgentEvent({
      type: "message_end",
      message: {
        role: "assistant",
        content: [],
        stopReason: "error",
        errorMessage: '404: {"error":{"message":"model not found"}}',
      },
    });

    const events = onEvent.mock.calls.map(([envelope]) => envelope as any);
    expect(events.at(-2)?.event).toMatchObject({
      type: "message_end",
      message: {
        status: "error",
        isError: true,
        error: {
          code: "MODEL_NOT_CONFIGURED",
          message: '404: {"error":{"message":"model not found"}}',
          retriable: false,
          details: {
            phase: "stream",
            providerStatus: 404,
          },
        },
      },
    });
    expect(events.at(-1)?.event).toMatchObject({
      type: "error",
      error: {
        code: "MODEL_NOT_CONFIGURED",
        retriable: false,
      },
    });

    await runtime.dispose();
  });
});
