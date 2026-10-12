import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { PersistenceOutbox } from "../main/persistence-outbox.ts";
import type { HostProcess } from "../main/host-process.ts";

test("diagnostics survive outbox reload and only invalidate after host acknowledgement", async () => {
  const dir = await mkdtemp(join(tmpdir(), "pi-context-outbox-"));
  try {
    const original = new PersistenceOutbox(dir, () => undefined);
    await original.enqueue({ key: "context:s:r", sessionId: "s", contextInsights: { request: { id: "r", content: "exact" } } }, () => null);
    const reloaded = new PersistenceOutbox(dir, () => undefined);
    const order: string[] = [];
    reloaded.setContextInsightsAcknowledgedHandler(sessionId => order.push(`ack:${sessionId}`));
    const host = { isAvailable: () => true, call: async (method: string, params: unknown) => {
      order.push(method); assert.deepEqual(params, { sessionId: "s", request: { id: "r", content: "exact" }, turnId: undefined });
      assert.deepEqual(order, ["contextInsights.record"]); return { recorded: true };
    } } as unknown as HostProcess;
    await reloaded.flush(() => host);
    assert.deepEqual(order, ["contextInsights.record", "ack:s"]);
    assert.equal(reloaded.size(), 0);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("permanently rejected diagnostics cannot block later transcript or usage writes", async () => {
  const dir = await mkdtemp(join(tmpdir(), "pi-context-poison-"));
  try {
    const logs: string[] = [];
    const outbox = new PersistenceOutbox(dir, (_level, message) => logs.push(message));
    await outbox.enqueue({ key: "context:s:bad", sessionId: "s", contextInsights: { request: { id: "bad" } } }, () => null);
    await outbox.enqueue({ key: "message:s:m", sessionId: "s", message: { id: "m" } }, () => null);
    await outbox.enqueue({ key: "usage:s:u", sessionId: "s", turnId: "t", usage: { operationId: "u" } }, () => null);
    const calls: string[] = [];
    const host = { isAvailable: () => true, call: async (method: string) => {
      calls.push(method);
      if (method === "contextInsights.record") throw Object.assign(new Error("invalid diagnostic"), { data: { errorCode: "INVALID_ARGUMENT" } });
      return {};
    } } as unknown as HostProcess;
    await outbox.flush(() => host);
    assert.deepEqual(calls, ["contextInsights.record", "session.appendMessage", "session.recordUsage"]);
    assert.equal(outbox.size(), 0);
    assert.equal(logs.some(log => log.includes("dropping diagnostic only")), true);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("transient diagnostic storage failures keep queued data until recovery", async () => {
  const dir = await mkdtemp(join(tmpdir(), "pi-context-retry-"));
  try {
    const outbox = new PersistenceOutbox(dir, () => undefined);
    await outbox.enqueue({ key: "context:s:r", sessionId: "s", contextInsights: { request: { id: "r" } } }, () => null);
    await outbox.enqueue({ key: "message:s:m", sessionId: "s", message: { id: "m" } }, () => null);
    const failedHost = { isAvailable: () => true, call: async () => {
      throw Object.assign(new Error("fixture disk temporarily unavailable"), { errorCode: "INTERNAL" });
    } } as unknown as HostProcess;
    await outbox.flush(() => failedHost);
    assert.equal(outbox.size(), 2);
    const calls: string[] = [];
    const recovered = { isAvailable: () => true, call: async (method: string) => { calls.push(method); return { recorded: true }; } } as unknown as HostProcess;
    await outbox.flush(() => recovered);
    assert.deepEqual(calls, ["contextInsights.record", "session.appendMessage"]);
    assert.equal(outbox.size(), 0);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
