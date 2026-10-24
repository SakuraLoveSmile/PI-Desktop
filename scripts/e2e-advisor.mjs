import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { promisify } from "node:util";
import { setTimeout as delay } from "node:timers/promises";
import { assertDesktopBuild, resolveElectronBinary } from "./e2e/boot.mjs";
import { resolveHostBinary } from "./e2e/host.mjs";

const execFileAsync = promisify(execFile);
const root = resolve(import.meta.dirname, "..");
const artifacts = join(root, ".artifacts", "advisor-e2e", String(Date.now()));
const workspace = join(artifacts, "workspace");
const results = [];
const requests = [];
let fixturePort = 0;

// English strings the spec pins (packages/i18n/src/locales/en). Each run sets
// `language: "en"` first, so the card text matches these exactly.
const ADVISOR_TITLE = "Advisor";
const ADVISOR_DESC =
  "Lets the main agent ask a second model for advice while it works. Main sessions only. The conversation so far is sent to the provider you pick.";
const OFF = "Off";
const UNAVAILABLE = "Unavailable. Sessions run without the Advisor until you pick another model.";
const UNAVAILABLE_LOG = "advisor model unavailable";
const ADVISOR_TOOL = "Advisor";
const READ_TOOL = "Read";

const MAIN_NAME = "E2E Main Fixture";
const ADVISOR_NAME = "E2E Advisor Fixture";
const MAIN_MODEL = "e2e-main-model";
const ADVISOR_MODEL = "e2e-advisor-model";
const MAIN_REPLY = "ADVISOR_E2E_MAIN_OK";

// One loopback server backs both providers. /main/ is the session provider and
// /advisor/ is the advisor pin. Every chat request is recorded with the tool
// names it declared, so the checks read what the model was actually offered.
const fixture = createServer(async (req, res) => {
  let raw = "";
  for await (const part of req) raw += part;
  const side = req.url.startsWith("/advisor/") ? "advisor" : "main";
  if (req.method !== "POST" || !req.url.endsWith("/chat/completions")) {
    res.writeHead(200, { "Content-Type": "application/json" });
    const model = side === "advisor" ? ADVISOR_MODEL : MAIN_MODEL;
    res.end(JSON.stringify({ data: [{ id: model, object: "model" }] }));
    return;
  }
  let body = {};
  try {
    body = JSON.parse(raw || "{}");
  } catch {
    body = {};
  }
  requests.push({
    side,
    tools: (body.tools ?? []).map((tool) => tool.function?.name ?? tool.name).filter(Boolean),
  });
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });
  const chunk = (delta, finish_reason = null) =>
    res.write(
      `data: ${JSON.stringify({ id: "chatcmpl-advisor-e2e", object: "chat.completion.chunk", created: 1, model: body.model ?? MAIN_MODEL, choices: [{ index: 0, delta, finish_reason }] })}\n\n`,
    );
  chunk({ role: "assistant", content: side === "main" ? MAIN_REPLY : "ADVISOR_E2E_UNUSED" });
  chunk({}, "stop");
  res.end("data: [DONE]\n\n");
});

// Page-side expressions. They read the rendered Settings card, which is found
// by its heading, so no class name has to be unique on the page.
const cardScript = (title) => `(() => {
  const heading = [...document.querySelectorAll("h3.settings-card-heading")].find((node) => node.textContent.trim() === ${JSON.stringify(title)});
  return heading?.closest("section.settings-card-block") ?? null;
})()`;
const ADVISOR_CARD = cardScript(ADVISOR_TITLE);
const ADVISOR_MENU = '.model-default-menu.is-open[role="listbox"][aria-label="Advisor model"]';
const READ_MENU = `(() => {
  const trigger = ${ADVISOR_CARD}?.querySelector(".model-default-trigger");
  return {
    viewport: { width: innerWidth, height: innerHeight },
    trigger: trigger ? { disabled: trigger.disabled, expanded: trigger.getAttribute("aria-expanded"), rect: trigger.getBoundingClientRect().toJSON() } : null,
    menus: [...document.querySelectorAll(".model-default-menu")].map((menu) => ({ label: menu.getAttribute("aria-label"), visible: getComputedStyle(menu).visibility === "visible", options: [...menu.querySelectorAll('[role="option"]')].map((option) => option.getAttribute("aria-label")) })),
  };
})()`;
const READ_ROW = `(() => {
  const card = ${ADVISOR_CARD};
  if (!card) return null;
  const detail = card.querySelector(".settings-row-detail");
  const help = card.querySelector(".ui-help-icon")?.getAttribute("aria-label") ?? "";
  return { detail: (detail?.textContent ?? "").replace(/\\s+/g, " ").trim(), help };
})()`;
const ADVISOR_TRIGGER_POINT = `(() => {
  const trigger = ${ADVISOR_CARD}?.querySelector(".model-default-trigger");
  if (!trigger || trigger.disabled) return null;
  trigger.scrollIntoView({ block: "center", behavior: "instant" });
  const rect = trigger.getBoundingClientRect(), x = rect.x + rect.width / 2, y = rect.y + rect.height / 2;
  return trigger.contains(document.elementFromPoint(x, y)) ? { x, y, expanded: trigger.getAttribute("aria-expanded") === "true" } : null;
})()`;
const optionPoint = (label) => `(() => {
  const menu = document.querySelector(${JSON.stringify(ADVISOR_MENU)});
  const option = [...(menu?.querySelectorAll('button[role="option"]') ?? [])].find((node) => node.getAttribute("aria-label") === ${JSON.stringify(label)});
  if (!option || option.disabled) return null;
  option.scrollIntoView({ block: "nearest", behavior: "instant" });
  const rect = option.getBoundingClientRect(), x = rect.x + rect.width / 2, y = rect.y + rect.height / 2;
  return option.contains(document.elementFromPoint(x, y)) ? { x, y } : null;
})()`;
const TRANSCRIPT_HAS_ADVISOR_ROW = `[...document.querySelectorAll("body *")].some((node) => node.children.length === 0 && node.textContent.trim() === ${JSON.stringify(ADVISOR_TOOL)})`;

function waitFor(fn, label, timeout = 45000, app = null) {
  return (async () => {
    const started = Date.now();
    let last = null;
    while (Date.now() - started < timeout) {
      if (app?.child && (app.child.exitCode !== null || app.child.signalCode !== null)) {
        throw new Error(`Electron exited before ${label}: ${app.output.slice(-2000)}`);
      }
      try {
        const value = await fn();
        if (value) return value;
      } catch (error) {
        last = error;
      }
      await delay(150);
    }
    throw new Error(`Timed out: ${label}${last ? `; last error: ${last.message}` : ""}`);
  })();
}

async function freePort() {
  const probe = createServer();
  await new Promise((resolveListen) => probe.listen(0, "127.0.0.1", resolveListen));
  const { port } = probe.address();
  await new Promise((resolveClose) => probe.close(resolveClose));
  return port;
}

function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function pidsMatching(pattern) {
  const { stdout } = await execFileAsync("pgrep", ["-f", pattern]).catch(() => ({ stdout: "" }));
  return stdout.split("\n").map(Number).filter((pid) => pid > 0 && pid !== process.pid);
}

function exited(child, timeout) {
  return new Promise((resolveExit) => {
    const timer = setTimeout(resolveExit, timeout);
    child.once("exit", () => {
      clearTimeout(timer);
      resolveExit();
    });
  });
}

// SIGTERM can leave Electron, its helpers or the Host running, so the
// survivors get SIGKILL after a short grace period.
async function stopProcesses(pids) {
  for (const pid of pids) if (alive(pid)) process.kill(pid, "SIGTERM");
  await delay(1000);
  for (const pid of pids) if (alive(pid)) process.kill(pid, "SIGKILL");
}

class DesktopApp {
  constructor(label, dataDir) {
    this.label = label;
    this.dataDir = dataDir;
    // Both launches of one scenario share a profile, so a restart is real.
    this.profileDir = join(dirname(dataDir), "profile");
    this.dir = join(artifacts, label);
    this.output = "";
    this.seq = 0;
    this.pending = new Map();
    this.ws = null;
    this.child = null;
  }

  async start() {
    await mkdir(this.dir, { recursive: true });
    const { appDir, electronBinary } = resolveElectronBinary(root);
    const debugPort = await freePort();
    const env = {
      ...process.env,
      PI_DESKTOP_DATA_DIR: this.dataDir,
      PI_DESKTOP_HOST_BIN: resolveHostBinary(),
      ELECTRON_RENDERER_URL: "",
      PI_DESKTOP_START_MAXIMIZED: "0",
      NO_PROXY: "localhost,127.0.0.1",
    };
    delete env.ELECTRON_RUN_AS_NODE;
    for (const key of Object.keys(env)) {
      if (key.startsWith("CLAUDE") || /^(HTTPS?|ALL)_PROXY$/i.test(key)) delete env[key];
    }
    this.child = spawn(
      electronBinary,
      [
        `--remote-debugging-port=${debugPort}`,
        "--disable-backgrounding-occluded-windows",
        "--disable-renderer-backgrounding",
        `--user-data-dir=${this.profileDir}`,
        ".",
      ],
      { cwd: appDir, env, stdio: ["ignore", "pipe", "pipe"], windowsHide: true },
    );
    this.child.stdout.on("data", (chunk) => (this.output += chunk));
    this.child.stderr.on("data", (chunk) => (this.output += chunk));
    const target = await this.waitFor(async () => {
      const list = await (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json();
      return list.find(
        (item) =>
          item.type === "page" &&
          item.url.includes("index.html") &&
          !item.url.includes("launcher") &&
          !item.url.includes("plugin"),
      );
    }, `${this.label} desktop CDP target`);
    this.ws = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((resolveOpen, reject) => {
      this.ws.onopen = resolveOpen;
      this.ws.onerror = reject;
    });
    this.ws.onmessage = (event) => {
      const data = JSON.parse(event.data);
      const entry = this.pending.get(data.id);
      if (!entry) return;
      this.pending.delete(data.id);
      clearTimeout(entry.timer);
      if (data.error) entry.reject(new Error(JSON.stringify(data.error)));
      else entry.resolve(data.result);
    };
    await this.ready();
  }

  async ready() {
    await this.waitFor(
      () =>
        this.evaluate(
          'Boolean(window.__PI_DESKTOP__ && window.piDesktop && !window.__advisorReloading && !document.querySelector(".app-shell.is-booting"))',
        ),
      `${this.label} desktop ready`,
    );
    await this.evaluate(
      "window.__advisorEvents = []; window.piDesktop.on(window.piDesktop.channels.event.agentMessage, (event) => window.__advisorEvents.push(event));",
    );
  }

  async reload() {
    await this.evaluate("window.__advisorReloading = true");
    await this.send("Page.reload", { ignoreCache: true });
    await this.ready();
  }

  send(method, params = {}) {
    return new Promise((resolveSend, reject) => {
      const id = ++this.seq;
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`CDP timeout ${method}`));
      }, 30000);
      this.pending.set(id, { resolve: resolveSend, reject, timer });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  async evaluate(expression) {
    const result = await this.send("Runtime.evaluate", {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
    if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
    return result.result.value;
  }

  async ipc(name, ...args) {
    const result = await this.evaluate(
      `window.piDesktop.invoke(window.piDesktop.channels.invoke[${JSON.stringify(name)}], ...${JSON.stringify(args)})`,
    );
    assert.equal(result.ok, true, `${name}: ${JSON.stringify(result)}`);
    return result.data;
  }

  waitFor(fn, label, timeout) {
    return waitFor(fn, label, timeout, this);
  }

  async screenshot(name) {
    const shot = await this.send("Page.captureScreenshot", { format: "png" });
    await writeFile(join(this.dir, `${name}.png`), Buffer.from(shot.data, "base64"));
  }

  async failure(error) {
    if (this.ws?.readyState !== 1) return;
    await this.screenshot("failure").catch(() => {});
    const text = await this.evaluate("document.body.innerText").catch(() => "");
    const events = await this.evaluate("window.__advisorEvents").catch(() => null);
    const menu = await this.evaluate(READ_MENU).catch(() => null);
    await writeFile(
      join(this.dir, "failure.json"),
      JSON.stringify({ error: String(error?.message ?? error), text: text.slice(-3000), menu, events }, null, 2),
    ).catch(() => {});
  }

  async stop() {
    this.ws?.close();
    const child = this.child;
    if (process.platform === "win32") {
      if (child?.pid) await execFileAsync("taskkill", ["/PID", String(child.pid), "/T", "/F"]).catch(() => {});
    } else {
      if (child && child.exitCode === null && child.signalCode === null) {
        child.kill("SIGTERM");
        await exited(child, 10000);
      }
      // Electron can ignore SIGTERM, and a restarted Host can outlive the window.
      // Stop every process that carries this scenario's paths, including ones
      // started after the signal.
      await stopProcesses(await pidsMatching(`${dirname(this.dataDir)}/`));
    }
    child?.stdout?.destroy();
    child?.stderr?.destroy();
    await writeFile(join(this.dir, "electron.log"), this.output).catch(() => {});
  }
}

async function withApp(label, dataDir, fn) {
  const app = new DesktopApp(label, dataDir);
  try {
    await app.start();
    return await fn(app);
  } catch (error) {
    await app.failure(error);
    throw error;
  } finally {
    await app.stop();
  }
}

function providerInput(name, side, modelId) {
  return {
    name,
    vendorKey: "custom",
    type: "openai_compatible",
    protocol: "openai_compatible",
    baseUrl: `http://127.0.0.1:${fixturePort}/${side}/v1`,
    authKind: "api_key_and_base_url",
    secretValue: "local-fixture-only",
    defaultModelId: modelId,
    apiStyle: "chat_completions",
    supportsReasoning: false,
    contextWindow: 128000,
    maxOutputTokens: 4096,
  };
}

async function setUpProviders(app) {
  const settings = await app.ipc("settingsGet");
  await app.ipc("settingsSet", {
    ...settings,
    language: "en",
    autoGenerateSessionTitles: false,
  });
  await app.reload();
  const main = (await app.ipc("providersCreate", providerInput(MAIN_NAME, "main", MAIN_MODEL)))
    .provider;
  const advisor = (
    await app.ipc("providersCreate", providerInput(ADVISOR_NAME, "advisor", ADVISOR_MODEL))
  ).provider;
  await app.evaluate("window.__PI_DESKTOP__.refreshProviders()");
  return { main, advisor };
}

async function openAdvisorSettings(app) {
  await app.evaluate('window.__PI_DESKTOP__.setPage("settings")');
  await app.evaluate('window.__PI_DESKTOP__.setSettingsTab("ai")');
  await app.waitFor(
    () => app.evaluate(`Boolean(${ADVISOR_CARD})`),
    "Advisor card on Settings → AI (the run expects the English UI)",
  );
}

function waitForRow(app, label, matches) {
  return app.waitFor(async () => {
    const row = await app.evaluate(READ_ROW);
    return row && matches(row) ? row : null;
  }, label);
}

async function clickPoint(app, { x, y }) {
  await app.send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1 });
  await app.send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 1 });
}

async function pickAdvisorOption(app, label) {
  console.log("ADVISOR_MENU_STATE", app.label, JSON.stringify(await app.evaluate(READ_MENU)));
  // AnchoredMenu closes anchors outside the viewport. Exercise a hit-tested
  // pointer path rather than clicking an unmeasured, hidden option in the DOM.
  const trigger = await app.waitFor(() => app.evaluate(ADVISOR_TRIGGER_POINT), "visible enabled Advisor model trigger");
  if (!trigger.expanded) await clickPoint(app, trigger);
  await app.waitFor(() => app.evaluate(`Boolean(document.querySelector(${JSON.stringify(ADVISOR_MENU)}))`), "Advisor model menu opens");
  const option = await app.waitFor(() => app.evaluate(optionPoint(label)), "advisor model option");
  await clickPoint(app, option);
}

async function pinAdvisor(app, advisorId) {
  await pickAdvisorOption(app, `${ADVISOR_NAME} · ${ADVISOR_MODEL}`);
  await app.waitFor(async () => {
    const settings = await app.ipc("settingsGet");
    return settings.advisorProviderId === advisorId && settings.advisorModelId === ADVISOR_MODEL;
  }, "advisor pin saved");
}

async function clearAdvisor(app) {
  await pickAdvisorOption(app, OFF);
}

async function runMainSession(app, main, title) {
  const { session } = await app.ipc("sessionCreate", {
    title,
    mode: "agent",
    projectPath: workspace,
    providerId: main.id,
    modelId: MAIN_MODEL,
    thinkingLevel: "off",
  });
  await app.evaluate("window.__PI_DESKTOP__.refreshProviders()");
  await app.evaluate('window.__PI_DESKTOP__.setPage("chat")');
  await app.evaluate(`window.__PI_DESKTOP__.selectSession(${JSON.stringify(session.id)})`);
  await app.waitFor(
    () => app.evaluate('Boolean(document.querySelector(".composer-input"))'),
    "composer",
  );
  const prompt = `Reply with the marker only. ${title}`;
  await app.evaluate(`(() => {
    const input = document.querySelector(".composer-input");
    input.focus();
    input.textContent = ${JSON.stringify(prompt)};
    input.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: input.textContent }));
  })()`);
  await app.waitFor(
    () => app.evaluate('Boolean(document.querySelector(".composer-shell .send-btn:not(:disabled)"))'),
    "send enabled",
  );
  await app.evaluate('document.querySelector(".composer-shell .send-btn").click()');
  await app.waitFor(
    async () => {
      const events = await app.evaluate("window.__advisorEvents");
      return events.some(
        (event) => event.sessionId === session.id && event.event?.type === "agent_end",
      );
    },
    `${title} agent_end`,
    150000,
  );
  await app.waitFor(async () => {
    const detail = await app.ipc("sessionGet", { id: session.id });
    return detail.session?.messages?.some(
      (message) => message.role === "assistant" && message.content?.includes(MAIN_REPLY),
    );
  }, `${title} reply saved`);
  const events = await app.evaluate("window.__advisorEvents");
  assert(!events.some((event) => event.event?.type === "error"), `${title}: no error event`);
  return session;
}

function assertAdvisorAbsent(label) {
  const declared = requests.filter((request) => request.side === "main" && request.tools.length > 0);
  assert(declared.length > 0, `${label}: the session provider received a request with tools`);
  assert(
    declared.some((request) => request.tools.includes(READ_TOOL)),
    `${label}: positive control, ${READ_TOOL} is declared`,
  );
  assert(
    declared.every((request) => !request.tools.includes(ADVISOR_TOOL)),
    `${label}: no request declares ${ADVISOR_TOOL}`,
  );
  assert.equal(
    requests.filter((request) => request.side === "advisor").length,
    0,
    `${label}: the advisor provider was never contacted`,
  );
}

async function assertNoAdvisorRow(app) {
  assert.equal(
    await app.evaluate(TRANSCRIPT_HAS_ADVISOR_ROW),
    false,
    "the transcript has no Advisor tool row",
  );
}

async function unavailableLogFiles(dataDir) {
  const logDir = join(dataDir, "logs");
  const names = await readdir(logDir, { recursive: true }).catch(() => []);
  const matches = [];
  for (const name of names.map(String).filter((item) => item.endsWith(".log"))) {
    const text = await readFile(join(logDir, name), "utf8").catch(() => "");
    if (text.includes(UNAVAILABLE_LOG)) matches.push(name);
  }
  return matches;
}

async function scenarioOff() {
  return withApp("off", join(artifacts, "off", "data"), async (app) => {
    const { main } = await setUpProviders(app);
    await openAdvisorSettings(app);
    const row = await app.evaluate(READ_ROW);
    assert.equal(row.detail, OFF, "the Advisor model row reads Off");
    assert.equal(row.help, ADVISOR_DESC, "the card description (its help icon) names the provider you pick");
    await app.screenshot("settings-off");
    await runMainSession(app, main, "E2E advisor off");
    assertAdvisorAbsent("off");
    await assertNoAdvisorRow(app);
    await app.screenshot("session-off");
    return { launches: 1, providerRequests: requests.length };
  });
}

async function scenarioClear() {
  const dataDir = join(artifacts, "clear", "data");
  const advisor = await withApp("clear-first", dataDir, async (app) => {
    const providers = await setUpProviders(app);
    await openAdvisorSettings(app);
    await pinAdvisor(app, providers.advisor.id);
    await waitForRow(
      app,
      "pinned row names the advisor model",
      (row) =>
        row.detail.includes(ADVISOR_NAME) &&
        row.detail.includes(ADVISOR_MODEL) &&
        !row.detail.includes(UNAVAILABLE),
    );
    await clearAdvisor(app);
    await waitForRow(app, "row reads Off at once", (row) => row.detail === OFF);
    await app.waitFor(async () => {
      const settings = await app.ipc("settingsGet");
      return settings.advisorProviderId === null && settings.advisorModelId === null;
    }, "cleared pin stored as explicit nulls");
    await app.screenshot("cleared-first");
    return providers.advisor;
  });
  await withApp("clear-relaunch", dataDir, async (app) => {
    const { providers } = await app.ipc("providersList");
    assert(
      providers.some((provider) => provider.id === advisor.id),
      "non-vacuity: the advisor provider survives the restart",
    );
    await openAdvisorSettings(app);
    await waitForRow(app, "row reads Off after restart", (row) => row.detail === OFF);
    const settings = await app.ipc("settingsGet");
    assert.equal(settings.advisorProviderId, null);
    assert.equal(settings.advisorModelId, null);
    assert.equal(requests.filter((request) => request.side === "advisor").length, 0);
    await app.screenshot("relaunch-off");
  });
  return { launches: 2 };
}

async function scenarioStale() {
  return withApp("stale", join(artifacts, "stale", "data"), async (app) => {
    const { main, advisor } = await setUpProviders(app);
    await openAdvisorSettings(app);
    await pinAdvisor(app, advisor.id);
    await app.ipc("providersUpdate", { id: advisor.id, enabled: false });
    await app.evaluate("window.__PI_DESKTOP__.refreshProviders()");
    await waitForRow(
      app,
      "row keeps the pinned provider and model with an Unavailable note",
      (row) =>
        row.detail.includes(ADVISOR_NAME) &&
        row.detail.includes(ADVISOR_MODEL) &&
        row.detail.includes(UNAVAILABLE),
    );
    await app.screenshot("settings-unavailable");
    await runMainSession(app, main, "E2E advisor stale pin");
    assertAdvisorAbsent("stale");
    await assertNoAdvisorRow(app);
    const logFiles = await app.waitFor(async () => {
      const files = await unavailableLogFiles(app.dataDir);
      return files.length > 0 ? files : null;
    }, "advisor unavailable line in the app log", 20000);
    await app.screenshot("session-stale");
    return { launches: 1, logFiles };
  });
}

async function runScenario(id, fn) {
  const started = Date.now();
  requests.length = 0;
  try {
    const detail = await fn();
    results.push({ id, status: "pass", ms: Date.now() - started, ...detail });
    console.log("PASS", id);
  } catch (error) {
    results.push({ id, status: "fail", ms: Date.now() - started, error: String(error?.stack ?? error) });
    console.error("FAIL", id, error);
    process.exitCode = 1;
  }
}

await mkdir(workspace, { recursive: true });
assertDesktopBuild(root);
await new Promise((resolveListen) => fixture.listen(0, "127.0.0.1", resolveListen));
fixturePort = fixture.address().port;
try {
  await runScenario("E2E-ADVISOR-off-until-a-model-is-picked", scenarioOff);
  await runScenario("E2E-ADVISOR-clear-row-returns-to-off", scenarioClear);
  await runScenario("E2E-ADVISOR-stale-pin-keeps-the-session-running", scenarioStale);
} finally {
  fixture.closeAllConnections();
  await new Promise((resolveClose) => fixture.close(resolveClose));
  await writeFile(join(artifacts, "results.json"), JSON.stringify(results, null, 2));
  console.log("ARTIFACTS", artifacts);
}
const summary = results.map(({ id, status }) => ({ id, status }));
console.log(results.every((result) => result.status === "pass") ? "VERIFIED" : "FAILED", JSON.stringify(summary));
process.exit(process.exitCode ?? 0);
