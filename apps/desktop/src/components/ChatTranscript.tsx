import {
  Fragment,
  memo,
  useCallback,
  useDeferredValue,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import type {
  ContextCompactionMark,
  MessageUsage,
  PlanningState,
  ProposalKind,
  UiMessage,
} from "@pi-desktop/shared";
import { proposalKindForMode } from "@pi-desktop/shared";
import { ConversationMinimap } from "./ConversationMinimap";
import { TurnOutcomeCard } from "./TurnOutcomeCard";
import { ReviewChangeCard } from "./ReviewChangeCard";
import { Markdown, useCopy } from "./Markdown";
import { ToolChips, ToolDetailBlocks } from "./ToolDetails";
import {
  formatToolDuration,
  getToolAction,
  getToolDisplayName,
  getToolSummary,
  type ToolAction,
} from "../lib/tool-display";
import {
  buildToolPresentation,
  hasToolDetails,
  toolResultChips,
} from "../lib/tool-presentation";
import { useOpenPreviewTarget } from "../lib/use-preview-target";
import {
  getToolPreviewTarget,
  splitChatText,
} from "../lib/chat-links";
import { reduceTranscriptScroll } from "../lib/transcript-scroll";
import {
  assistantTurnContent,
  assistantTurnMessages,
  assistantTurnResponseDuration,
  assistantTurnTools,
  assistantTurnUsage,
  buildTranscriptEntries,
  messageThinking as thinkingText,
  subagentRunsEqual,
  type AssistantActivityItem,
  type AssistantTurnEntry,
  type SubagentRun,
  type TranscriptEntry,
} from "../lib/assistant-turns";
import {
  aggregateToolTokenUsage,
  calculateCacheRate,
  calculateContextUsage,
  calculateTokenRate,
  DEFAULT_CONTEXT_WINDOW,
  latestMessageUsage,
  resolveContextWindow,
  usageTokenTotal,
} from "../lib/context-usage";
import {
  IconArrowDown,
  IconBot,
  IconBranch,
  IconCheck,
  IconCircleAlert,
  IconChevronLeft,
  IconChevronRight,
  IconCopy,
  IconFileText,
  IconFolder,
  IconGlobe,
  IconListChecks,
  IconPencil,
  IconSearch,
  IconReview,
  IconSparkles,
  IconTarget,
  IconTerminal,
  IconTrash,
  IconWrench,
} from "./icons";
import { useAppStore } from "../stores/app-store";
import type { PendingPermission } from "../lib/pending-permissions";
import { PermissionCard } from "./PermissionCard";

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

const CONTEXT_RING_RADIUS = 9;
const CONTEXT_RING_CIRCUMFERENCE = 2 * Math.PI * CONTEXT_RING_RADIUS;
const CONTEXT_POPOVER_GAP = 8;
const CONTEXT_VIEWPORT_MARGIN = 16;

type ContextPopoverPosition = {
  top: number;
  left: number;
};

function ContextUsageInspector({
  usage,
  turnUsage,
  contextWindow,
  tools,
  responseDurationMs,
}: {
  usage: MessageUsage;
  turnUsage: MessageUsage;
  contextWindow: number;
  tools: UiMessage[];
  responseDurationMs?: number;
}) {
  const { t } = useTranslation();
  const tooltipId = useId();
  // The transcript shows one row per compaction; the inspector adds what those
  // rows cannot — how much of the model context the newest summary occupies.
  const compaction = useAppStore((state) =>
    state.activeSessionId
      ? state.sessionCompactions[state.activeSessionId]?.at(-1)
      : undefined,
  );
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const closeTimerRef = useRef<number | undefined>(undefined);
  const [open, setOpen] = useState(false);
  const [popoverPosition, setPopoverPosition] =
    useState<ContextPopoverPosition | null>(null);
  const context = calculateContextUsage(usage, contextWindow);
  const turnTotal = usageTokenTotal(turnUsage);
  const throughput = calculateTokenRate(
    turnUsage.outputTokens,
    responseDurationMs,
  );
  const cacheRate = calculateCacheRate(
    turnUsage.inputTokens,
    turnUsage.cacheReadTokens,
  );
  const toolRows = aggregateToolTokenUsage(tools);
  const toolTotal = toolRows.reduce(
    (total, row) => total + row.totalTokens,
    0,
  );
  const level =
    context.remainingPercent <= 10
      ? "critical"
      : context.remainingPercent <= 25
        ? "warning"
      : "comfortable";

  const cancelClose = useCallback(() => {
    if (closeTimerRef.current !== undefined) {
      window.clearTimeout(closeTimerRef.current);
      closeTimerRef.current = undefined;
    }
  }, []);

  const openInspector = useCallback(() => {
    cancelClose();
    setOpen(true);
  }, [cancelClose]);

  const closeInspector = useCallback(() => {
    cancelClose();
    setOpen(false);
    setPopoverPosition(null);
  }, [cancelClose]);

  const scheduleClose = useCallback(() => {
    cancelClose();
    closeTimerRef.current = window.setTimeout(() => {
      closeTimerRef.current = undefined;
      const trigger = triggerRef.current;
      const popover = popoverRef.current;
      if (
        trigger?.matches(":focus") ||
        trigger?.matches(":hover") ||
        popover?.matches(":hover")
      ) {
        return;
      }
      setOpen(false);
      setPopoverPosition(null);
    }, 140);
  }, [cancelClose]);

  const updatePopoverPosition = useCallback(() => {
    const trigger = triggerRef.current;
    const popover = popoverRef.current;
    if (!trigger || !popover) return;

    const triggerRect = trigger.getBoundingClientRect();
    const triggerVisible =
      triggerRect.bottom > 0 && triggerRect.top < window.innerHeight;
    if (!triggerVisible) {
      setOpen(false);
      setPopoverPosition(null);
      return;
    }
    const popoverRect = popover.getBoundingClientRect();
    const maxLeft = Math.max(
      CONTEXT_VIEWPORT_MARGIN,
      window.innerWidth - popoverRect.width - CONTEXT_VIEWPORT_MARGIN,
    );
    const left = Math.min(
      Math.max(CONTEXT_VIEWPORT_MARGIN, triggerRect.left),
      maxLeft,
    );
    const above = triggerRect.top - popoverRect.height - CONTEXT_POPOVER_GAP;
    const below = triggerRect.bottom + CONTEXT_POPOVER_GAP;
    const maxTop = Math.max(
      CONTEXT_VIEWPORT_MARGIN,
      window.innerHeight - popoverRect.height - CONTEXT_VIEWPORT_MARGIN,
    );
    const top =
      above >= CONTEXT_VIEWPORT_MARGIN && above <= maxTop
        ? above
        : below >= CONTEXT_VIEWPORT_MARGIN && below <= maxTop
          ? below
          : Math.min(Math.max(CONTEXT_VIEWPORT_MARGIN, below), maxTop);

    setPopoverPosition((previous) =>
      previous?.top === top && previous.left === left
        ? previous
        : { top, left },
    );
  }, []);

  useLayoutEffect(() => {
    if (!open) return;
    const frame = window.requestAnimationFrame(updatePopoverPosition);
    return () => window.cancelAnimationFrame(frame);
  }, [
    compaction,
    context.usedTokens,
    contextWindow,
    open,
    toolRows.length,
    toolTotal,
    turnTotal,
    throughput,
    updatePopoverPosition,
  ]);

  useEffect(() => {
    if (!open) return;
    const handleViewportChange = () => updatePopoverPosition();
    window.addEventListener("resize", handleViewportChange);
    window.addEventListener("scroll", handleViewportChange, true);
    return () => {
      window.removeEventListener("resize", handleViewportChange);
      window.removeEventListener("scroll", handleViewportChange, true);
    };
  }, [open, updatePopoverPosition]);

  useEffect(() => {
    if (!open || !popoverRef.current || typeof ResizeObserver === "undefined") {
      return;
    }
    const observer = new ResizeObserver(updatePopoverPosition);
    observer.observe(popoverRef.current);
    return () => observer.disconnect();
  }, [open, updatePopoverPosition]);

  useEffect(
    () => () => {
      if (closeTimerRef.current !== undefined) {
        window.clearTimeout(closeTimerRef.current);
      }
    },
    [],
  );

  const popover = open ? (
    <div
      ref={popoverRef}
      className={`context-inspector-popover${popoverPosition ? " is-open" : ""}`}
      id={tooltipId}
      role="tooltip"
      style={
        popoverPosition
          ? {
              top: `${popoverPosition.top}px`,
              left: `${popoverPosition.left}px`,
            }
          : undefined
      }
      onPointerEnter={cancelClose}
      onPointerLeave={scheduleClose}
    >
      <div className="context-inspector-heading">
        <div className="context-inspector-heading-copy">
          <span className="context-inspector-eyebrow">
            <span className="context-inspector-status-dot" aria-hidden="true" />
            {t("chat.usageContextLabel")}
          </span>
          <strong>
            {t("chat.usageContextLeft", {
              count: formatTokenCount(context.remainingTokens),
            })}
          </strong>
        </div>
        <div className="context-inspector-remaining">
          <strong>{context.remainingPercent}%</strong>
          <span>{t("chat.usageContextRemaining")}</span>
        </div>
      </div>
      <div className="context-inspector-window">
        <span>{t("chat.usageContextWindow")}</span>
        <strong>
          {t("chat.usageContextTokens", {
            used: formatTokenCount(context.usedTokens),
            window: formatTokenCount(contextWindow),
          })}
        </strong>
      </div>
      <div className="context-inspector-meter-caption">
        <span>{t("chat.usageContextUsed")}</span>
        <span>{context.usedPercent}%</span>
      </div>
      <div className="context-inspector-meter" aria-hidden="true">
        <span style={{ width: `${context.usedPercent}%` }} />
      </div>
      <div className="context-inspector-kpis">
        <div>
          <span>{t("chat.usageTurnTotal")}</span>
          <strong>{formatTokenCount(turnTotal)}</strong>
        </div>
        <div>
          <span>{t("chat.usageThroughputLabel")}</span>
          <strong>
            {throughput === undefined
              ? t("chat.usageThroughputUnavailable")
              : t("chat.usageThroughput", {
                  count: formatTokenCount(throughput),
                })}
          </strong>
        </div>
      </div>
      <div className="context-inspector-section">
        <div className="context-inspector-section-heading">
          <div className="context-inspector-section-title">
            <strong>{t("chat.usageProviderUsage")}</strong>
          </div>
          <span className="context-inspector-source-badge exact">
            {t("chat.usageExact")}
          </span>
        </div>
        <div className="context-inspector-breakdown">
          <div className="context-inspector-row">
            <span>{t("chat.usageInput")}</span>
            <strong>{formatTokenCount(turnUsage.inputTokens)}</strong>
          </div>
          <div className="context-inspector-row">
            <span>{t("chat.usageOutput")}</span>
            <strong>{formatTokenCount(turnUsage.outputTokens)}</strong>
          </div>
          {turnUsage.cacheReadTokens !== undefined ? (
            <div className="context-inspector-row">
              <span>{t("chat.usageCacheRead")}</span>
              <strong>{formatTokenCount(turnUsage.cacheReadTokens)}</strong>
            </div>
          ) : null}
          {cacheRate !== undefined ? (
            <div className="context-inspector-row">
              <span>{t("chat.usageCacheRate")}</span>
              <strong>{cacheRate}%</strong>
            </div>
          ) : null}
          {turnUsage.cacheWriteTokens !== undefined ? (
            <div className="context-inspector-row">
              <span>{t("chat.usageCacheWrite")}</span>
              <strong>{formatTokenCount(turnUsage.cacheWriteTokens)}</strong>
            </div>
          ) : null}
          {turnUsage.reasoningTokens !== undefined ? (
            <div className="context-inspector-row">
              <span>{t("chat.usageReasoning")}</span>
              <strong>{formatTokenCount(turnUsage.reasoningTokens)}</strong>
            </div>
          ) : null}
        </div>
      </div>
      {compaction ? (
        <div className="context-inspector-compaction">
          <span>
            {t("chat.usageCompaction", { times: compaction.generation })}
          </span>
          <strong>~{formatTokenCount(compaction.summaryTokens)}</strong>
        </div>
      ) : null}
      <div className="context-inspector-section context-inspector-tools">
        <div className="context-inspector-section-heading">
          <div className="context-inspector-section-title">
            <strong>{t("chat.usageTools")}</strong>
            <span className="context-inspector-section-summary">
              {t("chat.usageToolsSummary", {
                count: toolRows.length,
                calls: tools.length,
                tokens: formatTokenCount(toolTotal),
              })}
            </span>
          </div>
          <span className="context-inspector-source-badge estimated">
            {t("chat.usageEstimated")}
          </span>
        </div>
        <p className="context-inspector-note">{t("chat.usageToolEstimate")}</p>
        {toolRows.length > 0 ? (
          <div className="context-inspector-tool-list">
            {toolRows.map((row) => {
              const percent =
                toolTotal > 0
                  ? Math.round((row.totalTokens / toolTotal) * 100)
                  : 0;
              const name =
                getToolDisplayName(row.toolName) ||
                row.toolName ||
                t("chat.usageUnknownTool");
              return (
                <div
                  className="context-inspector-tool"
                  key={row.toolName ?? "unknown-tool"}
                >
                  <div className="context-inspector-tool-heading">
                    <span title={row.toolName}>{name}</span>
                    <strong>~{formatTokenCount(row.totalTokens)}</strong>
                  </div>
                  <div className="context-inspector-tool-track" aria-hidden="true">
                    <span style={{ width: `${percent}%` }} />
                  </div>
                  <div className="context-inspector-tool-meta">
                    <span className="context-inspector-tool-meta-main">
                      <span className="context-inspector-tool-calls">
                        {t("chat.usageToolCalls", { count: row.callCount })}
                      </span>
                      <span className="context-inspector-tool-breakdown">
                        {t("chat.usageToolArgs", {
                          count: formatTokenCount(row.argumentTokens),
                        })}
                        {" · "}
                        {t("chat.usageToolResult", {
                          count: formatTokenCount(row.resultTokens),
                        })}
                      </span>
                    </span>
                    {row.durationMs !== undefined ? (
                      <span className="context-inspector-tool-duration">
                        {t("chat.usageToolDuration", {
                          time: formatToolDuration(row.durationMs / 1000),
                        })}
                      </span>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <p className="context-inspector-empty">{t("chat.usageNoTools")}</p>
        )}
      </div>
    </div>
  ) : null;

  return (
    <div
      className="context-inspector"
      data-level={level}
      data-open={open ? "true" : "false"}
    >
      <button
        ref={triggerRef}
        type="button"
        className="context-inspector-trigger"
        aria-describedby={open ? tooltipId : undefined}
        aria-expanded={open}
        aria-controls={open ? tooltipId : undefined}
        aria-label={t("chat.usageContextAria", {
          percent: context.remainingPercent,
          remaining: formatTokenCount(context.remainingTokens),
        })}
        onPointerEnter={openInspector}
        onPointerLeave={scheduleClose}
        onFocus={openInspector}
        onBlur={scheduleClose}
        onKeyDown={(event) => {
          if (event.key === "Escape") closeInspector();
        }}
      >
        <svg
          className="context-inspector-ring"
          viewBox="0 0 24 24"
          aria-hidden="true"
        >
          <circle
            className="context-inspector-ring-track"
            cx="12"
            cy="12"
            r={CONTEXT_RING_RADIUS}
          />
          <circle
            className="context-inspector-ring-progress"
            cx="12"
            cy="12"
            r={CONTEXT_RING_RADIUS}
            strokeDasharray={CONTEXT_RING_CIRCUMFERENCE}
            strokeDashoffset={
              CONTEXT_RING_CIRCUMFERENCE * (1 - context.remainingRatio)
            }
          />
        </svg>
        <span className="context-inspector-trigger-copy">
          <span>{t("chat.usageContextLabel")}</span>
          <strong>{context.remainingPercent}%</strong>
        </span>
      </button>
      {popover && typeof document !== "undefined"
        ? createPortal(popover, document.body)
        : null}
    </div>
  );
}

function MessageMeta({
  modelId,
  usage,
  contextUsage,
  contextWindow = DEFAULT_CONTEXT_WINDOW,
  tools = [],
  responseDurationMs,
}: {
  modelId?: string;
  usage?: MessageUsage;
  contextUsage?: MessageUsage;
  contextWindow?: number;
  tools?: UiMessage[];
  responseDurationMs?: number;
}) {
  const visibleContextUsage = contextUsage ?? usage;
  if (!modelId && !usage && !visibleContextUsage) return null;
  return (
    <div className="message-meta">
      {modelId ? (
        <span className="message-meta-chip model" title={modelId}>
          {modelId}
        </span>
      ) : null}
      {visibleContextUsage ? (
        <ContextUsageInspector
          usage={visibleContextUsage}
          turnUsage={usage ?? visibleContextUsage}
          contextWindow={contextWindow}
          tools={tools}
          responseDurationMs={responseDurationMs}
        />
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
  delegate: "chat.toolDelegated",
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
  delegate: "chat.toolDelegating",
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
    case "delegate":
      return <IconBot {...props} />;
    default:
      return <IconWrench {...props} />;
  }
}

/** Actions whose path/url argument makes sense to preview in the panel. */
const PREVIEWABLE_ACTIONS = new Set<ToolAction>(["read", "write", "edit", "fetch"]);

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

/** Definition name a `Task` row delegated to, from the rows it produced or,
 * before any arrived, from the call's own argument. */
function delegateAgentName(
  message: UiMessage,
  delegate?: SubagentRun,
): string {
  if (delegate?.agentName) return delegate.agentName;
  const args = message.toolArgs;
  if (args && typeof args === "object" && !Array.isArray(args)) {
    const requested = (args as { agent?: unknown }).agent;
    if (typeof requested === "string") return requested;
  }
  return "";
}

function ToolRow({
  message,
  delegate,
}: {
  message: UiMessage;
  /** Rows the delegate produced, when this row is a `Task` call (ADR 0062). */
  delegate?: SubagentRun;
}) {
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
  // A delegation is always expandable: its brief, report and the delegate's
  // own rows all live in the body.
  const hasDetails = hasToolDetails(message) || Boolean(delegate);
  const chips = toolResultChips(message);
  const agentName =
    action === "delegate" ? delegateAgentName(message, delegate) : "";
  // The delegate's last answer row is its report, so the body must not print
  // the same text a second time.
  const nestedReport = delegate?.items.some((item) => item.kind === "answer");
  // Streaming updates replace the message object each tick; only pay the
  // full payload walk once the row is actually expanded.
  const blocks =
    open && hasDetails
      ? buildToolPresentation(message, {
          hideSummaryArg: true,
          ...(nestedReport ? { hideDelegateReport: true } : {}),
        })
      : null;
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
        {agentName ? (
          <span className="tool-row-agent" title={t("chat.subagentAgent")}>
            {agentName}
          </span>
        ) : null}
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
        <ToolChips chips={chips} />
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
      {blocks && blocks.length > 0 ? (
        <div className="tool-row-body" id={detailsId}>
          <ToolDetailBlocks blocks={blocks} />
        </div>
      ) : null}
      {open && delegate ? (
        <SubagentRunRows run={delegate} agentName={agentName} />
      ) : null}
    </div>
  );
}

/**
 * What a delegate did, nested under the `Task` call that spawned it.
 *
 * The rows are the delegate's context, not the parent's, so they are visibly
 * one level in and stay collapsed with the call. Only one level is possible: a
 * delegate has no `Task` tool of its own (ADR 0062).
 */
function SubagentRunRows({
  run,
  agentName,
}: {
  run: SubagentRun;
  agentName: string;
}) {
  const { t } = useTranslation();
  if (run.items.length === 0) return null;
  return (
    <div className="subagent-run">
      <div className="subagent-run-heading">
        <IconBot size={13} aria-hidden />
        <span>
          {agentName
            ? t("chat.subagentWork", { agent: agentName })
            : t("chat.subagentWorkUnnamed")}
        </span>
        <span className="subagent-run-count">
          {t("chat.processingSteps", { count: run.items.length })}
        </span>
      </div>
      {run.items.map((item) =>
        item.kind === "tool" ? (
          <Fragment key={item.message.id}>
            <ToolRow message={item.message} />
            <ReviewChangeCard message={item.message} />
          </Fragment>
        ) : item.kind === "thinking" ? (
          <ThinkingRow
            key={`thinking-${item.message.id}`}
            message={item.message}
            streaming={item.message.status === "streaming"}
          />
        ) : (
          <div className="subagent-answer" key={`answer-${item.message.id}`}>
            {item.message.content ? (
              <div className="prose-chat">
                <Markdown source={item.message.content} />
              </div>
            ) : null}
            {item.message.error ? (
              <AssistantErrorMessage message={item.message} />
            ) : null}
          </div>
        ),
      )}
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

/** Whether two activity items render identically, delegate rows included. */
function activityItemsEqual(
  previous: ActivityItem,
  next: ActivityItem,
): boolean {
  if (previous.kind !== next.kind || previous.message !== next.message) {
    return false;
  }
  if (previous.kind === "tool" && next.kind === "tool") {
    return subagentRunsEqual(previous.delegate, next.delegate);
  }
  return true;
}

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
  return previous.items.every((item, index) =>
    activityItemsEqual(item, next.items[index]),
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
  const hasFailure = items.some((item) =>
    item.kind === "tool"
      ? item.message.toolStatus === "error"
      : item.message.status === "error",
  );
  // A provider/tool retry can leave an intermediate error row while the
  // active turn is still running. Do not paint the whole group as terminally
  // failed until the run has actually settled.
  const failed = !isActive && hasFailure;
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
                  <ToolRow
                    message={item.message}
                    {...(item.delegate ? { delegate: item.delegate } : {})}
                  />
                  <ReviewChangeCard message={item.message} />
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

/** Keep the transcript responsive while the model waits for its first event. */
function WorkingIndicator() {
  const { t } = useTranslation();
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    const startedAt = Date.now();
    const updateElapsed = () => {
      setElapsed(Math.floor((Date.now() - startedAt) / 1000));
    };
    const timer = window.setInterval(updateElapsed, 1000);
    return () => window.clearInterval(timer);
  }, []);

  return (
    <div
      className="working-indicator"
      data-testid="working-indicator"
      role="status"
      aria-live="polite"
    >
      <span className="shimmer-text">{t("chat.running")}</span>
      {elapsed > 0 ? (
        <span className="working-elapsed" aria-hidden="true">
          {formatToolDuration(elapsed)}
        </span>
      ) : null}
    </div>
  );
}

function PlanningIndicator({ kind }: { kind: ProposalKind }) {
  const { t } = useTranslation();
  return (
    <div
      className="planning-state-indicator"
      role="status"
      aria-live="polite"
      data-kind={kind}
    >
      {kind === "goal" ? (
        <IconTarget size={14} aria-hidden />
      ) : (
        <IconListChecks size={14} aria-hidden />
      )}
      <span>{t(`${kind}.planning`)}</span>
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
        part.items.every((item, itemIndex) =>
          activityItemsEqual(item, nextPart.items[itemIndex]),
        )
      );
    }
    return false;
  });
}

function compactionMarksEqual(
  previous: ContextCompactionMark,
  next: ContextCompactionMark,
): boolean {
  return (
    previous.id === next.id &&
    previous.throughMessageId === next.throughMessageId &&
    previous.generation === next.generation &&
    previous.summaryTokens === next.summaryTokens &&
    previous.summarized === next.summarized
  );
}

/** Compare the data that can change a transcript row's rendered output. */
function transcriptEntryEqual(
  previous: TranscriptEntry,
  next: TranscriptEntry,
): boolean {
  if (previous.kind !== next.kind) return false;
  if (previous.kind === "message" && next.kind === "message") {
    return previous.message === next.message;
  }
  if (previous.kind === "compaction" && next.kind === "compaction") {
    return compactionMarksEqual(previous.mark, next.mark);
  }
  if (previous.kind === "assistant-turn" && next.kind === "assistant-turn") {
    return assistantTurnPropsEqual(
      { entry: previous, isActive: false },
      { entry: next, isActive: false },
    );
  }
  return false;
}

function TranscriptEntryView({
  entry,
  isRunning,
  isActive,
}: {
  entry: TranscriptEntry;
  isRunning: boolean;
  isActive: boolean;
}) {
  if (entry.kind === "assistant-turn") {
    return <AssistantTurn entry={entry} isActive={isActive} />;
  }
  if (entry.kind === "compaction") {
    return <CompactionRow mark={entry.mark} />;
  }
  return <MessageRow message={entry.message} isRunning={isRunning} />;
}

function transcriptEntryKey(entry: TranscriptEntry): string {
  if (entry.kind === "compaction") return entry.mark.id;
  if (entry.kind === "assistant-turn") return entry.id;
  return entry.message.id;
}

type TranscriptHistoryProps = {
  entries: TranscriptEntry[];
  isRunning: boolean;
};

/**
 * Keep the completed transcript out of the streaming reconciliation path.
 * The projection is still rebuilt for correctness, but React can now bail out
 * before walking every historical row when only the active tail changed.
 */
const TranscriptHistory = memo(function TranscriptHistory({
  entries,
  isRunning,
}: TranscriptHistoryProps) {
  return (
    <>
      {entries.map((entry) => (
        <TranscriptEntryView
          key={transcriptEntryKey(entry)}
          entry={entry}
          isRunning={isRunning}
          isActive={false}
        />
      ))}
    </>
  );
}, (previous, next) => {
  if (
    previous.isRunning !== next.isRunning ||
    previous.entries.length !== next.entries.length
  ) {
    return false;
  }
  return previous.entries.every((entry, index) =>
    transcriptEntryEqual(entry, next.entries[index]),
  );
});

const TranscriptTail = memo(function TranscriptTail({
  entry,
  isRunning,
  isActive,
}: {
  entry: TranscriptEntry;
  isRunning: boolean;
  isActive: boolean;
}) {
  return (
    <TranscriptEntryView
      entry={entry}
      isRunning={isRunning}
      isActive={isActive}
    />
  );
}, (previous, next) =>
  previous.isRunning === next.isRunning &&
  previous.isActive === next.isActive &&
  transcriptEntryEqual(previous.entry, next.entry)
);

const AssistantTurn = memo(function AssistantTurn({
  entry,
  isActive,
}: AssistantTurnProps) {
  const { t } = useTranslation();
  const retryAssistantMessage = useAppStore((s) => s.retryAssistantMessage);
  const forkAssistantMessage = useAppStore((s) => s.forkAssistantMessage);
  const providerModels = useAppStore((s) => s.providerModels);
  const providers = useAppStore((s) => s.providers);
  const messages = assistantTurnMessages(entry);
  const content = assistantTurnContent(entry);
  const actionMessage = [...messages]
    .reverse()
    .find((message) => (message.content || "").trim());
  const metaMessage = [...messages]
    .reverse()
    .find((message) => message.modelId || message.usage);
  const latestUsageMessage = [...messages]
    .reverse()
    .find((message) => message.usage);
  const latestUsage = latestMessageUsage(messages);
  const usage = assistantTurnUsage(entry);
  const tools = assistantTurnTools(entry);
  const responseDurationMs = assistantTurnResponseDuration(entry);
  const modelId = metaMessage?.modelId ?? latestUsageMessage?.modelId;
  const contextWindow = latestUsage
    ? resolveContextWindow(
        latestUsageMessage?.providerId ?? metaMessage?.providerId,
        latestUsageMessage?.modelId ?? modelId,
        providerModels,
        providers,
      )
    : DEFAULT_CONTEXT_WINDOW;
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
          <MessageMeta
            modelId={modelId}
            usage={usage}
            contextUsage={latestUsage}
            contextWindow={contextWindow}
            tools={tools}
            responseDurationMs={responseDurationMs}
          />
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

/**
 * The transcript trace of one compaction, matching Codex's `ContextCompaction`
 * turn item: a divider that says the earlier turns above it are now a summary.
 * It carries no actions — nothing about a persisted checkpoint is undoable.
 */
function CompactionRow({ mark }: { mark: ContextCompactionMark }) {
  const { t } = useTranslation();
  return (
    <div className="transcript-compaction-row" role="separator">
      <span className="transcript-compaction-label">
        {t("chat.compactionRow", { times: mark.generation })}
      </span>
      <span className="transcript-compaction-detail">
        {mark.summarized
          ? t("chat.compactionRowSummary", {
              tokens: formatTokenCount(mark.summaryTokens),
            })
          : t("chat.compactionRowNoSummary")}
      </span>
    </div>
  );
}


export const ChatTranscript = memo(function ChatTranscript({
  sessionId,
  messages,
  isRunning,
  pendingPermission,
  queuedPermissions = 0,
  planningState,
}: {
  sessionId: string | undefined;
  messages: UiMessage[];
  isRunning: boolean;
  pendingPermission?: PendingPermission;
  /** Requests waiting behind this one, from other delegates (ADR 0062). */
  queuedPermissions?: number;
  planningState?: PlanningState;
}) {
  const { t } = useTranslation();
  const latestTurnResult = useAppStore((state) =>
    sessionId ? state.latestTurnResults[sessionId] : undefined,
  );
  const approvalPending = useAppStore((state) =>
    Boolean(
      sessionId && state.pendingPlans[sessionId]?.status === "pending",
    ),
  );
  // Plan and Goal both project `planning`; the durable mode names which
  // contract is being written, so the indicator can use that kind's copy.
  const planningKind = useAppStore(
    (state) =>
      proposalKindForMode(
        state.sessions.find((session) => session.id === sessionId)?.mode ??
          "agent",
      ) ?? "plan",
  );
  const compactions = useAppStore((state) =>
    sessionId ? state.sessionCompactions[sessionId] : undefined,
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
    const targetTop = Math.max(0, el.scrollHeight - el.clientHeight);
    el.scrollTo({ top: targetTop, behavior });
    // `scrollTo({ behavior: "auto" })` is synchronous. Recording the exact
    // target avoids the following native scroll event being mistaken for a
    // user gesture when the composer or the new turn changes the content
    // height in the same frame.
    if (behavior === "auto") lastScrollTopRef.current = targetTop;
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
  // This must run in the layout phase: the send state is committed before the
  // persisted user-message event arrives, and a passive effect allows one
  // frame where a long transcript can remain at its old/top position.
  useLayoutEffect(() => {
    const turnStarted = isRunning && !wasRunningRef.current;
    wasRunningRef.current = isRunning;
    if (!turnStarted) return;
    cancelFollowScroll();
    pinnedRef.current = true;
    setShowJump(false);
    scrollToBottom();
    scheduleFollowScroll();
  }, [
    cancelFollowScroll,
    isRunning,
    scheduleFollowScroll,
    scrollToBottom,
  ]);

  useLayoutEffect(() => {
    scheduleFollowScroll();
  }, [
    messages,
    isRunning,
    pendingPermission?.requestId,
    approvalPending,
    planningState,
    scheduleFollowScroll,
  ]);

  // Streamed Markdown and expanded activity rows can change content height, so
  // keep pinned follow synchronized with the observed layout.
  useEffect(() => {
    const el = contentRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(scheduleFollowScroll);
    ro.observe(el);
    return () => ro.disconnect();
  }, [scheduleFollowScroll]);

  // Store updates are intentionally immediate for controls and status, but a
  // streamed token should not force the full historical transcript tree to
  // rebuild at the same priority. React keeps the latest tail responsive and
  // schedules this heavier projection between paints.
  const renderedMessages = useDeferredValue(messages);
  const renderedCompactions = useDeferredValue(compactions);
  const { entries, visible } = useMemo(
    () => buildTranscriptEntries(renderedMessages, renderedCompactions),
    [renderedMessages, renderedCompactions],
  );
  const historyEntries = entries.slice(0, -1);
  const tailEntry = entries.at(-1);
  const lastEntry = entries[entries.length - 1];
  const lastTurnPart =
    lastEntry?.kind === "assistant-turn" ? lastEntry.parts.at(-1) : undefined;
  const activeToolGroup = isRunning && lastTurnPart?.kind === "activity";
  const assistantIsAnswering =
    lastTurnPart?.kind === "message" &&
    lastTurnPart.message.status === "streaming" &&
    Boolean((lastTurnPart.message.content || "").trim());
  // Show immediate feedback after send, then let the concrete activity row
  // (thinking/tool/answer) take over so the transcript never duplicates state.
  const showWorking =
    isRunning &&
    !pendingPermission &&
    !approvalPending &&
    planningState !== "planning" &&
    !activeToolGroup &&
    !assistantIsAnswering;
  const showPlanning =
    isRunning && planningState === "planning" && !approvalPending && !pendingPermission;

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
          <TranscriptHistory entries={historyEntries} isRunning={isRunning} />
          {tailEntry ? (
            <TranscriptTail
              entry={tailEntry}
              isRunning={isRunning}
              isActive={isRunning && tailEntry.kind === "assistant-turn"}
            />
          ) : null}
          <TurnOutcomeCard
            messages={messages}
            result={latestTurnResult}
          />
          {pendingPermission ? (
            <PermissionCard
              key={pendingPermission.requestId}
              permission={pendingPermission}
              queued={queuedPermissions}
            />
          ) : null}
          {showPlanning ? <PlanningIndicator kind={planningKind} /> : null}
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
