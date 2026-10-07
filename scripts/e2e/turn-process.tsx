import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import { createInstance } from "i18next";
import { I18nextProvider } from "react-i18next";
import { en, zhCN } from "@pi-desktop/i18n";
import type { AppSettings, UiMessage } from "@pi-desktop/shared";
import { AssistantTurn } from "../../apps/desktop/src/features/chat/transcript/AssistantTurn";
import { ThinkingDisplayModeRow } from "../../apps/desktop/src/components/settings/ThinkingDisplayModeRow";
import { buildTranscriptEntries } from "../../apps/desktop/src/lib/assistant-turns";
import { TranscriptSearchContext } from "../../apps/desktop/src/lib/transcript-search-context";
import type { TranscriptSearchTarget } from "../../apps/desktop/src/lib/transcript-reading";
import { useAppStore } from "../../apps/desktop/src/stores/app-store";

function assert(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}

const message = (
  id: string,
  role: UiMessage["role"],
  content: string,
  extra: Partial<UiMessage> = {},
): UiMessage => ({
  id,
  role,
  content,
  createdAt: "2026-09-17T00:00:00.000Z",
  ...extra,
});

/** Real mounted React components: disclosure ownership, preferences and search. */
export async function turnProcessProbe() {
  const i18n = createInstance();
  await i18n.init({
    lng: "en",
    resources: { en: { translation: en }, "zh-CN": { translation: zhCN } },
    interpolation: { escapeValue: false },
  });
  const container = document.createElement("div");
  document.body.append(container);
  const initialSettings = useAppStore.getState().settings;
  const settings: AppSettings = {
    defaultMode: "agent",
    theme: "light",
    enterToSend: true,
    onboardingDismissed: true,
  };
  flushSync(() => useAppStore.setState({ settings }));
  const errors: unknown[] = [];
  const root = createRoot(container, {
    onUncaughtError: (error) => errors.push(error),
  });
  const notes: string[] = [];
  const check = (value: unknown, name: string) => {
    assert(value, name);
    notes.push(name);
  };
  const render = (
    messages: UiMessage[],
    active = false,
    search: TranscriptSearchTarget | null = null,
    key = "turn",
  ) => {
    const entry = buildTranscriptEntries(messages).entries.find(
      (item) => item.kind === "assistant-turn",
    );
    assert(entry?.kind === "assistant-turn", "missing turn");
    flushSync(() =>
      root.render(
        <I18nextProvider i18n={i18n}>
          <TranscriptSearchContext.Provider value={search}>
            <AssistantTurn key={key} entry={entry} isActive={active} />
          </TranscriptSearchContext.Provider>
        </I18nextProvider>,
      ),
    );
    assert(!errors.length, `React error: ${errors.map(String).join("; ")}`);
  };
  const header = () =>
    container.querySelector<HTMLButtonElement>(".turn-process > button");
  const process = () => container.querySelector<HTMLElement>(".turn-process-body");
  const visible = (element: Element | null) =>
    Boolean(element?.getBoundingClientRect().height);
  const click = (element: HTMLElement | null) => {
    assert(element, "missing click target");
    flushSync(() => element.click());
  };
  const intro = message("intro", "assistant", "Inspecting the files", {
    thinking: "reasoning detail",
    status: "complete",
  });
  const read = message("read", "tool", "read output", {
    toolName: "Read",
    toolCallId: "read-call",
    toolStatus: "success",
    toolArgs: { path: "src/example.ts" },
  });
  const progress = message("progress", "assistant", "Found the problem");
  const edit = message("edit", "tool", "edit output", {
    toolName: "Edit",
    toolCallId: "edit-call",
    toolStatus: "success",
    toolArgs: { path: "src/example.ts" },
  });
  const answer = message("answer", "assistant", "The fix is ready.", {
    status: "complete",
    createdAt: "2026-09-17T00:00:03.000Z",
    responseDurationMs: 1000,
  });
  const messages = [intro, read, progress, edit, answer];
  try {
    render(messages);
    check(
      container.querySelectorAll(".turn-process").length === 1,
      "detailed wraps one process per turn",
    );
    check(
      header()?.getAttribute("aria-expanded") === "false" && !visible(process()),
      "detailed completed process starts collapsed",
    );
    check(
      visible(container.querySelector('[data-message-id="answer"]')),
      "final answer stays visible",
    );
    check(
      !visible(container.querySelector('[data-message-id="progress"]')),
      "completed progress stays hidden until expanded",
    );
    render(messages, true, null, "active-process");
    check(
      header()?.getAttribute("aria-expanded") === "true" && visible(process()),
      "active detailed process starts open",
    );
    render(messages, false, null, "active-process");
    check(
      header()?.getAttribute("aria-expanded") === "false" && !visible(process()),
      "untouched detailed process collapses on completion",
    );
    render(messages);
    click(header());
    check(
      visible(container.querySelector('[data-message-id="progress"]')),
      "user can expand completed progress",
    );
    check(
      container.querySelector('[data-message-id="edit"]')?.classList.contains("open") === true,
      "detailed opens the last tool",
    );
    check(
      container.querySelector('[data-message-id="read"]')?.classList.contains("open") !== true,
      "detailed keeps earlier tools collapsed",
    );
    check(
      container.querySelectorAll(".tool-row").length === 3,
      "detailed shows thinking and both tools in place",
    );
    render(
      [intro, { ...read, toolStatus: "error", isError: true }, answer],
      false,
      null,
      "failed-last-tool",
    );
    check(
      container.querySelector('[data-message-id="read"]')?.classList.contains("open") !== true,
      "detailed keeps a last failed tool collapsed",
    );

    const streaming = message("stream", "assistant", "Live text", {
      status: "streaming",
    });
    render([streaming], true, null, "stream");
    check(
      !header() && visible(container.querySelector('[data-message-id="stream"]')),
      "streamed answer is never delayed behind disclosure",
    );
    render([streaming, read], true, null, "stream");
    check(
      header()?.getAttribute("aria-expanded") === "true" &&
        visible(container.querySelector('[data-message-id="stream"]')),
      "detailed keeps streamed text visible after later tools",
    );
    render([intro, read, { ...answer, status: "aborted" }], false, null, "aborted");
    check(
      visible(container.querySelector('[data-message-id="answer"]')),
      "stopped partial answer remains visible",
    );
    render(
      [
        intro,
        read,
        message("failure", "assistant", "", {
          error: { code: "INTERNAL", message: "Connection failed", retryable: true },
        }),
      ],
      false,
      null,
      "error",
    );
    check(
      visible(container.querySelector('[data-message-id="failure"]')),
      "failure remains visible",
    );

    await i18n.changeLanguage("zh-CN");
    flushSync(() => useAppStore.setState({
      settings: { ...settings, thinkingDisplayMode: "compact" },
    }));
    const command = "printf 'Inspecting architecture and checking every constraint'\nnode --check src/example.ts";
    const bash = message("bash", "tool", "English command result", {
      toolName: "Bash", toolStatus: "success", toolCallId: "bash-call",
      toolArgs: { command, description: "Inspect architecture with a very long English description" },
      toolResult: { details: { stdout: "English command result", exitCode: 0 } },
    });
    const zhIntro = { ...intro, content: "我会先检查相关文件。", thinking: "Long English reasoning should remain stored" };
    const zhProgress = { ...progress, content: "已经找到原因，接下来修复。" };
    const zhAnswer = { ...answer, content: "已完成修复。" };
    const compactMessages = [zhIntro, bash, read, zhProgress, edit, zhAnswer];
    const row = (id: string) => container.querySelector<HTMLElement>(`[data-message-id="${id}"]`);
    const activityHeader = () => container.querySelector<HTMLButtonElement>(".process-activity-group.grouped > button");
    const textIsVisible = (needle: string) => [...container.querySelectorAll<HTMLElement>("span, p, code, pre, dd")]
      .some((element) => element.textContent?.includes(needle) && visible(element));
    render(compactMessages, false, null, "compact-inline");
    check(!header(), "compact does not wrap progress in a whole-turn disclosure");
    check(visible(row("intro")) && visible(row("progress")) && visible(row("answer")),
      "compact keeps Chinese progress and final answer visible");
    const firstTop = row("intro")!.getBoundingClientRect().top;
    const progressTop = row("progress")!.getBoundingClientRect().top;
    const answerTop = row("answer")!.getBoundingClientRect().top;
    check(firstTop < progressTop && progressTop < answerTop, "compact retains chronological progress order");
    check(activityHeader()?.getAttribute("aria-expanded") === "false", "compact activity defaults collapsed");
    check(!textIsVisible("Long English reasoning") && !textIsVisible("Inspecting architecture") && !textIsVisible("English command result"),
      "compact default hides English reasoning commands and outputs");
    check(activityHeader()?.textContent?.includes("2 次工具操作"), "compact group shows localized action count");
    click(activityHeader());
    check(visible(row("bash")) && !row("bash")?.classList.contains("open"), "opening an activity leaves command details folded");
    check(row("bash")?.querySelector(".tool-row-name")?.textContent === i18n.t("chat.toolRan"), "compact command action is localized");
    check(!row("bash")?.querySelector(".tool-row-summary") && !row("bash")?.querySelector(".tool-row-head-copy"),
      "compact command header omits raw instruction and copy affordance");
    click(row("bash")?.querySelector<HTMLButtonElement>(".tool-row-header") ?? null);
    check(row("bash")?.querySelector(".tool-row-body")?.textContent?.includes(command), "explicit command expansion restores the complete multiline command");
    check(Boolean(row("bash")?.querySelector(".tool-row-body .tool-row-head-copy")),
      "expanded compact details retain the command copy action");
    check(textIsVisible("English command result") && textIsVisible("Inspect architecture with a very long English description"), "explicit expansion reveals full original parameters and output");
    render(compactMessages, true, null, "compact-inline");
    render(compactMessages, false, null, "compact-inline");
    check(row("bash")?.classList.contains("open"), "manual detail choice survives completion");

    render([zhIntro, bash], true, null, "compact-stream");
    check(visible(row("intro")) && !header(), "later tools never hide previously visible progress");
    check(!row("bash")?.classList.contains("open") && !textIsVisible("Inspecting architecture"), "a live singleton keeps English payload folded");
    render(compactMessages, false,
      { sessionId: "s", messageId: "bash", query: "architecture", requestId: 1 }, "compact-search");
    check(activityHeader()?.getAttribute("aria-expanded") === "true" && row("bash")?.classList.contains("open"),
      "search reveals the owning compact activity and tool details");
    check(textIsVisible("Inspecting architecture"), "search can read the full original command");

    render([zhIntro, { ...bash, toolStatus: "error", toolResult: { details: { stdout: "English failure output", exitCode: 1 } }, isError: true }, zhAnswer], true, null, "compact-error");
    check(visible(row("bash")) && row("bash")?.textContent?.includes(i18n.t("chat.toolFailed")) && !row("bash")?.classList.contains("open"),
      "compact error status stays visible without opening command output");
    render([zhIntro, { ...bash, toolStatus: "denied", toolResult: undefined }, zhAnswer], false, null, "compact-denied");
    check(row("bash")?.textContent?.includes(i18n.t("chat.toolDenied")) && !row("bash")?.classList.contains("open"),
      "compact denial stays visible without opening payload");
    render([zhIntro, { ...bash, toolStatus: "error", toolResult: { details: { exitCode: 1 } } }, read, zhAnswer], false, null, "compact-group-error");
    check(activityHeader()?.textContent?.includes("1 个问题") && activityHeader()?.getAttribute("aria-expanded") === "false",
      "collapsed compact groups retain recorded issues");

    const thought = message("thought", "assistant", "", { thinking: "hidden English thinking words", status: "streaming" });
    render([thought], true, null, "compact-thinking");
    check(visible(container.querySelector(".thinking-compact")) && container.textContent?.includes(i18n.t("chat.thinking")) && !container.textContent?.includes("hidden English thinking"),
      "compact live thought shows only the Chinese indicator");
    render([{ ...thought, status: "complete" }], false, null, "compact-thinking");
    check(!container.querySelector(".thinking") && !header(), "completed compact thinking leaves no empty block");
    render([{ ...thought, content: "开始回答。" }], true, null, "compact-thinking");
    check(!container.querySelector(".thinking") && visible(row("thought")), "answer text ends compact thinking immediately");

    render([zhIntro, message("team-create", "tool", "created", {
      toolName: "task_create", toolStatus: "success", toolArgs: { title: "Very long English task instruction", description: "Detailed English plan" },
    }), zhAnswer], false, null, "compact-team");
    check(row("team-create")?.querySelector(".tool-row-name")?.textContent === "创建任务" && !textIsVisible("Very long English"),
      "compact Team tool shows a Chinese action without English JSON");

    render(compactMessages, false, null, "compact-switch");
    flushSync(() => useAppStore.setState({ settings: { ...settings, thinkingDisplayMode: "detailed" } }));
    check(Boolean(header()), "switching mounted history to detailed restores the process disclosure");
    click(header());
    check(Boolean(container.querySelector(".thinking")) && container.textContent?.includes("Long English reasoning"),
      "detailed mode retains original English reasoning");
    flushSync(() => useAppStore.setState({ settings: { ...settings, thinkingDisplayMode: "compact" } }));
    check(!header() && visible(row("progress")) && !container.querySelector(".thinking"),
      "switching back to compact restores readable progress");
    check(zhIntro.thinking === "Long English reasoning should remain stored" && (bash.toolArgs as { command: string }).command === command,
      "presentation never rewrites original thinking or command data");

    let saved: Partial<AppSettings> | undefined;
    flushSync(() => root.render(
      <I18nextProvider i18n={i18n}>
        <ThinkingDisplayModeRow settings={settings} saveSettings={async (patch) => {
          saved = patch;
          useAppStore.setState({ settings: { ...settings, ...patch } });
        }} />
      </I18nextProvider>,
    ));
    click(container.querySelector<HTMLElement>('[role="radio"][aria-checked="false"]'));
    check(saved?.thinkingDisplayMode === "compact", "settings control saves compact mode");
    return { ok: true, checks: notes };
  } finally {
    flushSync(() => root.unmount());
    useAppStore.setState({ settings: initialSettings });
    container.remove();
  }
}
