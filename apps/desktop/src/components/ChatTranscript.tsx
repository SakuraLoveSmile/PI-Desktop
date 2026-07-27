import {
  memo,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { useTranslation } from "react-i18next";
import type { MessageUsage, UiMessage } from "@pi-desktop/shared";
import { ConversationMinimap } from "./ConversationMinimap";
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
import { summarizeSessionWorkspaceChanges } from "../lib/workspace-review";
import { toolWorkPanelTab } from "../lib/work-panel-tabs";
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

function WorkspaceChangesEntry() {
  const { t } = useTranslation();
  const activeSessionId = useAppStore((state) => state.activeSessionId);
  const workspacePath = useAppStore((state) => state.workspace?.path);
  const diffPath = useAppStore((state) => state.workspaceDiffPath);
  const diff = useAppStore((state) => state.workspaceDiff);
  const reviewSessions = useAppStore((state) => state.workspaceReviewSessions);
  const openWorkPanelTab = useAppStore((state) => state.openWorkPanelTab);
  const summary = summarizeSessionWorkspaceChanges({
    diff,
    diffPath,
    workspacePath,
    sessionId: activeSessionId,
    reviewSessions,
  });

  if (!summary) return null;

  const countLabel = t(
    summary.truncated
      ? "chat.reviewChangedFilesTruncated"
      : "chat.reviewChangedFiles",
    { count: summary.fileCount },
  );
  const accessibleLabel = t(
    summary.truncated
      ? "chat.reviewChangesAccessibleTruncated"
      : "chat.reviewChangesAccessible",
    {
      count: summary.fileCount,
      additions: summary.additions,
      deletions: summary.deletions,
    },
  );

  return (
    <div className="review-changes-entry">
      <button
        type="button"
        className="review-changes-button"
        aria-label={accessibleLabel}
        onClick={() => openWorkPanelTab(toolWorkPanelTab("review"))}
      >
        <span className="review-changes-icon" aria-hidden>
          <IconDiff size={15} />
        </span>
        <span className="review-changes-title">{t("chat.reviewChanges")}</span>
        <span className="review-changes-meta">{countLabel}</span>
        <span className="diff-file-counts" aria-hidden>
          <span className="diff-count-add">+{summary.additions}</span>
          <span className="diff-count-del">−{summary.deletions}</span>
        </span>
        <span className="review-changes-caret" aria-hidden>
          <IconChevronRight size={13} />
        </span>
      </button>
    </div>
  );
}

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
type ActivityItem =
  | { kind: "thinking"; message: UiMessage }
  | { kind: "tool"; message: UiMessage };

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
            <Markdown source={text} />
          </div>
        </div>
      ) : null}
    </div>
  );
}

function ActivityGroup({
  items,
  isActive,
  endedAt,
}: {
  items: ActivityItem[];
  isActive: boolean;
  endedAt?: string;
}) {
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
                <ToolRow key={item.message.id} message={item.message} />
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
}

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

function thinkingText(message: UiMessage): string {
  if (typeof message.thinking !== "string") return "";
  return message.thinking.trim() ? message.thinking : "";
}

/* Typewriter reveal for streaming assistant messages: incoming chunks
 * accumulate in message.content (the buffer); we surface it a few characters
 * per animation frame, speeding up with backlog so the display never trails
 * far behind. Messages that arrive already complete (history loads) render in
 * full, and reduced-motion users get the buffer verbatim. */
const reduceMotionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");

function usePrefersReducedMotion() {
  return useSyncExternalStore(
    (onChange) => {
      reduceMotionQuery.addEventListener("change", onChange);
      return () => reduceMotionQuery.removeEventListener("change", onChange);
    },
    () => reduceMotionQuery.matches,
  );
}

function useTypewriter(message: UiMessage) {
  const target = message.content || "";
  const animate = message.role === "assistant";
  const reduceMotion = usePrefersReducedMotion();
  const everStreamedRef = useRef(message.status === "streaming");
  if (message.status === "streaming") everStreamedRef.current = true;
  const reveal = animate && everStreamedRef.current && !reduceMotion;
  const [visibleLen, setVisibleLen] = useState(() => (reveal ? 0 : target.length));
  const visibleLenRef = useRef(visibleLen);
  const targetRef = useRef(target);
  targetRef.current = target;
  const statusRef = useRef(message.status);
  statusRef.current = message.status;

  useEffect(() => {
    if (!reveal) {
      visibleLenRef.current = target.length;
      setVisibleLen(target.length);
      return;
    }
    let raf = 0;
    const tick = () => {
      const full = targetRef.current;
      const len = visibleLenRef.current;
      if (len < full.length) {
        const backlog = full.length - len;
        const step = Math.max(1, Math.round(backlog / 24));
        const next = Math.min(full.length, len + step);
        visibleLenRef.current = next;
        setVisibleLen(next);
      } else if (statusRef.current !== "streaming") {
        // Caught up and the stream ended — stop until new content arrives
        // (the effect restarts when `target` changes).
        return;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [reveal, target]);

  if (!reveal) return target;
  return target.slice(0, Math.min(visibleLen, target.length));
}

const MessageRow = memo(function MessageRow({
  message,
  isRunning,
}: {
  message: UiMessage;
  isRunning: boolean;
}) {
  const { t } = useTranslation();
  const retryAssistantMessage = useAppStore((s) => s.retryAssistantMessage);
  const forkAssistantMessage = useAppStore((s) => s.forkAssistantMessage);
  const editUserMessage = useAppStore((s) => s.editUserMessage);
  const activateMessageRevision = useAppStore((s) => s.activateMessageRevision);
  const deleteMessage = useAppStore((s) => s.deleteMessage);
  const isUser = message.role === "user";
  const isAssistant = message.role === "assistant";
  // Slash prompts are stored expanded; editing works on the typed form so the
  // resent turn re-expands the template (D123).
  const editSeed = (isUser && message.command) || message.content || "";
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState(editSeed);
  const [savingEdit, setSavingEdit] = useState(false);
  const copyLabel = t("chat.copy");
  const retryLabel = t("chat.retry");
  const forkLabel = t("chat.forkResponse");
  const editLabel = t("chat.editMessage");
  const deleteLabel = t("chat.deleteMessage");
  const displayed = useTypewriter(message);
  const hasAnswer = Boolean((message.content || "").trim());
  const hasError = Boolean(message.error);
  const streaming =
    !isUser && isRunning && message.status === "streaming";
  const completeAssistant =
    isAssistant && message.status !== "streaming" && hasAnswer;
  const showAnswer = isUser || Boolean(displayed) || isRunning || hasError;
  const showMeta = completeAssistant && Boolean(message.modelId || message.usage);
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
      className={`message-row ${isUser ? "user" : message.role}${streaming ? " streaming" : ""}`}
      data-minimap-id={message.id}
      role="article"
      aria-label={isUser ? t("chat.userMessage") : t("chat.assistantMessage")}
    >
      <div className="message-col">
        {showAnswer ? (
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
              <>
                {displayed ? (
                  <div className="prose-chat">
                    <Markdown source={displayed} />
                  </div>
                ) : null}
                {message.error ? <AssistantErrorMessage message={message} /> : null}
                {!displayed && !message.error && isRunning ? (
                  <div className="prose-chat">
                    <Markdown source="…" />
                  </div>
                ) : null}
              </>
            )}
          </div>
        ) : null}
        {showMeta && !editing ? (
          <MessageMeta modelId={message.modelId} usage={message.usage} />
        ) : null}
        {!editing && (hasAnswer || hasError || showRevisionPager) ? (
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
            {completeAssistant ? (
              <button
                className="copy-btn icon"
                data-tip={forkLabel}
                aria-label={forkLabel}
                disabled={isRunning}
                onClick={() => void forkAssistantMessage(message.id)}
              >
                <IconBranch size={13} />
              </button>
            ) : null}
            {completeAssistant ? (
              <button
                className="copy-btn icon"
                data-tip={retryLabel}
                aria-label={retryLabel}
                disabled={isRunning}
                onClick={() => void retryAssistantMessage(message.id)}
              >
                <IconReview size={13} />
              </button>
            ) : null}
            {isUser && !streaming ? (
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
            {isUser && !streaming ? (
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


export function ChatTranscript({
  messages,
  isRunning,
  pendingPermission,
}: {
  messages: UiMessage[];
  isRunning: boolean;
  pendingPermission?: PendingPermission;
}) {
  const { t } = useTranslation();
  const scrollRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const pinnedRef = useRef(true);
  const [showJump, setShowJump] = useState(false);

  const scrollToBottom = useCallback((behavior: ScrollBehavior = "auto") => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior });
  }, []);

  // Follow the stream only while the user is pinned to the bottom; a manual
  // scroll up pauses following and surfaces the jump-to-latest pill.
  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
    pinnedRef.current = atBottom;
    setShowJump(!atBottom);
  }, []);

  useEffect(() => {
    if (pinnedRef.current) scrollToBottom();
  }, [messages, isRunning, pendingPermission?.requestId, scrollToBottom]);

  // The typewriter reveal grows message height without changing `messages`,
  // so follow content resizes too while pinned to the bottom.
  useEffect(() => {
    const el = contentRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => {
      if (pinnedRef.current) scrollToBottom();
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [scrollToBottom]);

  const visible = messages.filter((message) => {
    if (
      message.role === "assistant" &&
      !(message.content || "").trim() &&
      !thinkingText(message) &&
      !message.error
    )
      return false;
    return true;
  });
  const minimapMessages = visible.filter(
    (message) =>
      message.role === "user" ||
      (message.role === "assistant" && (message.content || "").trim()),
  );
  // Thinking segments and tool calls between two answers merge into one
  // activity group, so a long agent loop reads as a single "Processed"
  // disclosure instead of alternating "Thinking" / tool rows.
  const entries: Array<
    | { kind: "message"; message: UiMessage }
    | { kind: "activity"; items: ActivityItem[]; endedAt?: string }
  > = [];
  const pushActivity = (item: ActivityItem) => {
    const last = entries[entries.length - 1];
    if (last?.kind === "activity") last.items.push(item);
    else entries.push({ kind: "activity", items: [item] });
  };
  for (const message of visible) {
    if (message.role === "tool") {
      pushActivity({ kind: "tool", message });
      continue;
    }
    if (message.role === "assistant") {
      if (thinkingText(message)) pushActivity({ kind: "thinking", message });
      if ((message.content || "").trim() || !thinkingText(message)) {
        entries.push({ kind: "message", message });
      }
      continue;
    }
    entries.push({ kind: "message", message });
  }
  // An answer following a group closes it; skip the timestamp when the
  // answer is the same message as a thinking segment (its createdAt marks
  // the start of thinking, not the end).
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index];
    const next = entries[index + 1];
    if (
      entry.kind === "activity" &&
      next?.kind === "message" &&
      next.message.role === "assistant" &&
      !entry.items.some((item) => item.message.id === next.message.id)
    ) {
      entry.endedAt = next.message.createdAt;
    }
  }
  const activeToolGroup =
    isRunning && entries[entries.length - 1]?.kind === "activity";
  const lastEntry = entries[entries.length - 1];
  const assistantIsAnswering =
    lastEntry?.kind === "message" &&
    lastEntry.message.role === "assistant" &&
    lastEntry.message.status === "streaming" &&
    Boolean((lastEntry.message.content || "").trim());
  const showWorking =
    isRunning && !pendingPermission && !activeToolGroup && !assistantIsAnswering;

  return (
    <div className="thread-wrap">
      <ConversationMinimap scrollRef={scrollRef} messages={minimapMessages} />
      <div
        className="thread-scroll"
        ref={scrollRef}
        onScroll={handleScroll}
        role="log"
        aria-live="polite"
      >
        <div className="thread-content" ref={contentRef}>
          {entries.map((entry, index) =>
            entry.kind === "activity" ? (
              <ActivityGroup
                key={`activity-${entry.items[0].message.id}`}
                items={entry.items}
                endedAt={entry.endedAt}
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
          <WorkspaceChangesEntry />
          {pendingPermission ? (
            <PermissionCard
              key={pendingPermission.requestId}
              permission={pendingPermission}
            />
          ) : null}
          {showWorking ? <WorkingIndicator /> : null}
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
            scrollToBottom("smooth");
          }}
        >
          <IconArrowDown size={14} />
        </button>
      ) : null}
    </div>
  );
}
