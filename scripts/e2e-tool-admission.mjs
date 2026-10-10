#!/usr/bin/env node
/**
 * Headless tool-admission regression for issue #1286. Uses only an isolated
 * host, workspace, and local shell commands; no provider or desktop instance.
 * Run with PI_DESKTOP_HOST_BIN pointing to the candidate's built host binary.
 */
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { PROTOCOL_VERSION } from "../packages/shared/dist/protocol.js";
import { assert, assertToolSuccess, shortJson } from "./e2e/assert.mjs";
import { withScenario } from "./e2e/fixture.mjs";
import { resolveHostBinary } from "./e2e/host.mjs";
import { configureSession, createSession } from "./e2e/session.mjs";
import { waitFor } from "./e2e/wait.mjs";

function posixQuote(value) {
  return `'${String(value).replaceAll("'", "'\\''")}'`;
}

function powerShellQuote(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function gateCommand(dialect, marker, gate) {
  if (dialect === "posix") {
    return `printf started > ${posixQuote(marker)}; while [ ! -f ${posixQuote(gate)} ]; do sleep 0.025; done; printf released`;
  }
  const script = `[IO.File]::WriteAllText(${powerShellQuote(marker)}, 'started'); while (-not [IO.File]::Exists(${powerShellQuote(gate)})) { Start-Sleep -Milliseconds 25 }; [Console]::Out.Write('released')`;
  if (dialect === "powershell") return script;
  if (dialect === "cmd") {
    // Windows cmd uses the same built-in PowerShell fixture as e2e-plan.mjs.
    return `powershell.exe -NoLogo -NoProfile -NonInteractive -EncodedCommand ${Buffer.from(script, "utf16le").toString("base64")}`;
  }
  throw new Error(`unsupported shell dialect: ${dialect}`);
}

async function main() {
  const binary = resolveHostBinary();
  const tempRoot = await mkdtemp(join(tmpdir(), "pi-tool-admission-e2e-"));
  try {
    await withScenario("E2E-097-admission", async ({ host, workspace }) => {
      const shellSessions = [];
      for (let index = 0; index < 16; index += 1) {
        const session = await createSession(host, workspace, `Shell admission fixture ${index}`);
        await configureSession(host, session, "agent", "auto");
        shellSessions.push(session);
      }
      const independentSession = await createSession(host, workspace, "Independent tool fixture");
      await configureSession(host, independentSession, "agent", "auto");
      const shell = (await host.call("commandShells.list")).effective;
      assert(shell?.id && shell.available, "no available effective shell: " + shortJson(shell));

      const gate = join(workspace, "release-shells");
      const readFixture = "read-fixture.txt";
      await writeFile(join(workspace, readFixture), "independent read fixture\n", "utf8");
      const calls = [];
      const markers = [];
      const dispatch = (index) => {
        const marker = join(workspace, `shell-${index}-started`);
        markers.push(marker);
        // Capture rejection immediately so an earlier assertion failure can
        // release the gate and clean up all pending RPCs without unhandled errors.
        calls.push(host.call("tools.execute", {
          sessionId: shellSessions[index].id,
          toolCallId: `admission-shell-${index}`,
          toolName: "Bash",
          args: { command: gateCommand(shell.dialect, marker, gate) },
          mode: "agent",
          expectedCommandShellId: shell.id,
          expectedCommandShellDialect: shell.dialect,
        }, 60_000).then(
          (result) => ({ result }),
          (error) => ({ error }),
        ));
      };

      try {
        for (let index = 0; index < 4; index += 1) dispatch(index);
        await waitFor(() => markers.every((marker) => existsSync(marker)), 5_000, "four active shell markers");
        for (let index = 4; index < 16; index += 1) dispatch(index);
        let saturatedBudget;
        await waitFor(async () => {
          saturatedBudget = (await host.call("app.health", {}, 1_000)).toolBudget;
          return saturatedBudget?.queued === 12;
        }, 5_000, "twelve queued shells");
        assert(saturatedBudget.active === 4 && saturatedBudget.shell === 4,
          "queued shells reserved execution capacity: " + shortJson(saturatedBudget));

        const read = await host.call("tools.execute", {
          sessionId: independentSession.id,
          toolCallId: "admission-independent-read",
          toolName: "Read",
          args: { path: readFixture },
          mode: "agent",
        }, 3_000);
        assertToolSuccess(read, "admission-independent-read");
        assert(JSON.stringify(read.content).includes("independent read fixture"),
          "Read returned unexpected content: " + shortJson(read));
        const write = await host.call("tools.execute", {
          sessionId: independentSession.id,
          toolCallId: "admission-independent-write",
          toolName: "Write",
          args: { path: "written-fixture.txt", content: "independent write fixture\n" },
          mode: "agent",
        }, 3_000);
        assertToolSuccess(write, "admission-independent-write");
        assert(await readFile(join(workspace, "written-fixture.txt"), "utf8") === "independent write fixture\n",
          "Write did not persist the independent fixture");
        // Keep the real 30-second admission deadline. This fixture deliberately
        // holds four shell slots; it never runs a provider or a live session.
        const rejectedMarker = join(workspace, "rejected-command-started");
        const overloaded = await host.call("tools.execute", {
          sessionId: independentSession.id,
          toolCallId: "admission-diagnostic",
          toolName: "Bash",
          args: { command: gateCommand(shell.dialect, rejectedMarker, gate) },
          mode: "agent",
          expectedCommandShellId: shell.id,
          expectedCommandShellDialect: shell.dialect,
        }, 40_000);
        assert(overloaded.ok === false && overloaded.errorCode === "HOST_OVERLOADED",
          "expected structured admission rejection: " + shortJson(overloaded));
        const { capacity, error } = overloaded.content;
        assert(capacity.host.inFlight === 4 && capacity.host.queued === 13 &&
          capacity.host.shellInFlight === 4 && capacity.host.shellQueued === 13,
          "incorrect host counts at rejection: " + shortJson(capacity));
        assert(capacity.session.inFlight === 0 && capacity.session.queued === 1 &&
          capacity.session.shellInFlight === 0 && capacity.session.shellQueued === 1,
          "incorrect requesting-session counts: " + shortJson(capacity));
        assert(capacity.holders.length === 4 && capacity.holders.every((holder) =>
          holder.tool === "Bash" && holder.inFlight === 1 &&
          shellSessions.slice(0, 4).some((session) => session.id === holder.sessionId)),
          "incorrect shell holder identities: " + shortJson(capacity));
        assert(error.includes("wait_for_updates") && error.includes("sleep") &&
          error.includes("background execution uses the same capacity"),
          "admission guidance missing: " + shortJson(overloaded));
        assert(!existsSync(rejectedMarker), "rejected command was started");
        assert(!JSON.stringify(overloaded.content).includes(workspace) &&
          !JSON.stringify(overloaded.content).includes(rejectedMarker),
          "capacity diagnostic leaked command or workspace data");
        console.log("PASS E2E-RUNTIME-shell-capacity-diagnostics: rejection preserves counts, safe holders and actionable guidance");
        const afterIndependent = (await host.call("app.health")).toolBudget;
        assert(afterIndependent.active === 4 && afterIndependent.queued === 12,
          "independent work did not release its capacity: " + shortJson(afterIndependent));
      } finally {
        // Release both active and subsequently admitted commands before the
        // isolated host is stopped, including when a regression assertion fails.
        await writeFile(gate, "release\n", "utf8");
        await Promise.all(calls);
      }

      for (const [index, outcome] of (await Promise.all(calls)).entries()) {
        if (outcome.error) throw outcome.error;
        assertToolSuccess(outcome.result, `admission-shell-${index}`);
      }
      const idleBudget = (await host.call("app.health")).toolBudget;
      assert(["active", "queued", "shell", "reads", "mutations", "plugins"].every((key) => idleBudget[key] === 0),
        "tool capacity did not drain: " + shortJson(idleBudget));
      console.log("PASS E2E-097-admission: 4 active + 12 queued shells leave independent Read/Write capacity and drain cleanly");
    }, binary, tempRoot, PROTOCOL_VERSION);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error("FAIL E2E-097-admission: " + (error?.message || String(error)));
  process.exitCode = 1;
});
