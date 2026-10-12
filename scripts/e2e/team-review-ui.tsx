import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import { createInstance } from "i18next";
import { I18nextProvider } from "react-i18next";
import type { TeamExecutionDecision, TeamLaunchReview } from "@pi-desktop/shared";
import { catalogs } from "@pi-desktop/i18n";
import { TeamLaunchReviewPanel } from "../../apps/desktop/src/components/workpanel/TeamLaunchReviewPanel";

declare global {
  var teamReviewUiProbe: () => Promise<unknown>;
  var __teamReviewApi: Record<string, (...args: unknown[]) => Promise<unknown>>;
  var __teamReviewStore: { providers: Array<Record<string, unknown>> };
}

const assert = (condition: unknown, message: string): asserts condition => {
  if (!condition) throw new Error(message);
};

const frame = () => new Promise<void>((resolve) => {
  const timeout = setTimeout(resolve, 50);
  requestAnimationFrame(() => {
    clearTimeout(timeout);
    resolve();
  });
});

async function waitFor(condition: () => boolean, label: string) {
  const deadline = performance.now() + 5000;
  while (!condition()) {
    assert(performance.now() < deadline, `timed out: ${label}`);
    await frame();
  }
}

function review(teamSessionId: string, reviewId: string, revision: number, providerId = "provider-removed", modelId = "model-removed"): TeamLaunchReview {
  return {
    schemaVersion: 1,
    reviewId,
    teamSessionId,
    leadTurnId: `turn-${teamSessionId}`,
    revision,
    status: "pending",
    members: [{
      name: "researcher",
      description: "负责环境与工具链约束调研。",
      presentation: { role: "researcher", displayName: "Alex" },
      contextKind: "fresh",
      selection: { providerId, modelId, thinkingLevel: "high" },
    }],
  };
}

const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
};

globalThis.teamReviewUiProbe = async () => {
  const i18n = createInstance();
  await i18n.init({
    lng: "zh-CN",
    resources: { "zh-CN": { translation: catalogs["zh-CN"] } },
    interpolation: { escapeValue: false },
  });
  globalThis.__teamReviewStore = {
    providers: [
      { id: "provider-1", name: "Provider One", enabled: true, hasSecret: true, models: [{ id: "model-1", thinkingLevels: ["high"] }, { id: "model-2", alias: "Model Two", thinkingLevels: ["low"] }] },
      { id: "provider-2", name: "Provider Two", enabled: true, hasSecret: true, models: [{ id: "model-3", thinkingLevels: ["off"] }] },
      { id: "provider-disabled", name: "Disabled", enabled: false, hasSecret: true, models: [{ id: "disabled-model", thinkingLevels: ["high"] }] },
      { id: "provider-empty", name: "Empty", enabled: true, hasSecret: true, models: [] },
      { id: "provider-generic", name: "Generic", enabled: true, hasSecret: true, models: [{ id: "generic-model", thinkingLevels: [] }] },
    ],
  };

  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const calls: Array<{ method: string; args: unknown[] }> = [];
  let refreshes = 0;
  let currentReview = review("team-1", "review-1", 5);
  let pendingUpdate: ReturnType<typeof deferred<{ review: TeamLaunchReview }>> | null = null;
  let shouldRejectInvalid = false;
  let cancelRevision = 0;

  globalThis.__teamReviewApi = {
    updateTeamLaunchReview: async (...args) => {
      calls.push({ method: "update", args: structuredClone(args) });
      if (args[0] === "team-old" && pendingUpdate) return pendingUpdate.promise;
      const selections = args[3] as Array<{ name: string; providerId: string; modelId: string; thinkingLevel: string }>;
      if (shouldRejectInvalid && selections.some((selection) => selection.modelId === "model-2")) {
        throw new Error("TEAM_MODEL_SELECTION_INVALID");
      }
      const members = currentReview.members.map((member) => ({
        ...member,
        selection: selections.find((selection) => selection.name === member.name) ?? member.selection,
      }));
      currentReview = { ...currentReview, revision: currentReview.revision + 1, members };
      return { review: structuredClone(currentReview) };
    },
    confirmTeamLaunchReview: async (...args) => {
      calls.push({ method: "confirm", args: structuredClone(args) });
      currentReview = { ...currentReview, revision: currentReview.revision + 1, status: "confirmed" };
      return { review: structuredClone(currentReview), decision: {} };
    },
    cancelTeamLaunchReview: async (...args) => {
      calls.push({ method: "cancel", args: structuredClone(args) });
      cancelRevision = Number(args[2]);
      currentReview = { ...currentReview, revision: currentReview.revision + 1, status: "cancelled" };
      return { review: structuredClone(currentReview) };
    },
  };

  const render = (teamSessionId: string, value: TeamLaunchReview) => {
    currentReview = structuredClone(value);
    const decision: TeamExecutionDecision = {
      schemaVersion: 1,
      teamSessionId,
      leadTurnId: value.leadTurnId,
      strategy: "delegate",
      reason: "环境调研与方案设计可以独立核验，需要专家分工。",
      updatedAt: "2026-10-07T00:00:00.000Z",
      taskIds: [],
      memberSessionIds: [],
      messageIds: [],
    };
    flushSync(() => root.render(
      <I18nextProvider i18n={i18n}>
        <TeamLaunchReviewPanel
          teamSessionId={teamSessionId}
          review={value}
          decision={decision}
          onReviewChanged={() => { refreshes += 1; }}
        />
      </I18nextProvider>,
    ));
  };
  const select = (testId: string) => {
    const element = host.querySelector<HTMLSelectElement>(`[data-testid="${testId}"]`);
    assert(element, `missing select ${testId}`);
    return element;
  };
  const choose = (element: HTMLSelectElement, value: string) => {
    const setValue = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")?.set;
    assert(setValue, "native select value setter is unavailable");
    setValue.call(element, value);
    element.dispatchEvent(new Event("change", { bubbles: true }));
  };

  const legacyReview = review("team-legacy", "review-legacy", 1, "provider-1", "model-1");
  legacyReview.members[0].presentation = undefined;
  legacyReview.members[0].description = "Review a fixed task";
  render("team-legacy", legacyReview);
  assert(host.querySelector(".team-launch-review-member-name")?.textContent === "researcher", "legacy routing handle was renamed");
  assert(host.querySelector(".team-launch-review-member-desc")?.textContent === "Review a fixed task", "legacy technical description was rewritten");

  render("team-1", review("team-1", "review-1", 5));
  await waitFor(() => select("review-provider-researcher").value === "provider-removed", "localized review became current");
  assert(host.querySelector(".team-launch-review-member-name")?.textContent === "调研员 Alex", "review ignored localized presentation identity");
  assert(host.querySelector(".team-launch-review-member-desc")?.textContent === "负责环境与工具链约束调研。", "Chinese expert responsibility is missing");
  assert(host.querySelector(".team-launch-review-reason-text")?.textContent === "环境调研与方案设计可以独立核验，需要专家分工。", "Chinese strategy reason is missing");
  assert(select("review-provider-researcher").value === "provider-removed", "missing provider ID was replaced");
  assert(select("review-model-researcher").value === "model-removed", "missing model ID was replaced");
  assert(host.textContent?.includes(i18n.t("team.review.missingProvider", { id: "provider-removed" })), "missing route ID is not visible");
  assert(!Array.from(select("review-provider-researcher").options).some((option) => ["provider-disabled", "provider-empty"].includes(option.value)), "review offers an unrunnable provider");

  shouldRejectInvalid = true;
  choose(select("review-provider-researcher"), "provider-1");
  await waitFor(() => calls.some((call) => call.method === "update"), "provider edit reached API");
  await waitFor(() => select("review-model-researcher").value === "model-1", "provider edit model selection");
  await waitFor(() => !select("review-model-researcher").disabled, "provider edit finished saving");
  assert(Array.from(select("review-thinking-researcher").options).map((option) => option.value).join(",") === "omit,high", "thinking menu is not bound to the selected model");
  choose(select("review-model-researcher"), "model-2");
  await waitFor(() => Boolean(host.querySelector('[role="alert"]')), "invalid route error rendered");
  assert(select("review-provider-researcher").value === "provider-1", "rejected update changed provider binding");
  assert(select("review-model-researcher").value === "model-1", "rejected update did not restore Host binding");
  assert(host.textContent?.includes(i18n.t("team.review.invalidRoute")), "route error was not localized");

  const confirm = host.querySelector<HTMLButtonElement>('[data-testid="team-launch-review-confirm-btn"]');
  assert(confirm, "missing confirm action");
  assert(confirm instanceof HTMLButtonElement && confirm.type === "button", "confirm is not a native button");
  assert(confirm.textContent?.includes("确认并启动"), "confirm action is not localized");
  confirm.click();
  await waitFor(() => calls.some((call) => call.method === "confirm"), "review confirmation sent");
  await waitFor(() => host.textContent?.includes(i18n.t("team.review.status.confirmed")) ?? false, "confirmation response applied");
  const updateCall = calls.find((call) => call.method === "update");
  const confirmCall = calls.find((call) => call.method === "confirm");
  assert(updateCall?.args[2] === 5, "first edit did not use displayed CAS revision");
  const selections = updateCall?.args[3] as Array<{ name: string }>;
  assert(selections.length === 1 && selections[0].name === "researcher", "display name replaced the routing handle in selection updates");
  assert(confirmCall?.args[2] === 6, "confirm did not use canonical revision returned by update");

  const switchReview = review("team-old", "review-old", 2, "provider-1", "model-1");
  render("team-old", switchReview);
  await waitFor(() => !select("review-provider-researcher").disabled, "old review became editable");
  pendingUpdate = deferred<{ review: TeamLaunchReview }>();
  const oldProvider = select("review-provider-researcher");
  choose(oldProvider, "provider-2");
  await waitFor(() => calls.filter((call) => call.method === "update").length === 3, "stale request started");
  const newReview = review("team-new", "review-new", 11, "provider-2", "model-3");
  render("team-new", newReview);
  pendingUpdate.resolve({ review: review("team-old", "review-old", 99, "provider-2", "model-3") });
  await frame();
  assert(select("review-provider-researcher").value === "provider-2", "stale response replaced new team provider");
  assert(select("review-model-researcher").value === "model-3", "stale response replaced new team model");
  const routeChange = calls.filter((call) => call.method === "update").at(-1);
  assert((routeChange?.args[3] as Array<{thinkingLevel: string}>)[0].thinkingLevel === "off", "provider change retained unsupported high thinking");
  assert(refreshes === 2, "stale response triggered a refresh for the new team");

  pendingUpdate = null;
  await waitFor(() => !select("review-provider-researcher").disabled, "new review became editable");
  const cancel = host.querySelector<HTMLButtonElement>('[data-testid="team-launch-review-cancel-btn"]');
  assert(cancel, "missing cancel action");
  assert(cancel instanceof HTMLButtonElement && cancel.type === "button", "cancel is not a native button");
  assert(cancel.textContent?.includes("取消提议"), "cancel action is not localized");
  cancel.click();
  await waitFor(() => host.textContent?.includes(i18n.t("team.review.status.cancelled")) ?? false, "review cancellation reflected");
  const cancelCall = calls.find((call) => call.method === "cancel");
  assert(cancelCall?.args[0] === "team-new" && cancelCall.args[2] === 11, "cancel used stale team or revision");
  assert(cancelRevision === 11, "cancel did not carry current CAS revision");
  // Repair one member without resubmitting another member's stale route.
  const repair = review("team-repair", "review-repair", 1, "provider-1", "model-1");
  repair.members.push({ name: "other", contextKind: "fresh", selection: {
    providerId: "provider-removed", modelId: "model-removed", thinkingLevel: "high",
  } });
  shouldRejectInvalid = false;
  render("team-repair", repair);
  await waitFor(() => !select("review-model-researcher").disabled, "repair review became editable");
  const updatesBeforeRepair = calls.filter((call) => call.method === "update").length;
  choose(select("review-model-researcher"), "model-2");
  await waitFor(() => calls.filter((call) => call.method === "update").length > updatesBeforeRepair && !select("review-model-researcher").disabled, "model repair saved");
  const repairCall = calls.filter((call) => call.method === "update").at(-1);
  const repairSelections = repairCall?.args[3] as Array<{ name: string; thinkingLevel: string }>;
  assert(repairSelections.length === 1 && repairSelections[0].name === "researcher", "member repair resubmitted another invalid route");
  assert(repairSelections[0].thinkingLevel === "low", "model change retained unsupported thinking");
  assert(select("review-thinking-researcher").value === "low", "adjusted effort was not displayed");
  choose(select("review-thinking-researcher"), "omit");
  await waitFor(() => select("review-thinking-researcher").value === "omit" && !select("review-thinking-researcher").disabled, "omit effort saved");
  assert(select("review-thinking-researcher").selectedOptions[0].textContent === i18n.t("extensions.subagents.thinkingOmit"), "omit label is not localized");
  render("team-generic", review("team-generic", "review-generic", 1, "provider-generic", "generic-model"));
  await waitFor(() => select("review-provider-researcher").value === "provider-generic", "generic route rendered");
  assert(Array.from(select("review-thinking-researcher").options).some((option) => option.value === "high" && !option.disabled), "generic empty binding lost manual thinking levels");
  root.unmount();
  host.remove();
  return { ok: true, calls: calls.map(({ method, args }) => ({ method, revision: args[2] })), refreshes };
};
