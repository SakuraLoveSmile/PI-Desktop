import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import { createInstance } from "i18next";
import { I18nextProvider } from "react-i18next";
import { en } from "@pi-desktop/i18n";
import type { BackgroundProcessesChanged, BackgroundProcessSummary, ContextInsightsSnapshot, SessionActivityPage, SessionSummary } from "@pi-desktop/shared";
import { SessionActivity } from "../../apps/desktop/src/features/chat/activity/SessionActivity";
import { useAppStore } from "../../apps/desktop/src/stores/app-store";
import { api } from "../../apps/desktop/src/lib/api";

const SID = "srv-session";
const PROJECT = "/Users/dev/Code/app";

/**
 * The Servers section of the real activity pane reads through the real store, hooks and stylesheet; only the Host edge
 * (the process list, its change events, stop and read) is replaced by a fake that answers when the probe says so. No
 * provider, account or user data is read.
 */
export async function sessionActivityServersProbe() {
  const initial = useAppStore.getState();
  const i18n = createInstance();
  await i18n.init({ lng: "en", interpolation: { escapeValue: false }, resources: { en: { translation: en } } });
  const host = document.createElement("div");
  // The real pane: 264px wide with 16px side padding, which the rows' −8px margins reach into.
  host.style.cssText = "position:fixed;top:40px;right:40px;width:264px;box-sizing:border-box;padding:8px 16px 16px;max-height:90vh;overflow:auto;background:var(--color-bg-primary);z-index:1000;";
  document.body.append(host);
  const errors: unknown[] = [];
  const warnings: string[] = [];
  const root = createRoot(host, { onUncaughtError: (error) => errors.push(error) });
  const initialTheme = document.documentElement.getAttribute("data-theme");
  const initialScale = document.documentElement.style.getPropertyValue("--font-scale");
  const originalWarn = console.warn;
  console.warn = (...args: unknown[]) => { warnings.push(args.map(String).join(" ")); };
  const original = {
    git: api.getWorkspaceGit, mcp: api.listMcpServers, activity: api.getSessionActivity, activityChanged: api.onSessionActivityChanged,
    list: api.listBackgroundProcesses, read: api.readBackgroundProcess, stop: api.stopBackgroundProcess, processesChanged: api.onBackgroundProcessesChanged,
    hostStatus: api.onHostStatus, insights: api.getContextInsights, agentEvent: api.onAgentEvent, insightsChanged: api.onContextInsightsChanged,
  };

  const at = new Date(Date.now() - 60_000).toISOString();
  const proc = (id: string, command: string, over: Partial<BackgroundProcessSummary> = {}): BackgroundProcessSummary =>
    ({ id, sessionId: SID, toolCallId: `call-${id}`, command, cwd: PROJECT, status: "running", startedAt: at, ...over });
  // What the Host would send: an address only while the process is up; a plain test watcher announces none.
  let processes: BackgroundProcessSummary[] = [
    proc("dev", "pnpm dev --port 3000", { address: "http://localhost:3000" }),
    proc("api", "node api.js", { address: "http://127.0.0.1:8080", backgroundKind: "service" }),
    proc("watch", "pnpm test --watch"),
  ];
  const listeners = new Set<(event: BackgroundProcessesChanged) => void>();
  let revision = 0;
  const changed = (id: string) => listeners.forEach((listener) => listener({ sessionId: SID, id, revision: ++revision }));
  const patch = (id: string, over: Partial<BackgroundProcessSummary>) => {
    processes = processes.map((item) => (item.id === id ? { ...item, ...over } : item));
    changed(id);
  };
  const lists: string[] = [];
  api.listBackgroundProcesses = async (sessionId) => { lists.push(sessionId); return { processes: processes.filter((item) => item.sessionId === sessionId).map((item) => ({ ...item })) }; };
  api.onBackgroundProcessesChanged = (listener) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
  api.readBackgroundProcess = async (sessionId, id) => ({ process: { ...processes.find((item) => item.id === id && item.sessionId === sessionId)! },
    stdout: "ready on http://localhost:3000\n", stderr: "", stdoutTruncated: false, stderrTruncated: false });
  // A stop answers when the probe says so, which keeps the row's in-between state still enough to look at.
  const stopCalls: string[] = [];
  const gates = new Map<string, { ok: () => void; fail: (message: string) => void }>();
  api.stopBackgroundProcess = (sessionId, id) => {
    stopCalls.push(`${sessionId}:${id}`);
    return new Promise((resolve, reject) => gates.set(id, {
      ok: () => { patch(id, { status: "stopping" }); resolve({ process: { ...processes.find((item) => item.id === id)! } }); },
      fail: (message) => reject(new Error(message)),
    }));
  };
  api.onHostStatus = () => () => {};
  api.getWorkspaceGit = async () => ({ git: null });
  api.listMcpServers = async () => ({ servers: [], statuses: [] });
  const insights: ContextInsightsSnapshot = { version: 1, sessionId: SID, events: [], updatedAt: 1, requests: [],
    retention: { maxRequests: 40, maxEvents: 160, maxContentChars: 120000, maxTotalContentChars: 1200000, droppedRequests: 0, droppedEvents: 0 } };
  api.getContextInsights = async () => insights;
  api.onAgentEvent = () => () => {};
  api.onContextInsightsChanged = () => () => {};
  const page: SessionActivityPage = { version: 1, sessionId: SID, limited: false, revision: "a".repeat(64), hasMore: false, nextOffset: null,
    totals: { subagents: 0, changedFiles: 0, websites: 0, attachments: 0, skills: 0, memory: 0, mcp: 0 },
    subagents: [], websites: [], attachments: [], references: { skills: [], memory: [], mcp: [] }, changedFiles: [] };
  api.getSessionActivity = async () => ({ activity: page });
  api.onSessionActivityChanged = () => () => {};

  const session: SessionSummary = { id: SID, title: "Servers", mode: "agent", thinkingLevel: "off", permissionMode: "auto", createdAt: at, updatedAt: at,
    messageCount: 0, source: "desktop", executionProfile: "standard", providerId: "preview-provider", modelId: "preview-model", projectPath: PROJECT, projectName: "App" };
  const set = (next: Parameters<typeof useAppStore.setState>[0]) => flushSync(() => useAppStore.setState(next));
  set({
    workspace: { path: PROJECT, name: "App", branch: null }, openProjects: [], activeSessionId: SID, retainedSessionIds: [SID],
    retainedTranscripts: { [SID]: [] }, messages: [], sessions: [session], runningSessions: {}, isRunning: false, toasts: [],
    settings: { defaultMode: "agent", theme: "dark", thinkingDisplayMode: "compact", enterToSend: true, onboardingDismissed: true },
    planHistory: {}, pendingPlans: {}, planCheckpoints: {}, pendingPermissions: {}, pendingAsks: {},
    workPanelOpen: false, workPanelTabs: [], activeWorkPanelTabId: null, workPanelContexts: {}, page: "chat",
  });
  // Disclosure state is kept per session in the browser profile; start this session from a clean slate.
  for (const key of Object.keys(localStorage)) if (key.includes(SID)) localStorage.removeItem(key);

  const paint = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  const text = (element: Element | null | undefined) => (element?.textContent ?? "").replace(/\s+/g, " ").trim();
  const rail = () => host.querySelector<HTMLElement>(`.session-activity-rail[data-session-id="${SID}"]:not([hidden])`);
  const section = (name: string) => rail()?.querySelector<HTMLElement>(`[data-activity-section="${name}"]`) ?? null;
  const sectionIds = () => [...(rail()?.querySelectorAll<HTMLElement>("[data-activity-section]") ?? [])].map((element) => element.dataset.activitySection).join();
  // The pane also carries the Skills section; what matters here is that Servers sits directly under Live.
  const followsLive = () => { const ids = sectionIds().split(","); return ids.includes("live") && ids[ids.indexOf("live") + 1] === "server"; };
  const serverRow = (id: string) => section("server")?.querySelector<HTMLElement>(`.session-activity-server[data-server-id="${id}"]`) ?? null;
  const control = (id: string, kind: "name" | "address" | "stop") => serverRow(id)?.querySelector<HTMLElement>(`.session-activity-server-${kind}`) ?? null;
  const toastMessages = () => useAppStore.getState().toasts.map((toast) => toast.message);
  async function until(predicate: () => boolean, label: string, timeout = 5000) {
    const deadline = performance.now() + timeout;
    while (!predicate()) {
      if (performance.now() > deadline) throw new Error(`${label}; sections=${sectionIds()}; stops=${stopCalls.join()}; errors=${errors.map(String).join(";")}; rail=${host.textContent?.slice(0, 500)}`);
      await paint();
    }
    if (errors.length) throw new Error(errors.map(String).join(";"));
  }
  const checks: string[] = [];
  const check = (value: unknown, label: string) => { if (!value) throw new Error(label); checks.push(label); };
  const click = (element: Element | null | undefined) => {
    if (!(element instanceof HTMLElement)) throw new Error(`Missing fixture control; rail=${host.textContent?.slice(0, 400)}`);
    flushSync(() => element.click());
  };
  const colorOf = (token: string) => {
    const ink = document.createElement("span");
    ink.style.color = `var(${token})`;
    host.append(ink);
    const value = getComputedStyle(ink).color;
    ink.remove();
    return value;
  };

  const cleanup = () => {
    console.warn = originalWarn;
    flushSync(() => root.unmount());
    host.remove();
    Object.assign(api, { getWorkspaceGit: original.git, listMcpServers: original.mcp, getSessionActivity: original.activity, onSessionActivityChanged: original.activityChanged,
      listBackgroundProcesses: original.list, readBackgroundProcess: original.read, stopBackgroundProcess: original.stop,
      onBackgroundProcessesChanged: original.processesChanged, onHostStatus: original.hostStatus,
      getContextInsights: original.insights, onAgentEvent: original.agentEvent, onContextInsightsChanged: original.insightsChanged });
    useAppStore.setState(initial);
    if (initialTheme === null) document.documentElement.removeAttribute("data-theme"); else document.documentElement.setAttribute("data-theme", initialTheme);
    document.documentElement.style.setProperty("--font-scale", initialScale || "1");
  };

  const Pane = () => <I18nextProvider i18n={i18n}><SessionActivity sessionId={SID} messages={[]} visible rangeLimited={false} /></I18nextProvider>;

  try {
    document.documentElement.setAttribute("data-theme", "dark");
    flushSync(() => root.render(<Pane />));

    // --- Placement: right after Live, each server once, a process with no address stays in Live ---------------------------------
    await until(() => Boolean(serverRow("dev") && serverRow("api")), "the servers did not show");
    check(followsLive(), `servers sit directly under Live (read ${sectionIds()})`);
    check(text(section("server")!.querySelector(".session-activity-group-title")) === "Servers", "the section is headed Servers");
    check([...section("server")!.querySelectorAll(".session-activity-server")].map((row) => row.getAttribute("data-server-id")).join() === "dev,api",
      "every running process that announced an address is a server, whatever its kind");
    check(text(control("dev", "name")) === "pnpm dev" && text(control("dev", "address")) === "localhost:3000", "a server shows its name without the port, then its address");
    check(text(control("api", "name")) === "api.js" && text(control("api", "address")) === "127.0.0.1:8080", "a Team service with an address is listed the same way");
    const live = section("live")!;
    check(live.querySelectorAll(".session-activity-process").length === 1 && live.querySelector('[data-process-id="watch"]') !== null
      && live.querySelector('[data-process-id="dev"]') === null && live.querySelector('[data-process-id="api"]') === null,
      "Live keeps only the process with no address; a server is not listed twice");

    // --- Names, order and look -----------------------------------------------------------------------------------------------
    check(control("dev", "stop")?.getAttribute("aria-label") === "Stop pnpm dev" && control("dev", "address")?.getAttribute("aria-label") === "Open localhost:3000"
      && control("dev", "name")?.getAttribute("aria-label") === "View process · pnpm dev", "the controls are named for the server they act on");
    check([...serverRow("dev")!.querySelectorAll("button")].map((button) => button.className.replace("session-activity-server-", "")).join() === "name,address,stop"
      && [...serverRow("dev")!.querySelectorAll("button")].every((button) => button.tabIndex === 0), "the keyboard reaches name, address and stop in that order");
    const row = serverRow("dev")!;
    const stop = control("dev", "stop")!;
    const rowBox = row.getBoundingClientRect();
    const stopBox = stop.getBoundingClientRect();
    check(Math.abs(rowBox.height - 34) < 0.5, `a server row is 34px tall, as the canvas draws it (read ${rowBox.height})`);
    check(Math.abs(stopBox.width - 24) < 0.5 && Math.abs(stopBox.height - 28) < 0.5 && Math.abs(rowBox.right - stopBox.right) < 0.5
      && Math.abs((stopBox.top + stopBox.bottom) / 2 - (rowBox.top + rowBox.bottom) / 2) < 0.5,
      `the stop square is 24px by 28px, centred and flush with the row's right edge (read ${stopBox.width}x${stopBox.height}, ${Math.round(rowBox.right - stopBox.right)}px from the edge)`);
    const glyph = stop.querySelector("svg")!;
    check(glyph.getBoundingClientRect().width === 10 && glyph.getBoundingClientRect().height === 10 && glyph.querySelector("rect")?.getAttribute("rx") === "2"
      && getComputedStyle(glyph).color === colorOf("--ds-text-primary"), "the stop glyph is a 10px square with 2px corners in the text colour");
    const addressLook = getComputedStyle(control("dev", "address")!);
    check(addressLook.color === colorOf("--ds-text-muted") && addressLook.fontSize === "12px" && addressLook.borderTopWidth === "0px"
      && addressLook.backgroundColor === "rgba(0, 0, 0, 0)", "the address is muted 12px text with no frame");
    check(getComputedStyle(control("dev", "name")!).color === colorOf("--ds-text-primary"), "the name is in the text colour");
    check(getComputedStyle(stop).backgroundColor === "rgba(0, 0, 0, 0)" && getComputedStyle(stop).borderTopWidth === "0px", "the stop square has no frame until hovered");
    for (const scale of ["1.4", "1"]) {
      document.documentElement.style.setProperty("--font-scale", scale);
      await paint();
      const fits = host.scrollWidth <= host.clientWidth && stop.getBoundingClientRect().right <= host.getBoundingClientRect().right + 0.5;
      check(fits, fits ? `the 264px pane keeps every server row within bounds at font scale ${scale}` : `the pane overflows at font scale ${scale} (scroll ${host.scrollWidth} > client ${host.clientWidth})`);
    }

    // --- Folding -----------------------------------------------------------------------------------------------------------
    click(section("server")!.querySelector(".session-activity-disclosure"));
    check(section("server")!.querySelector(".session-activity-disclosure")?.getAttribute("aria-expanded") === "false"
      && text(section("server")!.querySelector(".session-activity-heading-summary")) === "2 running", "a folded section says how many servers are running");
    click(section("server")!.querySelector(".session-activity-disclosure"));
    check(Boolean(serverRow("dev")), "unfolding brings the rows back");

    // --- The address opens the page in the work panel's browser -------------------------------------------------------------
    click(control("dev", "address"));
    const tabs = (useAppStore.getState().workPanelContexts[SID]?.tabs ?? []) as Array<{ kind: string; location?: string }>;
    check(tabs.some((tab) => tab.kind === "plugin" && tab.location === "http://localhost:3000/"), `the address opens a browser tab at the server's origin (read ${JSON.stringify(tabs.map((tab) => tab.location))})`);
    check(stopCalls.length === 0, "opening the address stops nothing");

    // --- The name opens the process details, where its output is -----------------------------------------------------------
    click(control("dev", "name"));
    await until(() => Boolean(section("server")?.querySelector(".session-process-detail")) && text(section("server")!.querySelector(".session-process-detail")).includes("ready on http://localhost:3000"),
      "the process details did not open under the server");
    check(followsLive() && Boolean(serverRow("dev")) && host.querySelectorAll(".session-process-detail").length === 1 && section("live")!.querySelector(".session-process-detail") === null,
      "the details open under the server's rows, once, without taking the server out of its section or opening it in Live status");
    click(host.querySelector(".session-process-detail .session-activity-action:last-child"));
    check(host.querySelector(".session-process-detail") === null, "the details close again");

    // --- Stop: one request, a spinner while the Host answers, then the row leaves for Live's ended group -------------------
    flushSync(() => { control("dev", "stop")!.click(); control("dev", "stop")?.click(); });
    check(stopCalls.length === 1 && stopCalls[0] === `${SID}:dev`, `Stop asks the Host once for that process (read ${stopCalls.join()})`);
    check(control("dev", "stop") === null && serverRow("dev")!.querySelector('.session-activity-spinner[aria-label="Stopping"]') !== null, "while the Host answers the row spins and offers no second stop");
    check(Boolean(control("api", "stop")), "the other server keeps its stop meanwhile");
    gates.get("dev")!.ok();
    await until(() => serverRow("dev")?.querySelector(".session-activity-spinner") !== null && control("dev", "stop") === null, "the stopping row did not stay");
    patch("dev", { status: "stopped", address: undefined, endedAt: new Date().toISOString(), exitCode: 0 });
    await until(() => !serverRow("dev") && Boolean(serverRow("api")), "the stopped server did not leave the section");
    check(text(section("live")).includes("Ended 1") && followsLive(), "a server that ended is listed with Live's ended processes, and the other keeps its row");

    // --- A Host that cannot stop it: the row gets its square back and says so once, by name -----------------------------------
    const warnedBefore = warnings.length;
    click(control("api", "stop"));
    check(stopCalls.length === 2 && !control("api", "stop"), "a second server asks on its own");
    gates.get("api")!.fail("host unavailable");
    await until(() => Boolean(control("api", "stop")), "a stop the Host could not take left the row spinning");
    check(toastMessages().filter((message) => message === "Could not stop api.js.").length === 1, "a refused stop says so once, naming the server");
    check(warnings.length === warnedBefore + 1 && !warnings.slice(warnedBefore).join().includes("host unavailable"), "the failure is logged by its name only");

    // --- An answer that arrives after the pane closed reaches nothing -------------------------------------------------------
    const toastsBefore = toastMessages().length;
    click(control("api", "stop"));
    check(stopCalls.length === 3, "a failed stop can be asked again");
    flushSync(() => root.unmount());
    gates.get("api")!.fail("late failure");
    await paint(); await paint(); await paint();
    check(toastMessages().length === toastsBefore && !errors.length, "a late answer shows no toast and raises no error once the pane is gone");
    check(true, `no uncaught render error (${lists.length} list reads)`);
    return { ok: true, checks };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? (error.stack ?? error.message) : String(error), checks };
  } finally {
    cleanup();
  }
}
