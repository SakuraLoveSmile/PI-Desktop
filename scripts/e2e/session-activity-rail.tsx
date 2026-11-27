import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import { createInstance } from "i18next";
import { I18nextProvider } from "react-i18next";
import { en } from "@pi-desktop/i18n";
import type { BackgroundProcessDetail, BackgroundProcessesChanged, BackgroundProcessSummary, HostStatusEvent } from "@pi-desktop/shared";
import { SessionActivityRail, type SessionActivityRailProps } from "../../apps/desktop/src/features/chat/activity/SessionActivityRail";
import { ActivitySectionGrip } from "../../apps/desktop/src/features/chat/activity/ActivitySectionGrip";
import { activitySectionOrderStore } from "../../apps/desktop/src/features/chat/activity/use-activity-section-order";
import { BackgroundProcessDetails } from "../../apps/desktop/src/features/chat/activity/BackgroundProcessDetails";
import { api } from "../../apps/desktop/src/lib/api";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

/** Real rail and details; only the IPC host boundary is replaced. No real process starts. */
export async function sessionActivityRailProbe(capture?: (stage: "service-list" | "service-terminal") => Promise<void>) {
  const i18n = createInstance();
  await i18n.init({ lng: "en", interpolation: { escapeValue: false }, resources: { en: { translation: en } } });
  const host = document.createElement("div");
  // The real pane: 264px wide with 16px side padding, which the rows' −8px margins reach into.
  host.style.cssText = "position:fixed;top:40px;right:40px;width:264px;box-sizing:border-box;padding:8px 16px 16px;max-height:90vh;overflow:auto;background:var(--color-bg-primary);z-index:1000;";
  document.body.append(host);
  const root = createRoot(host);
  const initialTheme = document.documentElement.getAttribute("data-theme");
  const initialScale = document.documentElement.style.getPropertyValue("--font-scale");
  const original = { read: api.readBackgroundProcess, stop: api.stopBackgroundProcess, subscribe: api.onBackgroundProcessesChanged, hostStatus: api.onHostStatus,
    insights: api.getContextInsights, agentEvent: api.onAgentEvent, insightsChanged: api.onContextInsightsChanged };
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
  // The Context section reads the newest request's breakdown while it is open; this fixture has none.
  api.getContextInsights = async (sessionId) => ({ version: 1, sessionId, requests: [], events: [], updatedAt: 1,
    retention: { maxRequests: 40, maxEvents: 160, maxContentChars: 120000, maxTotalContentChars: 1200000, droppedRequests: 0, droppedEvents: 0 } });
  api.onAgentEvent = () => () => {};
  api.onContextInsightsChanged = () => () => {};
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
    const disclosureState = groups.map((item) => `${item.closest("[data-activity-group]")?.getAttribute("data-activity-group")}:${item.getAttribute("aria-expanded")}`).join();
    check(disclosureState === "plans:true,live:true,agents:true,processes:true,artifacts:true,sources:false",
      disclosureState === "plans:true,live:true,agents:true,processes:true,artifacts:true,sources:false"
        ? "sections and their groups start open and only the sources fold" : `disclosure defaults read ${disclosureState}`);
    check(Boolean(host.querySelector('[data-activity-group="artifacts"] [data-activity-id="output"]')) && !host.querySelector('[data-activity-group="outputs"] .session-activity-disclosure'),
      "outputs are listed directly under Artifacts, with no fold of their own");
    check(!host.querySelector('[data-activity-group="team-members"]') && !host.querySelector(".session-activity-empty"), "groups without rows are left out");
    check(host.querySelectorAll("[data-process-id]").length === 1, "rail shows only the explicit session's processes");
    check(Boolean(host.querySelector(".subagent-activity-overview-main")) && Boolean(host.querySelector(".subagent-activity-overview-detail")), "Overview separates agent identity/status from task/timing");
    check(/^00:[2-3]\d$/.test(host.querySelector(".subagent-activity-elapsed")?.textContent ?? ""), "a running agent started 20 seconds ago shows its elapsed time as a clock");
    // A running agent shows a spinner, so its status is the spinner's accessible name; a finished one writes the word.
    const agentStatus = host.querySelector(".subagent-activity-status");
    check((agentStatus?.querySelector('[role="img"]')?.getAttribute("aria-label") ?? agentStatus?.textContent?.trim()) === "Running", "Overview status has no repeated Agent prefix");
    check(host.querySelector('[data-process-id="p1"] .session-activity-command')?.textContent === "long-background-command.js", "Process uses a readable script title");
    check(host.querySelector('[data-activity-group="agents"] .session-activity-group-count')?.textContent === "1", "Group displays its count");
    check(host.querySelector('[data-process-id="p1"] .session-activity-status[data-state="active"] [role="img"]')?.getAttribute("aria-label") === i18n.t("panel.activity.status.starting")
      && !host.querySelector('[data-process-id="p1"] .session-activity-status[data-state="done"]'), "accepted process starts truthfully without completed label");
    for (const theme of ["dark", "light"]) {
      document.documentElement.setAttribute("data-theme", theme);
      document.documentElement.style.setProperty("--font-scale", "1.4");
      await paint();
      check(host.scrollWidth <= host.clientWidth, `${theme}: the 264px pane keeps the rail within bounds at enlarged font scale`);
    }
    document.documentElement.style.setProperty("--font-scale", "1");
    click(host.querySelector('[data-activity-id="agent"]')); click(host.querySelector('[data-process-id="p1"]'));
    click(host.querySelector('[data-activity-id="output"]')); click(groups[5]);
    check(opened.join() === "agent,p1,output", "representative path opens agent, process and output from rail");
    check(host.querySelector(".session-activity-readonly")?.tagName === "SPAN", "readonly source is not a fake navigation action");
    check(!host.querySelector(".session-quick-notes"), "quick notes are absent from activity groups");
    renderRail({ ...railProps, supported: false });
    check(!host.querySelector('[data-process-id]') && !host.querySelector('[data-activity-group="processes"] .session-activity-action'), "unsupported host exposes no process controls");
    renderRail({ ...railProps, sessionId: "s2", plans: [], agents: [], processes: [], processesError: "List unavailable" });
    check(host.querySelectorAll('.session-activity-disclosure[aria-expanded="false"]').length === 1
      && host.querySelector('[data-activity-group="sources"] .session-activity-disclosure')?.getAttribute("aria-expanded") === "false", "new session restores disclosure defaults");
    check(!host.querySelector('[data-activity-group="plans"]') && !host.querySelector('[data-activity-group="agents"]'), "a plan or agent group with no rows is left out");
    check(host.textContent?.includes("List unavailable") && Boolean(host.querySelector('[role="alert"]')), "list error is observable");
    click(host.querySelector('[role="alert"] button')); check(opened.at(-1) === "refresh", "list error has explicit retry");
    renderRail({ ...railProps, sessionId: "bare", plans: [], agents: [], outputs: [], sources: [], processes: [] });
    check(host.querySelectorAll("[data-activity-section]").length === 1 && host.querySelector("[data-activity-section]")?.getAttribute("data-activity-section") === "live"
      && host.querySelector(".session-activity-empty")?.textContent === i18n.t("panel.activity.emptyLive") && !host.querySelector("[data-activity-group] [data-activity-group]"),
      "a rail with nothing to show keeps one hint line and no empty groups");

    // Sections: default order, hairlines, grips, keyboard and pointer reordering, cancel, persistence and reset.
    const orderKey = "pi-desktop:activity-section-order:v1";
    const savedOrder = () => { try { return localStorage.getItem(orderKey); } catch { return null; } };
    const sectionIds = () => [...host.querySelectorAll<HTMLElement>("[data-activity-section]")].map((element) => element.dataset.activitySection).join();
    const sectionGrip = (id: string) => host.querySelector<HTMLButtonElement>(`[data-activity-section-grip="${id}"]`);
    // The saved order is complete: sections this rail does not show (Todos, Team tasks, Servers) keep their default
    // slots while the visible ones move around them, exactly as applyVisibleActivitySectionOrder writes them.
    const FULL_DEFAULT = ["goals", "plans", "todos", "teamTasks", "live", "server", "environment", "context", "artifacts", "skills", "changes"];
    const saved = (visible: string) => {
      const ids = visible.split(",");
      const slots = new Set(ids);
      let next = 0;
      return JSON.stringify(FULL_DEFAULT.map((id) => (slots.has(id) ? ids[next++] : id)));
    };
    const sectionBox = (id: string) => host.querySelector<HTMLElement>(`[data-activity-section="${id}"]`)!.getBoundingClientRect();
    const usage = { inputTokens: 38_000, outputTokens: 2_000, totalTokens: 40_000 };
    const orderProps: SessionActivityRailProps = { ...railProps, goals: [{ id: "goal", label: "Ship importer", status: "running", statusLabel: "Running" }],
      environment: { name: "PI-Desktop", path: "/Users/dev/Code/PI-Desktop", branch: "main" },
      contextUsage: { usage, turnUsage: usage, contextWindow: 200_000, tools: [], responseOutputEstimated: false },
      changes: { count: 3, additions: 115, deletions: 22 }, onOpenContext: () => opened.push("context"), onOpenReview: () => opened.push("review"),
      suggestions: <section className="session-skill-suggestions"><div className="session-skill-suggestions-heading"><span>Skills</span><ActivitySectionGrip /></div></section> };
    const press = (id: string, key: string, altKey = false) => { sectionGrip(id)!.dispatchEvent(new KeyboardEvent("keydown", { key, altKey, bubbles: true, cancelable: true })); };
    const pointer = (type: "pointerdown" | "pointermove" | "pointerup", target: EventTarget, clientY: number) =>
      target.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, button: 0, pointerId: 1, isPrimary: true, clientX: 8, clientY }));
    const sceneTheme = document.documentElement.getAttribute("data-theme");
    activitySectionOrderStore.reset();
    renderRail({ ...orderProps, sessionId: "order-a" }); await paint();
    check(sectionIds() === "goals,plans,live,environment,context,artifacts,skills,changes" && !host.querySelector(".session-activity-sections-reset"), "sections start in the default order without a reset control");
    check(host.querySelectorAll("[data-activity-section-grip]").length === 8, "every section carries exactly one grip");
    // The reset gives every box a solid border style, so a stroke is told by its width: 0.5px snaps to 1px on a 1x display.
    const hairlines = [...host.querySelectorAll<HTMLElement>("[data-activity-section]")].map((section) => getComputedStyle(section).borderTopWidth).join();
    const hairlinesOk = /^0px(,(0\.5|1)px){7}$/.test(hairlines);
    check(hairlinesOk, hairlinesOk ? "a hairline separates neighbouring sections and nothing sits above the first" : `section hairline widths read ${hairlines}`);
    const strokes = [...host.querySelectorAll<HTMLElement>(".session-activity-group, .session-activity-row-shell, .session-activity-disclosure")].filter((element) => {
      const style = getComputedStyle(element); return parseFloat(style.borderTopWidth) > 0 || parseFloat(style.borderBottomWidth) > 0;
    }).map((element) => element.className);
    check(strokes.length === 0, strokes.length === 0 ? "groups, rows and headings draw no strokes of their own" : `strokes remain on ${strokes.join(" | ")}`);
    sectionGrip("live")!.focus();
    press("live", "ArrowUp"); await paint();
    const moved = "goals,live,plans,environment,context,artifacts,skills,changes";
    check(sectionIds() === moved, "ArrowUp on a grip moves its section up one place");
    check(document.activeElement === sectionGrip("live"), "the moved section's grip keeps keyboard focus");
    check(savedOrder() === saved(moved), "a chosen order is saved on this device");
    check(host.querySelector(".session-activity-sections-status")?.textContent === i18n.t("panel.activity.sections.moved", { name: i18n.t("panel.activity.liveStatus"), position: 2, count: 8 }),
      "the move is announced with its name and position");
    check(Boolean(host.querySelector(".session-activity-sections-reset")), "a changed order offers a reset");
    press("goals", "ArrowUp"); press("changes", "ArrowDown"); press("goals", "ArrowDown", true); await paint();
    check(sectionIds() === moved, "edges and modified arrow keys leave the order alone");
    renderRail({ ...orderProps, sessionId: "order-b" }); await paint();
    check(sectionIds() === moved, "a chosen order applies to every session's rail");
    const grab = sectionGrip("goals")!.getBoundingClientRect();
    pointer("pointerdown", sectionGrip("goals")!, grab.top + grab.height / 2); await paint();
    pointer("pointermove", window, sectionBox("skills").top + 2); await paint();
    check(host.querySelector('[data-activity-section="goals"]')?.getAttribute("data-dragging") === "true" && sectionIds() === "live,plans,environment,context,artifacts,goals,skills,changes",
      "dragging a grip moves its section live and marks it");
    pointer("pointerup", window, 0); await paint();
    const dragged = "live,plans,environment,context,artifacts,goals,skills,changes";
    check(sectionIds() === dragged && !host.querySelector('[data-dragging="true"]') && savedOrder() === saved(dragged), "releasing the grip keeps the new order and saves it");
    const lift = sectionGrip("skills")!.getBoundingClientRect();
    pointer("pointerdown", sectionGrip("skills")!, lift.top + lift.height / 2); await paint();
    pointer("pointermove", window, sectionBox("live").top - 2); await paint();
    check(sectionIds() === "skills,live,plans,environment,context,artifacts,goals,changes", "dragging above the first section moves it to the top");
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })); await paint();
    check(sectionIds() === dragged && !host.querySelector('[data-dragging="true"]') && savedOrder() === saved(dragged), "Escape puts the original order back and saves nothing");
    click(host.querySelector(".session-activity-sections-reset")); await paint();
    check(sectionIds() === "goals,plans,live,environment,context,artifacts,skills,changes" && savedOrder() === null && !host.querySelector(".session-activity-sections-reset") && document.activeElement === sectionGrip("goals"),
      "Reset order restores the default, clears the saved choice and returns focus to the first grip");
    for (const theme of ["dark", "light"]) {
      document.documentElement.setAttribute("data-theme", theme);
      document.documentElement.style.setProperty("--font-scale", "1.4"); await paint();
      check(host.scrollWidth <= host.clientWidth, `${theme}: sections, grips and hairlines fit the 264px pane at enlarged font scale`);
    }
    document.documentElement.style.setProperty("--font-scale", "1");
    if (sceneTheme === null) document.documentElement.removeAttribute("data-theme"); else document.documentElement.setAttribute("data-theme", sceneTheme);


    renderRail();
    const sourcesDisclosure = host.querySelector('[data-activity-group="sources"] .session-activity-disclosure');
    check(sourcesDisclosure?.getAttribute("aria-expanded") === "true", "Returning to a session retains disclosure preference");
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
    click(groupHeading("sources"));
    check(host.querySelectorAll('.session-activity-range-notice').length === 2
      && ["live", "artifacts"].every((section) => host.querySelector(`[data-activity-group="${section}"] .session-activity-range-notice`)), "each section of transcript-derived rows states its loaded range");
    click(host.querySelector('.session-activity-range-notice button')); check(opened.at(-1) === "load-earlier", "loaded-range action reaches the supplied history loader");
    click([...host.querySelectorAll('.session-activity-range-notice button')].find((element) => element.textContent === i18n.t("panel.activity.returnToLatest")));
    check(opened.at(-1) === "return-latest", "historical range retains return-to-latest action");
    check(host.querySelector('.session-activity-directory')?.textContent === "src" && host.querySelector('[data-activity-id="merged-output"]')?.getAttribute("aria-label")?.includes("2 writes"), "outputs show directory and keep merged write evidence in the row's name");
    check(host.querySelector('.session-activity-line-changes')?.textContent === "+3−1", "known output line changes remain distinct");
    check(host.querySelector('[data-activity-id="domain"]')?.getAttribute("aria-label")?.includes("3 references"), "domain source keeps citation occurrences in the row's name");
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
      check(host.scrollWidth <= host.clientWidth, `${theme}: attention, row status and tail actions fit the 264px pane at enlarged font scale`);
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
    const service: BackgroundProcessSummary = {
      ...process, id: "service", status: "running", backgroundKind: "service",
      teamSessionId: "team-owned", teamRunId: "run-owned", deadlineAt: "2026-10-09T06:00:00Z", stopMode: "unix-term-then-kill",
    };
    renderRail({ ...railProps, processes: [service], onOpenProcess: (id) => renderDetails(service.sessionId, id) });
    check(host.querySelector('[data-process-id="service"]')?.textContent?.includes("Service · long-background-command.js"), "explicit service is identified in the Activity list");
    await capture?.("service-list");
    click(host.querySelector('[data-process-id="service"]')); await paint();
    check(reads.at(-1)?.sessionId === service.sessionId && reads.at(-1)?.id === service.id, "opening a service preserves its exact session and process identity");
    reads.at(-1)!.task.resolve(detail(service)); await paint();
    check(host.textContent?.includes("team-owned") && host.textContent?.includes("run-owned")
      && host.querySelector('time[datetime="2026-10-09T06:00:00Z"]'), "service details show authenticated owner/run and recorded deadline");
    check(host.textContent?.includes("TERM, then KILL after up to 5 seconds") && !host.textContent?.includes("Escalated to KILL"), "active service shows stop policy without fabricating a stop outcome");
    const stopCount = stops.length;
    click(stopButton());
    check(stops.length === stopCount + 1 && stops.at(-1)?.sessionId === service.sessionId && stops.at(-1)?.id === service.id,
      "service stop uses the existing session-scoped action");
    const stoppingService = { ...service, status: "stopping" as const, stopReason: "explicit_stop" as const, stopRequestedAt: "2026-10-09T00:10:00Z" };
    stops.at(-1)!.task.resolve({ process: stoppingService }); await paint();
    reads.at(-1)!.task.resolve(detail(stoppingService)); await paint();
    check((stopButton() as HTMLButtonElement)?.disabled && host.textContent?.includes("Explicit stop"), "stopping service remains disabled and retains its recorded reason");
    emit(service.sessionId, service.id); await paint();
    reads.at(-1)!.task.resolve(detail({ ...stoppingService, status: "stopped", serviceStopEscalated: true })); await paint();
    check(!stopButton() && host.textContent?.includes("Escalated to KILL") && host.textContent?.includes("bounded stdout"),
      "terminal service preserves output and truthful escalation result without another stop control");
    await capture?.("service-terminal");
    return { ok: true, checks };
  } finally {
    // The order is a renderer-wide device preference: no scene leaves its choice behind for the next probe.
    activitySectionOrderStore.reset();
    flushSync(() => root.unmount()); host.remove();
    if (initialTheme === null) document.documentElement.removeAttribute("data-theme");
    else document.documentElement.setAttribute("data-theme", initialTheme);
    if (initialScale) document.documentElement.style.setProperty("--font-scale", initialScale);
    else document.documentElement.style.removeProperty("--font-scale");
    api.readBackgroundProcess = original.read; api.stopBackgroundProcess = original.stop; api.onBackgroundProcessesChanged = original.subscribe; api.onHostStatus = original.hostStatus;
    api.getContextInsights = original.insights; api.onAgentEvent = original.agentEvent; api.onContextInsightsChanged = original.insightsChanged;
    if (listeners.size || hostListeners.size) throw new Error("Process subscription leaked after unmount");
  }
}
