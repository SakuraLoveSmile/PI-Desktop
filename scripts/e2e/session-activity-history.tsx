import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import { createInstance } from "i18next";
import { I18nextProvider } from "react-i18next";
import { en } from "@pi-desktop/i18n";
import type { SessionDetail } from "@pi-desktop/shared";
import { SessionActivity } from "../../apps/desktop/src/features/chat/activity/SessionActivity";
import { useAppStore } from "../../apps/desktop/src/stores/app-store";

declare global { var sessionActivityHistoryProbe: (session: SessionDetail) => Promise<{ ok: boolean; checks: string[] }> }

/** Production component, hook, reader and preload API; no synthetic aggregate. */
globalThis.sessionActivityHistoryProbe = async (session) => {
  const checks: string[] = [];
  const check = (condition: unknown, name: string) => {
    if (!condition) throw new Error(name);
    checks.push(name);
  };
  check(session.messages.length === 5, "renderer receives only the last five messages");
  check(session.messages.every((message) => message.id.startsWith("tail-")), "old evidence is absent from the renderer transcript");
  const i18n = createInstance();
  await i18n.init({ lng: "en", resources: { en: { translation: en } }, interpolation: { escapeValue: false } });
  const initial = useAppStore.getState();
  const host = document.createElement("div");
  host.style.cssText = "width:340px;height:850px;overflow:auto;background:var(--ds-bg-primary)";
  document.body.append(host);
  const errors: unknown[] = [];
  const root = createRoot(host, { onUncaughtError: (error) => errors.push(error) });
  const opened: string[] = [];
  flushSync(() => useAppStore.setState({
    sessions: [session], activeSessionId: session.id, messages: session.messages,
    retainedTranscripts: { [session.id]: session.messages }, runningSessions: {},
    planHistory: {}, pendingPlans: {}, pendingPermissions: {}, planCheckpoints: {},
    sessionHistory: { [session.id]: { hasMoreBefore: true, messageStart: 63 } },
    openWorkPanelTabForSession: (id, tab) => { opened.push(`${id}:${tab.kind}:${tab.resource ?? ""}`); },
  }));
  flushSync(() => root.render(<I18nextProvider i18n={i18n}><SessionActivity sessionId={session.id}
    messages={session.messages} visible rangeLimited /></I18nextProvider>));
  const frame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  const until = async (predicate: () => boolean, label: string) => {
    const deadline = performance.now() + 10_000;
    while (!predicate()) {
      if (errors.length) throw errors[0];
      if (performance.now() > deadline) throw new Error(`${label}: ${host.textContent}`);
      await frame();
    }
  };
  const click = (selector: string | Element | null) => {
    const button = typeof selector === "string" ? host.querySelector(selector) : selector;
    if (!(button instanceof HTMLButtonElement)) throw new Error(`Missing button: ${selector}`);
    flushSync(() => button.click());
  };
  try {
    await until(() => host.querySelector('[data-activity-group="outputs"] .session-activity-group-count')?.textContent === "66", "complete paginated Host outputs load");
    check(host.querySelector('[data-activity-group="agents"] .session-activity-group-count')?.textContent === "1", "old Task remains in the overview");
    check(host.querySelector('[data-activity-group="sources"] .session-activity-group-count')?.textContent === "1", "old hosted-search source remains in the overview");
    check(host.textContent?.includes("Historical reviewer"), "Task identity is rendered from Host history");
    const delegateStatus = host.querySelector('.subagent-activity-status')?.textContent?.trim();
    if (delegateStatus !== i18n.t("panel.activity.status.completed")) throw new Error(`persisted Task terminal settlement renders ${delegateStatus ?? "no status"}, expected completed`);
    checks.push("persisted Task terminal settlement renders completed");
    click('[data-activity-group="outputs"] .session-activity-disclosure');
    click('[data-activity-group="sources"] .session-activity-disclosure');
    click('[data-activity-group="outputs"] .session-activity-show-all');
    await frame();
    check(host.textContent?.includes("old-result.txt"), "old Write output is visible with only tail messages loaded");
    check(host.textContent?.includes("example.com"), "old search domain is visible with only tail messages loaded");
    check(!host.textContent?.includes(i18n.t("panel.activity.loadedMessagesOnly")), "complete aggregate does not claim loaded-window scope");
    check(!host.querySelector('[role="alert"]'), "production aggregate transport has no error banner");
    click('[data-activity-group="agents"] [data-activity-id]');
    check(opened.some((entry) => entry.includes(":subagent:")), "historical delegate opens its detail tab");
    click([...host.querySelectorAll('[data-activity-group="outputs"] [data-activity-id]')].find((element) => element.textContent?.includes("old-result.txt")) ?? null);
    check(opened.some((entry) => entry.endsWith(":file:/isolated/old-result.txt")), "historical output opens its literal file path");
    // Keep the successful result mounted for the main-process screenshot.
    globalThis.addEventListener("pagehide", () => { root.unmount(); host.remove(); useAppStore.setState(initial); }, { once: true });
    return { ok: true, checks };
  } catch (error) {
    flushSync(() => root.unmount()); host.remove(); useAppStore.setState(initial);
    throw error;
  }
};
