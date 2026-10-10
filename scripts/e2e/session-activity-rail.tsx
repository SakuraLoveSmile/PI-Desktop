import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import { createInstance } from "i18next";
import { I18nextProvider } from "react-i18next";
import { en } from "@pi-desktop/i18n";
import type { BackgroundProcessDetail, BackgroundProcessesChanged, BackgroundProcessSummary, HostStatusEvent } from "@pi-desktop/shared";
import { SessionActivityRail, type SessionActivityRailProps } from "../../apps/desktop/src/features/chat/activity/SessionActivityRail";
import { BackgroundProcessDetails } from "../../apps/desktop/src/features/chat/activity/BackgroundProcessDetails";
import { api } from "../../apps/desktop/src/lib/api";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

/** Real rail and details; only the IPC host boundary is replaced. No real process starts. */
export async function sessionActivityRailProbe() {
  const i18n = createInstance();
  await i18n.init({ lng: "en", resources: { en: { translation: en } } });
  const host = document.createElement("div");
  host.style.cssText = "position:fixed;top:40px;right:40px;width:248px;max-height:90vh;overflow:auto;background:var(--color-bg-primary);z-index:1000;";
  document.body.append(host);
  const root = createRoot(host);
  const initialTheme = document.documentElement.getAttribute("data-theme");
  const initialScale = document.documentElement.style.getPropertyValue("--font-scale");
  const original = { read: api.readBackgroundProcess, stop: api.stopBackgroundProcess, subscribe: api.onBackgroundProcessesChanged, hostStatus: api.onHostStatus };
  const reads: Array<{ sessionId: string; id: string; task: ReturnType<typeof deferred<BackgroundProcessDetail>> }> = [];
  const stops: Array<{ sessionId: string; id: string; task: ReturnType<typeof deferred<{ process: BackgroundProcessSummary }>> }> = [];
  const listeners = new Set<(event: BackgroundProcessesChanged) => void>();
  const hostListeners = new Set<(event: HostStatusEvent) => void>();
  api.readBackgroundProcess = (sessionId, id) => {
    const task = deferred<BackgroundProcessDetail>(); reads.push({ sessionId, id, task }); return task.promise;
  };
  api.stopBackgroundProcess = (sessionId, id) => {
    const task = deferred<{ process: BackgroundProcessSummary }>(); stops.push({ sessionId, id, task }); return task.promise;
  };
  api.onBackgroundProcessesChanged = (listener) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
  api.onHostStatus = (listener) => { hostListeners.add(listener); return () => { hostListeners.delete(listener); }; };
  const checks: string[] = [];
  const check = (value: unknown, label: string) => { if (!value) throw new Error(label); checks.push(label); };
  const click = (element: Element | null) => { if (!(element instanceof HTMLElement)) throw new Error("Missing fixture control"); flushSync(() => element.click()); };
  // A frame flushes React's async result paint; it does not gate on a guessed duration.
  const paint = async () => { await Promise.resolve(); await new Promise<void>((resolve) => requestAnimationFrame(() => resolve())); };
  const process: BackgroundProcessSummary = { id: "p1", sessionId: "s1", toolCallId: "call", command: "node scripts/long-background-command.js --flag=value", cwd: "/isolated/project", status: "starting", startedAt: "2026-10-09T00:00:00Z" };
  const detail = (record = process): BackgroundProcessDetail => ({ process: record, stdout: "bounded stdout", stderr: "bounded stderr", stdoutTruncated: true, stderrTruncated: false });
  const renderDetails = (sessionId: string, id: string, visible = true) => flushSync(() => root.render(
    <I18nextProvider i18n={i18n}><BackgroundProcessDetails sessionId={sessionId} id={id} visible={visible} onClose={() => {}} /></I18nextProvider>));
  const stopButton = () => host.querySelector(".session-process-stop");
  try {
    const opened: string[] = [];
    const railProps: SessionActivityRailProps = {
      sessionId: "s1", visible: true, plans: [{ id: "plan", label: "Repair plan", onOpen: () => opened.push("plan") }],
      agents: [{ id: "agent", label: "architect", detail: "Review state ownership", status: "running", statusLabel: "Running", onOpen: () => opened.push("agent") }],
      outputs: [{ id: "output", label: "result.ts", onOpen: () => opened.push("output") }],
      sources: [{ id: "source", label: "Readonly evidence" }], processes: [process, { ...process, id: "other", sessionId: "s2" }],
      processesLoading: false, onRefreshProcesses: () => opened.push("refresh"), onOpenProcess: (id) => opened.push(id),
    };
    const renderRail = (props = railProps) => flushSync(() => root.render(<I18nextProvider i18n={i18n}><SessionActivityRail {...props} /></I18nextProvider>));
    renderRail();
    const groups = [...host.querySelectorAll<HTMLButtonElement>(".session-activity-disclosure")];
    check(groups.map((item) => item.getAttribute("aria-expanded")).join() === "true,true,true,false,false", "plan, agents, processes open; outputs and sources folded");
    check(host.querySelectorAll("[data-process-id]").length === 1, "rail shows only the explicit session's processes");
    check(host.querySelector('[data-process-id="p1"]')?.textContent?.includes(i18n.t("panel.activity.status.starting")), "accepted process starts truthfully without completed label");
    for (const theme of ["dark", "light"]) {
      document.documentElement.setAttribute("data-theme", theme);
      document.documentElement.style.setProperty("--font-scale", "1.4");
      await paint();
      check(host.scrollWidth <= host.clientWidth, `${theme}: 248px rail remains within bounds at enlarged font scale`);
    }
    document.documentElement.style.setProperty("--font-scale", "1");
    click(host.querySelector('[data-activity-id="agent"]')); click(host.querySelector('[data-process-id="p1"]'));
    click(groups[3]); click(host.querySelector('[data-activity-id="output"]')); click(groups[4]);
    check(opened.join() === "agent,p1,output", "representative path opens agent, process and output from rail");
    check(host.querySelector(".session-activity-readonly")?.tagName === "SPAN", "readonly source is not a fake navigation action");
    check(!host.querySelector(".session-quick-notes"), "quick notes are absent from activity groups");
    renderRail({ ...railProps, supported: false });
    check(!host.querySelector('[data-process-id]') && !host.querySelector(".session-activity-action"), "unsupported host exposes no process controls");
    renderRail({ ...railProps, sessionId: "s2", plans: [], agents: [], outputs: [], sources: [], processes: [], processesError: "List unavailable" });
    check(host.querySelectorAll('.session-activity-disclosure[aria-expanded="false"]').length === 2, "new session restores disclosure defaults");
    check(host.textContent?.includes("List unavailable") && Boolean(host.querySelector('[role="alert"]')), "list error is observable");
    click(host.querySelector('[role="alert"] button')); check(opened.at(-1) === "refresh", "list error has explicit retry");

    renderDetails("s1", "p1"); await paint();
    check(reads.length === 1 && listeners.size === 1, "opening detail reads the owning session and subscribes");
    reads[0].task.resolve(detail()); await paint();
    check(host.textContent?.includes(process.command) && host.textContent?.includes(process.cwd), "detail reveals complete command and cwd");
    check(host.querySelectorAll("pre").length === 2 && host.textContent?.includes(i18n.t("panel.activity.outputTruncated")), "bounded outputs preserve streams and truncation warning");
    click(stopButton());
    check(stops.length === 1 && (stopButton() as HTMLButtonElement)?.disabled, "stop targets same session and disables duplicate requests");
    renderDetails("s2", "p2"); await paint();
    stops[0].task.resolve({ process: { ...process, status: "stopped" } }); await paint();
    check(!host.textContent?.includes(process.command) && reads.length === 2, "late stop from previous session never paints or refreshes new session");
    const otherProcess = { ...process, id: "p2", sessionId: "s2", command: "other-command", status: "running" as const };
    reads[1].task.reject(new Error("Read unavailable")); await paint();
    check(host.querySelector('[role="alert"]')?.textContent?.includes("Read unavailable"), "read failure stays visible");
    click(host.querySelector('[role="alert"] button')); await paint();
    reads[2].task.resolve(detail(otherProcess)); await paint();
    check(host.textContent?.includes("other-command"), "retry recovers current process");
    const emit = (sessionId: string, id: string) => { for (const listener of listeners) listener({ sessionId, id, revision: 1 }); };
    emit("s1", "p1"); await paint(); check(reads.length === 3, "other-session process event is ignored");
    emit("s2", "p2"); await paint();
    check(reads.length === 4, "matching process event refreshes bounded output");
    reads[3].task.resolve(detail({ ...otherProcess, status: "completed", exitCode: 0 })); await paint();
    check(!stopButton() && host.textContent?.includes(i18n.t("panel.activity.status.completed")), "completed process loses stop control");
    renderDetails("s2", "p2", false); await paint();
    check(listeners.size === 0 && !host.querySelector(".session-process-detail"), "hiding removes process subscription and detail");
    renderDetails("s1", "p1"); await paint(); renderDetails("s2", "p2"); await paint();
    reads[4].task.resolve(detail()); await paint();
    check(!host.textContent?.includes(process.command), "late read from previous session cannot leak stale output");
    reads[5].task.resolve(detail(otherProcess)); await paint();
    click(stopButton()); stops[1].task.reject(new Error("Stop unavailable")); await paint();
    check(host.querySelector('[role="alert"]')?.textContent?.includes("Stop unavailable") && !(stopButton() as HTMLButtonElement)?.disabled, "stop failure is observable and retryable without fake terminal status");
    emit("s2", "p2"); emit("s2", "p2"); await paint();
    reads[7].task.resolve(detail({ ...otherProcess, status: "completed" })); await paint();
    reads[6].task.resolve(detail({ ...otherProcess, status: "running", command: "stale command" })); await paint();
    check(!stopButton() && !host.textContent?.includes("stale command"), "out-of-order reads cannot revive an exited process");
    emit("s2", "p2"); await paint();
    reads[8].task.resolve(detail(otherProcess)); await paint();
    click(stopButton());
    for (const listener of hostListeners) listener({ ok: true, restarted: true });
    await paint();
    check(reads.length === 10, "Host restart rereads opened details without a process changed notification");
    reads[9].task.resolve(detail({ ...otherProcess, status: "interrupted" })); await paint();
    check(!stopButton() && host.textContent?.includes(i18n.t("panel.activity.status.interrupted")), "Host restart replaces stale running and stopping state with interrupted");
    stops[2].task.resolve({ process: { ...otherProcess, status: "stopping" } }); await paint();
    check(!stopButton() && reads.length === 10, "late pre-restart stop cannot restore stale state or issue another read");
    click(host.querySelector('[aria-label="' + i18n.t("panel.activity.refresh") + '"]')); await paint();
    reads[10].task.resolve(detail({ ...otherProcess, status: "interrupted" })); await paint();
    check(reads.length === 11, "details provide manual refresh after terminal recovery");
    window.dispatchEvent(new Event("focus")); await paint();
    reads[11].task.resolve(detail({ ...otherProcess, status: "interrupted" })); await paint();
    check(reads.length === 12, "focus refreshes opened process details");
    renderDetails("s2", "p2", false); await paint();
    window.dispatchEvent(new Event("focus")); await paint();
    check(hostListeners.size === 0 && listeners.size === 0 && reads.length === 12, "hide removes Host status and focus refresh listeners");
    renderDetails("s2", "p2"); await paint();
    reads[12].task.resolve({ ...detail({ ...otherProcess, status: "failed" }), stdout: "", stderr: "", errorCode: "IO_ERROR", errorMessage: "Configured shell could not start" }); await paint();
    check(host.querySelector('[role="alert"]')?.textContent?.includes("IO_ERROR") && host.querySelector('[role="alert"]')?.textContent?.includes("Configured shell could not start") && !stopButton(), "empty-output startup failure exposes diagnostic code and reason");
    click(host.querySelector('[aria-label="' + i18n.t("panel.activity.refresh") + '"]')); await paint();
    reads[13].task.resolve({ ...detail({ ...otherProcess, status: "completed", exitCode: 0 }), persistenceError: "Could not persist terminal state: database unavailable" }); await paint();
    check(host.querySelector('[role="alert"]')?.textContent?.includes("Could not persist terminal state") && host.textContent?.includes("bounded stdout") && host.querySelector('.session-process-detail-heading')?.textContent?.includes(i18n.t("panel.activity.status.completed")) && !stopButton(), "persistence failure retains completed command status and output");
    click(host.querySelector('[aria-label="' + i18n.t("panel.activity.refresh") + '"]')); await paint();
    reads[14].task.resolve(detail({ ...otherProcess, status: "completed", exitCode: 0 })); await paint();
    check(!host.querySelector('[role="alert"]') && host.textContent?.includes("bounded stdout") && !stopButton(), "manual refresh clears recovered persistence error without losing output");
    return { ok: true, checks };
  } finally {
    flushSync(() => root.unmount()); host.remove();
    if (initialTheme === null) document.documentElement.removeAttribute("data-theme");
    else document.documentElement.setAttribute("data-theme", initialTheme);
    if (initialScale) document.documentElement.style.setProperty("--font-scale", initialScale);
    else document.documentElement.style.removeProperty("--font-scale");
    api.readBackgroundProcess = original.read; api.stopBackgroundProcess = original.stop; api.onBackgroundProcessesChanged = original.subscribe; api.onHostStatus = original.hostStatus;
    if (listeners.size || hostListeners.size) throw new Error("Process subscription leaked after unmount");
  }
}
