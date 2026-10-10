import "./runtime-test-harness.js";
import { describe, expect, it, vi } from "vitest";
import type { Agent } from "@earendil-works/pi-agent-core";
import {
  type AssistantMessage,
  type Models,
  createAssistantMessageEventStream,
} from "@earendil-works/pi-ai";
import type { AgentEventEnvelope } from "@pi-desktop/shared";
import { assistantMessage, createRuntime } from "./runtime-test-harness.js";
import { PROVIDER_TRANSIENT_MAX_RETRIES, STREAM_IDLE_TIMEOUT_FLOOR_MS } from "../provider-retry.js";

/** WP3b investigation: keep the real Agent loop and fake only the provider/Host. */
function memberFixture(hangAfterFirst: boolean) {
  const events: AgentEventEnvelope["event"][] = [];
  const host = { call: vi.fn(), onNotification: vi.fn(() => () => {}) };
  const runtime = createRuntime({
    host,
    executionProfile: "team",
    teamContext: {
      teamSessionId: "lead-session", callerSessionId: "session-1",
      memberName: "rehearsal_builder", isLead: false, workPurpose: "execute",
    },
    onEvent: envelope => events.push((envelope as AgentEventEnvelope).event),
  });
  const view = runtime as unknown as { agent: Agent; models: Pick<Models, "streamSimple"> };
  let requests = 0;
  let aborts = 0;
  view.models = {
    streamSimple: (_model, _context, options) => {
      const stream = createAssistantMessageEventStream();
      requests += 1;
      if (hangAfterFirst && requests > 1) {
        stream.push({ type: "start", partial: assistantMessage({ content: [] }) as AssistantMessage });
        // No terminal event, as with an upstream connection that stays open.
        options?.signal?.addEventListener("abort", () => {
          aborts += 1;
          const message = { ...assistantMessage({ content: [] }), stopReason: "aborted" } as AssistantMessage;
          stream.push({ type: "error", reason: "aborted", error: message });
          stream.end(message);
        }, { once: true });
      } else {
        const message = assistantMessage({ content: [] }) as AssistantMessage;
        queueMicrotask(() => {
          stream.push({ type: "start", partial: message });
          stream.push({ type: "done", reason: "stop", message });
          stream.end(message);
        });
      }
      return stream;
    },
  };
  return { runtime, events, host, requests: () => requests, aborts: () => aborts };
}

function terminalErrors(events: AgentEventEnvelope["event"][]) {
  return events.filter(event => event.type === "error");
}

describe("Team member silent-turn investigation", () => {
  it("settles two completed empty responses with EMPTY_MODEL_RESPONSE", async () => {
    const fixture = memberFixture(false);
    try {
      await fixture.runtime.prompt("Finish the assigned rehearsal task", "dispatch-1");
      expect(fixture.requests()).toBe(2);
      expect(terminalErrors(fixture.events)).toEqual([
        expect.objectContaining({ error: expect.objectContaining({ code: "EMPTY_MODEL_RESPONSE", retriable: true }) }),
      ]);
      expect(fixture.runtime.getStatus().isRunning).toBe(false);
      expect(fixture.events.filter(event => event.type === "agent_end")).toHaveLength(1);
      expect(fixture.host.call.mock.calls.some(([method]) => method === "team.authorizeLeadTool")).toBe(false);
    } finally {
      await fixture.runtime.dispose();
    }
  });

  it("surfaces a hanging recovery stream through the existing idle watchdog", async () => {
    vi.useFakeTimers();
    vi.stubEnv("PI_DESKTOP_STREAM_IDLE_TIMEOUT_MS", String(STREAM_IDLE_TIMEOUT_FLOOR_MS));
    const fixture = memberFixture(true);
    try {
      const running = fixture.runtime.prompt("Finish the assigned rehearsal task", "dispatch-2")
        .then(() => undefined, error => error);
      // Controlled time flushes loop setup and the one empty-response rerun.
      await vi.advanceTimersByTimeAsync(0);
      expect(fixture.requests()).toBe(2);
      expect(fixture.runtime.getStatus().isRunning).toBe(true);
      expect(terminalErrors(fixture.events)).toHaveLength(0);
      await vi.advanceTimersByTimeAsync(
        (PROVIDER_TRANSIENT_MAX_RETRIES + 2) * (STREAM_IDLE_TIMEOUT_FLOOR_MS + 30_000),
      );
      const outcome = await running;
      if (outcome !== undefined) {
        expect(outcome).toMatchObject({ code: "STREAM_FAILED", retriable: true });
      } else {
        expect(terminalErrors(fixture.events)).toContainEqual(expect.objectContaining({
          error: expect.objectContaining({ code: "STREAM_FAILED", retriable: true }),
        }));
      }
      expect(fixture.requests()).toBeLessThanOrEqual(PROVIDER_TRANSIENT_MAX_RETRIES + 2);
      expect(fixture.aborts()).toBeGreaterThanOrEqual(1);
      expect(fixture.events).toContainEqual(expect.objectContaining({
        type: "message_end", message: expect.objectContaining({
          status: "error", error: expect.objectContaining({ code: "STREAM_FAILED" }),
        }),
      }));
      expect(fixture.runtime.getStatus().isRunning).toBe(false);
      // Rejected prompt is converted to the terminal error by sidecar.ts.
    } finally {
      await fixture.runtime.dispose();
      vi.unstubAllEnvs();
      vi.useRealTimers();
    }
  });
});
