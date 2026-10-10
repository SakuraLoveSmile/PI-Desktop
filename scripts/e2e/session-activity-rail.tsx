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
  await i18n.init({ lng: "en", interpolation: { escapeValue: false }, resources: { en: { translation: en } } });
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
  const until = async (predicate: () => boolean, label: string) => {
    const deadline = performance.now() + 5000;
    while (!predicate()) { if (performance.now() > deadline) throw new Error(label); await paint(); }
  };
  const process: BackgroundProcessSummary = { id: "p1", sessionId: "s1", toolCallId: "call", command: "node scripts/long-background-command.js --flag=value", cwd: "/isolated/project", status: "starting", startedAt: "2026-10-09T00:00:00Z" };
  const detail = (record = process): BackgroundProcessDetail => ({ process: record, stdout: "bounded stdout", stderr: "bounded stderr", stdoutTruncated: true, stderrTruncated: false });
  const renderDetails = (sessionId: string, id: string, visible = true) => flushSync(() => root.render(
    <I18nextProvider i18n={i18n}><BackgroundProcessDetails sessionId={sessionId} id={id} visible={visible} onClose={() => {}} /></I18nextProvider>));
  const stopButton = () => host.querySelector(".session-process-stop");
  try {
    const opened: string[] = [];
    const railProps: SessionActivityRailProps = {
      sessionId: "s1", visible: true, plans: [{ id: "plan", label: "Repair plan", onOpen: () => opened.push("plan") }],
      agents: [{ id: "agent", label: "architect", detail: "Review state ownership", status: "running", statusLabel: "Running", timing: { startedAt: Date.now() - 20_000 }, onOpen: () => opened.push("agent") }],
      outputs: [{ id: "output", label: "result.ts", onOpen: () => opened.push("output") }],
      sources: [{ id: "source", label: "Readonly evidence" }], processes: [process, { ...process, id: "other", sessionId: "s2" }],
      processesLoading: false, onRefreshProcesses: () => opened.push("refresh"), onOpenProcess: (id) => opened.push(id),
    };
    const renderRail = (props = railProps) => flushSync(() => root.render(<I18nextProvider i18n={i18n}><SessionActivityRail {...props} /></I18nextProvider>));
    renderRail();
    const groups = [...host.querySelectorAll<HTMLButtonElement>(".session-activity-disclosure")];
    check(groups.map((item) => item.getAttribute("aria-expanded")).join() === "true,true,true,false,false", "plan, agents, processes open; outputs and sources folded");
    check(host.querySelectorAll("[data-process-id]").length === 1, "rail shows only the explicit session's processes");
    check(Boolean(host.querySelector(".subagent-activity-overview-main")) && Boolean(host.querySelector(".subagent-activity-overview-detail")), "Overview separates agent identity/status from task/timing");
    check(host.querySelector(".subagent-activity-status")?.textContent?.trim() === "Running", "Overview status has no repeated Agent prefix");
    check(host.querySelector('[data-process-id="p1"] .session-activity-command')?.textContent === "long-background-command.js", "Process uses a readable script title");
    check(host.querySelector('[data-activity-group="agents"] .session-activity-group-count')?.textContent === "1", "Group displays its count");
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
    check(!host.querySelector('[data-process-id]') && !host.querySelector('[data-activity-group="processes"] .session-activity-action'), "unsupported host exposes no process controls");
    renderRail({ ...railProps, sessionId: "s2", plans: [], agents: [], outputs: [], sources: [], processes: [], processesError: "List unavailable" });
    check(host.querySelectorAll('.session-activity-disclosure[aria-expanded="false"]').length === 2, "new session restores disclosure defaults");
    check(host.textContent?.includes("List unavailable") && Boolean(host.querySelector('[role="alert"]')), "list error is observable");
    click(host.querySelector('[role="alert"] button')); check(opened.at(-1) === "refresh", "list error has explicit retry");


    renderRail();
    const outputsDisclosure = host.querySelector('[data-activity-group="outputs"] .session-activity-disclosure');
    check(outputsDisclosure?.getAttribute("aria-expanded") === "true", "Returning to a session retains disclosure preference");
    click(host.querySelector('[data-activity-group="agents"] .session-activity-disclosure'));
    renderRail({ ...railProps, agents: [...railProps.agents, { id: "new-failure", label: "checker", status: "failed", statusLabel: "Failed" }] });
    check(host.querySelector('[data-activity-group="agents"] .session-activity-disclosure')?.getAttribute("aria-expanded") === "true", "New failure expands a manually collapsed group");
    const completed = { ...process, id: "ended", status: "completed" as const };
    renderRail({ ...railProps, processes: [process, completed] });
    check(host.querySelector('[data-activity-group="ended-processes"] .session-activity-disclosure')?.getAttribute("aria-expanded") === "false", "Ended processes initially collapse");
    click(host.querySelector('[data-activity-group="ended-processes"] .session-activity-disclosure'));
    check(Boolean(host.querySelector('[data-process-id="ended"]')), "Ended group exposes its records");
    click(host.querySelector('.session-activity-clear-ended'));
    check(!host.querySelector('[data-process-id="ended"]') && Boolean(host.querySelector('[data-process-id="p1"]')), "Clear hides only ended processes");
    check(stops.length === 0, "Clearing ended records does not stop a process");
    renderRail({ ...railProps, processes: [process, { ...process, id: "timeout", status: "timed_out" }] });
    check(host.querySelector('[data-process-id="timeout"] .session-activity-status')?.getAttribute("data-tone") === "warning", "Tool timeout uses a distinct warning tone");
    const remainingProps: SessionActivityRailProps = {
      ...railProps, sessionId: "remaining-a", rangeLimited: true, hasMoreBefore: true,
      onLoadEarlier: () => opened.push("load-earlier"), onReturnToLatest: () => opened.push("return-latest"),
      agents: Array.from({ length: 7 }, (_, index) => ({ id: `expert-${index}`, label: `Expert ${index}`, detail: "A long task summary which should remain bounded at narrow widths",
        status: index === 6 ? "failed" : "completed", statusLabel: index === 6 ? "Failed" : "Completed", onOpen: () => opened.push(`expert-${index}`) })),
      teamMembers: [{ id: "member", label: "Team member", roleLabel: "Reviewer", status: "running", statusLabel: "Running" }],
      outputs: [{ id: "merged-output", label: "src/result.ts", path: "src/result.ts", groupLabel: "src", changeCount: 2, addedLines: 3, removedLines: 1,
        lastChangedAt: "2026-10-10T01:00:00Z", onOpen: () => opened.push("open-output"), onLocate: () => opened.push("locate-output"), onCopyPath: () => opened.push("copy-output") }],
      sources: [{ id: "domain", label: "docs.example.org", sourceCount: 3, onOpen: () => opened.push("open-source") }],
      processes: [ { ...process, id: "remaining-live", sessionId: "remaining-a", status: "running" },
        ...Array.from({ length: 6 }, (_, index) => ({ ...process, id: `remaining-ended-${index}`, sessionId: "remaining-a", status: "completed" as const })),
        { ...process, id: "remaining-timeout", sessionId: "remaining-a", status: "timed_out" } ],
      attentionItems: [{ id: "approval", label: "2 approvals pending", group: "approvals", onOpen: () => opened.push("approval") },
        { id: "degraded", label: "Goal · Fallback report", group: "plans", itemId: "plan", onOpen: () => opened.push("report") }],
    };
    renderRail(remainingProps); await paint();
    check(host.querySelectorAll('[data-activity-group="agents"] [data-activity-item-id]').length === 5, "long agent list starts with five rows");
    check(Boolean(host.querySelector('[data-activity-group="team-members"]')) && !host.querySelector('[data-activity-group="agents"]')?.textContent?.includes("Team member"), "Team members have a separate role group");
    check(!host.querySelector('.subagent-activity-avatar') && Boolean(host.querySelector('.session-activity-agent-glyph')), "Overview uses a status glyph without decorative avatars");
    const groupHeading = (group: string) => host.querySelector(`[data-activity-group="${group}"] .session-activity-disclosure`);
    click(groupHeading("agents"));
    const failureLink = [...host.querySelectorAll('.session-activity-attention-link')].find((element) => element.textContent?.includes("Expert 6"));
    click(failureLink); await paint(); await paint();
    const revealedExpert = host.querySelector('[data-activity-item-id="expert-6"]');
    check(groupHeading("agents")?.getAttribute('aria-expanded') === 'true' && Boolean(revealedExpert), "attention opens collapsed group and reveals a failure beyond the first five");
    await until(() => Boolean(host.querySelector('[data-activity-item-id="expert-6"]')?.contains(document.activeElement)), "attention transfers keyboard focus to the target row");
    click(groupHeading("agents")); await paint();
    check(groupHeading("agents")?.getAttribute('aria-expanded') === 'false', "manual collapse works after attention reveal");
    renderRail({ ...remainingProps, sessionId: "remaining-b", agents: [], teamMembers: [], processes: [], attentionItems: [] });
    renderRail(remainingProps); await paint();
    check(groupHeading("agents")?.getAttribute('aria-expanded') === 'false', "attention reveal does not reopen on returning to unchanged session");
    click(groupHeading("agents"));
    check(host.querySelectorAll('[data-activity-group="agents"] [data-activity-item-id]').length === 7, "show-all choice survives a session switch");
    click(groupHeading("outputs")); click(groupHeading("sources"));
    check(host.querySelectorAll('.session-activity-range-notice').length === 3, "each transcript-derived group states its loaded range");
    click(host.querySelector('.session-activity-range-notice button')); check(opened.at(-1) === "load-earlier", "loaded-range action reaches the supplied history loader");
    click([...host.querySelectorAll('.session-activity-range-notice button')].find((element) => element.textContent === i18n.t("panel.activity.returnToLatest")));
    check(opened.at(-1) === "return-latest", "historical range retains return-to-latest action");
    check(host.querySelector('.session-activity-directory')?.textContent === "src" && host.querySelector('.session-activity-row-metadata')?.textContent?.includes("2 writes"), "outputs show directory and merged write evidence");
    check(host.querySelector('.session-activity-line-changes')?.textContent === "+3−1", "known output line changes remain distinct");
    check(host.querySelector('[data-activity-group="sources"]')?.textContent?.includes("3 references"), "domain source displays citation occurrences");
    const outputActions = [...host.querySelectorAll('[data-activity-item-id="merged-output"] .session-activity-tail-actions button')];
    for (const action of outputActions) click(action);
    check(opened.slice(-3).join() === "open-output,locate-output,copy-output", "output tail actions reach open, locate and copy without nesting");
    check(!host.querySelector('button button'), "row actions never nest interactive buttons");
    click([...host.querySelectorAll('.session-activity-attention-link')].find((element) => element.textContent === "2 approvals pending"));
    check(opened.at(-1) === "approval", "approval attention has an explicit navigation action");
    if (groupHeading("ended-processes")?.getAttribute("aria-expanded") === "true") click(groupHeading("ended-processes"));
    if (groupHeading("processes")?.getAttribute("aria-expanded") === "true") click(groupHeading("processes"));
    click([...host.querySelectorAll('.session-activity-attention-link')].find((element) => element.textContent?.includes("Timed out"))); await paint(); await paint();
    await until(() => Boolean(host.querySelector('[data-activity-item-id="remaining-timeout"]')?.contains(document.activeElement)), "timeout attention reveals and focuses ended process records");
    for (const theme of ["dark", "light"]) {
      document.documentElement.setAttribute("data-theme", theme);
      document.documentElement.style.setProperty("--font-scale", "1.4"); await paint();
      check(host.scrollWidth <= host.clientWidth, `${theme}: attention, metadata and tail actions fit 248px at enlarged font scale`);
      const copyAction = host.querySelector<HTMLElement>('[data-activity-item-id="merged-output"] .session-activity-tail-actions button:last-child');
      copyAction?.focus(); await paint();
      check(copyAction && getComputedStyle(copyAction.parentElement!).opacity === "1", `${theme}: tail actions are visible for keyboard focus`);
    }
    document.documentElement.style.setProperty("--font-scale", "1");
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
