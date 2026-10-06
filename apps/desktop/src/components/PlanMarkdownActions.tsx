import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { useAppStore } from "../stores/app-store";
import { Button } from "./ui";
import { IconCopy, IconDownload } from "./icons";

/** Export the exact checkpoint bytes without changing its approval state. */
export function PlanMarkdownActions({ markdown, artifactPath, title }: {
  markdown: string;
  artifactPath: string | null;
  title: string;
}) {
  const { t } = useTranslation();
  const showToast = useAppStore((state) => state.showToast);
  const owner = useRef<{ disposed: boolean; downloads: Map<string, number> }>(undefined);
  useEffect(() => {
    const current = { disposed: false, downloads: new Map<string, number>() };
    owner.current = current;
    return () => {
      current.disposed = true;
      for (const [url, timer] of current.downloads) {
        window.clearTimeout(timer);
        URL.revokeObjectURL(url);
      }
      current.downloads.clear();
    };
  }, [markdown, artifactPath, title]);

  const copy = async () => {
    const current = owner.current;
    try {
      await navigator.clipboard.writeText(markdown);
      if (current && !current.disposed) showToast(t("chat.copied"), { variant: "success" });
    } catch {
      if (current && !current.disposed) showToast(t("chat.copyFailed"), { variant: "error" });
    }
  };
  const download = () => {
    const current = owner.current;
    if (!current || current.disposed) return;
    let url: string | undefined;
    const link = document.createElement("a");
    try {
      url = URL.createObjectURL(new Blob([markdown], { type: "text/markdown;charset=utf-8" }));
      const fileName = artifactPath?.split(/[\\/]/).at(-1) || title.trim().replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_") || "plan";
      link.href = url;
      link.download = fileName.endsWith(".md") ? fileName : `${fileName}.md`;
      document.body.append(link);
      link.click();
      const downloadUrl = url;
      // Let Chromium consume the Blob before releasing it; disposal also releases it.
      current.downloads.set(downloadUrl, window.setTimeout(() => {
        URL.revokeObjectURL(downloadUrl);
        current.downloads.delete(downloadUrl);
      }, 1000));
    } catch {
      if (url) URL.revokeObjectURL(url);
      showToast(t("chat.downloadFailed"), { variant: "error" });
    } finally {
      link.remove();
    }
  };

  return <>
    <Button size="sm" className="plan-approval-export" onClick={() => void copy()}
      data-testid="plan-copy-markdown" aria-label={t("chat.copyMarkdown")}>
      <IconCopy size={13} aria-hidden />{t("chat.copyMarkdown")}
    </Button>
    <Button size="sm" className="plan-approval-export" onClick={download}
      data-testid="plan-download-markdown" aria-label={t("chat.downloadMarkdown")}>
      <IconDownload size={13} aria-hidden />{t("chat.downloadMarkdown")}
    </Button>
  </>;
}
