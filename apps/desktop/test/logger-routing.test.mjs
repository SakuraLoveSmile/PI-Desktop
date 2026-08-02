import assert from "node:assert/strict";
import { readFile, readdir, rm, mkdtemp } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { Logger } from "../electron/main/logger.ts";

test("logger routes records by category and keeps child stderr line-safe", async () => {
  const dataDir = await mkdtemp(join(tmpdir(), "pi-desktop-logger-"));
  const previousNodeEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = "production";

  try {
    const logger = new Logger(dataDir, "debug");
    logger.app("session", "info", "prompt accepted", {
      sessionId: "session-1",
      data: { apiKey: "must-not-be-written" },
    });
    logger.app("tool", "info", "tool start", {
      sessionId: "session-1",
      toolCallId: "tool-1",
    });
    logger.child(
      "host",
      "\u001b[2m2026-08-02T00:00:00Z\u001b[0m INFO tool timing tool=Read",
    );
    logger.child("host", " tool_call_id=tool-1\n");
    logger.child("agent", "[timing] kind=model providerWaitMs=12\n");

    const appFiles = (await readdir(join(dataDir, "logs", "app"))).sort();
    assert.deepEqual(appFiles, ["session.log", "tool.log"]);
    assert.equal(existsSync(join(dataDir, "logs", "app.log")), false);

    const sessionRecord = JSON.parse(
      await readFile(join(dataDir, "logs", "app", "session.log"), "utf8"),
    );
    assert.equal(sessionRecord.channel, "app");
    assert.equal(sessionRecord.category, "session");
    assert.equal(sessionRecord.data.apiKey, "***REDACTED***");

    const hostRecord = JSON.parse(
      await readFile(join(dataDir, "logs", "host", "timing.log"), "utf8"),
    );
    assert.equal(hostRecord.category, "timing");
    assert.match(hostRecord.message, /tool timing tool=Read tool_call_id=tool-1/);
    assert.doesNotMatch(hostRecord.message, /\u001b/);

    const agentRecord = JSON.parse(
      await readFile(join(dataDir, "logs", "agent", "timing.log"), "utf8"),
    );
    assert.equal(agentRecord.category, "timing");
    assert.match(agentRecord.message, /kind=model/);
  } finally {
    if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousNodeEnv;
    await rm(dataDir, { recursive: true, force: true });
  }
});
