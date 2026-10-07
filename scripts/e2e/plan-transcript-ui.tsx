import { act } from "react";
import { createRoot } from "react-dom/client";
import { createInstance } from "i18next";
import { I18nextProvider } from "react-i18next";
import { catalogs } from "@pi-desktop/i18n";
import type { PlanProposal, ProposalKind, UiMessage } from "@pi-desktop/shared";
import { ChatTranscript } from "../../apps/desktop/src/features/chat/transcript/ChatTranscript";
import { TranscriptDisclosureProvider } from "../../apps/desktop/src/features/chat/transcript/disclosure";
import { useAppStore } from "../../apps/desktop/src/stores/app-store";
import { api } from "../../apps/desktop/src/lib/api";
import "../../apps/desktop/src/styles/globals.css";

declare global {
  var planTranscriptUiProbe: () => Promise<unknown>;
  var planDownloadResult: { state: string; filename: string; content: string } | undefined;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function until(condition: () => boolean, label: string) {
  const deadline = performance.now() + 6000;
  while (!condition() && performance.now() < deadline) {
    await act(async () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));
  }
  assert(condition(), `UI did not reach expected state: ${label}`);
}

const at = (second: number) => new Date(Date.UTC(2026, 9, 2, 9, 0, second)).toISOString();
const message = (id: string, role: UiMessage["role"], content: string, second: number): UiMessage =>
  ({ id, role, content, createdAt: at(second), status: "complete" });

globalThis.planTranscriptUiProbe = async () => {
  const i18n = createInstance();
  await i18n.init({ lng: "zh-CN", resources: { en: { translation: catalogs.en }, "zh-CN": { translation: catalogs["zh-CN"] } } });
  const container = document.createElement("div");
  container.style.cssText = "width: 900px; height: 650px; margin: 24px auto;";
  document.documentElement.dataset.theme = "dark";
  document.body.append(container);
  const root = createRoot(container);
  const originalResolve = api.resolvePlan;
  const originalGetSession = api.getSession;
  const originalListSessions = api.listSessions;
  const originalListQueuedPrompts = api.listQueuedPrompts;
  let proposal: PlanProposal;
  let rows: UiMessage[] = [];
  const cases: string[] = [];
  let resolves = 0;
  let copied = "";
  let rejectCopy = false;
  const clipboardDescriptor = Object.getOwnPropertyDescriptor(navigator, "clipboard");
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: {
    writeText: async (text: string) => {
      if (rejectCopy) throw new Error("isolated clipboard rejection");
      copied = text;
    },
  } });
  const originalCreateUrl = URL.createObjectURL;
  const originalRevokeUrl = URL.revokeObjectURL;
  const urls = new Set<string>();
  URL.createObjectURL = (blob) => { const url = originalCreateUrl(blob); urls.add(url); return url; };
  URL.revokeObjectURL = (url) => { urls.delete(url); originalRevokeUrl(url); };
  const sessionId = "plan-transcript-session";
  const session = { id: sessionId, title: "Approval transcript", mode: "goal" as const,
    providerId: "fixture", modelId: "fixture",
    projectPath: "/fixture/workspace", permissionMode: "ask" as const,
    createdAt: at(0), updatedAt: at(0) };
  api.getSession = async () => ({ session: { ...session, messages: rows } });
  api.listSessions = async () => ({ sessions: [session] });
  api.listQueuedPrompts = async () => ({ entries: [] });
  api.resolvePlan = async (resolution) => {
    resolves += 1;
    proposal = { ...proposal, status: resolution.action === "reject" ? "rejected" : "approved",
      action: resolution.action, updatedAt: at(3),
      ...(resolution.action === "approve" ? { executionState: "running", executionId: "execution" } : {}) };
    return { proposal, action: resolution.action, state: resolution.action === "reject" ? "planning" : "inactive" };
  };
  const render = async (other = false) => {
    await act(async () => {
      root.render(<I18nextProvider i18n={i18n}><TranscriptDisclosureProvider>
        <div style={{ height: "600px", display: "flex", flexDirection: "column" }}>
          <ChatTranscript sessionId={sessionId} messages={rows} isRunning={false} paneVisible={!other} />
          {other ? <ChatTranscript sessionId="other-session" messages={rows} isRunning={false} /> : null}
        </div>
      </TranscriptDisclosureProvider></I18nextProvider>);
    });
  };
  const card = () => container.querySelector<HTMLElement>('[data-testid="plan-approval-bar"]');
  const checkOrder = (label: string) => {
    const approval = card();
    const continuation = container.querySelector('[data-message-id="continuation"]');
    assert(approval && continuation, `${label}: card and execution message must render`);
    assert(approval.compareDocumentPosition(continuation) & Node.DOCUMENT_POSITION_FOLLOWING,
      `${label}: the handled card must precede subsequent execution output`);
    assert(container.querySelectorAll('[data-testid="plan-approval-bar"]').length === 1,
      `${label}: a proposal must render exactly once`);
  };
  try {
    for (const mode of ["detailed", "compact"] as const) {
      await act(async () => useAppStore.setState({ settings: {
        defaultMode: "agent", theme: "dark", enterToSend: true, onboardingDismissed: true,
        thinkingDisplayMode: mode, smoothStreaming: false,
      } }));
    for (const kind of ["plan", "goal"] as ProposalKind[]) {
      for (const action of ["approve", "reject"] as const) {
        rows = [message("user", "user", "Implement the supplied plan.", 0),
          message("before", "assistant", "Review this contract before execution.", 1),
          { ...message("submit", "tool", "", 2), toolName: kind === "goal" ? "SubmitGoal" : "SubmitPlan",
            toolCallId: "submit-call", toolStatus: "success", toolResult: { submitted: true } }];
        proposal = { id: `proposal-${kind}-${action}`, sessionId, turnId: "turn-contract", toolCallId: "submit-call",
          kind, title: "KaneoPilot 项目仓库配置与 UI 简化施工（T1 & T2）",
          markdown: "# Approved contract\r\n\r\n精确字节 `code`\r\n", plan: "# Approved contract",
          question: action === "reject" ? "确认执行？" : "增加项目仓库配置，简化任务界面，并验证旧配置兼容和完整操作流程。确认按此计划执行？",
          artifact: { relativePath: `.pi/${kind}/fixture.md`, sha256: "fixture", sizeBytes: 19 },
          version: 1, status: "pending", createdAt: at(2), updatedAt: at(2) };
        await act(async () => useAppStore.setState({ activeSessionId: sessionId, sessions: [session],
          planHistory: { [sessionId]: [proposal] }, pendingPlans: { [sessionId]: proposal },
          planCheckpoints: { [sessionId]: proposal } }));
        await render();
        await until(() => Boolean(card()?.querySelector(`.plan-approval-${action === "approve" ? "approve-main" : "reject"}`)), "pending approval");
        assert(card()?.querySelector(".approval-summary-text")?.textContent === proposal.question,
          `${mode}/${kind}: show the AI approval overview, including a short question, rather than repeating the title or full Markdown`);
        await act(async () => card()?.querySelector<HTMLButtonElement>(`.plan-approval-${action === "approve" ? "approve-main" : "reject"}`)?.click());
        await until(() => card()?.dataset.status === (action === "approve" ? "approved" : "rejected"), "resolved approval");
        assert(!card()?.querySelector(".plan-approval-approve-main"), "a resolved card cannot approve again");
        rows = [...rows, message("continuation", "assistant", "Execution continues below the approved card.", 4)];
        await render();
        checkOrder(`${kind}/${action}`);
        cases.push(`${mode}/${kind}/${action}`);

        // Old profiles and paged transcripts may lack the submit-tool row.
        rows = rows.filter((row) => row.id !== "submit");
        await render();
        checkOrder(`${kind}/${action}/missing-submit-row`);
        cases.push(`${mode}/${kind}/${action}/missing-submit-row`);
      }
    }
    }
    await act(async () => useAppStore.setState({ activeSessionId: "other-session" }));
    await render(true);
    assert(container.querySelectorAll('[data-testid="plan-approval-bar"]').length === 1,
      "retained panes must use their own session's proposals even when tool IDs match");
    cases.push("session-isolation");
    await act(async () => useAppStore.setState({ activeSessionId: sessionId }));
    rows.push(message("later-user", "user", "Continue the work.", 5),
      message("later-answer", "assistant", Array.from({ length: 30 }, (_, index) => `Later output ${index + 1}.`).join("\n\n"), 6));
    await render();
    const scroller = container.querySelector<HTMLElement>(".thread-scroll");
    assert(scroller && card(), "scrolling fixture must render");
    scroller.style.cssText = "height: 430px; flex: none; overflow-y: auto";
    scroller.scrollTop = 0;
    await until(() => scroller.scrollHeight > scroller.clientHeight + 100, "scrollable transcript");
    const firstY = card()!.getBoundingClientRect().top;
    scroller.scrollTop = 100;
    await act(async () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));
    const offset = firstY - card()!.getBoundingClientRect().top;
    assert(offset > 90, `the handled card must scroll with its message (moved ${offset}px)`);
    assert(!["fixed", "sticky"].includes(getComputedStyle(card()!).position), "handled cards must stay in normal message flow");
    cases.push("scrolls-with-message");
    scroller.scrollTop = 0;
    const shortOverview = proposal.question;
    const legacyQuestion = "请确认按此计划实施：**Node 22 + Fastify + SQLite**，实现用户管理和同源界面。".repeat(15);
    proposal = { ...proposal, question: legacyQuestion };
    await act(async () => useAppStore.setState({ planHistory: { [sessionId]: [proposal] } }));
    await render();
    await until(() => Boolean(card()?.querySelector(".approval-summary-toggle")), "legacy approval overview can expand");
    const summary = card()?.querySelector<HTMLElement>(".approval-summary-text");
    assert(summary && !summary.textContent?.includes("**"), "legacy Markdown emphasis is rendered, not printed as raw markup");
    const collapsedHeight = summary.getBoundingClientRect().height;
    assert(collapsedHeight <= Number.parseFloat(getComputedStyle(summary).lineHeight) * 3 + 1,
      "long legacy approval overview is bounded to three lines");
    await act(async () => card()?.querySelector<HTMLButtonElement>(".approval-summary-toggle")?.click());
    assert(summary.getBoundingClientRect().height > collapsedHeight,
      "expanding retains the complete original approval description");
    assert(useAppStore.getState().planHistory[sessionId][0].question === legacyQuestion,
      "presentation cannot rewrite the stored approval decision");
    await act(async () => card()?.querySelector<HTMLButtonElement>(".approval-summary-toggle")?.click());
    assert(summary.getBoundingClientRect().height <= collapsedHeight + 1, "legacy overview can collapse again");
    cases.push("AI-overview-separate-from-contract-and-expandable-legacy-description");
    proposal = { ...proposal, question: shortOverview };
    await act(async () => useAppStore.setState({ planHistory: { [sessionId]: [proposal] } }));
    await render();
    await act(async () => card()?.querySelector<HTMLButtonElement>('[data-testid="plan-open-artifact"]')?.click());
    assert(useAppStore.getState().workPanelContexts[sessionId]?.tabs.some((tab) => tab.resource === `.pi/${proposal.kind}/fixture.md`),
      "resolved cards must retain the original artifact opener");
    cases.push("artifact-opener");
    const exportButton = (id: string) => card()?.querySelector<HTMLButtonElement>(`[data-testid="${id}"]`);
    const beforeExport = resolves;
    await act(async () => exportButton("plan-copy-markdown")?.click());
    assert(copied === proposal.markdown, "copy keeps CRLF, Unicode and Markdown bytes unchanged");
    rejectCopy = true;
    await act(async () => exportButton("plan-copy-markdown")?.click());
    assert(useAppStore.getState().toasts.some((toast) => toast.message === i18n.t("chat.copyFailed")), "clipboard failure is visible");
    globalThis.planDownloadResult = undefined;
    await act(async () => exportButton("plan-download-markdown")?.click());
    await until(() => Boolean(globalThis.planDownloadResult), "native download completion");
    assert(globalThis.planDownloadResult?.state === "completed", "Markdown downloads in isolated Chromium");
    assert(globalThis.planDownloadResult?.filename === "fixture.md", "artifact filename is preserved");
    assert(globalThis.planDownloadResult?.content === proposal.markdown, "download preserves the exact Markdown bytes");
    assert(resolves === beforeExport, "exports cannot approve or reject a contract");
    assert(!container.querySelector('a[download]'), "download removes its temporary anchor");
    cases.push("copy-download-exact-markdown-and-visible-copy-error");

    // Native failures are injected only at the browser's Blob URL boundary.
    URL.createObjectURL = () => { throw new Error("isolated Blob failure"); };
    await act(async () => exportButton("plan-download-markdown")?.click());
    assert(useAppStore.getState().toasts.some((toast) => toast.message === i18n.t("chat.downloadFailed")), "download failure is visible");
    URL.createObjectURL = (blob) => { const url = originalCreateUrl(blob); urls.add(url); return url; };
    cases.push("visible-download-error");

    // A clipboard completion after disposal cannot notify a different pane.
    let finishCopy!: () => void;
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: {
      writeText: () => new Promise<void>((resolve) => { finishCopy = resolve; }),
    } });
    const toastCount = useAppStore.getState().toasts.length;
    await act(async () => exportButton("plan-copy-markdown")?.click());
    // Disposal cancels any pending revoke timer and releases all download URLs.
    await act(async () => root.render(null));
    await act(async () => finishCopy());
    assert(useAppStore.getState().toasts.length === toastCount, "disposed copy completion cannot show a toast");
    assert(urls.size === 0, "disposed export actions release every Blob URL");
    cases.push("download-resource-disposal");
    proposal = { ...proposal, status: "pending", executionState: undefined, executionId: undefined };
    await act(async () => useAppStore.setState({
      planHistory: { [sessionId]: [proposal] }, pendingPlans: { [sessionId]: proposal },
    }));
    await render();
    for (const locale of ["en", "zh-CN"]) {
      await act(async () => i18n.changeLanguage(locale));
      for (const width of [320, 450, 620]) {
        container.style.width = `${width}px`;
        await act(async () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));
        const approval = card();
        const announcement = approval?.querySelector<HTMLElement>(".sr-only");
        assert(announcement && announcement.getBoundingClientRect().width <= 1, "ready announcement remains visually hidden");
        assert(approval && approval.scrollWidth <= approval.clientWidth + 1, `${locale}/${width}: card stays within its width`);
        for (const button of approval.querySelectorAll<HTMLButtonElement>("button")) {
          const rect = button.getBoundingClientRect();
          const bounds = approval.getBoundingClientRect();
          assert(rect.left >= bounds.left - 1 && rect.right <= bounds.right + 1,
            `${locale}/${width}: ${button.textContent} is not clipped`);
        }
        cases.push(`${locale}/${width}/responsive-export-actions`);
      }
    }
    container.style.width = "900px";
    proposal = { ...proposal, title: "用户管理系统实现计划",
      question: "实现登录、用户管理与搜索分页，保留既定安全边界，并验证接口和完整操作流程。确认按此计划执行？" };
    await act(async () => useAppStore.setState({ planHistory: { [sessionId]: [proposal] }, pendingPlans: { [sessionId]: proposal } }));
    await render();
    await act(async () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));
    return { ok: true, cases, resolutions: resolves };
  } catch (error) {
    console.error(JSON.stringify({ resolves, active: useAppStore.getState().activeSessionId,
      history: useAppStore.getState().planHistory[sessionId]?.map((item) => ({ status: item.status, id: item.id })),
      card: card()?.outerHTML, toasts: useAppStore.getState().toasts }));
    throw error;
  } finally {
    URL.createObjectURL = originalCreateUrl;
    URL.revokeObjectURL = originalRevokeUrl;
    if (clipboardDescriptor) Object.defineProperty(navigator, "clipboard", clipboardDescriptor);
    else Reflect.deleteProperty(navigator, "clipboard");
    api.resolvePlan = originalResolve;
    api.getSession = originalGetSession;
    api.listSessions = originalListSessions;
    api.listQueuedPrompts = originalListQueuedPrompts;
  }
};
