import { act, createElement, Fragment } from "react";
import { createRoot } from "react-dom/client";
import { createInstance } from "i18next";
import { I18nextProvider } from "react-i18next";
import type { GoalProgressChangedEvent, GoalProgressSnapshot, GoalReportChangedEvent, GoalReportSummary, PlanProposal, TeamSnapshot, UiMessage } from "@pi-desktop/shared";
import { catalogs } from "@pi-desktop/i18n";
import { GoalProgressBar } from "../../apps/desktop/src/features/chat/composer/GoalProgressBar";
import { TeamDispatchCardsGroup } from "../../apps/desktop/src/features/chat/transcript/TeamDispatchCard";
import { api } from "../../apps/desktop/src/lib/api";
import { useAppStore } from "../../apps/desktop/src/stores/app-store";
import { ChatTranscript } from "../../apps/desktop/src/features/chat/transcript/ChatTranscript";
import { buildTeamDispatchIndex, TeamDispatchContext, type TeamDispatchCardItem, type TeamDispatchIndex } from "../../apps/desktop/src/lib/team-dispatch";
import { AssistantTurn } from "../../apps/desktop/src/features/chat/transcript/AssistantTurn";
import type { AssistantTurnEntry, AssistantTurnPart } from "../../apps/desktop/src/lib/assistant-turns";
import { installTranscriptSearchFocus } from "../../apps/desktop/src/hooks/use-transcript-search-focus";
import "../../apps/desktop/src/styles/tokens.css";
import "../../apps/desktop/src/styles/base.css";
import "../../apps/desktop/src/styles/messages.css";
import "../../apps/desktop/src/styles/ui-kit.css";
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
  let cardHeight = 0;
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
  const openedTabs: Array<{ sessionId: string; tab: { id: string; label?: string; teamTarget?: unknown } }> = [];
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
      tasks: [{
        teamSessionId: "team-session", taskId: "task-real", revision: 2,
        subject: "Review change", status: "in_progress", ownerSessionId: "member-session",
        ownerMemberName: "researcher", blockedBy: [], writeScopes: [], deleted: false,
        createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:01:00.000Z",
      }],
      readiness: [{ taskId: "task-real", isReady: true, unresolvedBlockedBy: [] }],
      scopeOverlaps: [], leadPhase: "idle",
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
    const renderAll = (proposal: PlanProposal, sessionId = "goal-session", joining = false) => createElement(I18nextProvider, { i18n },
      createElement(Fragment, null,
        createElement(GoalProgressBar, { sessionId, proposal }),
        createElement(TeamDispatchCardsGroup, { cards: [card], joining }),
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
    await act(async () => { root.render(renderAll({ ...newProposal, executionState: "interrupted" })); });
    assert(!container.querySelector('[data-testid="goal-progress-bar"]'), "interrupted execution ends progress without waiting for any report");

    await until(() => container.querySelector(".team-dispatch-card")?.getAttribute("data-state") === "in_progress", "live dispatch card status");
    const dispatchCard = container.querySelector<HTMLElement>(".team-dispatch-card");
    assert(dispatchCard?.textContent?.includes("In progress"), "snapshot status must replace the pending tool fixture");
    assert(dispatchCard?.querySelector(".team-dispatch-identity")?.textContent === "Researcher Alex", "dispatch identity must match the projected member identity");
    assert(dispatchCard?.querySelectorAll("button").length === 1, "dispatch card must have one focusable control");
    cardHeight = dispatchCard?.getBoundingClientRect().height ?? 0;
    const cardMetrics = Array.from(dispatchCard?.querySelectorAll("button, .team-dispatch-card-row, .team-dispatch-identity, .team-dispatch-title, img") ?? []).map((element) => {
      const style = getComputedStyle(element);
      return { className: element.className, height: element.getBoundingClientRect().height, fontSize: style.fontSize, lineHeight: style.lineHeight };
    });
    assert(cardHeight >= 58 && cardHeight <= 66, `dispatch card height must be within [58, 66], got ${cardHeight}: ${JSON.stringify(cardMetrics)}`);
    await act(async () => container.querySelector<HTMLButtonElement>(".team-dispatch-card-open")?.click());
    assert(openedTabs.length === 1, "one card click must open exactly one work panel target");
    assert(openedTabs[0].sessionId === "lead-session", "card click must open from the active session");
    assert(openedTabs[0].tab.id === "team:team-session:task:task-real", "task card must open its own tab ID");
    assert(openedTabs[0].tab.label === "Review change", "task card captures the current subject as its tab label");
    assert(JSON.stringify(openedTabs[0].tab.teamTarget) === JSON.stringify({ kind: "task", taskId: "task-real" }), "card click must open the task detail target");
    const renderJoining = (joining: boolean) => createElement(I18nextProvider, { i18n },
      createElement(TeamDispatchCardsGroup, { cards: [], joining }));
    await act(async () => { root.render(renderJoining(true)); });
    assert(container.querySelector('.team-dispatch-joining[role="status"]')?.textContent === "New expert joining…", "joining feedback must render even before a task card exists");
    const joiningLabel = container.querySelector(".team-dispatch-joining-label");
    if (joiningLabel && window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      assert(getComputedStyle(joiningLabel).animationName === "none", "reduced motion must disable joining animation");
    }
    await act(async () => { root.render(renderJoining(false)); });
    assert(container.childElementCount === 0, "joining feedback must disappear when spawning finishes and there are no cards");
    const completion: GoalReportSummary = {
      reportId: "report-completed", executionId: "execution-completed", sessionId: "report-session",
      proposalId: "proposal-completed", status: "ready", executionStatus: "completed", verdict: "met",
      integrity: "structured", summary: "Verified all requested work.", goalTitle: "Completed goal",
      completedAt: 1, createdAt: 1,
    };
    const interruption: GoalReportSummary = { ...completion, reportId: "report-interrupted",
      executionId: "execution-interrupted", executionStatus: "interrupted", verdict: "blocked",
      integrity: "fallback", summary: "Execution was interrupted.", goalTitle: "Interrupted goal" };
    const transcript = () => createElement(I18nextProvider, { i18n }, createElement(ChatTranscript, {
      sessionId: "report-session", isRunning: false,
      messages: [{ id: "goal-result-user", role: "user", content: "Complete the goal.", createdAt: "2026-01-01T00:00:00Z" },
        { id: "goal-result-answer", role: "assistant", content: "The execution has stopped.", status: "complete", createdAt: "2026-01-01T00:00:01Z" }],
    }));
    await act(async () => { useAppStore.setState({ goalReports: { "report-session": [interruption] } }); root.render(transcript()); });
    assert(!container.querySelector('[data-testid="goal-report-card"]'), "legacy interrupted report never renders a result card after loading history");
    await act(async () => { useAppStore.setState({ goalReports: { "report-session": [interruption, completion] } }); });
    await until(() => container.querySelectorAll('[data-testid="goal-report-card"]').length === 1, "only the completed report appears");
    const completedCard = container.querySelector('[data-testid="goal-report-card"]');
    assert(completedCard?.getAttribute("data-execution-id") === "execution-completed", "visible result belongs to the completed execution");
    const openings = openedTabs.length;
    await act(async () => completedCard?.querySelector<HTMLButtonElement>('[data-testid="goal-report-card-open-btn"]')?.click());
    assert(openedTabs.length === openings + 1 && openedTabs.at(-1)?.sessionId === "report-session",
      "completed result retains its session-owned work panel action");
    const msg = (id: string, content = id, extra: Partial<UiMessage> = {}): UiMessage => ({
      id, role: "assistant", content, createdAt: "2026-10-07T00:00:00Z", status: "complete", ...extra,
    });
    const narration = (id: string, text: string): AssistantTurnPart => ({ kind: "message", message: msg(id, text) });
    const thought = (id: string): AssistantTurnPart => ({ kind: "activity", items: [{ kind: "thinking", message: msg(id, "", { thinking: `Verified reasoning ${id}` }) }] });
    const dispatchMessages = ["Alex", "Sam", "Tina"].map((name, index) => msg(`timeline-create-${index}`, "", {
      role: "tool", toolName: "task_create", toolStatus: "success", toolCallId: `timeline-call-${index}`,
      toolArgs: { subject: `Verified ${name} research`, ownerMemberName: name },
      toolResult: { taskId: `timeline-task-${index}`, subject: `Verified ${name} research`, status: "completed", ownerMemberName: name },
    }));
    const dispatchPart: AssistantTurnPart = { kind: "activity", items: dispatchMessages.map(message => ({ kind: "tool", message })) };
    const referenceEntry: AssistantTurnEntry = { kind: "assistant-turn", id: "timeline-turn", parts: [
      thought("timeline-think-before"), narration("timeline-before", "I will dispatch three researchers to inspect the source."), dispatchPart,
      thought("timeline-think-after-one"), thought("timeline-think-after-two"),
      narration("timeline-after", "All three researchers returned verified findings. Here is the complete plan."),
    ] };
    const baseSnapshot = await api.getTeamSnapshot({ teamSessionId: "team-session" });
    let timelineSnapshot: TeamSnapshot = {
      ...baseSnapshot,
      members: [...baseSnapshot.members, ...["Sam", "Tina"].map((name, index) => ({
        ...baseSnapshot.members[0], name: `researcher-${index}`, memberSessionId: `timeline-member-${index}`,
        presentation: { role: "researcher" as const, displayName: name },
      }))],
      tasks: [...baseSnapshot.tasks, ...dispatchMessages.map((message, index) => ({
        ...baseSnapshot.tasks[0], taskId: `timeline-task-${index}`, subject: `Verified ${["Alex", "Sam", "Tina"][index]} research`,
        status: "completed" as const, ownerMemberName: index === 0 ? "researcher" : `researcher-${index - 1}`,
        ownerSessionId: index === 0 ? "member-session" : `timeline-member-${index - 1}`,
      }))],
    };
    const timelineListeners = new Set<Parameters<typeof api.onTeamChanged>[0]>();
    api.getTeamSnapshot = async () => timelineSnapshot;
    api.onTeamChanged = listener => { timelineListeners.add(listener); return () => timelineListeners.delete(listener); };
    const timelineIndex = buildTeamDispatchIndex(dispatchMessages, "team-session");
    const renderTimeline = (entry = referenceEntry, isActive = false, proposals: readonly PlanProposal[] = [], withCards = true, index: TeamDispatchIndex = timelineIndex) =>
      createElement(I18nextProvider, { i18n }, createElement(TeamDispatchContext.Provider, {
        value: withCards ? index : { cardsByMessageId: new Map(), cardsByTaskId: new Map() },
      }, createElement(AssistantTurn, { entry, isActive, proposals, runtimeActivity: { phase: "waiting-model", since: Date.now() } })));
    const inOrder = (elements: Array<Element | null>) => elements.every((element, index) => Boolean(element) &&
      (index === 0 || Boolean(elements[index - 1]!.compareDocumentPosition(element!) & Node.DOCUMENT_POSITION_FOLLOWING)));
    await act(async () => { useAppStore.setState({ settings: { ...useAppStore.getState().settings, thinkingDisplayMode: "detailed", smoothStreaming: false } }); root.render(renderTimeline()); });
    await until(() => container.querySelectorAll(".team-dispatch-card").length === 3, "three chronological dispatch cards");
    assert(!container.querySelector(".turn-process"), "Team turn must not retain the whole-turn fold");
    const thinkingRows = [...container.querySelectorAll(".tool-row.thinking")];
    assert(thinkingRows.length === 3, "reference retains three separate thinking rows");
    assert(inOrder([thinkingRows[0], container.querySelector('[data-message-id="timeline-before"]'),
      ...container.querySelectorAll(".team-dispatch-card"), thinkingRows[1], thinkingRows[2],
      container.querySelector('[data-message-id="timeline-after"]')]), "reference thinking/narration/card chronology");
    for (const message of dispatchMessages) {
      const card = container.querySelector(`[data-message-id="${message.id}"]`);
      assert(card?.classList.contains("team-dispatch-card"), "absorbed tool must map to its card for search");
      assert(card?.querySelectorAll("button").length === 1, "card retains one navigation control");
      assert(!container.querySelector(`.tool-row[data-message-id="${message.id}"]`), "successful anchor raw row must be absorbed");
    }
    const openedBeforeTimeline = openedTabs.length;
    await act(async () => container.querySelector<HTMLButtonElement>(".team-dispatch-card button")?.click());
    assert(openedTabs.length === openedBeforeTimeline + 1, "timeline card opens exactly one task target");
    assert(JSON.stringify(openedTabs.at(-1)?.tab.teamTarget).includes("timeline-task-0"), "timeline navigation keeps original task id");
    const retainedCard = container.querySelector('.team-dispatch-card');
    const retainedControl = retainedCard?.querySelector<HTMLButtonElement>('button');
    retainedControl?.focus();
    timelineSnapshot = { ...timelineSnapshot, revision: 2, tasks: timelineSnapshot.tasks.map(task =>
      task.taskId === "timeline-task-0" ? { ...task, status: "in_progress" } : task) };
    await act(async () => {
      for (const notify of timelineListeners) notify({ teamSessionId: "team-session", revision: 2, reason: "task" });
    });
    await until(() => retainedCard?.getAttribute('data-state') === "in_progress", "live snapshot updates the timeline card");
    assert(container.querySelector('.team-dispatch-card') === retainedCard, "status update keeps the anchored card DOM identity");
    assert(retainedCard?.getAttribute('data-state') === "in_progress", "status update reaches the card in place");
    assert(document.activeElement === retainedControl, "status update keeps the focused card control");
    const cleanupSearch = installTranscriptSearchFocus({
      target: { sessionId: "team-session", messageId: dispatchMessages[0].id, query: "ownerMemberName", requestId: 1 },
      source: JSON.stringify(dispatchMessages[0].toolArgs), scroller: container, content: container,
      position: { current: { requestId: 0, alignUntil: 0 } }, onNavigate: () => {},
    });
    assert(container.querySelector(".team-dispatch-card.transcript-search-source-match"), "source-only tool search highlights its card");
    cleanupSearch?.();
    await act(async () => { useAppStore.setState({ settings: { ...useAppStore.getState().settings, thinkingDisplayMode: "compact" } }); });
    assert(!container.querySelector(".tool-row.thinking"), "Compact keeps completed thinking hidden");
    assert(container.querySelector('[data-message-id="timeline-before"]') && container.querySelector('[data-message-id="timeline-after"]'), "Compact keeps every narration visible");
    assert(container.querySelectorAll(".team-dispatch-card").length === 3, "Compact retains all task cards");
    await act(async () => { useAppStore.setState({ settings: { ...useAppStore.getState().settings, thinkingDisplayMode: "detailed" } }); root.render(renderTimeline(referenceEntry, false, [], false)); });
    assert(container.querySelector(".turn-process"), "ordinary Detailed turn keeps its whole-turn fold");
    await act(async () => { useAppStore.setState({ settings: { ...useAppStore.getState().settings, thinkingDisplayMode: "compact" } }); });
    assert(!container.querySelector(".turn-process") && container.querySelector('[data-message-id="timeline-before"]'), "ordinary Compact keeps the existing chronological path");
    await act(async () => { useAppStore.setState({ settings: { ...useAppStore.getState().settings, thinkingDisplayMode: "detailed" } }); root.render(renderTimeline({ ...referenceEntry, parts: referenceEntry.parts.slice(0, 3) }, true)); });
    assert(container.querySelector(".team-timeline-runtime[role=status]"), "cards-last active turn needs a real runtime tail");
    assert(!container.querySelector(".tool-row-name.running, .tool-activity-label.running"), "earlier finished thinking must not look active");
    const spawning = msg("timeline-spawn", "", { role: "tool", toolName: "spawn_teammate", toolStatus: "running" });
    await act(async () => root.render(renderTimeline({ ...referenceEntry, parts: [...referenceEntry.parts, { kind: "activity", items: [{ kind: "tool", message: spawning }] }] }, true)));
    assert(inOrder([container.querySelector('[data-message-id="timeline-after"]'), container.querySelector(".team-dispatch-joining")]), "joining row follows the true tail");
    assert(!container.querySelector(".team-timeline-runtime"), "joining feedback does not duplicate runtime tail");
    const failed = msg("timeline-failed", "Permission denied", { role: "tool", toolName: "task_create", toolStatus: "denied", isError: true });
    await act(async () => root.render(renderTimeline({ ...referenceEntry, parts: [...referenceEntry.parts, { kind: "activity", items: [{ kind: "tool", message: failed }] }] })));
    assert(container.querySelector('.tool-row[data-message-id="timeline-failed"]')?.textContent?.toLowerCase().includes("denied"), "failed non-anchor tool remains visibly discoverable");
    const read = msg("timeline-read", "Read complete", { role: "tool", toolName: "Read", toolStatus: "success", toolArgs: { path: "source.ts" } });
    await act(async () => root.render(renderTimeline({ ...referenceEntry, parts: [...referenceEntry.parts, { kind: "activity", items: [{ kind: "tool", message: read }, { kind: "tool", message: failed }] }] })));
    assert(container.querySelector('.process-activity-group.grouped .turn-process-error'), "closed non-anchor group keeps a visible failure signal");
    const submit = msg("timeline-submit", "", { role: "tool", toolName: "SubmitPlan", toolStatus: "success", toolCallId: "timeline-submit-call" });
    const timelineProposal: PlanProposal = { ...oldProposal, kind: "plan", id: "timeline-proposal", title: "Timeline plan", status: "pending", turnId: referenceEntry.id, toolCallId: submit.toolCallId!, createdAt: submit.createdAt };
    const sectionEntry: AssistantTurnEntry = { ...referenceEntry, parts: [...referenceEntry.parts,
      { kind: "activity", items: [{ kind: "tool", message: submit }] }, narration("timeline-second-section", "Continuing after the plan checkpoint.")] };
    await act(async () => root.render(renderTimeline(sectionEntry, false, [timelineProposal])));
    assert(inOrder([container.querySelector('[data-message-id="timeline-after"]'), container.querySelector('[data-testid="plan-approval-bar"]'), container.querySelector('[data-message-id="timeline-second-section"]')]), "approval stays after its own section");
    timelineSnapshot = { ...timelineSnapshot, revision: 3, tasks: timelineSnapshot.tasks.map(task =>
      task.taskId === "timeline-task-0" ? { ...task, status: "completed" } : task) };
    await act(async () => {
      for (const notify of timelineListeners) notify({ teamSessionId: "team-session", revision: 3, reason: "task" });
      root.render(renderTimeline());
    });
    assert(!container.querySelector(".team-dispatch-joining, .team-timeline-runtime"), "settled timeline has no live row");
    const screenshotProposal = { ...newProposal, executionId: "screenshot-execution" } as PlanProposal;
    await act(async () => { root.render(createElement(Fragment, null, renderAll(screenshotProposal, "screenshot-session", true), renderTimeline())); });
    await until(() => container.querySelector(".goal-progress-capsule-text")?.textContent?.trim() === "1/1", "ready progress for screenshot");
    await act(async () => container.querySelector<HTMLButtonElement>(".goal-progress-toggle-btn")?.click());
    await until(() => container.textContent?.includes("Screenshot step") === true, "expanded goal for screenshot");
    assert(Boolean(container.querySelector(".goal-progress-expanded-content")), "expanded step list must be visible in the screenshot");
    assert(container.querySelector(".goal-progress-toggle-btn")?.textContent?.trim() === "Show less", "expanded goal toggle must use the English catalog key");
    assert(Boolean(container.querySelector('[data-testid="goal-progress-bar"]')), "running goal progress should remain visible for the evidence capture");
    await act(async () => root.render(renderTimeline()));
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
  return { ok: true, cardHeight, reducedMotion: window.matchMedia("(prefers-reduced-motion: reduce)").matches, scenarios: ["goal execution and session switch", "cross-session event isolation", "stale report event", "out-of-order progress revisions", "ready report completion", "interruption without a result card or stuck progress", "completed report navigation", "single task navigation", "expert joining feedback", "Team chronological transcript", "Compact and ordinary turn preservation", "card search/navigation", "live tail and section approval"] };
};
