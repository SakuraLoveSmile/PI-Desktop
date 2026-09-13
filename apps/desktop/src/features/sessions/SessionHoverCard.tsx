import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import type { ProjectWorkspace, SessionCollaborationSummary } from "@pi-desktop/shared";
import { api } from "../../lib/api";
import { IconBranch, IconClock, IconFolder } from "../../components/icons";
import { observeSessionCollaboration } from "./session-collaboration-reader";
import {
  collaborationStatusKey,
  currentCollaborationResult,
  formatSessionTimestamp,
  positionSessionHoverCard,
  sessionPreview,
} from "./session-collaboration-view";
import type { SessionHoverCardData } from "./useSessionHoverCard";

export function SessionHoverCard({
  card,
  refreshProject,
}: {
  card: SessionHoverCardData;
  refreshProject: (path: string) => Promise<ProjectWorkspace | null>;
}) {
  const { t, i18n } = useTranslation();
  const elementRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<{ top: number; left: number }>();
  const [summary, setSummary] = useState<SessionCollaborationSummary>();
  const [readState, setReadState] = useState<"loading" | "ready" | "unavailable">("loading");
  const [project, setProject] = useState<{ space: string; branch?: string }>({
    space: card.space,
    branch: card.branch,
  });
  const { session, target } = card;

  useEffect(() => observeSessionCollaboration({
    sessionId: session.id,
    read: api.getSessionCollaboration,
    isVisible: () => target.isConnected && !document.hidden,
    onSummary: (next) => {
      setSummary(next);
      setReadState("ready");
    },
    onUnavailable: () => setReadState("unavailable"),
  }), [session.id, target]);

  useEffect(() => {
    if (card.temporary) return;
    let current = true;
    void refreshProject(session.projectPath ?? "").then((workspace) => {
      if (current && target.isConnected && workspace) {
        setProject({ space: workspace.name, branch: workspace.branch });
      }
    }).catch(() => {
      // The cached project label and branch remain useful when this optional read fails.
    });
    return () => { current = false; };
  }, [card.temporary, refreshProject, session.projectPath, target]);

  useLayoutEffect(() => {
    const element = elementRef.current;
    if (!element) return;
    const place = () => {
      if (!target.isConnected) return;
      setPosition(positionSessionHoverCard(
        target.getBoundingClientRect(),
        { width: element.offsetWidth, height: element.offsetHeight },
        { width: window.innerWidth, height: window.innerHeight },
      ));
    };
    place();
    const observer = new ResizeObserver(place);
    observer.observe(element);
    return () => observer.disconnect();
  }, [target]);

  const modeKey = session.mode === "plan" ? "chat.modePlan"
    : session.mode === "goal" ? "chat.modeGoal"
      : session.permissionMode === "auto" ? "chat.permissionAuto"
        : session.permissionMode === "accept-edits" ? "chat.permissionAcceptEdits"
          : session.permissionMode === "ask" ? "chat.permissionAsk" : "chat.modeAgent";
  const result = summary ? currentCollaborationResult(summary) : undefined;
  const modelKey = summary?.modelKey ?? session.modelId;
  const timestamp = (value: string | undefined) => formatSessionTimestamp(value, i18n.language);

  return createPortal(
    <div
      ref={elementRef}
      id={`session-hover-${session.id}`}
      className="sidebar-session-hover-card"
      role="tooltip"
      data-session-collaboration={session.id}
      style={{ ...position, visibility: position ? "visible" : "hidden" }}
    >
      <div className="sidebar-session-hover-card-title">{session.title}</div>
      <div className="sidebar-session-hover-card-tags">
        <span className="sidebar-session-hover-card-tag">
          <IconBranch size={12} aria-hidden />
          {summary?.createdBySession ? t("sessionCollaboration.sessionTask") : t("nav.hoverCardLocalTask")}
        </span>
        <span className="sidebar-session-hover-card-tag sidebar-session-hover-card-tag-accent">{t(modeKey)}</span>
        <span className="sidebar-session-hover-card-status" data-status={readState === "ready" ? summary?.status : readState}>
          {readState === "ready" && summary
            ? t(collaborationStatusKey(summary.status))
            : readState === "unavailable" ? t("sessionCollaboration.unavailable") : t("sessionCollaboration.loading")}
        </span>
      </div>
      <code className="sidebar-session-hover-card-id">{session.id}</code>
      {summary?.createdBySession ? (
        <div className="sidebar-session-hover-card-section">
          <span className="sidebar-session-hover-card-section-label">{t("sessionCollaboration.createdBy")}</span>
          <span className="sidebar-session-hover-card-preview">{summary.createdBySession.title || summary.createdBySession.sessionId}</span>
          <code className="sidebar-session-hover-card-id">{summary.createdBySession.sessionId}</code>
        </div>
      ) : null}
      {summary?.currentTask ? (
        <div className="sidebar-session-hover-card-section">
          <span className="sidebar-session-hover-card-section-label">{t("sessionCollaboration.currentTask")}</span>
          <span className="sidebar-session-hover-card-peer">
            {t("sessionCollaboration.receivedFrom", { name: summary.currentTask.senderSession.title || summary.currentTask.senderSession.sessionId })}
          </span>
          <span className="sidebar-session-hover-card-preview">{sessionPreview(summary.currentTask.text)}</span>
        </div>
      ) : null}
      {summary?.recentExchanges.length ? (
        <div className="sidebar-session-hover-card-section">
          <span className="sidebar-session-hover-card-section-label">{t("sessionCollaboration.recentMessages")}</span>
          <ol className="sidebar-session-hover-card-exchanges">
            {summary.recentExchanges.slice(0, 2).map((exchange) => (
              <li key={exchange.messageId}>
                <span className="sidebar-session-hover-card-peer">
                  {t(exchange.direction === "incoming" ? "sessionCollaboration.receivedFrom" : "sessionCollaboration.sentTo", {
                    name: exchange.peer.title || exchange.peer.sessionId,
                  })}
                </span>
                <span className="sidebar-session-hover-card-preview">{sessionPreview(exchange.preview, 180)}</span>
              </li>
            ))}
          </ol>
        </div>
      ) : null}
      {result && (result.error || result.text) ? (
        <div className="sidebar-session-hover-card-section" data-result-status={result.status}>
          <span className="sidebar-session-hover-card-section-label">
            {result.error ? t("sessionCollaboration.failure") : t("sessionCollaboration.result")}
          </span>
          <span className="sidebar-session-hover-card-preview">{sessionPreview(result.error || result.text)}</span>
        </div>
      ) : null}
      <div className="sidebar-session-hover-card-meta">
        {modelKey ? (
          <div className="sidebar-session-hover-card-detail">
            <span className="sidebar-session-hover-card-meta-label">{t("sessionCollaboration.model")}</span>
            <span className="sidebar-session-hover-card-model">{modelKey}</span>
          </div>
        ) : null}
        <div className="sidebar-session-hover-card-meta-row">
          <span className="sidebar-session-hover-card-meta-icon" aria-hidden><IconFolder size={12} /></span>
          <span className="sidebar-session-hover-card-meta-label">{t("nav.hoverCardSpace")}</span>
          <span className="sidebar-session-hover-card-meta-value">{project.space}</span>
        </div>
        {project.branch ? (
          <div className="sidebar-session-hover-card-meta-row">
            <span className="sidebar-session-hover-card-meta-icon" aria-hidden><IconBranch size={12} /></span>
            <span className="sidebar-session-hover-card-meta-value" aria-label={t("nav.hoverCardBranchAria", { name: project.branch })}>
              {project.branch}
            </span>
          </div>
        ) : null}
        <div className="sidebar-session-hover-card-meta-row">
          <span className="sidebar-session-hover-card-meta-icon" aria-hidden><IconClock size={12} /></span>
          <span className="sidebar-session-hover-card-meta-label">
            {t("nav.hoverCardUpdatedAt", { when: timestamp(session.updatedAt) })}
          </span>
        </div>
        {summary ? <span className="sidebar-session-hover-card-observed">{t("sessionCollaboration.checkedAt", { when: timestamp(summary.observedAt) })}</span> : null}
      </div>
    </div>,
    document.body,
  );
}
