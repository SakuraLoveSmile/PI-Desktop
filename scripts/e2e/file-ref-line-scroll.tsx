import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import { createInstance } from "i18next";
import { I18nextProvider, initReactI18next } from "react-i18next";
import { IPC } from "@pi-desktop/shared";
import { catalogs, flattenCatalog } from "@pi-desktop/i18n";
import { FilesTab } from "../../apps/desktop/src/components/workpanel/FilesTab";
import { LinkifiedText } from "../../apps/desktop/src/features/chat/transcript/shared";
import { useAppStore } from "../../apps/desktop/src/stores/app-store";
import { splitChatText } from "../../apps/desktop/src/lib/chat-links";
import { Markdown } from "../../apps/desktop/src/components/Markdown";

const targetPath = "src/scroll-target.txt";
const targetLine = 65;
const references = [
  { token: `${targetPath}:${targetLine}:4`, line: targetLine, column: 4 },
  { token: `${targetPath}:45-48`, line: 45 },
  { token: `${targetPath}#L75-L80`, line: 75 },
];
const transcript = references.map(({ token }) => `Review ${token}.`).join(" ");
const markdownReferences = [
  { token: `${targetPath}:55-60`, line: 55, path: targetPath, source: `${targetPath}:55-60`, selector: ".fixture-markdown-bare a" },
  { token: `${targetPath}#L35-L40`, line: 35, path: targetPath, source: `[source](${targetPath}#L35-L40)`, selector: ".fixture-markdown-explicit a" },
  { token: `${targetPath}:25:3`, line: 25, column: 3, path: targetPath, source: `\`${targetPath}:25:3\``, selector: ".fixture-markdown-linked-code .chat-code-link" },
  { token: "src/scroll target.txt:85-89", line: 85, path: "src/scroll target.txt", source: "`src/scroll target.txt:85-89`", selector: ".fixture-markdown-code .chat-code-link" },
];
const content = Array.from({ length: 90 }, (_, index) => `line ${index + 1}`).join("\n");
const resolveRefs: string[] = [];
const readPaths: string[] = [];
const scrollCalls: Array<{ line: string | undefined; block?: string }> = [];

window.piDesktop = {
  platform: "darwin",
  channels: IPC,
  on: () => () => {},
  async invoke(channel, ...args) {
    const input = args[0] as Record<string, unknown> | undefined;
    if (channel === IPC.invoke.fsResolveRef) {
      const ref = String(input?.ref ?? "");
      resolveRefs.push(ref);
      const relativePath = ref.replace(/^\/workspace\//, "");
      return {
        ok: true,
        data: {
          match: {
            root: "workspace",
            relativePath,
            absolutePath: `/workspace/${relativePath}`,
            matchedBy: "exact-relative",
            projectRoot: { path: "/workspace", name: "Fixture", primary: true },
          },
        },
      };
    }
    if (channel === IPC.invoke.fsList) {
      return { ok: true, data: { entries: [] } };
    }
    if (channel === IPC.invoke.fsRead) {
      const path = String(input?.path ?? "");
      readPaths.push(path);
      return { ok: true, data: { kind: "text", content, size: content.length } };
    }
    throw new Error(`Unexpected file viewer IPC: ${channel}`);
  },
};

useAppStore.setState({
  workspace: { path: "/workspace", name: "Fixture" },
  activeSessionId: "fixture-session",
  pluginViews: [{ pluginId: "pi.file-manager", viewId: "manager" }],
  workPanelOpen: false,
  workPanelTabs: [],
  activeWorkPanelTabId: null,
  workPanelFileRequest: null,
});

const nativeScrollIntoView = HTMLElement.prototype.scrollIntoView;
if (!nativeScrollIntoView) throw new Error("Chromium scrollIntoView is unavailable");
HTMLElement.prototype.scrollIntoView = function (options?: ScrollIntoViewOptions) {
  scrollCalls.push({
    line: this.getAttribute("data-line") ?? undefined,
    block: options?.block,
  });
  nativeScrollIntoView.call(this, options);
};

const i18n = createInstance();
void i18n
  .use(initReactI18next)
  .init({
    lng: "en",
    fallbackLng: "en",
    keySeparator: false,
    resources: { en: { translation: flattenCatalog(catalogs.en) } },
    interpolation: { escapeValue: false },
  })
  .then(() => {
    const root = createRoot(document.getElementById("root")!);
    flushSync(() =>
      root.render(
        <I18nextProvider i18n={i18n}>
          <div className="fixture-chat">
            <LinkifiedText text={transcript} />
            {markdownReferences.map((reference) => (
              <div key={reference.selector} className={reference.selector.split(" ")[0].slice(1)}>
                <Markdown source={reference.source} />
              </div>
            ))}
          </div>
          <FilesTab />
        </I18nextProvider>,
      ),
    );

    window.fileRefLineScrollProbe = async () => {
      const until = async (predicate: () => boolean, label: string) => {
        for (let frame = 0; frame < 180; frame++) {
          if (predicate()) return true;
          await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
        }
        return false;
      };

      if (!(await until(
        () => document.querySelectorAll(".chat-file-chip").length === references.length,
        "verified transcript chip",
      ))) throw new Error("The verified file reference chip did not render");
      const cases = [];
      const clicks = [
        ...references.map((reference, index) => ({ ...reference, path: targetPath, selector: `.chat-file-chip:nth-of-type(${index + 1})`, element: document.querySelectorAll<HTMLButtonElement>(".chat-file-chip")[index] })),
        ...markdownReferences.map((reference) => ({ ...reference, element: document.querySelector<HTMLElement>(reference.selector) })),
      ];
      for (const reference of clicks) {
        const previousScrollCalls = scrollCalls.length;
        if (!reference.element) throw new Error(`Missing reference: ${reference.selector}`);
        reference.element.click();
        if (!(await until(
          () => Boolean(document.querySelector(".file-viewer-path")) && readPaths.length > 0,
          "host viewer file load",
        ))) throw new Error(`Host file viewer did not load: ${JSON.stringify({ resolveRefs, readPaths, request: useAppStore.getState().workPanelFileRequest })}`);
        if (!(await until(() => scrollCalls.length > previousScrollCalls, "host viewer line scroll"))) {
          throw new Error(`No scroll for ${reference.token}`);
        }

        const viewer = document.querySelector<HTMLElement>(".file-viewer-body");
        const line = viewer?.querySelector<HTMLElement>(`[data-line="${reference.line}"]`);
        if (!viewer || !line) throw new Error("The requested source line was not rendered");
        const viewerRect = viewer.getBoundingClientRect();
        const lineRect = line.getBoundingClientRect();
        const request = useAppStore.getState().workPanelFileRequest;
        cases.push({
          token: reference.token,
          request,
          scrollCall: scrollCalls.at(-1) ?? null,
          scrollTop: viewer.scrollTop,
          targetLineVisible: lineRect.top >= viewerRect.top && lineRect.bottom <= viewerRect.bottom,
        });
      }
      return {
        fileManagerAvailable: useAppStore.getState().pluginViews.some(
          (view) => view.pluginId === "pi.file-manager" && view.viewId === "manager",
        ),
        selectedPath: document.querySelector(".file-viewer-path")?.textContent,
        segments: splitChatText(transcript, "/workspace"),
        resolveRefs,
        readPaths,
        cases,
      };
    };
  })
  .catch((error: unknown) => {
    console.error(error);
    throw error;
  });

declare global {
  interface Window {
    piDesktop?: {
      platform: NodeJS.Platform;
      channels: typeof IPC;
      on: (channel: string, listener: (...args: unknown[]) => void) => () => void;
      invoke: (channel: string, ...args: unknown[]) => Promise<unknown>;
    };
    fileRefLineScrollProbe: () => Promise<{
      fileManagerAvailable: boolean;
      selectedPath: string | null | undefined;
      segments: unknown[];
      resolveRefs: string[];
      readPaths: string[];
      cases: Array<{
        token: string;
        request: { path: string; line?: number; column?: number } | null;
        scrollCall: { line: string | undefined; block?: string } | null;
        scrollTop: number;
        targetLineVisible: boolean;
      }>;
    }>;
  }
}
