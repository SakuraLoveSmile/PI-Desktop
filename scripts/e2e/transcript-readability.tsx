import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import { createInstance } from "i18next";
import { I18nextProvider } from "react-i18next";
import { zhCN } from "@pi-desktop/i18n";
import type { UiMessage } from "@pi-desktop/shared";
import { AssistantTurn } from "../../apps/desktop/src/features/chat/transcript/AssistantTurn";
import { buildTranscriptEntries } from "../../apps/desktop/src/lib/assistant-turns";
import { useAppStore } from "../../apps/desktop/src/stores/app-store";

/** Built CSS and real transcript components, with synthetic data only. */
export async function transcriptReadabilityProbe() {
  const settings = useAppStore.getState().settings;
  const theme = document.documentElement.getAttribute("data-theme");
  const i18n = createInstance();
  await i18n.init({ lng: "zh-CN", resources: { "zh-CN": { translation: zhCN } } });
  const host = document.createElement("div");
  host.style.cssText = "position:fixed;inset:0;z-index:1000;overflow:auto;background:var(--ds-bg-primary);padding:40px;";
  document.body.append(host);
  const root = createRoot(host);
  const msg = (id: string, role: UiMessage["role"], content: string, extra: Partial<UiMessage> = {}): UiMessage => ({ id, role, content, createdAt: "2026-10-09T00:00:00Z", ...extra });
  const messages = [
    msg("intro", "assistant", "我会先检查相关实现，确认问题所在，再进行修改。"),
    ...["read1", "read2", "read3"].map((id) => msg(id, "tool", "File contents", { toolName: "Read", toolStatus: "success", toolArgs: { path: "lib/core/providers.dart" } })),
    msg("progress", "assistant", "已经找到原因：随机歌曲按钮复用了播放操作。接下来将换曲与播放分开，保留现有推荐缓存。"),
    msg("edit", "tool", "Updated", { toolName: "Edit", toolStatus: "success", toolArgs: { path: "lib/core/providers.dart" } }),
    msg("run", "tool", "All checks passed", { toolName: "Bash", toolStatus: "success", toolArgs: { command: "flutter analyze --no-pub" } }),
    msg("answer", "assistant", "### 修改完成\n\n点击随机歌曲右侧按钮会换一首推荐歌曲。播放仍由独立的播放按钮控制。\n\n- 保留现有缓存与推荐状态。\n- 已检查重复点击与切换歌曲的行为。\n\n工具过程已收在摘要中，点击即可查看文件和命令详情。", { status: "complete" }),
  ];
  const entry = buildTranscriptEntries(messages).entries.find((item) => item.kind === "assistant-turn");
  if (entry?.kind !== "assistant-turn") throw new Error("Missing fixture turn");
  const notes: string[] = [];
  const check = (value: unknown, name: string) => { if (!value) throw new Error(name); notes.push(name); };
  const cleanup = () => {
    flushSync(() => root.unmount()); host.remove();
    useAppStore.setState({ settings });
    if (theme === null) document.documentElement.removeAttribute("data-theme");
    else document.documentElement.setAttribute("data-theme", theme);
  };
  try {
    flushSync(() => useAppStore.setState({ settings: { defaultMode: "agent", theme: "dark", enterToSend: true, thinkingDisplayMode: "compact" } }));
    for (const tone of ["dark", "light"]) {
      document.documentElement.setAttribute("data-theme", tone);
      for (const width of [450, 960]) {
        flushSync(() => root.render(<I18nextProvider i18n={i18n}><div style={{ width: `min(100%, ${width}px)`, margin: "auto" }}><AssistantTurn entry={entry} isActive={false} /></div></I18nextProvider>));
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
        const prose = host.querySelector<HTMLElement>(".assistant-turn-fragment .prose-chat")!;
        const headers = [...host.querySelectorAll<HTMLElement>(".process-activity-group > button")];
        check(headers.length === 2 && headers.every((item) => item.getAttribute("aria-expanded") === "false"), `${tone}/${width}: activity summaries start closed`);
        check(parseFloat(getComputedStyle(prose).fontSize) === 16, `${tone}/${width}: readable prose scale`);
        check(headers.every((item) => parseFloat(getComputedStyle(item).fontSize) < 16), `${tone}/${width}: activity is secondary`);
        check(host.scrollWidth <= host.clientWidth && host.firstElementChild!.scrollWidth <= host.firstElementChild!.clientWidth, `${tone}/${width}: no horizontal overflow`);
      }
    }
    document.documentElement.setAttribute("data-theme", "dark");
    // The runner captures the real Chromium surface before releasing the fixture.
    globalThis.cleanupReadabilityProbe = cleanup;
    return { ok: true, checks: notes };
  } catch (error) { cleanup(); throw error; }
}
