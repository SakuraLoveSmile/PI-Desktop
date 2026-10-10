#!/usr/bin/env node
/** Isolated candidate Host RPC Edit compatibility; no provider or user profile. */
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PROTOCOL_VERSION } from "../packages/shared/dist/protocol.js";
import { assert, assertToolFailure, assertToolSuccess, shortJson } from "./e2e/assert.mjs";
import { withScenario } from "./e2e/fixture.mjs";
import { resolveHostBinary } from "./e2e/host.mjs";
import { configureSession, createSession } from "./e2e/session.mjs";

const binary = resolveHostBinary();
const tempRoot = await mkdtemp(join(tmpdir(), "pi-edit-legacy-e2e-"));
try {
  await withScenario("E2E-RUNTIME-edit-accepts-tag-with-legacy-arguments", async ({ host, workspace }) => {
    const session = await createSession(host, workspace, "Legacy Edit shape fixture");
    await configureSession(host, session, "agent", "auto");
    let call = 0;
    const execute = async (toolName, args) => {
      const toolCallId = `edit-legacy-${++call}`;
      const result = await host.call("tools.execute", {
        sessionId: session.id, toolCallId, toolName, args, mode: "agent",
      });
      if (result.ok) assertToolSuccess(result, toolCallId);
      return result;
    };
    const path = "edit.txt";
    const target = join(workspace, path);
    await writeFile(target, "before\nunique\nafter\n");
    let read = await execute("Read", { path });
    assert(read.ok, shortJson(read));
    const legacy = await execute("Edit", { path, tag: "FFFF", old_string: "unique", new_string: "replacement" });
    assert(legacy.ok, shortJson(legacy));
    assert(await readFile(target, "utf8") === "before\nreplacement\nafter\n", "legacy edit did not apply exactly once");

    const anchored = await execute("Edit", {
      path, tag: legacy.content.tag, ops: "PUT 2.=2:\n+anchored\n",
      old_string: "replacement", new_string: "ignored legacy content",
    });
    assert(anchored.ok, shortJson(anchored));
    assert(await readFile(target, "utf8") === "before\nanchored\nafter\n", "ops did not take precedence");
    read = await execute("Read", { path });
    const unchangedAnchored = await execute("Edit", {
      path, tag: read.content.tag, ops: "PUT 2.=2:\n+plain anchored\n",
    });
    assert(unchangedAnchored.ok, shortJson(unchangedAnchored));

    for (const old_string of ["missing", "repeated"]) {
      await writeFile(target, "repeated\nrepeated\n");
      const rejected = await execute("Edit", { path, tag: "FFFF", old_string, new_string: "unsafe" });
      assertToolFailure(rejected, "EDIT_LEGACY_MATCH_FAILED");
      assert(await readFile(target, "utf8") === "repeated\nrepeated\n", "ambiguous/missing legacy match changed file");
    }
    read = await execute("Read", { path });
    for (const [ops, errorCode] of [[undefined, "INVALID_ARGUMENT"], ["PUT 1.=1:", "EDIT_PARSE_FAILED"]]) {
      const rejected = await execute("Edit", { path, tag: read.content.tag, ops, new_string: "ignored" });
      assertToolFailure(rejected, errorCode);
      assert(rejected.content.error.includes("PUT 48.=48:\n+replacement"), shortJson(rejected));
      assert(rejected.content.error.includes("new_string is read only when ops is absent"), shortJson(rejected));
      assert(await readFile(target, "utf8") === "repeated\nrepeated\n", "malformed edit changed file");
    }
    console.log("PASS E2E-RUNTIME-edit-accepts-tag-with-legacy-arguments");
  }, binary, tempRoot, PROTOCOL_VERSION);
} finally {
  await rm(tempRoot, { recursive: true, force: true });
}
