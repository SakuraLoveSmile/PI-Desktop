import { act, createElement, Fragment } from "react";
import { createRoot } from "react-dom/client";
import { createInstance } from "i18next";
import { I18nextProvider } from "react-i18next";
import type { GoalProgressChangedEvent, GoalProgressSnapshot, GoalReportChangedEvent, PlanProposal, TeamSnapshot } from "@pi-desktop/shared";
import { catalogs } from "@pi-desktop/i18n";
import { GoalProgressBar } from "../../apps/desktop/src/features/chat/composer/GoalProgressBar";
import { TeamDispatchCard } from "../../apps/desktop/src/features/chat/transcript/TeamDispatchCard";
import { api } from "../../apps/desktop/src/lib/api";
import { useAppStore } from "../../apps/desktop/src/stores/app-store";
import type { TeamDispatchCardItem } from "../../apps/desktop/src/lib/team-dispatch";
import "../../apps/desktop/src/styles/tokens.css";
import "../../apps/desktop/src/styles/goal-progress.css";
import "../../apps/desktop/src/styles/team-dispatch.css";

declare global { var goalTeamRendererUiProbe: () => Promise<unknown>; }
declare global { var goalTeamRendererUiCleanup: (() => void) | undefined; }
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const assert = (condition: unknown, message: string) => {
  if (!condition) throw new Error(message);
};

async function until(condition: () => boolean, label: string) {
  const deadline = performance.now() + 6000;
  while (!condition() && performance.now() < deadline) {
    await act(async () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));
  }
  assert(condition(), `UI did not reach expected state: ${label}`);
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

function progress(executionId: string, revision: number, label: string, status: "pending" | "completed", sessionId = "goal-session"): GoalProgressSnapshot {
  return {
    schemaVersion: 1,
    sessionId,
    proposalId: `proposal-${executionId}`,
    executionId,
    revision,
    items: [{ id: `${executionId}-${revision}`, label, status }],
    updatedAt: revision,
  };
}

globalThis.goalTeamRendererUiProbe = async () => {
  const i18n = createInstance();
  await i18n.init({ lng: "en", resources: { en: { translation: catalogs.en } } });
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  let preserveForScreenshot = false;
  const progressListeners = new Map<string, Array<(event: GoalProgressChangedEvent) => void>>();
  const reportListeners = new Map<string, Array<(event: GoalReportChangedEvent) => void>>();
  const initialProgress = new Map<string, ReturnType<typeof deferred<{ progress: GoalProgressSnapshot | null }>>>();
  const initialProgressUsed = new Set<string>();
  const reportReads = new Map<string, ReturnType<typeof deferred<{ report: { status: string } | null }>>>();
  const laterProgress: Array<ReturnType<typeof deferred<{ progress: GoalProgressSnapshot | null }>>> = [];
  const originalGetGoalProgress = api.getGoalProgress;
  const originalGetGoalReport = api.getGoalReport;
  const originalProgressListener = api.onGoalProgressChanged;
  const originalReportListener = api.onGoalReportChanged;
  const originalTeamSnapshot = api.getTeamSnapshot;
  const originalTeamChanged = api.onTeamChanged;
  const originalHostStatus = api.onHostStatus;
  const originalStoreMethod = useAppStore.getState().openWorkPanelTabForSession;
  const openedTabs: Array<{ sessionId: string; tab: { teamTarget?: unknown } }> = [];
  try {
    for (const id of ["execution-old", "execution-new"]) {
      initialProgress.set(id, deferred());
      reportReads.set(id, deferred());
    }
    api.getGoalProgress = async ({ executionId }) => {
      if (executionId === "screenshot-execution") {
        return { progress: progress("screenshot-execution", 1, "Screenshot step", "completed", "screenshot-session") };
      }
      const initial = initialProgress.get(executionId);
      if (initial && !initialProgressUsed.has(executionId)) {
        initialProgressUsed.add(executionId);
        return initial.promise;
      }
      const request = deferred<{ progress: GoalProgressSnapshot | null }>();
      laterProgress.push(request);
      return request.promise;
    };
    api.getGoalReport = async ({ executionId }) => {
      const report = reportReads.get(executionId ?? "");
      return report ? report.promise : { report: null };
    };
    api.onGoalProgressChanged = (listener) => {
      const list = progressListeners.get("current") ?? [];
      list.push(listener);
      progressListeners.set("current", list);
      return () => progressListeners.set("current", (progressListeners.get("current") ?? []).filter((item) => item !== listener));
    };
    api.onGoalReportChanged = (listener) => {
      const list = reportListeners.get("current") ?? [];
      list.push(listener);
      reportListeners.set("current", list);
      return () => reportListeners.set("current", (reportListeners.get("current") ?? []).filter((item) => item !== listener));
    };
    api.onTeamChanged = () => () => undefined;
    api.onHostStatus = () => () => undefined;
    api.getTeamSnapshot = async () => ({
      teamSessionId: "team-session",
      revision: 1,
      paused: false,
      members: [{
        teamSessionId: "team-session",
        memberSessionId: "member-session",
        name: "researcher",
        contextKind: "fresh",
        phase: "idle",
        presentation: { role: "researcher", displayName: "Alex" },
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      }],
      tasks: [], readiness: [], scopeOverlaps: [], leadPhase: "idle",
      queuedMessageCount: 0, review: null, decision: null,
    } satisfies TeamSnapshot);
    useAppStore.setState({
      activeSessionId: "lead-session",
      openWorkPanelTabForSession: (sessionId, tab) => { openedTabs.push({ sessionId, tab }); },
    });

    const oldProposal = {
      id: "proposal-old", sessionId: "goal-session", turnId: "turn-old", toolCallId: "call-old",
      kind: "goal", title: "Old goal", markdown: "Old plan", question: "Approve?", version: 1,
      status: "approved", createdAt: "now", updatedAt: "now", plan: "Old plan",
      executionId: "execution-old", executionKind: "goal", executionState: "completed",
    } as PlanProposal;
    const newProposal = {
      ...oldProposal, id: "proposal-new", title: "Current goal", executionId: "execution-new",
      executionState: "running",
    } as PlanProposal;
    const card: TeamDispatchCardItem = {
      teamSessionId: "team-session", taskId: "task-real", firstCreateMessageId: "message-create",
      task: { taskId: "task-real", subject: "Review change", status: "pending", ownerMemberName: "researcher", ownerSessionId: "member-session" },
    };
    const renderAll = (proposal: PlanProposal, sessionId = "goal-session") => createElement(I18nextProvider, { i18n },
      createElement(Fragment, null,
        createElement(GoalProgressBar, { sessionId, proposal }),
        createElement(TeamDispatchCard, { card }),
      ));
    await act(async () => { root.render(renderAll(oldProposal)); });
    await act(async () => container.querySelector<HTMLButtonElement>(".goal-progress-toggle-btn")?.click());
    await act(async () => initialProgress.get("execution-old")?.resolve({ progress: progress("execution-old", 1, "Old work", "completed") }));
    await until(() => container.textContent?.includes("Old work") === true, "initial goal progress");
    const oldProgressHandlers = [...(progressListeners.get("current") ?? [])];
    await act(async () => oldProgressHandlers[0]?.({ sessionId: "other-session", executionId: "execution-old", revision: 2 }));
    assert(laterProgress.length === 0, "progress events from another session must be ignored");
    const oldReportHandlers = [...(reportListeners.get("current") ?? [])];
    await act(async () => oldReportHandlers[0]?.({ sessionId: "other-session", reportId: "foreign-report", executionId: "execution-old", proposalId: "proposal-old", status: "ready" }));
    assert(Boolean(container.querySelector('[data-testid="goal-progress-bar"]')), "report events from another session must be ignored");

    await act(async () => { root.render(renderAll(newProposal)); });
    assert(container.textContent?.includes("Current goal"), "new execution title must render immediately");
    assert(!container.textContent?.includes("Old work"), "execution switch must hide the prior progress snapshot");
    const staleReportHandlers = [...(reportListeners.get("current") ?? [])];
    await act(async () => {
      staleReportHandlers.forEach((listener) => listener({ sessionId: "goal-session", reportId: "report-old", executionId: "execution-old", proposalId: "proposal-old", status: "ready" }));
    });
    assert(Boolean(container.querySelector('[data-testid="goal-progress-bar"]')), "old report readiness must not hide the new running goal");
    await act(async () => initialProgress.get("execution-new")?.resolve({ progress: progress("execution-new", 1, "Current work", "pending") }));
    await until(() => container.textContent?.includes("Current work") === true, "new goal progress");

    const progressHandlers = [...(progressListeners.get("current") ?? [])];
    await act(async () => progressHandlers[0]?.({ sessionId: "goal-session", executionId: "execution-new", revision: 2 }));
    await act(async () => progressHandlers[0]?.({ sessionId: "goal-session", executionId: "execution-new", revision: 3 }));
    await until(() => laterProgress.length === 2, "two overlapping progress reads");
    await act(async () => laterProgress[1].resolve({ progress: progress("execution-new", 3, "Newest work", "completed") }));
    await until(() => container.textContent?.includes("Newest work") === true, "newest progress revision");
    await act(async () => laterProgress[0].resolve({ progress: progress("execution-new", 2, "Stale work", "pending") }));
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    assert(container.textContent?.includes("Newest work"), "late lower-revision response must not replace newer progress");
    assert(!container.textContent?.includes("Stale work"), "stale lower-revision label must remain hidden");

    await act(async () => { root.render(renderAll(newProposal, "other-session")); });
    assert(!container.textContent?.includes("Newest work"), "changing sessions must hide the same execution's previous snapshot");
    await until(() => laterProgress.length === 3, "progress read for the new session");
    await act(async () => laterProgress[2].resolve({ progress: progress("execution-new", 1, "Session work", "pending", "other-session") }));
    await act(async () => container.querySelector<HTMLButtonElement>(".goal-progress-toggle-btn")?.click());
    await until(() => container.textContent?.includes("Session work") === true, "new session progress");

    const readyHandlers = [...(reportListeners.get("current") ?? [])];
    assert(readyHandlers.length > 0, "active goal must have a report status listener");
    await act(async () => { root.render(renderAll({ ...newProposal, executionState: "completed" })); });
    assert(Boolean(container.querySelector('[data-testid="goal-progress-bar"]')), "terminal execution waits for its report");
    assert(container.querySelector(".goal-progress-badge")?.getAttribute("data-state") === "completed", "terminal execution state must reach the rendered component");
    await act(async () => readyHandlers.forEach((listener) => listener({ sessionId: "other-session", reportId: "report-new", executionId: "execution-new", proposalId: "proposal-new", status: "ready" })));
    await act(async () => reportReads.get("execution-new")?.resolve({ report: { status: "ready" } }));
    await until(() => !container.querySelector('[data-testid="goal-progress-bar"]'), `ready report hides completed execution (listeners=${readyHandlers.length})`);

    await until(() => Boolean(container.querySelector(".team-dispatch-card-expert")), "dispatch card member");
    await act(async () => container.querySelector<HTMLButtonElement>(".team-dispatch-card-expert")?.click());
    await act(async () => container.querySelector<HTMLButtonElement>(".team-dispatch-task-title-btn")?.click());
    assert(openedTabs.length === 2, "member and task links must open work panel targets");
    assert(openedTabs[0].sessionId === "lead-session", "member link must open from the active session");
    assert(JSON.stringify(openedTabs[0].tab.teamTarget) === JSON.stringify({ kind: "member", memberSessionId: "member-session" }), "member click must open the actual member detail target");
    assert(JSON.stringify(openedTabs[1].tab.teamTarget) === JSON.stringify({ kind: "task", taskId: "task-real" }), "task click must open the task detail target");
    const screenshotProposal = { ...newProposal, executionId: "screenshot-execution" } as PlanProposal;
    await act(async () => { root.render(renderAll(screenshotProposal, "screenshot-session")); });
    await until(() => container.querySelector(".goal-progress-capsule-text")?.textContent?.trim() === "1/1", "ready progress for screenshot");
    await act(async () => container.querySelector<HTMLButtonElement>(".goal-progress-toggle-btn")?.click());
    await until(() => container.textContent?.includes("Screenshot step") === true, "expanded goal for screenshot");
    assert(Boolean(container.querySelector(".goal-progress-expanded-content")), "expanded step list must be visible in the screenshot");
    assert(container.querySelector(".goal-progress-toggle-btn")?.textContent?.trim() === "Show less", "expanded goal toggle must use the English catalog key");
    assert(Boolean(container.querySelector('[data-testid="goal-progress-bar"]')), "running goal progress should remain visible for the evidence capture");
    preserveForScreenshot = true;
    globalThis.goalTeamRendererUiCleanup = () => { root.unmount(); container.remove(); };
  } finally {
    if (!preserveForScreenshot) {
      await act(async () => root.unmount());
      container.remove();
    }
    api.getGoalProgress = originalGetGoalProgress;
    api.getGoalReport = originalGetGoalReport;
    api.onGoalProgressChanged = originalProgressListener;
    api.onGoalReportChanged = originalReportListener;
    api.getTeamSnapshot = originalTeamSnapshot;
    api.onTeamChanged = originalTeamChanged;
    api.onHostStatus = originalHostStatus;
    useAppStore.setState({ openWorkPanelTabForSession: originalStoreMethod });
  }
  return { ok: true, scenarios: ["goal execution and session switch", "cross-session event isolation", "stale report event", "out-of-order progress revisions", "ready report completion", "member detail and task navigation"] };
};
