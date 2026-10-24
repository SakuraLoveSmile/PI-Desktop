import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import { catalogs, flattenCatalog } from "@pi-desktop/i18n";
import type { AppNotification, NotificationListResult, SessionSummary } from "@pi-desktop/shared";
import { NotificationCenter } from "../../apps/desktop/src/components/NotificationCenter";
import { api } from "../../apps/desktop/src/lib/api";
import { useAppStore } from "../../apps/desktop/src/stores/app-store";

declare global {
  interface Window {
    notificationFixture: { action(name: string, input?: unknown): Promise<unknown> };
    notificationInboxProbe(options?: { reloadOnly?: boolean }): Promise<unknown>;
  }
}
await i18n.use(initReactI18next).init({ lng: "en", fallbackLng: "en", keySeparator: false,
  resources: { en: { translation: flattenCatalog(catalogs.en) } }, interpolation: { escapeValue: false } });
const root = createRoot(document.getElementById("root")!);
const action = (name: string, input?: unknown) => window.notificationFixture.action(name, input);
const unsubscribe = api.onNotificationChanged((notification) => useAppStore.getState().receiveNotification(notification));
const frame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }
async function until(predicate: () => boolean, message: string) {
  const deadline = performance.now() + 5000;
  while (!predicate()) { if (performance.now() > deadline) throw new Error(message); await frame(); }
  await frame();
}
const trigger = () => document.querySelector<HTMLButtonElement>(".notification-trigger")!;
const rows = () => Array.from(document.querySelectorAll<HTMLButtonElement>(".notification-item"));
const row = (id: string) => rows().find((button) => button.dataset.notificationId === id);
const dialog = () => document.querySelector("#notification-popover");
const state = () => useAppStore.getState();
type ShellBadgeResult = { requestedCount: number; accepted: boolean; platform: string; nativeCount: number };
const shellBadgeChecks: ShellBadgeResult[] = [];
async function open() {
  flushSync(() => trigger().click());
  await until(() => !!dialog() && !document.querySelector(".notification-action:disabled:not(:last-child)"), "Popover opens and refresh finishes");
}
function filter(value: "all" | "unread") {
  const buttons = document.querySelectorAll<HTMLButtonElement>(".notification-filter");
  flushSync(() => buttons[value === "all" ? 0 : 1].click());
}
async function expectBadge(count: number) {
  await until(() => state().unreadNotificationCount === count, "Store unread count is " + count);
  const shellBadge = await action("dock") as ShellBadgeResult;
  assert(typeof shellBadge.accepted === "boolean", "Native shell reports whether the badge API is supported");
  assert(shellBadge.requestedCount === count, "Production shell badge requests unread count " + count);
  if (shellBadge.accepted) {
    assert(shellBadge.nativeCount === count, "Accepted native shell unread count equals " + count);
  }
  shellBadgeChecks.push(shellBadge);
  const badge = document.querySelector(".notification-badge");
  assert(count ? badge?.textContent === String(count) : !badge, "Bell unread count equals the requested shell count");
}
async function create(title: string, failed = false) {
  const result = await action("create", { title, failed }) as { session: SessionSummary; notification: AppNotification };
  useAppStore.setState({ sessions: [...state().sessions, result.session] });
  await until(() => state().notifications.some((item) => item.id === result.notification.id), "Terminal result IPC event enters production store");
  return result;
}
window.notificationInboxProbe = async ({ reloadOnly = false } = {}) => {
  const checks: string[] = [];
  document.documentElement.setAttribute("data-theme", "dark");
  document.body.style.background = "var(--ds-bg-primary)";
  flushSync(() => root.render(<div style={{ position: "fixed", bottom: 20, left: 20 }}><NotificationCenter /></div>));
  const completed = await action("seed") as { session: SessionSummary; notification: AppNotification };
  useAppStore.setState({ sessions: [completed.session] });
  await open();
  await expectBadge(1);
  assert(rows().length === 1 && row(completed.notification.id), "Successful-only durable inbox must not be empty when unread count is 1");
  assert(row(completed.notification.id)?.textContent?.includes("Successful task"), "Completion title renders");
  assert(!document.querySelector(".notification-empty"), "Completion is visible instead of empty state");
  checks.push("success-only-list-recovery-shell-request-1-bell-1-visible-completion");
  if (reloadOnly) return { ok: true, checks };
  const failure = await create("Failed task", true);
  await expectBadge(2);
  await until(() => rows().length === 2, "Open popover updates live from terminal failure IPC event");
  assert(row(failure.notification.id)?.querySelector(".notification-kind-icon.failed"), "Failure keeps its distinctive presentation");
  filter("unread");
  assert(rows().length === 2, "Unread filter contains both unread outcome kinds");
  checks.push("mixed-completed-failed-live-event-unread-filter");

  flushSync(() => row(completed.notification.id)!.click());
  await until(() => state().activeSessionId === completed.session.id && !dialog(), "Click navigates to the source session and closes popover");
  await expectBadge(1);
  let durable = await action("list") as NotificationListResult;
  assert(durable.notifications.find((note) => note.id === completed.notification.id)?.readAt, "Click durably marks the completed row read");
  await open();
  assert(rows().length === 1 && row(failure.notification.id), "Unread hides read completion and retains failed task");
  filter("all");
  assert(rows().length === 2 && !row(completed.notification.id)?.classList.contains("unread"), "All retains the read completion");
  checks.push("click-mark-read-real-sqlite-source-navigation-all-unread");

  document.querySelectorAll<HTMLButtonElement>(".notification-action")[0].click();
  await until(() => state().unreadNotificationCount === 0, "Mark all read clears the store count");
  await expectBadge(0);
  durable = await action("list") as NotificationListResult;
  assert(durable.unreadCount === 0 && durable.notifications.every((note) => note.readAt), "Mark all read is durable for both kinds");
  filter("unread");
  assert(rows().length === 0 && document.querySelector(".notification-empty"), "Unread shows empty after acknowledgement");
  filter("all");
  assert(rows().length === 2, "Acknowledgement keeps both rows in All");
  checks.push("mark-all-read-both-kinds-clears-bell-and-shell-request");

  await create("Completion after acknowledgement");
  await expectBadge(1);
  await until(() => rows().length === 3, "New completion remains visible after bulk acknowledgement");
  await action("screenshot");
  document.querySelectorAll<HTMLButtonElement>(".notification-action")[1].click();
  await until(() => state().notifications.length === 0, "Clear empties production store");
  await expectBadge(0);
  durable = await action("list") as NotificationListResult;
  assert(durable.notifications.length === 0 && durable.unreadCount === 0, "Clear empties real durable inbox");
  assert(rows().length === 0 && document.querySelector(".notification-empty"), "Clear shows empty UI");
  checks.push("new-success-after-read-clear-all-real-sqlite-bell-shell-request");
  unsubscribe();
  flushSync(() => root.unmount());
  return { ok: true, checks, host: "real-stdio-sqlite", renderer: "production-notification-center-api-zustand",
    main: "production-notification-ipc-taskbar-badge", nativeBadge: {
      readback: shellBadgeChecks.every((check) => check.accepted) ? "verified" : "native-api-unavailable",
      checks: shellBadgeChecks,
    },
    nativeBadgeContract: "real setBadgeCount requests; getBadgeCount readback for accepted writes",
    providerCalls: 0, nativeNotificationsShown: 0 };
};
