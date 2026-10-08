import { createElement } from "react";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import { createInstance } from "i18next";
import { I18nextProvider } from "react-i18next";
import { catalogs } from "@pi-desktop/i18n";
import type { ToolPermissionRequest } from "@pi-desktop/shared";
import { PermissionCard } from "../../apps/desktop/src/components/PermissionCard";
import { useAppStore } from "../../apps/desktop/src/stores/app-store";
import "../../apps/desktop/src/styles/tokens.css";
import "../../apps/desktop/src/styles/base.css";
import "../../apps/desktop/src/styles/messages.css";
import "../../apps/desktop/src/styles/ui-kit.css";

const workspace = "/Users/example/Library/Application Support/KaneoPilot/worktrees/" + "project-".repeat(24) + "/review-ac2eaf90-7257-4ef6-8151-06fc44eb6e78";
const path = "/Users/example/Library/Application Support/KaneoPilot/worktrees/uedvmrsucbgy8v2e1di4b789/23b5ff43-b793-4540-b5c6-4f777856ad7b/app/src/main/java/app/startool/android/data/DailySummaryEntity.kt";
const permission: ToolPermissionRequest = { requestId: "permission-fixture", sessionId: "session-fixture", toolCallId: "tool-fixture", toolName: "Read", argsPreview: { path }, risk: "low", reason: "Accesses a path outside the session workspace" };
const i18n = createInstance();
const ready = i18n.init({ lng: "zh-CN", interpolation: { escapeValue: false }, resources: { "zh-CN": { translation: catalogs["zh-CN"] } } });
const host = document.createElement("main"); document.body.append(host);
host.style.cssText = "margin:16px;width:720px;max-width:calc(100vw - 32px)";
const focusTarget = document.createElement("textarea"); focusTarget.className = "composer-input"; focusTarget.setAttribute("aria-label", "Fixture composer"); focusTarget.style.cssText = "position:fixed;bottom:4px;width:1px;height:1px;opacity:0"; document.body.append(focusTarget);
const root = createRoot(host);
const frame = () => new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }
async function until(test: () => boolean, message: string) {
  const deadline = performance.now() + 5000;
  while (!test()) { if (performance.now() > deadline) throw new Error(message); await frame(); }
}
function render(value = permission) { flushSync(() => root.render(createElement(I18nextProvider, { i18n }, createElement(PermissionCard, { key: value.requestId, permission: value })))); }
declare global { var permissionCardLayoutProbe: () => Promise<unknown>; var permissionCardLayoutCleanup: () => void; }
globalThis.permissionCardLayoutProbe = async () => {
  await ready;
  const decisions: Array<{ sessionId: string; requestId: string; decision: string }> = [];
  const copied: string[] = [];
  let finish: (() => void) | undefined;
  let failed = false;
  const errors: string[] = [];
  useAppStore.setState({ sessions: [{ id: permission.sessionId, title: "Permission fixture", projectPath: workspace, mode: "agent", thinkingLevel: "off", permissionMode: "ask", messageCount: 0, createdAt: "now", updatedAt: "now" }],
    resolvePermission: async (sessionId, requestId, decision) => { decisions.push({ sessionId, requestId, decision }); if (failed) throw new Error("Fixture denied transport"); await new Promise<void>(resolve => { finish = resolve; }); },
    showToast: message => { errors.push(message); },
  });
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: async (text: string) => { copied.push(text); } } });
  const layouts = [];
  for (const theme of ["dark", "light"]) for (const width of [720, 560, 320, 240]) {
    document.documentElement.dataset.theme = theme; host.style.width = `${width}px`;
    render(); await frame(); await frame();
    const card = host.querySelector<HTMLElement>(".permission-card")!;
    const meta = host.querySelector<HTMLElement>(".permission-card-meta")!;
    assert(card.scrollWidth <= card.clientWidth + 1, `permission card overflows at ${width}px ${theme}`);
    assert(meta.textContent?.includes(workspace), "project path must remain complete");
    const rect = card.getBoundingClientRect();
    const text = meta.firstElementChild!.getBoundingClientRect();
    assert(text.right <= rect.right + 1, "project path escapes its card");
    assert(meta.scrollHeight > 20, "long project path must visibly wrap rather than truncate");
    for (const button of host.querySelectorAll<HTMLButtonElement>(".permission-card-actions button")) {
      const b = button.getBoundingClientRect(); assert(b.left >= rect.left && b.right <= rect.right + 1, "authorization action escapes card");
    }
    assert(host.querySelector(".permission-card-reason")?.textContent === "访问会话工作区之外的路径", "known Host reason must be localized");
    layouts.push({ width, theme });
  }
  host.querySelector<HTMLButtonElement>(".tool-row-copy")!.click();
  await until(() => copied.length === 1, "copy responds"); assert(copied[0] === path, "copy must preserve exact requested path");
  for (const [index, decision] of ["deny", "allow-session", "allow-once"].entries()) {
    render({ ...permission, requestId: `decision-${index}` });
    const button = host.querySelectorAll<HTMLButtonElement>(".permission-card-actions button")[index]!;
    flushSync(() => button.click());
    assert([...host.querySelectorAll<HTMLButtonElement>(".permission-card-actions button")].every(b => b.disabled), "pending decision disables all actions");
    button.click(); assert(decisions.length === index + 1, "pending decision cannot submit twice");
    assert(decisions[index]?.sessionId === permission.sessionId && decisions[index]?.requestId === `decision-${index}` && decisions[index]?.decision === decision, "decision identity and scope must be preserved");
    finish?.(); await until(() => document.activeElement === focusTarget, "decision restores composer focus"); await frame();
  }
  failed = true; render({ ...permission, requestId: "failed-decision" });
  flushSync(() => host.querySelector<HTMLButtonElement>(".permission-card-actions button")!.click());
  await until(() => errors.length === 1 && !host.querySelector<HTMLButtonElement>(".permission-card-actions button")!.disabled, "failed decision stays retryable");
  render({ ...permission, requestId: "unknown-reason", reason: "Specific external policy reason" });
  assert(host.querySelector(".permission-card-reason")?.textContent === "Specific external policy reason", "unknown reason must remain visible unchanged");
  document.documentElement.dataset.theme = "dark"; host.style.width = "720px"; render();
  await frame(); await frame();
  await Promise.all(document.getAnimations().filter(a => { const end = a.effect?.getComputedTiming().endTime; return typeof end === "number" && Number.isFinite(end); }).map(a => a.finished.catch(() => undefined)));
  return { ok: true, layouts, decisions: decisions.length, copiedExactPath: copied[0] === path, environment: "isolated Electron with production PermissionCard; no actual permission resolved" };
};
globalThis.permissionCardLayoutCleanup = () => root.unmount();
