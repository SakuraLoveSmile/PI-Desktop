#!/usr/bin/env node
/** Isolated real Host/Main/renderer acceptance; loopback provider only. */
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { createNativeHarness } from "./e2e/team-closeout-native.mjs";
import { approveGoalAuto } from "./e2e/goal-approval-ui.mjs";
import { assertDesktopBuild, repositoryRoot, resolveElectronBinary } from "./e2e/boot.mjs";
import { Host, resolveHostBinary } from "./e2e/host.mjs";
const unknown = process.argv.slice(2).filter((arg) => arg !== "--budget-only" && arg !== "--recovery-only");
assert(process.argv.slice(2).length <= 1, "Choose one closeout scenario mode");
assert.equal(unknown.length, 0, `Unknown arguments: ${unknown.join(", ")}`);
const root = repositoryRoot();
const scriptHash = createHash("sha256")
  .update(readFileSync(new URL(import.meta.url)))
  .digest("hex");
const candidateAtStart = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
const baseMain = execFileSync("git", ["rev-parse", "origin/main"], { cwd: root, encoding: "utf8" }).trim();
// Identify both committed product ancestry and the exact local candidate inputs.
const originalBaseProductCandidate = "26db5043860db8412a988cdce31362a424eea407";
// The public-history rewrite changed documentation, not these product inputs.
// Preserve the immutable old baseline through its exact three product trees.
const baseProductCandidate = "43a4725d64feb9aef33fc0889370d39417c2e712";
const baseProductTrees = { apps: "dbea1acd04f80c949c6e3d518cfa306bdd93fe1c",
  packages: "c8a5416bfb50d55e34a5131e72a4b4a9bb532041", crates: "6043d555ef889ff9d82d934fd1c9ab0e807a11ae" };
for (const [path, tree] of Object.entries(baseProductTrees)) {
  assert.equal(execFileSync("git", ["rev-parse", `${baseProductCandidate}:${path}`], { cwd: root, encoding: "utf8" }).trim(), tree,
    `Rewritten baseline must retain the original ${path} tree`);
}
execFileSync("git", ["merge-base", "--is-ancestor", baseProductCandidate, baseMain], { cwd: root });
execFileSync("git", ["merge-base", "--is-ancestor", baseMain, candidateAtStart], { cwd: root });
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
async function hashGitDiff(args) {
  const digest = createHash("sha256");
  const child = spawn("git", ["diff", "--binary", ...args], { cwd: root, stdio: ["ignore", "pipe", "inherit"] });
  child.stdout.on("data", chunk => digest.update(chunk));
  const code = await new Promise((yes, no) => { child.once("error", no); child.once("close", yes); });
  assert.equal(code, 0, "Candidate diff must be complete before hashing");
  return digest.digest("hex");
}
const workspaceDiffSha256 = await hashGitDiff(["HEAD", "--"]);
const productSourceDiffSha256 = await hashGitDiff([baseProductCandidate, "--", "apps", "packages", "crates"]);
const untrackedSourceHashes = Object.fromEntries(
  execFileSync("git", ["ls-files", "--others", "--exclude-standard", "-z"], { cwd: root, encoding: "utf8" })
    .split("\0")
    .filter(Boolean)
    .sort()
    .map((path) => [path, hash(readFileSync(join(root, path)))]),
);
const candidateIdentity = {
  head: candidateAtStart,
  baseMain,
  baseProductCandidate,
  originalBaseProductCandidate,
  baseProductTrees,
  workspaceDiffSha256,
  productSourceDiffSha256,
  untrackedSourceHashes,
};
candidateIdentity.workspaceFingerprint = hash(JSON.stringify(candidateIdentity));
const runRoot = process.env.E2E_ROOT
  ? resolve(process.env.E2E_ROOT)
  : mkdtempSync(join(tmpdir(), "pi-team-closeout-"));
const dataDir = join(runRoot, "data"),
  homeDir = join(runRoot, "home"),
  project = join(runRoot, "project");

assert(
  !existsSync(join(dataDir, "pi.sqlite")),
  "Use a fresh isolated profile; existing databases are never seeded",
);
const results = [],
  requests = [];
const native = createNativeHarness({ root, runRoot, dataDir, homeDir, results });
const { boot, stop, ipc } = native;
function check(name, detail = {}) {
  results.push({ name, passed: true, ...detail });
  console.log(`PASS ${name}`);
  writeFileSync(join(runRoot, "progress.json"), JSON.stringify(results, null, 2));
}
async function until(probe, label, timeoutMs = 45000) {
  const end = Date.now() + timeoutMs;
  let last;
  while (Date.now() < end) {
    try {
      const value = await probe();
      if (value) return value;
    } catch (e) {
      last = e;
    }
    await delay(timeoutMs > 60000 ? 1000 : 100);
  }
  throw new Error(`Timeout ${label}: ${last?.message ?? ""}`);
}
async function screenshot(name) {
  writeFileSync(join(runRoot, `${name}.png`), Buffer.from(await native.renderer.screenshot(), "base64"));
}
async function selectSession(id) {
  await native.renderer.run(async (id) => {
    window.__PI_DESKTOP__.setPage("chat");
    await window.__PI_DESKTOP__.selectSession(id);
  }, id);
  await native.renderer.until(
    () => Boolean(document.querySelector(".composer-input")),
    null,
    "selected session composer",
  );
}
async function submit(content) {
  await native.renderer.click('.composer-input[contenteditable="true"]');
  await native.renderer.type(content);
  await native.renderer.until(
    () => Boolean(document.querySelector(".send-btn:not(:disabled)")),
    null,
    "send enabled",
  );
  await native.renderer.click(".send-btn");
}
const server = createServer(async (req, res) => {
  try {
    let raw = "";
    for await (const c of req) raw += c;
    const p = JSON.parse(raw);
    if (!req.url.endsWith("/chat/completions")) {
      res.writeHead(404);
      res.end("{}");
      return;
    }
    const messages = p.messages ?? [],
      activeMessages = messages.slice(messages.findLastIndex((m) => m.role === "user") + 1),
      user = messages
        .filter((m) => m.role === "user")
        .map((m) => (typeof m.content === "string" ? m.content : JSON.stringify(m.content)))
        .join("\n");
    requests.push({
      at: Date.now(),
      user,
      tools: messages.filter((m) => m.role === "tool").map((m) => m.content),
    });
    const lastUserContent = messages.findLast((m) => m.role === "user")?.content ?? "";
    const lastUser = typeof lastUserContent === "string" ? lastUserContent : JSON.stringify(lastUserContent);
    requests.at(-1).lastUser = lastUser;
    const late = lastUser.includes("Authenticated user answer to deferred Team question");
    let name, args, text, extraTool;
    if (late) {
      if (
        !activeMessages.some(
          (m) =>
            m.role === "assistant" && m.tool_calls?.some((t) => t.function?.name === "declare_team_strategy"),
        )
      ) {
        name = "declare_team_strategy";
        args = {
          strategy: "delegate",
          reason: "A late answer starts a new recovery negotiation; no old Goal authority is reused",
          members: [
            {
              name: "recovery_observer",
              description: "Proposed read-only recovery expert; do not start before user approval",
              contextKind: "fresh",
              presentation: { role: "collaborator", displayName: "Recovery observer" },
            },
          ],
        };
      } else
        text =
          "CLOSEOUT_LATE_ANSWER_ACCEPTED: Await explicit recovery roster approval. The old Goal remains interrupted.";
    } else if (
      String(lastUser).includes("CLOSEOUT_HELD_REPORT") ||
      String(lastUser).includes("Host Team run limit:")
    ) {
      text = "CLOSEOUT held report acknowledged after explicit Resume.";
    } else if (user.includes("CLOSEOUT_BUDGET_EXPERT")) {
      if (!activeMessages.some((m) => m.role === "tool")) {
        name = "Bash";
        args = { command: "sleep 25; printf CLOSEOUT_BASH_FINISHED", timeout: 35 };
        extraTool = {
          index: 1,
          id: "closeout-admitted-report",
          type: "function",
          function: {
            name: "send_message",
            arguments: JSON.stringify({
              targetMemberName: "Lead",
              content: "CLOSEOUT_HELD_REPORT: pre-admitted expert report after foreground completion.",
            }),
          },
        };
      } else if (
        !activeMessages.some(
          (m) => m.role === "assistant" && m.tool_calls?.some((t) => t.function?.name === "send_message"),
        )
      ) {
        name = "send_message";
        args = {
          targetMemberName: "Lead",
          content: "CLOSEOUT_BASH_FINISHED: real foreground Bash completed normally.",
        };
      } else text = "CLOSEOUT expert finished.";
    } else if (user.includes("CLOSEOUT_PENDING_GOAL") && !user.includes("Approved goal title:")) {
      name = "SubmitGoal";
      args = {
        title: "Closeout pending question",
        markdown: "# Goal\n\n## Acceptance criteria\n- Ask a bounded recovery question.\n",
        question: "Approve bounded recovery question?",
      };
    } else if (user.includes("Approved goal title:") && !late) {
      name = "asktool";
      args = {
        questions: [
          {
            question: "CLOSEOUT durable question: choose recovery",
            options: ["Later authenticated answer", "Wait"],
          },
        ],
      };
    } else if (user.includes("CLOSEOUT_BUDGET_SETUP")) {
      if (
        !messages.some(
          (m) =>
            m.role === "assistant" && m.tool_calls?.some((t) => t.function?.name === "declare_team_strategy"),
        )
      ) {
        name = "declare_team_strategy";
        args = {
          strategy: "delegate",
          reason: "Isolated real run limit acceptance with an idle expert",
          members: [
            {
              name: "observer",
              description: "Stay idle until assigned",
              contextKind: "fresh",
              presentation: { role: "collaborator", displayName: "Observer" },
            },
          ],
        };
      } else if (user.includes("Approved members:")) {
        if (
          !activeMessages.some(
            (m) => m.role === "assistant" && m.tool_calls?.some((t) => t.function?.name === "send_message"),
          )
        ) {
          name = "send_message";
          args = {
            targetMemberName: "observer",
            content:
              "CLOSEOUT_BUDGET_EXPERT: Run the isolated 25 second foreground Bash and send completion evidence.",
          };
        } else {
          name = "wait_for_updates";
          args = { timeoutSeconds: 1 };
        }
      } else text = "CLOSEOUT roster setup complete.";
    } else text = "CLOSEOUT_LATE_ANSWER_ACCEPTED";
    const base = { id: "closeout-local", object: "chat.completion.chunk", created: 1, model: p.model };
    res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
    const delta = name
      ? {
          role: "assistant",
          tool_calls: [
            {
              index: 0,
              id: name === "Bash" ? "closeout-Bash" : `closeout-${name}-${requests.length}`,
              type: "function",
              function: { name, arguments: JSON.stringify(args) },
            },
            ...(extraTool ? [extraTool] : []),
          ],
        }
      : { role: "assistant", content: text };
    for (const part of [
      { ...base, choices: [{ index: 0, delta, finish_reason: null }] },
      {
        ...base,
        choices: [{ index: 0, delta: {}, finish_reason: name ? "tool_calls" : "stop" }],
        usage: { prompt_tokens: 20, completion_tokens: 10, total_tokens: 30 },
      },
    ])
      res.write(`data: ${JSON.stringify(part)}\n\n`);
    res.end("data: [DONE]\n\n");
  } catch (e) {
    res.writeHead(500);
    res.end(JSON.stringify({ error: { message: e.message } }));
  }
});
await new Promise((done, reject) => {
  server.once("error", reject);
  server.listen(0, "127.0.0.1", done);
});
const hostBin = resolveHostBinary(),
  { electronBinary } = resolveElectronBinary(root);
assertDesktopBuild(root);
const artifactHashes = Object.fromEntries(
  [
    hostBin,
    join(root, "apps/desktop/out/main/index.js"),
    join(root, "apps/desktop/out/renderer/index.html"),
    join(root, "packages/agent-runtime/dist/runtime.js"),
    join(root, "packages/agent-runtime/dist/sidecar.js"),
    join(root, "scripts/e2e/team-closeout-native.mjs"),
  ].map((path) => [path, createHash("sha256").update(readFileSync(path)).digest("hex")]),
);
// Include the renderer bundle and Main chunks, not only their entry filenames.
const desktopBuildHashes = Object.fromEntries(
  readdirSync(join(root, "apps/desktop/out"), { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => join(entry.parentPath, entry.name))
    .sort()
    .map((path) => [path.slice(root.length + 1), hash(readFileSync(path))]),
);
for (const p of [dataDir, homeDir, project]) mkdirSync(p, { recursive: true });
const seed = new Host(hostBin, dataDir);
let provider;
try {
  await seed.start();
  provider = (
    await seed.call("providers.create", {
      name: "Closeout isolated loopback",
      vendorKey: "custom",
      type: "openai_compatible",
      authKind: "none",
      apiStyle: "chat_completions",
      baseUrl: `http://127.0.0.1:${server.address().port}/v1`,
      models: [{ id: "closeout", contextWindow: 128000, maxTokens: 2048, thinkingLevels: ["off"] }],
      defaultModelId: "closeout",
    })
  ).provider;
  await seed.call("settings.set", {
    language: "en",
    defaultProviderId: provider.id,
    defaultModelId: "closeout",
    autoGenerateTitle: false,
    expertTeamExpected: (await seed.call("settings.get")).expertTeam ?? null,
    expertTeam: {
      schemaVersion: 1,
      userDefaults: {},
      projectOverrides: {},
      runLimits: { enabled: false, softMs: 21600000, hardMs: 36000000 },
    },
  });
} catch (error) {
  await new Promise((done) => server.close(done));
  throw error;
} finally {
  await seed.stop();
}
console.log(`ARTIFACTS ${runRoot}`);
let failure;
try {
  await boot(electronBinary, hostBin);
  if (process.argv.includes("--budget-only")) {
    await budgetJourney();
  } else {
    const goal = (
      await ipc("sessionCreate", {
        title: "Closeout 30 minute pending",
        mode: "goal",
        executionProfile: "team",
        projectPath: project,
        providerId: provider.id,
        modelId: "closeout",
        permissionMode: "auto",
      })
    ).session;
    await native.cdp.call("Page.reload");
    await native.renderer.until(
      () => Boolean(window.__PI_DESKTOP__ && !document.querySelector(".startup-splash")),
      null,
      "created Goal loaded",
    );
    await selectSession(goal.id);
    await submit("CLOSEOUT_PENDING_GOAL: ask a bounded recovery question.");
    await approveGoalAuto({
      sessionId: goal.id,
      label: "Goal",
      run: native.renderer.run,
      waitFor: (fn, arg, label) => native.renderer.until(fn, arg, label),
      click: selector => native.renderer.click(selector),
    });
    await native.renderer.until(
      () => document.querySelector(".asktool-card")?.innerText.includes("CLOSEOUT durable question"),
      null,
      "real runtime question",
    );
    const pendingStarted = Date.now();
    const askRecord = JSON.parse(
      readDb(
        "SELECT value_json FROM kv WHERE ns='team-lead-ask-v1' AND json_extract(value_json,'$.request.sessionId')=?",
        [goal.id],
      )[0].value_json,
    );
    assert.equal(askRecord.status, "waiting");
    assert(
      askRecord.createdAt <= pendingStarted && pendingStarted - askRecord.createdAt < 5000,
      "Host registered the displayed live question",
    );
    const authRecord = JSON.parse(
      readDb(
        "SELECT value_json FROM kv WHERE ns='goal_progress_auth_v1' AND json_extract(value_json,'$.sessionId')=?",
        [goal.id],
      )[0].value_json,
    );
    const originalTurn = (await ipc("agentGetStatus", goal.id)).status.currentTurnId;
    await screenshot("pending-waiting");
    check("WP11 real question waiting with 30 minute deadline", {
      sessionId: goal.id,
      originalTurn,
      pendingStarted,
      requestId: askRecord.request.requestId,
      createdAt: askRecord.createdAt,
      deadlineMs: askRecord.createdAt + 1800000,
    });
    writeFileSync(
      join(runRoot, "fixture.json"),
      JSON.stringify({ goal, originalTurn, pendingStarted, dataDir, providerId: provider.id }, null, 2),
    );
    // The approved 30-minute timeout remains unchanged; other acceptance runs concurrently.
    // Budget acceptance uses a distinct isolated process so restart cannot shorten this deadline.
    await selectSession(goal.id);
    if (process.argv.includes("--recovery-only")) {
      await stop();
      await boot(electronBinary, hostBin);
      await selectSession(goal.id);
      await native.renderer.until(
        () => Boolean(document.querySelector(".asktool-card .badge")),
        null,
        "waiting question restored pending after process restart",
      );
      const restoredAsk = JSON.parse(
        readDb("SELECT value_json FROM kv WHERE ns='team-lead-ask-v1' AND key=?", [
          `${goal.id}:${askRecord.request.requestId}`,
        ])[0].value_json,
      );
      assert.equal(restoredAsk.status, "pending");
      assert.equal(restoredAsk.request.requestId, askRecord.request.requestId);
      assert(Date.parse(restoredAsk.request.teamPending.deferredAt) < askRecord.createdAt + 1800000);
      check(
        "WP11 waiting question becomes durable pending after restart; this is not a 30 minute expiry test",
        { elapsedMs: Date.now() - askRecord.createdAt },
      );
    } else {
      await until(
        () => native.renderer.run(() => Boolean(document.querySelector(".asktool-card .badge"))),
        "actual 30 minute pending",
        31 * 60 * 1000,
      );
      const expiredAsk = JSON.parse(
        readDb("SELECT value_json FROM kv WHERE ns='team-lead-ask-v1' AND key=?", [
          `${goal.id}:${askRecord.request.requestId}`,
        ])[0].value_json,
      );
      const elapsed = Date.parse(expiredAsk.request.teamPending.deferredAt) - askRecord.createdAt;
      assert(elapsed >= 1800000);
      check("WP11 actual 30 minute expiry", { elapsedMs: elapsed });
    }
    await native.renderer.until(
      () => document.querySelector(".asktool-card")?.innerText.includes("starts a new turn"),
      null,
      "pending approval explanation",
    );
    const pendingHelp = await native.renderer.run(
      () => document.querySelector(".asktool-card p[role='status']")?.innerText ?? "",
    );
    assert(pendingHelp.includes("stopped waiting"));
    assert(pendingHelp.includes("starts a new turn"));
    assert(!pendingHelp.includes("30 minutes"), "Restart recovery must not claim a 30-minute wait");
    check("WP11 pending card states the recovery boundary without claiming elapsed time", { pendingHelp });
    await screenshot("pending-expired");
    assert.equal((await ipc("agentGetStatus", goal.id)).status.isRunning, false);
    const reports = (await ipc("goalReportList", { sessionId: goal.id })).reports;
    assert.equal(reports[0].executionStatus, "interrupted");
    assert.equal(reports[0].status, "pending");
    await native.cdp.call("Page.reload");
    await native.renderer.until(() => Boolean(window.__PI_DESKTOP__), null, "reload ready");
    await selectSession(goal.id);
    await native.renderer.until(
      () => Boolean(document.querySelector(".asktool-card .badge")),
      null,
      "pending card reload",
    );
    await screenshot("pending-reloaded");
    await stop();
    const verifier = new Host(hostBin, dataDir);
    await verifier.start();
    try {
      await assert.rejects(
        verifier.call("goalProgress.update", {
          sessionId: goal.id,
          executionId: authRecord.executionId,
          writeToken: authRecord.writeToken,
          items: [],
        }),
        (error) => ["GOAL_PROGRESS_NOT_RUNNING", "UNAUTHORIZED"].includes(error.errorCode),
      );
      check("WP11 genuine old Goal token rejected", {
        tokenHash: createHash("sha256").update(authRecord.writeToken).digest("hex"),
      });
    } finally {
      await verifier.stop();
    }
    await boot(electronBinary, hostBin);
    await selectSession(goal.id);
    await native.renderer.until(
      () => Boolean(document.querySelector(".asktool-card .badge")),
      null,
      "pending card process restart",
    );
    check("WP11 pending question survives reload and app restart", { executionId: reports[0].executionId });
    await native.renderer.click(".asktool-option:first-child");
    await native.renderer.click(".asktool-card-header-actions .btn-primary");
    const admittedInput = await until(() => {
      const rows = readDb("SELECT turn_id FROM messages WHERE session_id=? AND role='user' AND text LIKE ?", [
        goal.id,
        `Authenticated user answer to deferred Team question ${askRecord.request.requestId}.%`,
      ]);
      return rows.length === 1 && rows[0];
    }, "authenticated late answer admitted to a new turn");
    assert.notEqual(admittedInput.turn_id, originalTurn);
    await until(async () => {
      const turn = await ipc("turnGet", { sessionId: goal.id, turnId: admittedInput.turn_id });
      return turn.status !== "running" && turn;
    }, "legitimate recovery negotiation settles");
    const settled = await ipc("turnGet", { sessionId: goal.id, turnId: admittedInput.turn_id });
    assert.equal(settled.status, "completed");
    const review = (await ipc("teamGetLaunchReview", { teamSessionId: goal.id })).review;
    assert.equal(review.status, "pending");
    assert.equal(review.leadTurnId, admittedInput.turn_id);
    assert.equal(
      (await ipc("teamGetRoster", { teamSessionId: goal.id })).members.length,
      0,
      "late answer cannot start new experts before approval",
    );
    await openTeamPanel();
    await native.renderer.until(
      () => Boolean(document.querySelector('[data-testid="team-launch-review-confirm-btn"]:not(:disabled)')),
      null,
      "explicit recovery roster approval visible",
    );
    const detail = (await ipc("sessionGet", { id: goal.id })).session;
    const lateMessages = detail.messages.filter(
      (m) => m.role === "user" && JSON.stringify(m).includes("Later authenticated answer"),
    );
    assert.equal(lateMessages.length, 1);
    const finalReports = (await ipc("goalReportList", { sessionId: goal.id })).reports;
    assert.equal(finalReports[0].executionStatus, "interrupted");
    assert.equal(finalReports[0].status, "pending");
    await screenshot("pending-late-answer");
    const answered = JSON.parse(
      readDb("SELECT value_json FROM kv WHERE ns='team-lead-ask-v1' AND key=?", [
        `${goal.id}:${askRecord.request.requestId}`,
      ])[0].value_json,
    );
    assert.equal(answered.status, "answered");
    assert.equal(answered.queueId, `asktool-answer:${askRecord.request.requestId}`);
    const admitted = readDb(
      "SELECT turn_id FROM messages WHERE session_id=? AND role='user' AND text LIKE ?",
      [goal.id, `Authenticated user answer to deferred Team question ${askRecord.request.requestId}.%`],
    );
    assert.equal(admitted.length, 1);
    assert.notEqual(admitted[0].turn_id, originalTurn);
    assert.equal(readDb("SELECT id FROM turn_queue WHERE id=?", [answered.queueId]).length, 0);
    check("WP11 authenticated late answer exactly once; interrupted Goal remains interrupted", {
      lateMessages: lateMessages.length,
      requestId: askRecord.request.requestId,
      newTurnId: admitted[0].turn_id,
      queueId: answered.queueId,
      recoveryReviewId: review.reviewId,
      recoveryReviewStatus: review.status,
      newTurnStatus: settled.status,
    });
  }
} catch (error) {
  failure = error;
  console.error(error.stack);
} finally {
  try {
    await stop();
  } catch (error) {
    failure ??= error;
    console.error(error.stack);
  }
  await new Promise((r) => server.close(r));
  writeFileSync(
    join(runRoot, "result.json"),
    JSON.stringify(
      {
        passed: !failure,
        artifactHashes,
        desktopBuildHashes,
        baseProductCandidate,
        candidateIdentity,
        scriptHash,
        candidateAtStart,
        baseMain,
        candidate: execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim(),
        hostSha256: createHash("sha256").update(readFileSync(hostBin)).digest("hex"),
        results,
        requests: requests.map((r) => ({ at: r.at, lastUser: r.lastUser })),
        error: failure?.stack,
      },
      null,
      2,
    ),
  );
}
if (failure) process.exitCode = 1;
async function budgetJourney() {
  const lead = (
    await ipc("sessionCreate", {
      title: "Closeout safe budget pause",
      mode: "agent",
      executionProfile: "team",
      projectPath: project,
      providerId: provider.id,
      modelId: "closeout",
    })
  ).session;
  const configured = await native.renderer.run(
    async ({ id, providerId }) =>
      window.piDesktop.invoke(window.piDesktop.channels.invoke.sessionConfigure, id, {
        mode: "agent",
        providerId,
        modelId: "closeout",
        permissionMode: "auto",
      }),
    { id: lead.id, providerId: provider.id },
  );
  assert.equal(configured.ok, true, JSON.stringify(configured));
  await native.cdp.call("Page.reload");
  await native.renderer.until(
    () => Boolean(window.__PI_DESKTOP__ && !document.querySelector(".startup-splash")),
    null,
    "budget session loaded",
  );
  await selectSession(lead.id);
  await native.renderer.run(() => {
    window.__closeoutEvents = [];
    window.piDesktop.on(window.piDesktop.channels.event.agentMessage, (event) =>
      window.__closeoutEvents.push({ receivedAt: Date.now(), ...event }),
    );
  });
  await submit("CLOSEOUT_BUDGET_SETUP: propose an idle observer for run limit validation.");
  await until(
    async () =>
      Boolean((await ipc("teamGetLaunchReview", { teamSessionId: lead.id })).review?.status === "pending"),
    "budget roster review",
  );
  await policyViaUi(true, "0.002", "0.004");
  const settings = await ipc("settingsGet");
  assert.deepEqual(settings.expertTeam.runLimits, { enabled: true, softMs: 7200, hardMs: 14400 });
  check("WP8 native settings persist through real Host CAS", { policy: settings.expertTeam.runLimits });
  await selectSession(lead.id);
  await openTeamPanel();
  await native.renderer.until(
    () => Boolean(document.querySelector('[data-testid="team-launch-review-confirm-btn"]:not(:disabled)')),
    null,
    "budget roster confirm",
  );
  await native.renderer.click('[data-testid="team-launch-review-confirm-btn"]');
  const expert = await until(async () => {
    const members = (await ipc("teamGetRoster", { teamSessionId: lead.id })).members;
    return members.find((m) => m.name === "observer");
  }, "confirmed expert").catch(async (error) => {
    await screenshot("budget-confirm-failed");
    const review = await ipc("teamGetLaunchReview", { teamSessionId: lead.id });
    const surface = await native.renderer.run(() => document.querySelector('[data-testid="team-panel"]')?.innerText);
    throw new Error(`${error.message}; review=${JSON.stringify(review)}; surface=${surface}`, { cause: error });
  });
  const expertId = expert.sessionId ?? expert.memberSessionId;
  await native.renderer.until(
    (id) =>
      window.__closeoutEvents.some(
        (e) => e.sessionId === id && e.event?.type === "tool_start" && e.event.toolName === "Bash",
      ),
    expertId,
    "pre-admitted real expert Bash",
  );
  const soft = await until(async () => {
    const snap = await ipc("teamGetSnapshot", { teamSessionId: lead.id });
    return snap.runLimits?.softMessageId && snap;
  }, "real scheduler soft notice");
  await native.renderer.until(
    () =>
      Array.from(document.querySelectorAll(".team-warning-box")).some((node) =>
        node.innerText.includes("wrap-up limit"),
      ),
    null,
    "soft UI notice",
  );
  await screenshot("budget-soft");
  check("WP8 scheduler soft notice visible", {
    runId: soft.runLimits.runId,
    softMessageId: soft.runLimits.softMessageId,
  });
  const hard = await until(async () => {
    const snap = await ipc("teamGetSnapshot", { teamSessionId: lead.id });
    return snap.runLimits?.hardReachedAt && snap;
  }, "real scheduler hard pause");
  assert.equal(
    (await ipc("agentGetStatus", expertId)).status.isRunning,
    true,
    "pre-admitted Bash must safely finish",
  );
  await native.renderer.until(
    () =>
      Array.from(document.querySelectorAll(".team-warning-box")).some((node) =>
        node.innerText.includes("safely finishing"),
      ),
    null,
    "safely finishing UI",
  );
  await screenshot("budget-hard-finishing");
  await until(
    async () => (await ipc("agentGetStatus", expertId)).status.isRunning === false,
    "Bash safely settles",
  );
  const detail = (await ipc("sessionGet", { id: expertId })).session;
  const bashResults = detail.messages.filter((m) => m.toolName === "Bash");
  assert.equal(bashResults.length, 1);
  const blocks = transcriptTools(expertId);
  const finished = blocks.find(
    (b) =>
      b.type === "tool_call" &&
      b.name === "Bash" &&
      b.status === "success" &&
      JSON.stringify(b.result).includes("CLOSEOUT_BASH_FINISHED"),
  );
  assert(finished, "Bash result must be completed with returned output");
  assert.equal(finished.result.details.exitCode, 0);
  assert(Date.parse(finished.completedAt) > hard.runLimits.hardReachedAt);
  assert.equal(
    requests.filter((r) => r.at > hard.runLimits.hardReachedAt).length,
    0,
    "hard pause prevents subsequent model requests",
  );
  const toolStartsAfterHard = await native.renderer.run(
    (at) =>
      window.__closeoutEvents.filter(
        (e) =>
          e.receivedAt > at &&
          e.event?.type === "tool_start" &&
          e.event.toolCallId !== "closeout-admitted-report",
      ),
    hard.runLimits.hardReachedAt,
  );
  assert.equal(toolStartsAfterHard.length, 0);
  check("WP8 hard pause preserves admitted Bash and blocks continuation", {
    hardReachedAt: hard.runLimits.hardReachedAt,
    exitCode: finished.result.details.exitCode,
    stdout: finished.result.details.stdout,
    bashCalls: bashResults.length,
    postHardRequests: 0,
    postHardToolBatches: 0,
    preAdmittedCallIds: ["closeout-Bash", "closeout-admitted-report"],
  });
  const expertReport = transcriptTools(expertId).find((b) => b.name === "send_message");
  assert.equal(expertReport.status, "success");
  assert(Date.parse(expertReport.completedAt) > hard.runLimits.hardReachedAt);
  const reportId = expertReport.result.details.id;
  assert(reportId);
  assert.equal(
    readDb("SELECT status FROM session_collaboration_messages WHERE id=?", [reportId])[0].status,
    "queued",
  );
  check("WP8 pre-admitted expert report remains held after hard pause", { reportId });
  const requestCount = requests.length;
  await stop();
  await boot(electronBinary, hostBin);
  await selectSession(lead.id);
  await openTeamPanel();
  const restart = await ipc("teamGetSnapshot", { teamSessionId: lead.id });
  assert.equal(restart.runLimits.runId, hard.runLimits.runId);
  assert.equal(restart.runLimits.startedAt, hard.runLimits.startedAt);
  assert.equal(restart.runLimits.hardReachedAt, hard.runLimits.hardReachedAt);
  assert(restart.runLimits.elapsedMs >= hard.runLimits.elapsedMs);
  assert.equal(restart.paused, true);
  assert.equal(requests.length, requestCount);
  assert.equal(
    readDb("SELECT status FROM session_collaboration_messages WHERE id=?", [reportId])[0].status,
    "queued",
  );
  await native.renderer.until(
    () =>
      Array.from(document.querySelectorAll(".team-warning-box")).some((node) =>
        node.innerText.includes("Paused at the hard run limit"),
      ),
    null,
    "paused after restart",
  );
  await screenshot("budget-restarted");
  check("WP8 app restart retains pause and run clock", { runId: restart.runLimits.runId });
  await native.renderer.click(".team-panel-actions .btn-primary");
  await native.renderer.until(
    () => document.querySelector(".team-panel")?.innerText.includes("Extend or disable"),
    null,
    "resume rejected",
  );
  assert.equal((await ipc("teamGetSnapshot", { teamSessionId: lead.id })).paused, true);
  await policyViaUi(false, "0.002", "0.004");
  await selectSession(lead.id);
  await openTeamPanel();
  await native.renderer.until(
    () =>
      Array.from(document.querySelectorAll(".team-warning-box")).some((node) =>
        node.innerText.includes("remains paused"),
      ),
    null,
    "explicit resume required after policy change",
  );
  assert.equal((await ipc("teamGetSnapshot", { teamSessionId: lead.id })).paused, true);
  await screenshot("budget-resume-ready");
  assert.equal(
    readDb("SELECT status FROM session_collaboration_messages WHERE id=?", [reportId])[0].status,
    "queued",
  );
  assert.equal(requests.length, requestCount);
  await native.renderer.click(".team-panel-actions .btn-primary");
  const resumed = await until(async () => {
    const s = await ipc("teamGetSnapshot", { teamSessionId: lead.id });
    return s.paused === false && s;
  }, "explicit native Resume");
  assert.equal(resumed.runLimits.runId, hard.runLimits.runId);
  check("WP8 disabling policy retains pause until explicit native Resume", {
    runId: resumed.runLimits.runId,
  });
  await until(
    () =>
      readDb("SELECT status FROM session_collaboration_messages WHERE id=?", [reportId])[0].status ===
      "failed",
    "Resume admits held mail and retains Team completion guard",
  );
  const admission = readDb("SELECT id,turn_id FROM messages WHERE session_id=? AND role='user' AND text=?", [
    lead.id,
    "CLOSEOUT_HELD_REPORT: pre-admitted expert report after foreground completion.",
  ]);
  assert.equal(admission.length, 1);
  assert.notEqual(admission[0].turn_id, hard.runLimits.runId);
  const resumedTranscript = readFileSync(join(dataDir, "sessions", `${lead.id}.jsonl`), "utf8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  assert(
    resumedTranscript.some(
      (record) => record.role === "assistant" && record.meta?.error?.code === "TEAM_APPROVAL_REQUIRED",
    ),
  );
  check(
    "WP8 held report admitted exactly once only after explicit Resume; aborted expert is not auto-approved",
    {
      reportId,
      newTurnId: admission[0].turn_id,
      mailStatus: "failed",
      retainedGuard: "TEAM_APPROVAL_REQUIRED",
      authenticatedUserRows: admission.length,
    },
  );
  await screenshot("budget-resumed");
}
async function openTeamPanel() {
  await native.renderer.until(
    () => !document.querySelector(".work-panel.is-exiting,.work-panel.is-entering"),
    null,
    "stable work panel",
  );
  if (await native.renderer.run(() => Boolean(document.querySelector('[data-testid="team-panel"]')))) return;
  if (await native.renderer.run(() => Boolean(document.querySelector('[data-work-panel-tab-id="team"]')))) {
    await native.renderer.click('[data-work-panel-tab-id="team"] .work-panel-tab-button');
    return;
  }
  if (
    await native.renderer.run(
      () => document.querySelector(".app-work-panel-toggle")?.getAttribute("aria-pressed") === "false",
    )
  )
    await native.renderer.click(".app-work-panel-toggle");
  await native.renderer.until(
    () =>
      Boolean(
        document.querySelector('[data-testid="team-panel"]') || document.querySelector(".work-panel-new-tab"),
      ),
    null,
    "work panel open",
  );
  if (await native.renderer.run(() => Boolean(document.querySelector('[data-testid="team-panel"]')))) return;
  await native.renderer.click(".work-panel-new-tab");
  await native.renderer.until(
    () => Boolean(document.querySelector('[data-work-panel-launcher-item="team"]')),
    null,
    "Team launcher",
  );
  await native.renderer.click('[data-work-panel-launcher-item="team"]');
  await native.renderer.until(
    () => Boolean(document.querySelector('[data-testid="team-panel"]')),
    null,
    "Team panel",
  );
}
async function policyViaUi(enabled, soft, hard) {
  await native.renderer.run(() => window.__PI_DESKTOP__.setSettingsTab("expertTeam"));
  await native.renderer.until(
    () => Boolean(document.querySelector('input[aria-label="Wrap-up after (hours)"]')),
    null,
    "real budget settings",
  );
  for (const [label, value] of [
    ["Wrap-up after (hours)", soft],
    ["Pause after (hours)", hard],
  ]) {
    const selector = `input[aria-label="${label}"]`;
    await native.renderer.click(selector);
    await native.renderer.run((selector) => {
      const e = document.querySelector(selector);
      e.select();
    }, selector);
    await native.renderer.type(value);
  }
  const toggle = 'button[role="switch"][aria-label="Enable wall-clock limits"]';
  if (
    (await native.renderer.run((s) => document.querySelector(s)?.getAttribute("aria-checked"), toggle)) !==
    String(enabled)
  )
    await native.renderer.click(toggle);
  const save = 'input[aria-label="Wrap-up after (hours)"]';
  await native.renderer.run(
    (s) =>
      document
        .querySelector(s)
        .closest(".settings-card-block")
        .querySelector(".expert-team-editor-actions button")
        .setAttribute("data-closeout-save", ""),
    save,
  );
  await native.renderer.click("[data-closeout-save]");
  await until(async () => {
    const s = await ipc("settingsGet");
    return (
      s.expertTeam.runLimits.enabled === enabled &&
      s.expertTeam.runLimits.softMs === Number(soft) * 3600000 &&
      s.expertTeam.runLimits.hardMs === Number(hard) * 3600000
    );
  }, "budget saved in Host");
  await screenshot(enabled ? "budget-policy-enabled" : "budget-policy-disabled");
}

function transcriptTools(sessionId) {
  return readFileSync(join(dataDir, "sessions", `${sessionId}.jsonl`), "utf8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line))
    .filter((record) => record.type === "message")
    .flatMap((record) => record.blocks ?? [])
    .filter((block) => block.type === "tool_call");
}

function readDb(sql, params = []) {
  return JSON.parse(
    execFileSync(
      "python3",
      [
        "-c",
        "import sqlite3,json,sys; c=sqlite3.connect('file:'+sys.argv[1]+'?mode=ro',uri=True); c.execute('PRAGMA query_only=ON'); c.row_factory=sqlite3.Row; print(json.dumps([dict(r) for r in c.execute(sys.argv[2],json.loads(sys.argv[3]))]))",
        join(dataDir, "pi.sqlite"),
        sql,
        JSON.stringify(params),
      ],
      { encoding: "utf8" },
    ),
  );
}
