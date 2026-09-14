/**
 * Renderer half of the runnable native side-chat journey
 * (`pnpm test:e2e:native-side-chat`).
 *
 * Drives the real app store, real session/queue/events slices, the real
 * SideChatTab panel and the real SearchDialog over the real preload bridge.
 * The Electron main process hosts the real NativePiSessionService with a
 * synthetic loopback-free model runtime; every assertion compares observable
 * store/DOM/durable-file state, never a stubbed copy of the feature.
 */
import { createRoot } from "react-dom/client";
import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import { catalogs, flattenCatalog } from "@pi-desktop/i18n";
import { useAppStore } from "../../apps/desktop/src/stores/app-store";
import { api } from "../../apps/desktop/src/lib/api";
import { SideChatTab } from "../../apps/desktop/src/components/workpanel/SideChatTab";
import { SearchDialog } from "../../apps/desktop/src/components/SearchDialog";

// The production renderer initializes i18n in main.tsx; this probe renders the
// real components, so it must provide the same locale resources.
void i18n.use(initReactI18next).init({
  lng: "en",
  fallbackLng: "en",
  resources: Object.fromEntries(
    Object.entries(catalogs).map(([lng, catalog]) => [
      lng,
      { translation: flattenCatalog(catalog as unknown as Record<string, unknown>) },
    ]),
  ),
  interpolation: { escapeValue: false },
});

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function until<T>(fn: () => T | undefined | false | null, timeout = 25_000): Promise<T> {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    const value = fn();
    if (value) return value as T;
    await sleep(40);
  }
  throw new Error(`probe timeout after ${timeout}ms`);
}

function setValue(
  element: HTMLTextAreaElement | HTMLInputElement,
  value: string,
): void {
  const prototype =
    element instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(prototype, "value")!.set!.call(element, value);
  element.dispatchEvent(new Event("input", { bubbles: true }));
}

type ProbeResult = {
  ok: boolean;
  checks: { name: string; ok: boolean; detail?: string }[];
  error?: string;
};

(globalThis as { nativeSideChatProbe?: () => Promise<ProbeResult> }).nativeSideChatProbe =
  async (): Promise<ProbeResult> => {
    const checks: ProbeResult["checks"] = [];
    const check = (name: string, ok: boolean, detail?: string) => {
      checks.push({ name, ok: Boolean(ok), ...(detail ? { detail } : {}) });
      if (!ok) throw new Error(name);
    };
    const rootElements: HTMLElement[] = [];
    const bridge = (window as any).piDesktop;
    const offAgentEvents = api.onAgentEvent((envelope) =>
      useAppStore.getState().handleAgentEvent(envelope),
    );
    try {
      const { sessions } = await api.listSessions();
      const parent = sessions.find(
        (session) =>
          session.source === "pi-native" && String(session.title) === "hello",
      );
      check("native parent listed", Boolean(parent), JSON.stringify(sessions.map((s) => s.title)));
      const parentDetail = await api.getSession(parent!.id);
      check(
        "parent transcript loaded",
        (parentDetail.session?.messages?.length ?? 0) >= 2,
        String(parentDetail.session?.messages?.length),
      );
      useAppStore.setState({
        sessions,
        activeSessionId: parent!.id,
        activeProjectPath: parent!.projectPath,
        workspace: parent!.projectPath
          ? { path: parent!.projectPath, name: "fixture-project" }
          : null,
        messages: parentDetail.session!.messages!,
        page: "chat",
        runningSessions: {},
        sideChats: {},
        sideChatTranscripts: {},
        toasts: [],
        queuedPrompts: {},
      } as any);

      const queueCalls: unknown[] = [];
      const originalQueuePrompt = api.queuePrompt;
      api.queuePrompt = (async (...args: unknown[]) => {
        queueCalls.push(args);
        throw new Error("native child must not use the Desktop queue");
      }) as typeof api.queuePrompt;

      const childId = await useAppStore.getState().openSideChat("a1");
      check("side chat opened from anchor", Boolean(childId), String(childId));
      const rows = () =>
        useAppStore.getState().sideChatTranscripts[childId!] ?? [];
      check("anchored history seeded whole", rows().length === 2, JSON.stringify(rows().map((r) => r.id)));
      const childSummary = () =>
        useAppStore.getState().sessions.find((session) => session.id === childId);
      check("child title is the side-chat title", String(childSummary()?.title).startsWith("Side chat"), String(childSummary()?.title));

      const panelHost = document.createElement("div");
      document.body.appendChild(panelHost);
      rootElements.push(panelHost);
      createRoot(panelHost).render(<SideChatTab sessionId={childId!} />);
      await until(() => document.querySelector(".side-chat"));
      await until(() => document.querySelector(".side-chat-thread")?.textContent?.includes("first answer"));
      check("panel paints the anchored answer", true);

      const composer = () => document.querySelector("form.side-chat-composer") as HTMLFormElement;
      const textarea = () => document.querySelector("textarea.side-chat-input") as HTMLTextAreaElement;

      setValue(textarea(), "probe question");
      composer().dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      const sendOutcome = await until(() => {
        if (rows().some((row) => row.status === "streaming" && String(row.content).length > 0)) {
          return "streaming";
        }
        const failed =
          rows().some((row) => row.status === "error") ||
          useAppStore.getState().toasts.length > 0;
        return failed
          ? `failed:${JSON.stringify({
              rows: rows().map((row) => [row.role, row.status, row.error?.message]),
              toasts: useAppStore.getState().toasts.map((toast) => toast.message),
            })}`
          : false;
      });
      check("reply streams progressively into the panel", sendOutcome === "streaming", sendOutcome);
      const streamingId = rows().find((row) => row.status === "streaming")!.id;
      await until(() => document.querySelector(".side-chat-thread")?.textContent?.includes("fixture reply"));
      check("reply streams progressively into the panel", true);

      // A send while the child is running is rejected before the Desktop queue
      // and never overwrites text typed after the failed submission.
      setValue(textarea(), "typed while running");
      composer().dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      await until(() => useAppStore.getState().toasts.length > 0 || rows().some((row) => row.status === "error"));
      await sleep(150);
      check("busy send keeps the newer draft", textarea().value === "typed while running", textarea().value);
      check(
        "busy send surfaces a toast",
        useAppStore.getState().toasts.some((toast) => /still replying/.test(toast.message)),
        JSON.stringify(useAppStore.getState().toasts.map((toast) => toast.message)),
      );
      check("native send never used the Desktop queue", queueCalls.length === 0);

      await until(() => rows().some((row) => row.role === "assistant" && row.status === "complete" && row.id !== streamingId));
      await until(() => !rows().some((row) => row.status === "streaming"));
      const assistantRows = rows().filter((row) => row.role === "assistant");
      check(
        "provisional row re-keyed to exactly one durable row",
        assistantRows.length === 2 &&
          assistantRows.some((row) => row.id === streamingId) === false,
        JSON.stringify(rows().map((row) => [row.role, row.id, row.status])),
      );
      check(
        "durable user acknowledgement",
        rows().filter((row) => row.role === "user").length === 2,
        JSON.stringify(rows().map((row) => [row.role, row.id])),
      );
      const parentBytes = await bridge.invoke("probe.parentBytes");
      check(
        "parent bytes unchanged after fork and turn",
        parentBytes.ok && parentBytes.data.hash === parentBytes.data.initial,
        JSON.stringify(parentBytes),
      );

      // Stop: durable user row stays, no provisional row survives settling.
      setValue(textarea(), "probe stop");
      composer().dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      await until(() => rows().some((row) => row.status === "streaming" && String(row.content).length > 0));
      await useAppStore.getState().abortSession(childId!);
      await until(() => !rows().some((row) => row.status === "streaming"));
      check(
        "stop keeps the durable user row",
        rows().some((row) => row.role === "user" && String(row.content).includes("probe stop")),
        JSON.stringify(rows().map((row) => [row.role, row.content])),
      );
      check("stop leaves no provisional row", !rows().some((row) => row.status === "streaming"));

      // Close: only the renderer registration goes away.
      useAppStore.getState().closeSideChat(childId!);
      check("close removes the panel registration", !useAppStore.getState().sideChats[childId!]);
      await useAppStore.getState().refreshSessions();
      const listedChild = () =>
        useAppStore.getState().sessions.find((session) => session.id === childId);
      check("child stays in the session list after close", Boolean(listedChild()));
      check(
        "child keeps its project label",
        listedChild()?.projectPath === parent!.projectPath,
        String(listedChild()?.projectPath),
      );

      // Global search: title and project label both find the durable child.
      const searchHost = document.createElement("div");
      document.body.appendChild(searchHost);
      rootElements.push(searchHost);
      createRoot(searchHost).render(<SearchDialog open onClose={() => undefined} />);
      const searchInput = await until(
        () => document.querySelector("input.search-input") as HTMLInputElement | null,
      );
      setValue(searchInput!, "side chat");
      await sleep(250);
      check("title search finds the child", document.body.textContent?.includes("Side chat:") === true);
      setValue(searchInput!, "fixture-project");
      await sleep(250);
      check("project search finds the child", document.body.textContent?.includes("fixture-project") === true);

      // Ordinary reopen as a conversation (fresh IPC detail read).
      await useAppStore.getState().selectSession(childId!);
      await until(() => useAppStore.getState().activeSessionId === childId);
      await until(() => useAppStore.getState().messages.length >= rows().length);
      const reopened = useAppStore.getState().messages;
      check(
        "reopen loads the durable history",
        reopened.some((row) => row.role === "user") &&
          reopened.some((row) => row.role === "assistant" && String(row.content).includes("fixture reply")),
        JSON.stringify(reopened.map((row) => [row.role, row.id, row.status])),
      );
      check("reopen has no provisional row", !reopened.some((row) => row.status === "streaming"));

      // Wrong cases against the real service: foreign lease and long branch.
      const busy = await bridge.invoke("probe.forkBusy");
      check(
        "foreign lease blocks fork",
        busy.ok && busy.data.code === "NATIVE_PI_SESSION_BUSY",
        JSON.stringify(busy),
      );
      const long = await bridge.invoke("probe.forkLong");
      check(
        "long branch child returns the whole transcript",
        long.ok &&
          long.data.count === 520 &&
          long.data.hasMoreBefore === false &&
          long.data.messageStart === 0,
        JSON.stringify(long),
      );

      api.queuePrompt = originalQueuePrompt;
      return { ok: true, checks };
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? (error.stack ?? error.message) : String(error),
        checks,
      };
    } finally {
      offAgentEvents();
      for (const element of rootElements) element.remove();
    }
  };
