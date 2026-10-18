// Production UI and store; only the sandboxed preload IPC boundary is faked.
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import { catalogs } from "@pi-desktop/i18n";
import { IPC, type PlanProposal, type PlanExecution, type SessionSummary, type ProviderPublic, type GoalReportSummary } from "@pi-desktop/shared";
import { Composer } from "../../apps/desktop/src/components/Composer";
import { ToastHost } from "../../apps/desktop/src/components/Toast";
import { GoalReportCard } from "../../apps/desktop/src/components/GoalReportCard";
import { BlockedGoalSessionCard } from "../../apps/desktop/src/features/chat/goal/BlockedGoalSessionCard";
import { GoalActivityRow } from "../../apps/desktop/src/features/chat/activity/GoalActivityRow";
import { useAppStore } from "../../apps/desktop/src/stores/app-store";

window.addEventListener("error", (event) => console.error(event.error?.stack ?? event.message));
await i18n.use(initReactI18next).init({ lng: "en", fallbackLng: "en", interpolation: { escapeValue: false },
  resources: Object.fromEntries(Object.entries(catalogs).map(([language, catalog]) => [language, { translation: catalog }])) });
const root = createRoot(document.getElementById("root")!);
function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }
type ActionCall = { channel: string; input: { sessionId?: string; executionId?: string; expectedVersion?: number; action?: string; message?: string; content?: string; modelOverride?: { providerId: string; modelId: string } } };
type FixtureState = { session: SessionSummary; execution: PlanExecution; proposal: PlanProposal; calls: ActionCall[] };
type ProbeResult = { ok: boolean; checks: string[]; boundary: string };
declare global { interface Window { goalBlockedUIProbe: () => Promise<ProbeResult>; goalBlockedUILayout: () => Promise<unknown>; } }
const t = (key: string) => String(i18n.t(key));
const control = async (action: string, input: Record<string, unknown> = {}) => {
  const result = await window.piDesktop!.invoke<FixtureState>("fixture:control", { action, ...input });
  if (!result.ok) throw new Error(result.error.message);
  return result.data;
};
const frame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
async function until(test: () => unknown, description: string) {
  const deadline = performance.now() + 5000;
  while (!test()) { if (performance.now() > deadline) throw new Error(`Timed out: ${description}; DOM: ${document.body.textContent?.slice(0, 3000)}`); await frame(); }
  await frame();
}
const card = () => document.querySelector<HTMLElement>('[data-testid="goal-blocked-card"]');
const editor = () => document.querySelector<HTMLElement>('.composer-input[role="textbox"]')!;
function click(element: Element | null | undefined) {
  assert(element instanceof HTMLButtonElement && !element.disabled, `Expected enabled button: ${element?.outerHTML}`);
  flushSync(() => element.click());
}
function cardAction(key: string) {
  return [...(card()?.querySelectorAll("button") ?? [])].find((node) => node.textContent?.trim() === t(key));
}
function typeText(text: string) {
  const input = editor(); input.focus(); input.textContent = text;
  const selection = getSelection(); const range = document.createRange(); range.selectNodeContents(input); range.collapse(false);
  selection?.removeAllRanges(); selection?.addRange(range);
  flushSync(() => input.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: text })));
}
function enter() {
  flushSync(() => editor().dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", code: "Enter", bubbles: true, cancelable: true })));
}
const providers: ProviderPublic[] = ["old-provider", "current-provider"].map((id, index) => ({ id, name: index ? "Current Provider" : "Original Provider",
  vendorKey: "custom", type: "custom", protocol: "openai", createdAt: "2026-01-01", updatedAt: "2026-01-01", supportsReasoning: false, enabled: true, hasSecret: false, authKind: "none", apiStyle: "openai-completions", baseUrl: "https://isolated.invalid", models: [
    { id: index ? "current-model" : "old-model", contextWindow: 32000, maxTokens: 4000, thinkingLevels: ["off"], defaultThinkingLevel: "off", alias: index ? "Current Model" : "Original Model" }], supportedThinkingLevels: ["off"] }));
let sessionId = "";
let executionId = "";
let revision = 0;
const emptyReports: GoalReportSummary[] = [];
function Surface({ proposal }: { proposal: PlanProposal }) {
  const reports = useAppStore((state) => state.goalReports[proposal.sessionId] ?? emptyReports);
  return <main className="e2e-goal-surface">
    <div className="session-activity"><GoalActivityRow sessionId={proposal.sessionId} proposal={proposal} visible /></div>
    <div className="chat-message-content"><BlockedGoalSessionCard sessionId={proposal.sessionId} />
      {reports.filter((report) => report.closure === "user_accepted").map((report) =>
        <GoalReportCard key={report.reportId} report={report} onOpenReport={() => {}} />)}</div>
    <Composer /><ToastHost />
  </main>;
}
async function mount(remote = false) {
  flushSync(() => root.render(null)); await frame();
  const fixture = await control("reset", { remote });
  sessionId = fixture.session.id; executionId = fixture.execution.id;
  flushSync(() => useAppStore.setState({ activeSessionId: sessionId, sessions: [fixture.session], providers,
    providerModels: Object.fromEntries(providers.map((provider) => [provider.id, provider.models.map((model) => ({ providerId: provider.id, modelId: model.id, displayName: model.alias ?? model.id, contextWindow: 32000, capabilities: ["text"], source: "user" as const }))])),
    settings: { onboardingDismissed: true, language: "en", theme: "light", defaultMode: "goal", defaultPermissionMode: "auto", enterToSend: true },
    isRunning: false, runningSessions: {}, messages: [], goalReports: {}, planCheckpoints: {}, pendingPlans: {}, planningStates: {},
    queuedPrompts: {}, pendingAsks: {}, toasts: [], version: undefined, ready: true }));
  flushSync(() => root.render(<Surface key={++revision} proposal={fixture.proposal} />));
  await until(() => card() && (remote || document.querySelector('[data-testid="goal-resume-chip"]')), "durable blocked card and resume chip");
  await until(() => document.querySelector('.session-activity-goal-report')?.textContent?.includes(t("panel.activity.goal.reportBlocked")), "blocked timeline");
}
async function calls() { return (await control("calls")).calls; }
function identity(call: ActionCall, version = 7) {
  assert(call.input.sessionId === sessionId && call.input.executionId === executionId && call.input.expectedVersion === version,
    `Action must preserve current session/execution/version: ${JSON.stringify(call)}`);
}
async function selectCurrentModel() {
  click(document.querySelector('.composer-model-thinking-chip'));
  await until(() => document.querySelector('button.composer-model-option[title="current-model"]'), "current model option");
  click(document.querySelector('button.composer-model-option[title="current-model"]'));
  await until(() => useAppStore.getState().sessions[0]?.providerId === "current-provider", "current provider saved by production store");
  if (document.querySelector('.composer-model-thinking-chip')?.getAttribute("aria-expanded") === "true") click(document.querySelector('.composer-model-thinking-chip'));
}
async function actionDone(channel: string) {
  await until(() => !card(), `${channel} removes blocked card`);
  const all = await calls(); const call = all.find((entry) => entry.channel === channel);
  assert(call, `Missing ${channel}`); return call;
}
const checks: string[] = [];
window.goalBlockedUIProbe = async () => {
  await mount();
  assert(card()!.textContent?.includes(t("goal.blocked.reasons.verdictPartial")), "Partial verdict reason visible");
  assert(card()!.textContent?.includes("M1: Local checks") && card()!.textContent?.includes("M2: User acceptance"), "M-list labels visible");
  assert(card()!.textContent?.includes("Validation unavailable in the isolated environment") && card()!.textContent?.includes("Run remaining acceptance checks"), "Draft limitations and next steps visible");
  assert(card()!.classList.contains("goal-report-card"), "Blocked card reuses existing Goal report visual container");
  checks.push("blocked reason, M-list, partial limitations and existing report layout");
  await selectCurrentModel();
  click(cardAction("goal.blocked.resume"));
  let call = await actionDone(IPC.invoke.goalResume); identity(call);
  await until(() => useAppStore.getState().sessions[0]?.mode === "agent" &&
    useAppStore.getState().sessions[0]?.permissionMode === "ask", "Host-approved mode and permission refresh immediately on resume");
  assert(useAppStore.getState().sessions[0]?.providerId === "current-provider", "Canonical refresh preserves the selected provider");
  assert(call.input.modelOverride?.providerId === "current-provider" && call.input.modelOverride?.modelId === "current-model" && call.input.message === undefined, "Continue uses current selected model");
  checks.push("Continue uses exact execution/version and current model, then refreshes Host-approved Agent/Ask settings");

  for (const method of ["enter", "send"]) {
    await mount(); await selectCurrentModel(); typeText(`Resume with ${method}`);
    if (method === "enter") enter(); else click(document.querySelector('.send-btn'));
    call = await actionDone(IPC.invoke.goalResume); identity(call);
    assert(call.input.message === `Resume with ${method}` && call.input.modelOverride?.providerId === "current-provider" && call.input.modelOverride?.modelId === "current-model", "Composer forwards text and current model");
    assert(!(await calls()).some((entry) => entry.channel === IPC.invoke.agentPrompt), "Default resume must not issue ordinary prompt");
    await until(() => editor().textContent === "", "accepted draft cleared");
  }
  checks.push("Composer Enter and Send resume same execution with draft and selected model");

  await mount(); typeText("Keep this draft after failure"); await control("failResume"); enter();
  await until(() => document.querySelector('.toast[role="alert"]')?.textContent?.includes(t("goal.blocked.actionFailed")), "resume failure is visible");
  assert(editor().textContent === "Keep this draft after failure" && card(), "Resume error retains draft and blocked card");
  assert(!(await calls()).some((entry) => entry.channel === IPC.invoke.agentPrompt), "Failed resume cannot fall through to ordinary prompt");
  call = (await calls()).find((entry) => entry.channel === IPC.invoke.goalResume)!; identity(call);
  checks.push("resume failure preserves Composer draft and reports error");

  await mount(); click(document.querySelector('[data-testid="goal-resume-chip"] button')); typeText("Ordinary message after opt-out"); enter();
  await until(() => useAppStore.getState().messages.some((message) => message.role === "user" && message.content === "Ordinary message after opt-out"), "ordinary prompt uses production optimistic transcript");
  call = (await calls()).find((entry) => entry.channel === IPC.invoke.agentPrompt)!;
  assert(call?.input.sessionId === sessionId && call.input.content === "Ordinary message after opt-out", "Opt-out uses ordinary agent prompt");
  assert(!(await calls()).some((entry) => entry.channel === IPC.invoke.goalResume), "Opt-out must not resume");
  checks.push("resume-chip opt-out routes next send through ordinary production prompt flow");

  await mount(); click(cardAction("goal.blocked.accept"));
  call = await actionDone(IPC.invoke.goalClose); identity(call);
  assert(call.input.action === "accept", "Accept is explicit CAS close");
  await until(() => document.querySelector('[data-testid="goal-report-card"]')?.textContent?.includes(t("goal.blocked.userAccepted")), "accepted report refreshed from production store");
  assert(useAppStore.getState().goalReports[sessionId][0].verdict === "partial", "Acceptance preserves non-met verdict");
  assert(document.querySelector('[data-testid="goal-report-card"]')!.textContent?.includes(t("goalReport.view.verdictPartial")), "Accepted card shows partial verdict");
  await until(() => document.querySelector('.session-activity-goal-report')?.textContent?.includes(t("panel.activity.goal.reportReady")), "timeline updates after acceptance");
  assert((await calls()).some((entry) => entry.channel === IPC.invoke.goalReportList), "Accept reloads report list through API");
  checks.push("accept refreshes user-accepted non-met report and production timeline");

  await mount(); click(cardAction("goal.blocked.abandon"));
  call = await actionDone(IPC.invoke.goalClose); identity(call);
  assert(call.input.action === "abandon", "Abandon is explicit CAS close");
  assert(!document.querySelector('[data-testid="goal-report-card"]'), "Abandon does not invent an accepted report");
  checks.push("abandon sends exact execution/version without acceptance report");

  await mount(true);
  assert(!card()!.querySelector("button") && !document.querySelector('[data-testid="goal-resume-chip"]'), "Remote blocked Goal is readonly without actions/default resume");
  assert(card()!.textContent?.includes(t("goal.blocked.remoteReadOnly")), "Remote readonly boundary is visible");
  typeText("Remote ordinary message"); click(document.querySelector('.send-btn'));
  await until(() => useAppStore.getState().isRunning, "remote ordinary prompt accepted");
  const remoteCalls = await calls();
  assert(remoteCalls.some((entry) => entry.channel === IPC.invoke.agentPrompt) && !remoteCalls.some((entry) => entry.channel === IPC.invoke.goalResume || entry.channel === IPC.invoke.goalClose), "Remote send cannot mutate blocked execution");
  checks.push("remote readonly card and Composer do not mutate blocked execution");

  await mount(); await control("restart", { version: 11 });
  await until(() => card()!.textContent?.includes("Restart recovered checkpoint"), "host restart rereads durable snapshot");
  click(cardAction("goal.blocked.resume")); call = await actionDone(IPC.invoke.goalResume); identity(call, 11);
  checks.push("host restart refresh uses restored hold version");
  await mount(); await i18n.changeLanguage("zh-CN");
  await until(() => card()!.textContent?.includes(t("goal.blocked.title")), "localized card");
  return { ok: true, checks, boundary: "Production renderer components, store and native reader; isolated fake preload IPC only. No real provider or user profile." };
};
window.goalBlockedUILayout = async () => {
  await frame(); await frame();
  const bounds = card()!.getBoundingClientRect();
  const actions = [...card()!.querySelectorAll<HTMLButtonElement>("button")].map((button) => {
    const box = button.getBoundingClientRect();
    assert(box.width > 24 && box.height >= 24 && box.left >= bounds.left && box.right <= bounds.right + 1, "Card actions stay usable inside card");
    return { text: button.textContent, width: box.width, height: box.height };
  });
  assert(document.documentElement.scrollWidth <= innerWidth + 1, `Horizontal overflow at ${innerWidth}: ${document.documentElement.scrollWidth}`);
  assert(bounds.left >= 0 && bounds.right <= innerWidth + 1 && actions.length === 3, "Card remains within viewport with three actions");
  const send = document.querySelector('.send-btn')!.getBoundingClientRect();
  assert(send.left >= 0 && send.right <= innerWidth + 1, "Composer Send remains within viewport");
  return { width: innerWidth, scrollWidth: document.documentElement.scrollWidth, cardWidth: bounds.width, actions };
};
