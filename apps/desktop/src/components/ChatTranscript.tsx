import {
  Fragment,
  memo,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import type {
  DiffFile,
  MessageUsage,
  UiMessage,
  WorkspaceDiff,
} from "@pi-desktop/shared";
import { ConversationMinimap } from "./ConversationMinimap";
import { AgentProgressTimeline } from "./AgentProgressTimeline";
import { TurnOutcomeCard } from "./TurnOutcomeCard";
import { Markdown, useCopy } from "./Markdown";
import {
  formatToolDuration,
  getToolAction,
  getToolDisplayName,
  getToolSections,
  getToolSummary,
  hasToolSections,
  type ToolAction,
} from "../lib/tool-display";
import {
  getToolPreviewTarget,
  splitChatText,
  type ChatPreviewTarget,
} from "../lib/chat-links";
import { findWorkspaceChangeForMessage } from "../lib/workspace-review";
import { reduceTranscriptScroll } from "../lib/transcript-scroll";
import {
  assistantTurnContent,
  assistantTurnMessages,
  assistantTurnUsage,
  buildTranscriptEntries,
  messageThinking as thinkingText,
  type AssistantActivityItem,
  type AssistantTurnEntry,
} from "../lib/assistant-turns";
import {
  IconArrowDown,
  IconBranch,
  IconCheck,
  IconCircleAlert,
  IconChevronLeft,
  IconChevronRight,
  IconCopy,
  IconDiff,
  IconFileText,
  IconFolder,
  IconGlobe,
  IconPencil,
  IconSearch,
  IconReview,
  IconSparkles,
  IconTerminal,
  IconTrash,
  IconWrench,
} from "./icons";
import { useAppStore } from "../stores/app-store";
import type { PendingPermission } from "../lib/pending-permissions";
import { PermissionCard } from "./PermissionCard";

function diffStatusLabel(
  status: DiffFile["status"],
  t: (key: string, options?: Record<string, unknown>) => string,
) {
  return t(`panel.review.status.${status}`);
}

function InlineDiffBody({ file }: { file: DiffFile }) {
  const { t } = useTranslation();

  if (file.binary) {
    return <div className="review-change-note">{t("panel.review.binary")}</div>;
  }
  if (file.tooLarge) {
    return <div className="review-change-note">{t("panel.review.tooLarge")}</div>;
  }

  return (
    <div className="review-change-diff">
      {file.hunks.map((hunk, hunkIndex) => (
        <div className="diff-hunk" key={hunkIndex}>
          <div className="diff-line hunk">
            <span className="diff-line-text">{hunk.header}</span>
          </div>
          {hunk.lines.map((line, lineIndex) => (
            <div className={`diff-line ${line.type}`} key={lineIndex}>
              <span className="diff-line-sign" aria-hidden>
                {line.type === "add" ? "+" : line.type === "del" ? "−" : " "}
              </span>
              <span className="diff-line-text">{line.text}</span>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

const WorkspaceChangeCard = memo(function WorkspaceChangeCard({
  message,
}: {
  message: UiMessage;
}) {
  const { t } = useTranslation();
  const workspacePath = useAppStore((state) => state.workspace?.path);
  const diffPath = useAppStore((state) => state.workspaceDiffPath);
  const workspaceDiff = useAppStore((state) => state.workspaceDiff);
  const detailsId = useId();
  const [open, setOpen] = useState(false);
  const diff: WorkspaceDiff | null =
    diffPath === workspacePath ? workspaceDiff : null;
  const file = findWorkspaceChangeForMessage(message, diff);

  if (!file) return null;

  const status = diffStatusLabel(file.status, t);
  const displayPath = file.oldPath
    ? `${file.oldPath} → ${file.path}`
    : file.path;
  const accessibleLabel = t(
    open ? "chat.reviewChangeHide" : "chat.reviewChangeShow",
    {
      path: displayPath,
      status,
      additions: file.additions,
      deletions: file.deletions,
    },
  );

  return (
    <section className={`review-change-card ${open ? "open" : ""}`}>
      <button
        type="button"
        className="review-change-card-header"
        aria-expanded={open}
        aria-controls={detailsId}
        aria-label={accessibleLabel}
        onClick={() => setOpen((value) => !value)}
      >
        <span className="review-change-card-icon" aria-hidden>
          <IconDiff size={14} />
        </span>
        <span className={`diff-file-status is-${file.status}`}>{status}</span>
        <code className="review-change-card-path">{displayPath}</code>
        <span
          className="diff-file-counts"
          aria-label={t("chat.reviewChangeCounts", {
            additions: file.additions,
            deletions: file.deletions,
          })}
        >
          <span className="diff-count-add">+{file.additions}</span>
          <span className="diff-count-del">−{file.deletions}</span>
        </span>
        <span className="review-change-card-caret" aria-hidden>
          <IconChevronRight size={12} />
        </span>
      </button>
      {open ? (
        <div className="review-change-card-body" id={detailsId}>
          <InlineDiffBody file={file} />
        </div>
      ) : null}
    </section>
  );
});

/**
 * Copy chip. Message toolbars are glyph-only (`icon`) with the label in a
 * hover tooltip; surfaces that need a worded button (error details) pass
 * `withLabel`.
 */
function CopyButton({
  text,
  label,
  withLabel = false,
}: {
  text: string;
  label: string;
  withLabel?: boolean;
}) {
  const { copied, copy } = useCopy();
  const { t } = useTranslation();
  const tip = copied ? t("chat.copied") : label;
  return (
    <button
      className={`copy-btn ${withLabel ? "" : "icon"} ${copied ? "copied" : ""}`}
      data-tip={withLabel ? undefined : tip}
      title={withLabel ? tip : undefined}
      aria-label={label}
      onClick={() => copy(text)}
    >
      {copied ? <IconCheck size={13} /> : <IconCopy size={13} />}
      {withLabel ? <span>{tip}</span> : null}
    </button>
  );
}


function formatTokenCount(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(value >= 10_000_000 ? 0 : 1)}M`;
  if (value >= 10_000) return `${Math.round(value / 1000)}k`;
  if (value >= 1000) return `${(value / 1000).toFixed(1)}k`;
  return String(value);
}

function usageLabel(usage: MessageUsage, t: (key: string, opts?: Record<string, unknown>) => string): string {
  const total = usage.totalTokens || usage.inputTokens + usage.outputTokens;
  return t("chat.usageTokens", { count: formatTokenCount(total) });
}

function usageTitle(usage: MessageUsage, t: (key: string, opts?: Record<string, unknown>) => string): string {
  const parts = [
    t("chat.usageInput", { count: formatTokenCount(usage.inputTokens) }),
    t("chat.usageOutput", { count: formatTokenCount(usage.outputTokens) }),
  ];
  if (usage.cacheReadTokens) {
    parts.push(t("chat.usageCacheRead", { count: formatTokenCount(usage.cacheReadTokens) }));
  }
  if (usage.cacheWriteTokens) {
    parts.push(t("chat.usageCacheWrite", { count: formatTokenCount(usage.cacheWriteTokens) }));
  }
  if (usage.reasoningTokens !== undefined) {
    parts.push(t("chat.usageReasoning", { count: formatTokenCount(usage.reasoningTokens) }));
  }
  return parts.join(" · ");
}

function MessageMeta({
  modelId,
  usage,
}: {
  modelId?: string;
  usage?: MessageUsage;
}) {
  const { t } = useTranslation();
  if (!modelId && !usage) return null;
  return (
    <div className="message-meta">
      {modelId ? (
        <span className="message-meta-chip model" title={modelId}>
          {modelId}
        </span>
      ) : null}
      {usage ? (
        <span className="message-meta-chip usage" title={usageTitle(usage, t)}>
          {usageLabel(usage, t)}
        </span>
      ) : null}
    </div>
  );
}

function AssistantErrorMessage({ message }: { message: UiMessage }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(true);
  const detailsId = useId();
  const retryLastPrompt = useAppStore((state) => state.retryLastPrompt);
  const error = message.error;
  if (!error) return null;
  const localizedKey = `errors.${error.code}`;
  const localized = t(localizedKey);
  const summary = localized === localizedKey ? t("chat.responseFailed") : localized;
  const configurationError = [
    "MODEL_NOT_CONFIGURED",
    "PROVIDER_SECRET_MISSING",
    "PROVIDER_UNAUTHORIZED",
  ].includes(error.code);

  return (
    <section className="message-error" aria-label={t("chat.responseError")}>
      <div className="message-error-heading">
        <span className="message-error-icon" aria-hidden>
          <IconCircleAlert size={16} />
        </span>
        <div className="message-error-copy">
          <strong>{summary}</strong>
          <code>{error.code}</code>
        </div>
      </div>
      <button
        type="button"
        className="message-error-toggle"
        aria-expanded={open}
        aria-controls={detailsId}
        onClick={() => setOpen((value) => !value)}
      >
        <IconChevronRight size={12} aria-hidden />
        {open ? t("chat.hideErrorDetails") : t("chat.showErrorDetails")}
      </button>
      <div
        id={detailsId}
        className={`message-error-details ${open ? "open" : ""}`}
        hidden={!open}
      >
        <dl>
          {message.providerId ? (
            <>
              <dt>{t("chat.errorProvider")}</dt>
              <dd>{message.providerId}</dd>
            </>
          ) : null}
          {message.modelId ? (
            <>
              <dt>{t("chat.errorModel")}</dt>
              <dd>{message.modelId}</dd>
            </>
          ) : null}
        </dl>
        <pre className="selectable">{error.message}</pre>
        <CopyButton
          text={error.message}
          label={t("chat.copyErrorDetails")}
          withLabel
        />
      </div>
      <div className="message-error-actions">
        {configurationError ? (
          <button
            type="button"
            className="copy-btn"
            onClick={() => {
              useAppStore.getState().setSettingsTab("agent");
              useAppStore.getState().setPage("settings");
            }}
          >
            {t("errors.action.openSettings")}
          </button>
        ) : null}
        {error.retriable ? (
          <button
            type="button"
            className="copy-btn"
            onClick={() => void retryLastPrompt()}
          >
            {t("errors.action.retry")}
          </button>
        ) : null}
      </div>
    </section>
  );
}

const TOOL_ACTION_KEYS: Record<ToolAction, string> = {
  read: "chat.toolRead",
  list: "chat.toolListed",
  search: "chat.toolSearched",
  write: "chat.toolWrote",
  edit: "chat.toolEdited",
  run: "chat.toolRan",
  fetch: "chat.toolFetched",
  fork: "chat.toolUsed",
  use: "chat.toolUsed",
};

const TOOL_RUNNING_KEYS: Record<ToolAction, string> = {
  read: "chat.toolReading",
  list: "chat.toolListing",
  search: "chat.toolSearching",
  write: "chat.toolWriting",
  edit: "chat.toolEditing",
  run: "chat.toolRunning",
  fetch: "chat.toolFetching",
  fork: "chat.toolUsing",
  use: "chat.toolUsing",
};

function ToolActionIcon({ action }: { action: ToolAction }) {
  const props = { size: 15, "aria-hidden": true };
  switch (action) {
    case "read":
      return <IconFileText {...props} />;
    case "list":
      return <IconFolder {...props} />;
    case "search":
      return <IconSearch {...props} />;
    case "write":
    case "edit":
      return <IconPencil {...props} />;
    case "run":
      return <IconTerminal {...props} />;
    case "fetch":
      return <IconGlobe {...props} />;
    case "fork":
      return <IconBranch {...props} />;
    default:
      return <IconWrench {...props} />;
  }
}

function ToolSection({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  const { copied, copy } = useCopy();
  const { t } = useTranslation();
  return (
    <section className="tool-row-section">
      <div className="tool-row-section-head">
        <span>{label}</span>
        <button
          className={`tool-row-copy ${copied ? "copied" : ""}`}
          aria-label={`${t("chat.copy")} ${label}`}
          title={copied ? t("chat.copied") : t("chat.copy")}
          onClick={() => copy(value)}
        >
          {copied ? <IconCheck size={12} /> : <IconCopy size={12} />}
        </button>
      </div>
      <pre className="tool-row-content">{value}</pre>
    </section>
  );
}

/** Actions whose path/url argument makes sense to preview in the panel. */
const PREVIEWABLE_ACTIONS = new Set<ToolAction>(["read", "write", "edit", "fetch"]);

function useOpenPreviewTarget() {
  const openFile = useAppStore((s) => s.openFileInWorkPanel);
  const openUrl = useAppStore((s) => s.openUrlInWorkPanel);
  return useCallback(
    (target: ChatPreviewTarget) => {
      if (target.kind === "file") openFile(target.path);
      else openUrl(target.url);
    },
    [openFile, openUrl],
  );
}

/** Plain user text with file paths and URLs linkified to the work panel. */
function LinkifiedText({ text }: { text: string }) {
  const { t } = useTranslation();
  const root = useAppStore((s) => s.workspace?.path);
  const openTarget = useOpenPreviewTarget();
  const segments = useMemo(() => splitChatText(text, root), [text, root]);
  return (
    <>
      {segments.map((segment, index) =>
        segment.kind === "text" ? (
          <span key={index}>{segment.text}</span>
        ) : (
          <button
            key={index}
            type="button"
            className="chat-text-link"
            title={
              segment.target.kind === "file"
                ? t("chat.previewFile")
                : t("chat.previewUrl")
            }
            onClick={() => openTarget(segment.target)}
          >
            {segment.text}
          </button>
        ),
      )}
    </>
  );
}

function ToolRow({ message }: { message: UiMessage }) {
  const { t } = useTranslation();
  const detailsId = useId();
  const root = useAppStore((s) => s.workspace?.path);
  const openTarget = useOpenPreviewTarget();
  const openTerminal = useAppStore((s) => s.openTerminalInWorkPanel);
  const status = message.toolStatus;
  const [open, setOpen] = useState(status === "error");
  const action = getToolAction(message.toolName);
  const actionLabel = t(
    status === "running" ? TOOL_RUNNING_KEYS[action] : TOOL_ACTION_KEYS[action],
  );
  const rawName = getToolDisplayName(message.toolName) || t("chat.tool");
  const summary = getToolSummary(message.toolName, message.toolArgs);
  const previewTarget = PREVIEWABLE_ACTIONS.has(action)
    ? getToolPreviewTarget(message.toolArgs, root)
    : null;
  const terminalArtifact = action === "run" && status === "success";
  const hasDetails = hasToolSections(message);
  // Streaming updates replace the message object each tick; only pay the
  // full args/result stringify once the row is actually expanded.
  const sections = open && hasDetails ? getToolSections(message) : null;
  const statusLabel =
    status === "running"
      ? t("chat.running")
      : status === "error"
        ? t("chat.toolFailed")
        : status === "denied"
          ? t("chat.toolDenied")
          : t("chat.toolCompleted");

  useEffect(() => {
    if (status === "error") setOpen(true);
  }, [status]);

  return (
    <div
      className={`tool-row ${open ? "open" : ""} status-${status || "success"}`}
      role="region"
      aria-label={`${t("chat.toolCall")}: ${rawName}, ${statusLabel}`}
    >
      <button
        className="tool-row-header"
        aria-expanded={open}
        aria-controls={hasDetails ? detailsId : undefined}
        disabled={!hasDetails}
        title={summary || rawName}
        onClick={() => hasDetails && setOpen((value) => !value)}
      >
        <span className="tool-row-icon">
          <ToolActionIcon action={action} />
        </span>
        <span className={`tool-row-name ${status === "running" ? "running" : ""}`}>
          {actionLabel}
        </span>
        {summary ? (
          <span
            className={`tool-row-summary${previewTarget || terminalArtifact ? " linked" : ""}`}
            title={
              previewTarget
                ? previewTarget.kind === "file"
                  ? t("chat.previewFile")
                  : t("chat.previewUrl")
                : terminalArtifact
                  ? t("chat.openTerminal")
                : undefined
            }
            onClick={
              previewTarget || terminalArtifact
                ? (e) => {
                    // Open the produced surface instead of toggling details.
                    e.stopPropagation();
                    if (previewTarget) openTarget(previewTarget);
                    else openTerminal();
                  }
                : undefined
            }
          >
            {summary}
          </span>
        ) : null}
        {status === "running" ? (
          <span className="tool-spinner" aria-label={t("chat.running")} />
        ) : status === "error" ? (
          <span className="tool-row-status error" aria-label={t("chat.toolFailed")}>
            <IconCircleAlert size={13} />
            {t("chat.toolFailed")}
          </span>
        ) : status === "denied" ? (
          <span className="tool-row-status">{t("chat.toolDenied")}</span>
        ) : null}
        <span className="sr-only" role="status" aria-live="polite">
          {statusLabel}
        </span>
        {hasDetails ? (
          <span className="tool-row-caret" aria-hidden>
            <IconChevronRight size={12} />
          </span>
        ) : null}
      </button>
      {sections ? (
        <div className="tool-row-body" id={detailsId}>
          {sections.output ? (
            <ToolSection label={t("chat.toolOutput")} value={sections.output} />
          ) : null}
          {sections.input ? (
            <ToolSection label={t("chat.toolInput")} value={sections.input} />
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/**
 * One item on the activity timeline between two answers: either a thinking
 * segment (an assistant message's reasoning) or a tool call. Grouping both
 * into a single disclosure keeps long agent loops from stacking alternating
 * "Thinking" / "Processed" rows down the transcript.
 */
type ActivityItem = AssistantActivityItem;

function activityItemSummary(
  item: ActivityItem,
  t: (key: string) => string,
): string {
  if (item.kind === "thinking") {
    // Latest thought line, so the collapsed header reads like a live ticker.
    const lines = thinkingText(item.message)
      .split("\n")
      .map((line) => line.replace(/^#+\s*|\*\*/g, "").trim())
      .filter(Boolean);
    return lines[lines.length - 1] || "";
  }
  const message = item.message;
  const action = getToolAction(message.toolName);
  const actionLabel = t(
    message.toolStatus === "running"
      ? TOOL_RUNNING_KEYS[action]
      : TOOL_ACTION_KEYS[action],
  );
  const summary = getToolSummary(message.toolName, message.toolArgs);
  return summary ? `${actionLabel} ${summary}` : actionLabel;
}

/** A thinking segment rendered like a tool row: one-line summary, expandable. */
function ThinkingRow({
  message,
  streaming,
}: {
  message: UiMessage;
  streaming: boolean;
}) {
  const { t } = useTranslation();
  const detailsId = useId();
  const [open, setOpen] = useState(false);
  const text = thinkingText(message);
  const summary = text.replace(/\s+/g, " ").trim();
  return (
    <div className={`tool-row thinking ${open ? "open" : ""}`}>
      <button
        className="tool-row-header"
        aria-expanded={open}
        aria-controls={detailsId}
        aria-label={t(open ? "chat.thinkingHide" : "chat.thinkingShow")}
        onClick={() => setOpen((value) => !value)}
      >
        <span className="tool-row-icon">
          <IconSparkles size={15} aria-hidden />
        </span>
        <span className={`tool-row-name ${streaming ? "running" : ""}`}>
          {t("chat.thinking", { defaultValue: "Thinking" })}
        </span>
        <span className="tool-row-summary">{summary}</span>
        <span className="tool-row-caret" aria-hidden>
          <IconChevronRight size={12} />
        </span>
      </button>
      {open ? (
        <div className="tool-row-body" id={detailsId}>
          <div className="prose-chat thinking-prose">
            <Markdown source={text} renderDiagrams={false} />
          </div>
        </div>
      ) : null}
    </div>
  );
}

type ActivityGroupProps = {
  items: ActivityItem[];
  isActive: boolean;
  endedAt?: string;
};

function activityGroupPropsEqual(
  previous: ActivityGroupProps,
  next: ActivityGroupProps,
) {
  if (
    previous.isActive !== next.isActive ||
    previous.endedAt !== next.endedAt ||
    previous.items.length !== next.items.length
  ) {
    return false;
  }
  return previous.items.every(
    (item, index) =>
      item.kind === next.items[index].kind &&
      item.message === next.items[index].message,
  );
}

const ActivityGroup = memo(function ActivityGroup({
  items,
  isActive,
  endedAt,
}: ActivityGroupProps) {
  const { t } = useTranslation();
  const detailsId = useId();
  const [open, setOpen] = useState(false);
  const [now, setNow] = useState(Date.now);
  const [finishedAt, setFinishedAt] = useState<number | null>(null);
  const wasActiveRef = useRef(isActive);
  const messages = items.map((item) => item.message);
  const startedAt = Date.parse(messages[0]?.createdAt || "") || now;
  const fallbackEnd =
    Math.max(
      startedAt,
      ...messages.map(
        (message) =>
          Date.parse(message.toolCompletedAt || "") ||
          (Date.parse(message.createdAt) || startedAt) +
            (message.toolDurationMs || 0),
      ),
    );
  const completedAt =
    Date.parse(endedAt || "") ||
    finishedAt ||
    (wasActiveRef.current ? now : fallbackEnd);
  const elapsedSeconds = Math.max(
    0,
    Math.floor(((isActive ? now : completedAt) - startedAt) / 1000),
  );
  const elapsed = formatToolDuration(elapsedSeconds);
  const failed = items.some((item) =>
    item.kind === "tool"
      ? item.message.toolStatus === "error"
      : item.message.status === "error",
  );
  const lastItem = items[items.length - 1];
  const thinkingNow =
    isActive &&
    lastItem?.kind === "thinking" &&
    lastItem.message.status === "streaming";
  const onlyThinking = items.every((item) => item.kind === "thinking");
  const label = failed
    ? t("chat.processingFailedAfter", { time: elapsed })
    : isActive
      ? t(thinkingNow || onlyThinking ? "chat.thinkingFor" : "chat.processingFor", {
          time: elapsed,
        })
      : onlyThinking
        ? elapsedSeconds > 0
          ? t("chat.thoughtFor", { time: elapsed })
          : // History reloads keep no end timestamp for pure-thinking groups.
            t("chat.thinking", { defaultValue: "Thinking" })
        : t("chat.processedFor", { time: elapsed });
  const tail = isActive && !open && lastItem ? activityItemSummary(lastItem, t) : "";

  useEffect(() => {
    if (wasActiveRef.current && !isActive) setFinishedAt(Date.now());
    wasActiveRef.current = isActive;
    if (!isActive) return;
    setNow(Date.now());
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [isActive]);

  return (
    <div
      className={`tool-activity-group ${open ? "open" : ""} ${
        isActive ? "active" : ""
      } ${failed ? "failed" : ""}`}
    >
      <button
        className="tool-activity-header"
        aria-expanded={open}
        aria-controls={detailsId}
        onClick={() => setOpen((value) => !value)}
      >
        <span className="tool-activity-icon" aria-hidden>
          {failed ? <IconCircleAlert size={14} /> : <IconSparkles size={14} />}
        </span>
        <span className={`tool-activity-label ${isActive ? "running" : ""}`}>
          {label}
        </span>
        {items.length > 1 ? (
          <span className="tool-activity-count">
            {t("chat.processingSteps", { count: items.length })}
          </span>
        ) : null}
        <span className="tool-activity-caret" aria-hidden>
          <IconChevronRight size={12} />
        </span>
      </button>
      {tail ? (
        <div className="tool-activity-preview" aria-hidden>
          {tail}
        </div>
      ) : null}
      <div
        className="tool-activity-collapse"
        aria-hidden={!open}
        inert={!open}
      >
        <div className="tool-activity-collapse-inner">
          <div className="tool-activity-body" id={detailsId}>
            {items.map((item) =>
              item.kind === "tool" ? (
                <Fragment key={item.message.id}>
                  <ToolRow message={item.message} />
                  <WorkspaceChangeCard message={item.message} />
                </Fragment>
              ) : (
                <ThinkingRow
                  key={`thinking-${item.message.id}`}
                  message={item.message}
                  streaming={isActive && item.message.status === "streaming"}
                />
              ),
            )}
          </div>
        </div>
      </div>
    </div>
  );
}, activityGroupPropsEqual);

/* Shimmering "Working…" line with elapsed time, Codex-style. */
function WorkingIndicator() {
  const { t } = useTranslation();
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    const started = Date.now();
    const id = window.setInterval(
      () => setElapsed(Math.floor((Date.now() - started) / 1000)),
      1000,
    );
    return () => window.clearInterval(id);
  }, []);
  const time = formatToolDuration(elapsed);
  return (
    <div className="working-indicator">
      <span className="shimmer-text">{t("chat.running")}</span>
      {elapsed > 0 ? <span className="working-elapsed">{time}</span> : null}
    </div>
  );
}

const MessageRow = memo(function MessageRow({
  message,
  isRunning,
}: {
  message: UiMessage;
  isRunning: boolean;
}) {
  const { t } = useTranslation();
  const editUserMessage = useAppStore((s) => s.editUserMessage);
  const activateMessageRevision = useAppStore((s) => s.activateMessageRevision);
  const deleteMessage = useAppStore((s) => s.deleteMessage);
  const isUser = message.role === "user";
  // Slash prompts are stored expanded; editing works on the typed form so the
  // resent turn re-expands the template (D123).
  const editSeed = (isUser && message.command) || message.content || "";
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState(editSeed);
  const [savingEdit, setSavingEdit] = useState(false);
  const copyLabel = t("chat.copy");
  const editLabel = t("chat.editMessage");
  const deleteLabel = t("chat.deleteMessage");
  // Runtime chunks are already progressive. Rendering that source directly
  // avoids a second per-frame state loop while Markdown memoizes stable blocks.
  const displayed = message.content || "";
  const hasAnswer = Boolean((message.content || "").trim());
  const revisionCount = message.revisionCount ?? 0;
  const activeRevision = message.activeRevision ?? revisionCount;
  const showRevisionPager = isUser && revisionCount > 1;
  const cancelEdit = () => {
    setEditValue(editSeed);
    setEditing(false);
  };
  const saveEdit = async () => {
    const next = editValue.trim();
    if (savingEdit || !next) return;
    // An unchanged prompt is not worth a regenerate branch.
    if (next === editSeed.trim()) {
      setEditing(false);
      return;
    }
    setSavingEdit(true);
    const saved = await editUserMessage(message.id, next);
    setSavingEdit(false);
    if (saved) setEditing(false);
  };
  return (
    <div
      className={`message-row ${isUser ? "user" : message.role}`}
      data-minimap-id={message.id}
      role="article"
      aria-label={isUser ? t("chat.userMessage") : t("chat.assistantMessage")}
    >
      <div className="message-col">
        {isUser || displayed ? (
          <div className="message-bubble">
            {editing ? (
              <div className="message-edit">
                <textarea
                  className="message-edit-input selectable"
                  value={editValue}
                  rows={Math.min(12, Math.max(3, editValue.split("\n").length))}
                  aria-label={editLabel}
                  autoFocus
                  spellCheck={false}
                  autoCorrect="off"
                  autoCapitalize="off"
                  disabled={savingEdit}
                  onChange={(event) => setEditValue(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Escape") {
                      cancelEdit();
                    } else if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                      event.preventDefault();
                      void saveEdit();
                    }
                  }}
                />
                <div className="message-edit-actions">
                  <button
                    type="button"
                    className="copy-btn"
                    disabled={savingEdit}
                    onClick={cancelEdit}
                  >
                    {t("chat.cancelEdit")}
                  </button>
                  <button
                    type="button"
                    className="copy-btn primary"
                    disabled={savingEdit || !editValue.trim()}
                    onClick={() => void saveEdit()}
                  >
                    {savingEdit ? t("chat.savingEdit") : t("chat.saveEdit")}
                  </button>
                </div>
              </div>
            ) : isUser ? (
              <div className="message-user-text selectable">
                {message.command ? (
                  // Slash invocations show the typed form as a chip; the
                  // expanded template body lives in `content` (hover reveals
                  // it) and is what regenerate/reseed replay (D123).
                  <code
                    className="chat-command-chip"
                    title={String(message.content || "")}
                  >
                    {message.command}
                  </code>
                ) : (
                  <LinkifiedText text={String(message.content || "")} />
                )}
              </div>
            ) : (
              <div className="prose-chat">
                <Markdown source={displayed} />
              </div>
            )}
          </div>
        ) : null}
        {!editing && (hasAnswer || showRevisionPager) ? (
          <div className="message-actions">
            {showRevisionPager ? (
              <div className="message-revision-pager" role="group" aria-label={t("chat.revisions")}>
                <button
                  className="copy-btn icon revision-nav"
                  data-tip={t("chat.revisionPrev")}
                  aria-label={t("chat.revisionPrev")}
                  disabled={isRunning || activeRevision <= 1}
                  onClick={() =>
                    void activateMessageRevision(message.id, Math.max(1, activeRevision - 1))
                  }
                >
                  <IconChevronLeft size={13} />
                </button>
                <span className="message-revision-label">
                  {t("chat.revisionPager", {
                    current: activeRevision,
                    total: revisionCount,
                  })}
                </span>
                <button
                  className="copy-btn icon revision-nav"
                  data-tip={t("chat.revisionNext")}
                  aria-label={t("chat.revisionNext")}
                  disabled={isRunning || activeRevision >= revisionCount}
                  onClick={() =>
                    void activateMessageRevision(
                      message.id,
                      Math.min(revisionCount, activeRevision + 1),
                    )
                  }
                >
                  <IconChevronRight size={13} />
                </button>
              </div>
            ) : null}
            {hasAnswer ? <CopyButton text={message.content} label={copyLabel} /> : null}
            {isUser ? (
              <button
                className="copy-btn icon"
                data-tip={editLabel}
                aria-label={editLabel}
                disabled={isRunning}
                onClick={() => {
                  setEditValue(editSeed);
                  setEditing(true);
                }}
              >
                <IconPencil size={13} />
              </button>
            ) : null}
            {isUser ? (
              <button
                className="copy-btn icon danger"
                data-tip={deleteLabel}
                aria-label={deleteLabel}
                disabled={isRunning}
                onClick={() => void deleteMessage(message.id)}
              >
                <IconTrash size={13} />
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
});

type AssistantTurnProps = {
  entry: AssistantTurnEntry;
  isActive: boolean;
};

function assistantTurnPropsEqual(
  previous: AssistantTurnProps,
  next: AssistantTurnProps,
) {
  if (
    previous.isActive !== next.isActive ||
    previous.entry.anchorId !== next.entry.anchorId ||
    previous.entry.parts.length !== next.entry.parts.length
  ) {
    return false;
  }
  return previous.entry.parts.every((part, index) => {
    const nextPart = next.entry.parts[index];
    if (part.kind !== nextPart.kind) return false;
    if (part.kind === "message" && nextPart.kind === "message") {
      return part.message === nextPart.message;
    }
    if (part.kind === "activity" && nextPart.kind === "activity") {
      return (
        part.endedAt === nextPart.endedAt &&
        part.items.length === nextPart.items.length &&
        part.items.every(
          (item, itemIndex) =>
            item.kind === nextPart.items[itemIndex].kind &&
            item.message === nextPart.items[itemIndex].message,
        )
      );
    }
    return false;
  });
}

const AssistantTurn = memo(function AssistantTurn({
  entry,
  isActive,
}: AssistantTurnProps) {
  const { t } = useTranslation();
  const retryAssistantMessage = useAppStore((s) => s.retryAssistantMessage);
  const forkAssistantMessage = useAppStore((s) => s.forkAssistantMessage);
  const messages = assistantTurnMessages(entry);
  const content = assistantTurnContent(entry);
  const actionMessage = [...messages]
    .reverse()
    .find((message) => (message.content || "").trim());
  const metaMessage = [...messages]
    .reverse()
    .find((message) => message.modelId || message.usage);
  const usage = assistantTurnUsage(entry);
  const hasError = messages.some((message) => Boolean(message.error));
  const complete =
    !isActive && !hasError && Boolean(content) && Boolean(actionMessage);
  const streaming =
    isActive && messages.some((message) => message.status === "streaming");

  return (
    <div
      className={`message-row assistant assistant-turn${streaming ? " streaming" : ""}`}
      data-minimap-id={entry.anchorId}
      role="article"
      aria-label={t("chat.assistantMessage")}
    >
      <div className="message-col">
        {entry.parts.map((part, index) =>
          part.kind === "activity" ? (
            <ActivityGroup
              key={`activity-${part.items[0].message.id}`}
              items={part.items}
              endedAt={part.endedAt}
              isActive={isActive && index === entry.parts.length - 1}
            />
          ) : (
            <div
              className={`message-bubble assistant-turn-fragment${
                isActive && part.message.status === "streaming"
                  ? " streaming"
                  : ""
              }`}
              key={part.message.id}
            >
              {part.message.content ? (
                <div className="prose-chat">
                  <Markdown source={part.message.content} />
                </div>
              ) : null}
              {part.message.error ? (
                <AssistantErrorMessage message={part.message} />
              ) : null}
            </div>
          ),
        )}
        {!isActive && metaMessage && (metaMessage.modelId || usage) ? (
          <MessageMeta modelId={metaMessage.modelId} usage={usage} />
        ) : null}
        {(content || hasError) && actionMessage ? (
          <div className="message-actions">
            {content ? <CopyButton text={content} label={t("chat.copy")} /> : null}
            {complete ? (
              <button
                className="copy-btn icon"
                data-tip={t("chat.forkResponse")}
                aria-label={t("chat.forkResponse")}
                onClick={() => void forkAssistantMessage(actionMessage.id)}
              >
                <IconBranch size={13} />
              </button>
            ) : null}
            {complete ? (
              <button
                className="copy-btn icon"
                data-tip={t("chat.retry")}
                aria-label={t("chat.retry")}
                onClick={() => void retryAssistantMessage(actionMessage.id)}
              >
                <IconReview size={13} />
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}, assistantTurnPropsEqual);


export const ChatTranscript = memo(function ChatTranscript({
  sessionId,
  messages,
  isRunning,
  pendingPermission,
}: {
  sessionId: string | undefined;
  messages: UiMessage[];
  isRunning: boolean;
  pendingPermission?: PendingPermission;
}) {
  const { t } = useTranslation();
  const agentProgress = useAppStore((state) =>
    sessionId ? state.agentProgress[sessionId] : undefined,
  );
  const latestTurnResult = useAppStore((state) =>
    sessionId ? state.latestTurnResults[sessionId] : undefined,
  );
  const scrollRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const pinnedRef = useRef(true);
  const lastScrollTopRef = useRef(0);
  const wasRunningRef = useRef(isRunning);
  const followFrameRef = useRef(0);
  const [showJump, setShowJump] = useState(false);

  const scrollToBottom = useCallback((behavior: ScrollBehavior = "auto") => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior });
    lastScrollTopRef.current = el.scrollTop;
  }, []);

  const cancelFollowScroll = useCallback(() => {
    cancelAnimationFrame(followFrameRef.current);
    followFrameRef.current = 0;
  }, []);

  // A newly activated session must paint at its latest record. Reset any
  // manual-scroll state inherited from the previous session and position the
  // updated DOM during layout so no top-of-transcript frame can flash first.
  useLayoutEffect(() => {
    cancelFollowScroll();
    pinnedRef.current = true;
    setShowJump(false);
    scrollToBottom();
  }, [cancelFollowScroll, sessionId, scrollToBottom]);

  const scheduleFollowScroll = useCallback(() => {
    if (!pinnedRef.current || followFrameRef.current !== 0) return;
    followFrameRef.current = requestAnimationFrame(() => {
      followFrameRef.current = 0;
      if (pinnedRef.current) scrollToBottom();
    });
  }, [scrollToBottom]);

  useEffect(() => cancelFollowScroll, [cancelFollowScroll]);

  // Follow the stream only while the user is pinned to the bottom; a manual
  // scroll up pauses following and surfaces the jump-to-latest pill.
  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const transition = reduceTranscriptScroll({
      previousScrollTop: lastScrollTopRef.current,
      scrollTop: el.scrollTop,
      scrollHeight: el.scrollHeight,
      clientHeight: el.clientHeight,
      wasPinned: pinnedRef.current,
    });
    lastScrollTopRef.current = el.scrollTop;
    if (transition.releasedFollow) cancelFollowScroll();
    pinnedRef.current = transition.pinned;
    setShowJump(transition.showJump);
  }, [cancelFollowScroll]);

  // Send / retry / regenerate always re-pins follow mode so the new prompt and
  // its stream stay in view, even if the user had scrolled up through history.
  useEffect(() => {
    const turnStarted = isRunning && !wasRunningRef.current;
    wasRunningRef.current = isRunning;
    if (!turnStarted) return;
    pinnedRef.current = true;
    setShowJump(false);
    scrollToBottom();
    scheduleFollowScroll();
  }, [isRunning, scrollToBottom, scheduleFollowScroll]);

  useEffect(() => {
    scheduleFollowScroll();
  }, [messages, isRunning, pendingPermission?.requestId, scheduleFollowScroll]);

  // Streamed Markdown and expanded activity rows can change content height, so
  // keep pinned follow synchronized with the observed layout.
  useEffect(() => {
    const el = contentRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(scheduleFollowScroll);
    ro.observe(el);
    return () => ro.disconnect();
  }, [scheduleFollowScroll]);

  const { entries, visible } = useMemo(
    () => buildTranscriptEntries(messages),
    [messages],
  );
  const lastEntry = entries[entries.length - 1];
  const lastTurnPart =
    lastEntry?.kind === "assistant-turn" ? lastEntry.parts.at(-1) : undefined;
  const activeToolGroup = isRunning && lastTurnPart?.kind === "activity";
  const assistantIsAnswering =
    lastTurnPart?.kind === "message" &&
    lastTurnPart.message.status === "streaming" &&
    Boolean((lastTurnPart.message.content || "").trim());
  const showWorking =
    isRunning && !pendingPermission && !activeToolGroup && !assistantIsAnswering;

  return (
    <div className="thread-wrap">
      <ConversationMinimap scrollRef={scrollRef} messages={visible} />
      <div
        className="thread-scroll"
        ref={scrollRef}
        onScroll={handleScroll}
        role="log"
        aria-live="polite"
      >
        <div className="thread-content" ref={contentRef}>
          {entries.map((entry, index) =>
            entry.kind === "assistant-turn" ? (
              <AssistantTurn
                key={entry.id}
                entry={entry}
                isActive={isRunning && index === entries.length - 1}
              />
            ) : (
              <MessageRow
                key={entry.message.id}
                message={entry.message}
                isRunning={isRunning}
              />
            ),
          )}
          <TurnOutcomeCard
            messages={messages}
            result={latestTurnResult}
          />
          {pendingPermission ? (
            <PermissionCard
              key={pendingPermission.requestId}
              permission={pendingPermission}
            />
          ) : null}
          {isRunning ? (
            <AgentProgressTimeline
              progress={agentProgress}
              waitingForPermission={Boolean(pendingPermission)}
            />
          ) : showWorking ? (
            <WorkingIndicator />
          ) : null}
        </div>
      </div>
      {showJump ? (
        <button
          className="jump-latest-btn"
          aria-label={t("chat.scrollToBottom")}
          title={t("chat.scrollToBottom")}
          onClick={() => {
            pinnedRef.current = true;
            setShowJump(false);
            scrollToBottom(
              window.matchMedia("(prefers-reduced-motion: reduce)").matches
                ? "auto"
                : "smooth",
            );
          }}
        >
          <IconArrowDown size={14} />
        </button>
      ) : null}
    </div>
  );
});
