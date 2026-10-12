#!/usr/bin/env node
/** Public Host smokes; no model, private profile, or repository mutations. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { access, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PROTOCOL_VERSION } from "../packages/shared/dist/protocol.js";
import { withScenario } from "./e2e/fixture.mjs";
import { resolveHostBinary } from "./e2e/host.mjs";
import { beginTurn, configureSession, createSession, endTurn } from "./e2e/session.mjs";
import { waitForNotification } from "./e2e/wait.mjs";

const scenarios = {
  async approval(ctx) {
    const session = await createSession(ctx.host, ctx.workspace, "Approval smoke");
    await configureSession(ctx.host, session, "agent", "ask");
    const target = join(ctx.workspace, "approved.txt");
    for (const decision of ["deny", "allow-once"]) {
      const toolCallId = randomUUID();
      const pending = ctx.host.call("tools.execute", {
        sessionId: session.id, toolCallId, toolName: "Write",
        args: { path: "approved.txt", content: "approved fixture\n" }, mode: "agent",
      }).then(result => ({ result }), error => ({ error }));
      const request = await waitForNotification(ctx.host.notifications,
        note => note.method === "permissions.request" && note.params?.toolCallId === toolCallId);
      assert.ok(request, "Write must wait for explicit approval");
      await assert.rejects(access(target), { code: "ENOENT" });
      await ctx.host.call("permissions.resolve", { requestId: request.params.requestId, decision });
      const settled = await pending;
      if (settled.error) throw settled.error;
      assert.equal(settled.result.ok, decision === "allow-once", JSON.stringify(settled.result));
      if (decision === "deny") {
        assert.equal(settled.result.errorCode, "TOOL_DENIED");
        await assert.rejects(access(target), { code: "ENOENT" });
      } else assert.equal(await readFile(target, "utf8"), "approved fixture\n");
    }
  },
  async restart(ctx) {
    const session = await createSession(ctx.host, ctx.workspace, "Restart smoke");
    const turnId = await beginTurn(ctx.host, session.id);
    const message = { id: randomUUID(), role: "user", content: "Durable fixture message", status: "complete", createdAt: new Date().toISOString() };
    await ctx.host.call("session.appendMessage", { sessionId: session.id, turnId, message });
    await endTurn(ctx.host, turnId);
    await ctx.host.restart(PROTOCOL_VERSION);
    const restored = (await ctx.host.call("session.get", { id: session.id })).session;
    assert.equal(restored.messages.find(item => item.id === message.id)?.content, message.content);
    const terminal = await ctx.host.call("session.getTurn", { sessionId: session.id, turnId });
    assert.equal(terminal.status, "completed");
    const resumed = await beginTurn(ctx.host, session.id);
    assert.notEqual(resumed, turnId, "restart never replays a completed turn");
    await endTurn(ctx.host, resumed);
  },
};
const selected = process.argv[2];
if (!Object.hasOwn(scenarios, selected) || process.argv.length !== 3) throw new Error("Usage: node scripts/e2e-suite-core.mjs approval|restart");
const temp = await mkdtemp(join(tmpdir(), "pi-core-smoke-"));
try {
  await withScenario(`E2E-CI-${selected}`, scenarios[selected], resolveHostBinary(), temp, PROTOCOL_VERSION);
  console.log(`PASS E2E-CI-${selected}`);
} finally { await rm(temp, { recursive: true, force: true }); }
