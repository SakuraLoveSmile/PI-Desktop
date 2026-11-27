import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import { createInstance } from "i18next";
import { I18nextProvider } from "react-i18next";
import { en } from "@pi-desktop/i18n";
import type { BackgroundProcessSummary, ContextInsightsSnapshot, SessionActivityPage, SessionSummary, SessionSummaryNote, SessionSummaryRefreshResult } from "@pi-desktop/shared";
import { SessionActivity } from "../../apps/desktop/src/features/chat/activity/SessionActivity";
import { useAppStore } from "../../apps/desktop/src/stores/app-store";
import { api } from "../../apps/desktop/src/lib/api";

const SID = "summary-session";
const PROJECT = "/Users/dev/Code/app";
const SHORT = "Importer tests pass.";
const LONG = "Importer work is split in three steps: the CSV reader is done and covered by tests, the writer streams rows in batches and still needs "
  + "back-pressure handling, and the CLI wrapper waits for the writer. Open question: whether to keep the legacy column order. "
  + "Next: add the back-pressure test, then wire the CLI flags and update the docs.";

/**
 * The pinned summary card of the real activity pane: real store, hooks, controller and stylesheet. Only the Host edge is
 * replaced: the stored note, the refresh call (which answers when the probe says so) and the process list. No model,
 * provider, account or user data is read.
 */
export async function sessionActivitySummaryProbe() {
  const initial = useAppStore.getState();
  const i18n = createInstance();
  await i18n.init({ lng: "en", interpolation: { escapeValue: false }, resources: { en: { translation: en } } });
  const host = document.createElement("div");
  // The real pane: 264px wide with 16px side padding.
  host.style.cssText = "position:fixed;top:40px;right:40px;width:264px;box-sizing:border-box;padding:8px 16px 16px;max-height:90vh;overflow:auto;background:var(--color-bg-primary);z-index:1000;";
  document.body.append(host);
  const errors: unknown[] = [];
  const root = createRoot(host, { onUncaughtError: (error) => errors.push(error) });
  const initialTheme = document.documentElement.getAttribute("data-theme");
  const initialScale = document.documentElement.style.getPropertyValue("--font-scale");
  const original = {
    git: api.getWorkspaceGit, mcp: api.listMcpServers, activity: api.getSessionActivity, activityChanged: api.onSessionActivityChanged,
    list: api.listBackgroundProcesses, read: api.readBackgroundProcess, processesChanged: api.onBackgroundProcessesChanged,
    hostStatus: api.onHostStatus, insights: api.getContextInsights, agentEvent: api.onAgentEvent, insightsChanged: api.onContextInsightsChanged,
    getSummary: api.getSessionSummary, refreshSummary: api.refreshSessionSummary,
  };

  const at = new Date(Date.now() - 60_000).toISOString();
  // One failed process gives the rail its "Needs attention" block, which the card has to sit above.
  const failed: BackgroundProcessSummary = { id: "build", sessionId: SID, toolCallId: "call-build", command: "pnpm build", cwd: PROJECT, status: "failed", startedAt: at, endedAt: at, exitCode: 1 };
  api.listBackgroundProcesses = async (sessionId) => ({ processes: sessionId === SID ? [{ ...failed }] : [] });
  api.readBackgroundProcess = async (_sessionId, id) => ({ process: { ...failed, id }, stdout: "", stderr: "", stdoutTruncated: false, stderrTruncated: false });
  api.onBackgroundProcessesChanged = () => () => {};
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

  // The Host's record and the two calls the card makes. A refresh answers when the probe says so.
  const note = (text: string, over: Partial<SessionSummaryNote> = {}): SessionSummaryNote => ({
    sessionId: SID, text, revision: 1, basedOnMessageCount: 4, updatedAt: new Date(2026, 10, 22, 14, 5).toISOString(), behind: 0, diverged: false, ...over,
  });
  let stored: SessionSummaryNote | null = null;
  let readError: Error | null = null;
  const reads: string[] = [];
  const refreshes: Array<{ sessionId: string; force: boolean }> = [];
  let gate: { ok: (summary: SessionSummaryNote) => void; fail: (message: string) => void } | null = null;
  api.getSessionSummary = async (sessionId) => {
    reads.push(sessionId);
    if (readError) throw readError;
    return { summary: stored ? { ...stored } : null, messageCount: 4 };
  };
  api.refreshSessionSummary = (sessionId, force) => {
    refreshes.push({ sessionId, force });
    return new Promise<SessionSummaryRefreshResult>((resolve, reject) => {
      gate = {
        ok: (summary) => { stored = summary; resolve({ outcome: "updated", summary: { ...summary } }); },
        fail: (message) => reject(new Error(message)),
      };
    });
  };

  const session: SessionSummary = { id: SID, title: "Summary", mode: "agent", thinkingLevel: "off", permissionMode: "auto", createdAt: at, updatedAt: at,
    messageCount: 4, source: "desktop", executionProfile: "standard", providerId: "preview-provider", modelId: "preview-model", projectPath: PROJECT, projectName: "App" };
  type State = ReturnType<typeof useAppStore.getState>;
  const settings: NonNullable<State["settings"]> = { defaultMode: "agent", theme: "dark", thinkingDisplayMode: "compact", enterToSend: true, onboardingDismissed: true };
  const set = (next: Partial<State>) => flushSync(() => useAppStore.setState(next));
  set({
    workspace: { path: PROJECT, name: "App" }, openProjects: [], activeSessionId: SID, retainedSessionIds: [SID],
    retainedTranscripts: { [SID]: [] }, messages: [], sessions: [session], runningSessions: {}, isRunning: false, toasts: [],
    settings, planHistory: {}, pendingPlans: {}, planCheckpoints: {}, pendingPermissions: {}, pendingAsks: {},
    workPanelOpen: false, workPanelTabs: [], activeWorkPanelTabId: null, workPanelContexts: {}, page: "chat",
  });
  for (const key of Object.keys(localStorage)) if (key.includes(SID)) localStorage.removeItem(key);

  let visible = true;
  let generation = 0;
  const Pane = () => <I18nextProvider i18n={i18n}><SessionActivity key={generation} sessionId={SID} messages={[]} visible={visible} rangeLimited={false} /></I18nextProvider>;
  const render = () => flushSync(() => root.render(<Pane />));
  const paint = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  const text = (element: Element | null | undefined) => (element?.textContent ?? "").replace(/\s+/g, " ").trim();
  const rail = () => host.querySelector<HTMLElement>(`.session-activity-rail[data-session-id="${SID}"]:not([hidden])`);
  const card = () => rail()?.querySelector<HTMLElement>(".session-activity-summary") ?? null;
  const body = () => card()?.querySelector<HTMLElement>(".session-activity-summary-body") ?? null;
  const refreshButton = () => card()?.querySelector<HTMLButtonElement>(".session-activity-summary-refresh") ?? null;
  const moreButton = () => card()?.querySelector<HTMLButtonElement>(".session-activity-summary-more") ?? null;
  const toastMessages = () => useAppStore.getState().toasts.map((toast) => toast.message);
  const running = (value: boolean) => set({ runningSessions: { [SID]: value } });
  const endTurn = () => { running(true); running(false); };
  async function until(predicate: () => boolean, label: string, timeout = 5000) {
    const deadline = performance.now() + timeout;
    while (!predicate()) {
      if (performance.now() > deadline) throw new Error(`${label}; reads=${reads.length}; refreshes=${JSON.stringify(refreshes)}; errors=${errors.map(String).join(";")}; rail=${host.textContent?.slice(0, 400)}`);
      await paint();
    }
    if (errors.length) throw new Error(errors.map(String).join(";"));
  }
  const settle = async () => { await paint(); await paint(); await paint(); };
  const checks: string[] = [];
  const check = (value: unknown, label: string) => { if (!value) throw new Error(label); checks.push(label); };
  const click = (element: Element | null | undefined) => {
    if (!(element instanceof HTMLElement)) throw new Error(`Missing fixture control; rail=${host.textContent?.slice(0, 400)}`);
    flushSync(() => element.click());
  };
  const probeStyle = (property: "color" | "backgroundColor" | "borderRadius" | "fontFamily", css: string, value: string) => {
    const probe = document.createElement("span");
    probe.style.setProperty(css, value);
    host.append(probe);
    const result = getComputedStyle(probe)[property];
    probe.remove();
    return result;
  };

  const cleanup = () => {
    flushSync(() => root.unmount());
    host.remove();
    Object.assign(api, { getWorkspaceGit: original.git, listMcpServers: original.mcp, getSessionActivity: original.activity, onSessionActivityChanged: original.activityChanged,
      listBackgroundProcesses: original.list, readBackgroundProcess: original.read, onBackgroundProcessesChanged: original.processesChanged, onHostStatus: original.hostStatus,
      getContextInsights: original.insights, onAgentEvent: original.agentEvent, onContextInsightsChanged: original.insightsChanged,
      getSessionSummary: original.getSummary, refreshSessionSummary: original.refreshSummary });
    useAppStore.setState(initial);
    if (initialTheme === null) document.documentElement.removeAttribute("data-theme"); else document.documentElement.setAttribute("data-theme", initialTheme);
    document.documentElement.style.setProperty("--font-scale", initialScale || "1");
  };

  try {
    document.documentElement.setAttribute("data-theme", "dark");
    render();

    // --- Opening a session reads the stored note and never asks a model; with no note there is no card ------------------------
    await until(() => reads.length === 1 && Boolean(rail()?.querySelector(".session-activity-attention")), "the rail did not open and read the stored summary");
    check(card() === null && refreshes.length === 0, "a session with no summary shows no card, and opening it called no model");

    // --- A turn end asks once, not forced; a first run shows nothing until it finishes -----------------------------------------
    endTurn();
    await until(() => refreshes.length === 1, "the turn end did not ask for a summary");
    check(refreshes[0].sessionId === SID && refreshes[0].force === false, "a turn end asks for the shown session, without forcing");
    check(card() === null, "a first run shows no card until it finishes");
    gate!.ok(note(SHORT));
    await until(() => text(body()) === SHORT, "the finished summary did not appear");

    // --- The card: first in the rail, above Needs attention, the canvas's look ----------------------------------------------
    const plate = card()!;
    const attention = rail()!.querySelector(".session-activity-attention")!;
    check(rail()!.firstElementChild === plate && Boolean(plate.compareDocumentPosition(attention) & Node.DOCUMENT_POSITION_FOLLOWING), "the card is the first child of the rail, above Needs attention");
    check(plate.closest("[data-activity-section]") === null && plate.querySelector(".session-activity-grip") === null, "the card is pinned: no section, no grip");
    check(plate.getAttribute("aria-label") === "Session summary" && refreshButton()?.getAttribute("aria-label") === "Regenerate session summary", "the card and its control are named");
    const look = getComputedStyle(plate);
    check(look.backgroundColor === probeStyle("backgroundColor", "background-color", "var(--ds-bg-hover)") && look.borderTopWidth === "0px" && look.boxShadow === "none",
      "the plate is one tint lighter than the pane and draws no stroke");
    check(look.borderTopLeftRadius === probeStyle("borderRadius", "border-radius", "var(--radius-xs)") && look.paddingTop === "10px" && look.paddingRight === "12px"
      && look.paddingBottom === "8px" && look.paddingLeft === "12px" && look.marginBottom === "20px", `the plate has 8px corners, 10 12 8 padding and a 20px gap below (read ${look.borderTopLeftRadius}, ${look.padding}, ${look.marginBottom})`);
    const time = plate.querySelector<HTMLElement>(".session-activity-summary-time")!;
    check(text(time) === "Updated 2026-11-22 14:05" && time.tagName === "TIME" && time.getAttribute("datetime") === note(SHORT).updatedAt, `the head dates the note in local time (read ${text(time)})`);
    const timeLook = getComputedStyle(time);
    check(timeLook.fontSize === "11px" && timeLook.color === probeStyle("color", "color", "var(--ds-text-muted)") && timeLook.fontFamily === probeStyle("fontFamily", "font-family", "var(--font-mono)"),
      `the stamp is 11px muted text in the monospace face (read ${timeLook.fontSize})`);
    const bodyLook = getComputedStyle(body()!);
    check(bodyLook.fontSize === "13px" && Math.abs(parseFloat(bodyLook.lineHeight) - 13 * 1.55) < 0.1 && bodyLook.color === probeStyle("color", "color", "var(--ds-text-primary)"),
      `the paragraph is 13px at 1.55 in the text colour (read ${bodyLook.fontSize} / ${bodyLook.lineHeight})`);
    const control = refreshButton()!;
    const plateBox = plate.getBoundingClientRect();
    const controlBox = control.getBoundingClientRect();
    check(Math.abs(controlBox.width - 24) < 0.5 && Math.abs(controlBox.height - 28) < 0.5 && Math.abs(plateBox.right - controlBox.right - 8) < 0.5,
      `the refresh control is 24px by 28px, 8px in from the plate's edge (read ${controlBox.width}x${controlBox.height}, ${Math.round(plateBox.right - controlBox.right)}px)`);
    check(getComputedStyle(control).backgroundColor === "rgba(0, 0, 0, 0)" && getComputedStyle(control).borderTopWidth === "0px", "the refresh control has no frame until hovered");
    check(Math.abs(plate.querySelector(".session-activity-summary-head")!.getBoundingClientRect().height - 24) < 0.5, "the head row is 24px tall");
    check(moreButton() === null, "a note that fits shows no Expand control");
    check(host.scrollWidth <= host.clientWidth, "the 264px pane has no horizontal scroll");

    // --- The refresh control forces a run; a second press and keyboard focus --------------------------------------------------
    control.focus();
    click(control);
    await until(() => refreshes.length === 2, "the control did not ask for a summary");
    check(refreshes[1].force === true, "the refresh control forces the run");
    await until(() => refreshButton()?.getAttribute("aria-disabled") === "true" && refreshButton()!.querySelector(".session-activity-spinner") !== null && card()?.getAttribute("aria-busy") === "true",
      "the control did not show the run");
    click(refreshButton());
    await settle();
    check(refreshes.length === 2, "a second press while it runs asks nothing");
    check(document.activeElement === refreshButton() || document.activeElement === control, "the control keeps keyboard focus while it runs");
    endTurn();
    await settle();
    check(refreshes.length === 2, "a turn end during a run joins it instead of asking again");
    gate!.ok(note(LONG, { revision: 2 }));
    await until(() => text(body()) === LONG && refreshButton()?.getAttribute("aria-disabled") === "false" && refreshButton()!.querySelector(".session-activity-spinner") === null,
      "the new summary did not replace the old one");
    check(refreshes.length === 2, "the run that finished was the only one");

    // --- Clamp: four lines, Expand only when something is cut off, Collapse puts it back ------------------------------------
    const lineHeight = parseFloat(getComputedStyle(body()!).lineHeight);
    await until(() => moreButton() !== null, "a long note did not offer Expand");
    const clamped = body()!.getBoundingClientRect().height;
    check(Math.abs(clamped - 4 * lineHeight) < 1.5 && body()!.scrollHeight > body()!.clientHeight + 1, `a long note is cut at four lines (read ${clamped}px for ${lineHeight}px lines)`);
    check(text(moreButton()) === "Expand" && moreButton()!.getAttribute("aria-expanded") === "false" && moreButton()!.getAttribute("aria-controls") === body()!.id, "Expand names what it opens");
    check(Math.abs(moreButton()!.getBoundingClientRect().height - 28) < 0.5, "Expand is a 28px control");
    click(moreButton());
    await until(() => body()?.dataset.open === "true", "Expand did not open the note");
    check(body()!.getBoundingClientRect().height > clamped + lineHeight && text(moreButton()) === "Collapse" && moreButton()!.getAttribute("aria-expanded") === "true", "Expand shows the whole note and offers Collapse");
    click(moreButton());
    await until(() => body()?.dataset.open === "false" && text(moreButton()) === "Expand", "Collapse did not close the note");
    check(Math.abs(body()!.getBoundingClientRect().height - clamped) < 1.5, "Collapse cuts the note at four lines again");
    document.documentElement.style.setProperty("--font-scale", "1.4");
    await settle();
    const scaled = parseFloat(getComputedStyle(body()!).lineHeight);
    check(Math.abs(body()!.getBoundingClientRect().height - 4 * scaled) < 1.5 && moreButton() !== null && host.scrollWidth <= host.clientWidth,
      "at font scale 1.4 the note is still cut at four lines, keeps Expand and fits the pane");
    document.documentElement.style.setProperty("--font-scale", "1");
    await settle();

    // --- The text is only ever text -----------------------------------------------------------------------------------------
    const markup = "<b>bold</b> & **stars** <img src=x onerror=alert(1)>";
    const holder = { done: false };
    click(refreshButton());
    await until(() => refreshes.length === 3, "the control did not ask again");
    gate!.ok(note(markup, { revision: 3 }));
    await until(() => text(body()) === markup, "the markup-looking note did not appear");
    check(body()!.querySelector("b, img, strong") === null && body()!.childElementCount === 0 && !holder.done, "a note that looks like markup is shown as plain text");

    // --- A failed manual run says so once and keeps the text; a failed automatic one stays quiet ----------------------------------
    click(refreshButton());
    await until(() => refreshes.length === 4, "the control did not ask after the markup note");
    gate!.fail("provider down");
    await until(() => toastMessages().includes("Could not update the session summary."), "a failed run said nothing");
    check(toastMessages().filter((message) => message === "Could not update the session summary.").length === 1 && text(body()) === markup, "a failed run says so once and keeps the old text");
    await until(() => refreshButton()?.getAttribute("aria-disabled") === "false", "the control stayed busy after a failure");
    const toastsBefore = toastMessages().length;
    endTurn();
    await until(() => refreshes.length === 5, "a turn end after a failure did not ask");
    gate!.fail("provider down");
    await settle();
    check(toastMessages().length === toastsBefore && text(body()) === markup, "a failed automatic run is quiet and keeps the old text");

    // --- A hidden pane asks nothing; showing it again reads without asking a model ------------------------------------------------
    const readsBefore = reads.length;
    visible = false;
    render();
    await settle();
    endTurn();
    await settle();
    check(refreshes.length === 5 && reads.length === readsBefore, "a turn that ends while the pane is hidden asks nothing");
    visible = true;
    render();
    await until(() => reads.length === readsBefore + 1 && card() !== null, "showing the pane again did not read the stored note");
    check(refreshes.length === 5, "showing the pane again calls no model");

    // --- A rewound transcript hides the old note; the setting hides the card and stops every call ---------------------------------
    stored = note(SHORT, { revision: 4, diverged: true });
    visible = false; render(); await settle();
    visible = true; render();
    await until(() => reads.length === readsBefore + 2 && card() === null, "a note the transcript has moved past was still shown");
    check(true, "a note the transcript has moved past is not shown");
    stored = note(SHORT, { revision: 5 });
    set({ settings: { ...settings, autoSummarizeSessions: false } });
    await settle();
    check(card() === null, "with the setting off the card is gone");
    const callsBefore = refreshes.length;
    endTurn();
    await settle();
    check(refreshes.length === callsBefore, "with the setting off a turn end asks nothing");
    set({ settings: { ...settings, autoSummarizeSessions: true } });
    await until(() => text(body()) === SHORT, "switching the setting back on did not bring the stored note back");
    check(refreshes.length === callsBefore, "switching the setting back on asks no model");

    // --- Light theme ------------------------------------------------------------------------------------------------------------------
    document.documentElement.setAttribute("data-theme", "light");
    await settle();
    check(getComputedStyle(card()!).backgroundColor === probeStyle("backgroundColor", "background-color", "var(--ds-bg-hover)") && getComputedStyle(card()!).backgroundColor !== "rgba(0, 0, 0, 0)",
      "in the light theme the plate keeps its tint token");
    document.documentElement.setAttribute("data-theme", "dark");

    // --- An answer that arrives after the pane closed reaches nothing ---------------------------------------------------------------
    click(refreshButton());
    await until(() => refreshes.length === callsBefore + 1, "the control did not ask before the pane closed");
    const toastsAtClose = toastMessages().length;
    flushSync(() => root.unmount());
    gate!.fail("late failure");
    await settle();
    check(toastMessages().length === toastsAtClose && errors.length === 0, "a late answer shows no toast and raises no error once the pane is gone");

    // --- A Host or session that cannot hold a summary draws no card and is never asked again ---------------------------------------------
    const second = createRoot(host, { onUncaughtError: (error) => errors.push(error) });
    readError = Object.assign(new Error("METHOD_NOT_FOUND"), { code: "METHOD_NOT_FOUND" });
    stored = note(SHORT, { revision: 6 });
    const readsAtMount = reads.length;
    generation += 1;
    flushSync(() => second.render(<Pane />));
    await until(() => reads.length === readsAtMount + 1, "the unsupported pane did not read");
    await settle();
    const refreshesAtMount = refreshes.length;
    endTurn();
    await settle();
    check(card() === null && refreshes.length === refreshesAtMount, "an older Host draws no card and is not asked to write one");
    flushSync(() => second.unmount());
    return { ok: true, checks };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? (error.stack ?? error.message) : String(error), checks };
  } finally {
    cleanup();
  }
}
