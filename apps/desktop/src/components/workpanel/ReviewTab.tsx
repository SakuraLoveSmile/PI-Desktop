import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { DiffFile } from "@pi-desktop/shared";
import { summarizeWorkspaceChanges } from "../../lib/workspace-review";
import { useAppStore } from "../../stores/app-store";
import { cx } from "../ui";
import {
  IconChevronRight,
  IconDiff,
  IconSnapshot,
} from "../icons";

function statusLabel(status: DiffFile["status"], t: (k: string) => string) {
  return t(`panel.review.status.${status}`);
}

function FileCard({ file }: { file: DiffFile }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(true);
  const hasBody = file.hunks.length > 0;

  return (
    <div className={cx("diff-file", open && hasBody && "open")}>
      <button
        type="button"
        className="diff-file-header"
        aria-expanded={open && hasBody}
        disabled={!hasBody && !file.binary && !file.tooLarge}
        onClick={() => setOpen((v) => !v)}
        title={file.oldPath ? `${file.oldPath} → ${file.path}` : file.path}
      >
        <span className="diff-file-caret" aria-hidden>
          {hasBody ? <IconChevronRight size={12} /> : null}
        </span>
        <span className={cx("diff-file-status", `is-${file.status}`)}>
          {statusLabel(file.status, t)}
        </span>
        <span className="diff-file-path">
          {file.oldPath ? `${file.oldPath} → ${file.path}` : file.path}
        </span>
        <span className="diff-file-counts">
          {file.additions > 0 && (
            <span className="diff-count-add">+{file.additions}</span>
          )}
          {file.deletions > 0 && (
            <span className="diff-count-del">−{file.deletions}</span>
          )}
        </span>
      </button>
      {open && (
        <div className="diff-file-body">
          {file.binary ? (
            <div className="diff-file-note">{t("panel.review.binary")}</div>
          ) : file.tooLarge ? (
            <div className="diff-file-note">{t("panel.review.tooLarge")}</div>
          ) : (
            file.hunks.map((hunk, hunkIndex) => (
              <div className="diff-hunk" key={hunkIndex}>
                <div className="diff-line hunk">
                  <span className="diff-line-text">{hunk.header}</span>
                </div>
                {hunk.lines.map((line, lineIndex) => (
                  <div className={cx("diff-line", line.type)} key={lineIndex}>
                    <span className="diff-line-sign" aria-hidden>
                      {line.type === "add" ? "+" : line.type === "del" ? "−" : " "}
                    </span>
                    <span className="diff-line-text">{line.text}</span>
                  </div>
                ))}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}

export function ReviewTab() {
  const { t } = useTranslation();
  const workspace = useAppStore((s) => s.workspace);
  const workspaceDiff = useAppStore((s) => s.workspaceDiff);
  const workspaceDiffPath = useAppStore((s) => s.workspaceDiffPath);
  const loading = useAppStore((s) => s.workspaceDiffLoading);
  const refresh = useAppStore((s) => s.refreshWorkspaceDiff);
  const diff = workspaceDiffPath === workspace?.path ? workspaceDiff : null;

  if (!workspace?.path) {
    return (
      <div className="work-tab-empty">
        <IconDiff size={20} />
        <p>{t("panel.review.noWorkspace")}</p>
      </div>
    );
  }

  const files = diff?.files ?? [];
  const summary = summarizeWorkspaceChanges(diff);

  return (
    <div className="review-tab">
      <div className="review-toolbar">
        <span className="review-summary">
          {diff && !diff.repo
            ? t("panel.review.noRepo")
            : files.length > 0
              ? t("panel.review.filesChanged", { count: files.length })
              : ""}
        </span>
        {files.length > 0 && (
          <span className="diff-file-counts">
            <span className="diff-count-add">+{summary?.additions ?? 0}</span>
            <span className="diff-count-del">−{summary?.deletions ?? 0}</span>
          </span>
        )}
        <button
          type="button"
          className={cx("icon-btn", loading && "is-loading")}
          onClick={() => void refresh()}
          title={t("panel.review.refresh")}
          disabled={loading}
        >
          <IconSnapshot size={14} />
        </button>
      </div>
      {diff?.truncated && (
        <div className="review-truncated">{t("panel.review.truncated")}</div>
      )}
      <div className="review-scroll">
        {diff && diff.repo && diff.clean ? (
          <div className="work-tab-empty">
            <IconDiff size={20} />
            <p>{t("panel.review.clean")}</p>
          </div>
        ) : diff && !diff.repo ? (
          <div className="work-tab-empty">
            <IconDiff size={20} />
            <p>{t("panel.review.noRepo")}</p>
          </div>
        ) : (
          files.map((file) => <FileCard key={file.path} file={file} />)
        )}
      </div>
    </div>
  );
}
