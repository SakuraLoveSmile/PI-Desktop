import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import { createInstance } from "i18next";
import { I18nextProvider } from "react-i18next";
import type { TeamLaunchReview } from "@pi-desktop/shared";
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
      description: "Review a fixed task",
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
    lng: "en",
    resources: { en: { translation: catalogs.en } },
    interpolation: { escapeValue: false },
  });
  globalThis.__teamReviewStore = {
    providers: [
      { id: "provider-1", name: "Provider One", models: [{ id: "model-1" }, { id: "model-2", alias: "Model Two" }] },
      { id: "provider-2", name: "Provider Two", models: [{ id: "model-3" }] },
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
    flushSync(() => root.render(
      <I18nextProvider i18n={i18n}>
        <TeamLaunchReviewPanel
          teamSessionId={teamSessionId}
          review={value}
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

  render("team-1", currentReview);
  assert(select("review-provider-researcher").value === "provider-removed", "missing provider ID was replaced");
  assert(select("review-model-researcher").value === "model-removed", "missing model ID was replaced");
  assert(host.textContent?.includes("Unavailable provider (provider-removed)"), "missing route ID is not visible");

  shouldRejectInvalid = true;
  choose(select("review-provider-researcher"), "provider-1");
  await waitFor(() => calls.some((call) => call.method === "update"), "provider edit reached API");
  await waitFor(() => select("review-model-researcher").value === "model-1", "provider edit model selection");
  await waitFor(() => !select("review-model-researcher").disabled, "provider edit finished saving");
  choose(select("review-model-researcher"), "model-2");
  await waitFor(() => Boolean(host.querySelector('[role="alert"]')), "invalid route error rendered");
  assert(select("review-provider-researcher").value === "provider-1", "rejected update changed provider binding");
  assert(select("review-model-researcher").value === "model-1", "rejected update did not restore Host binding");
  assert(host.textContent?.includes("Invalid model route selection."), "route error was not localized");

  const confirm = host.querySelector<HTMLButtonElement>('[data-testid="team-launch-review-confirm-btn"]');
  assert(confirm, "missing confirm action");
  confirm.click();
  await waitFor(() => calls.some((call) => call.method === "confirm"), "review confirmation sent");
  await waitFor(() => host.textContent?.includes("Confirmed") ?? false, "confirmation response applied");
  const updateCall = calls.find((call) => call.method === "update");
  const confirmCall = calls.find((call) => call.method === "confirm");
  assert(updateCall?.args[2] === 5, "first edit did not use displayed CAS revision");
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
  assert(refreshes === 2, "stale response triggered a refresh for the new team");

  pendingUpdate = null;
  await waitFor(() => !select("review-provider-researcher").disabled, "new review became editable");
  const cancel = host.querySelector<HTMLButtonElement>('[data-testid="team-launch-review-cancel-btn"]');
  assert(cancel, "missing cancel action");
  cancel.click();
  await waitFor(() => host.textContent?.includes("Cancelled") ?? false, "review cancellation reflected");
  const cancelCall = calls.find((call) => call.method === "cancel");
  assert(cancelCall?.args[0] === "team-new" && cancelCall.args[2] === 11, "cancel used stale team or revision");
  assert(cancelRevision === 11, "cancel did not carry current CAS revision");
  root.unmount();
  host.remove();
  return { ok: true, calls: calls.map(({ method, args }) => ({ method, revision: args[2] })), refreshes };
};
