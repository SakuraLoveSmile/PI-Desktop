import { useLayoutEffect, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useTeamMemberTranscript } from "../../../hooks/useTeamMemberTranscript";
import { useTeamSnapshot } from "../../../hooks/useTeamSnapshot";
import { useFollowScroll } from "../../../hooks/use-follow-scroll";
import { DisclosureAnchorContext } from "../../../lib/disclosure-anchor-context";
import { TooltipButton } from "../../ui";
import { IconArrowDown, IconCircleAlert, IconRefresh } from "../../icons";
import { TranscriptDisclosureProvider } from "../../../features/chat/transcript/disclosure";
import { ToolRow } from "../../../features/chat/transcript/ToolRow";
import { Markdown } from "../../Markdown";
import { AssistantErrorMessage, ThinkingRow } from "../../../features/chat/transcript/shared";
import { buildTeamMemberTranscriptRows } from "../../../lib/team-member-transcript";

export function TeamMemberTranscript({ memberSessionId, teamSessionId, isRunning = false, tabBody = false }: {
  memberSessionId: string; teamSessionId?: string; isRunning?: boolean; tabBody?: boolean;
}) {
  const { t } = useTranslation();
  const { snapshot } = useTeamSnapshot(teamSessionId);
  const { messages, loading, error, truncated } = useTeamMemberTranscript(memberSessionId, { snapshotRevision: snapshot?.revision });
  const { scrollRef, contentRef, showJump, handleScroll, jumpToLatest, scheduleFollowScroll, disclosureAnchorNotifier } = useFollowScroll();
  useLayoutEffect(() => { if (tabBody) jumpToLatest(); }, [tabBody, memberSessionId, jumpToLatest]);
  useLayoutEffect(() => { if (tabBody) scheduleFollowScroll(); }, [tabBody, messages, scheduleFollowScroll]);
  const rows = useMemo(() => buildTeamMemberTranscriptRows(messages), [messages]);

  const content = (
    <div ref={tabBody ? contentRef : undefined}>
      {!tabBody ? <div className="team-section-header"><span>{t("team.transcript")}</span></div> : null}
      {truncated ? <p className="team-transcript-notice" role="status">{t("team.transcriptTruncated")}</p> : null}
      {loading && rows.length === 0 ? (
        <div className="team-loading-state">
          <IconRefresh className="animate-spin" size={18} />
          <span>{t("common.loading")}</span>
        </div>
      ) : null}
      {error ? (
        <div className="team-error-state">
          <IconCircleAlert size={20} />
          <span>{error}</span>
        </div>
      ) : null}
      {!loading && !error && rows.length === 0 ? (
        <div className="team-empty-state">{t("team.noTranscript")}</div>
      ) : null}
      {rows.length > 0 ? (
        <TranscriptDisclosureProvider key={memberSessionId}>
          <div className="team-transcript-list">
            {rows.map(({ kind, message }) => kind === "user" ? (
              <div key={`user-${message.id}`} className="message-row user">
                <div className="message-col">
                  <div className="message-bubble">
                    <div className="message-user-text selectable">{message.content}</div>
                  </div>
                </div>
              </div>
            ) : kind === "tool" ? (
              <div key={`tool-${message.id}`} className="team-transcript-tool-item">
                <ToolRow message={message} />
              </div>
            ) : kind === "thinking" ? (
              <ThinkingRow key={`thinking-${message.id}`} message={message}
                streaming={isRunning && message.status === "streaming"} />
            ) : (
              <div key={`answer-${message.id}`} className="message-row assistant" data-message-id={message.id}>
                <div className="message-col">
                  <div className="message-bubble">
                    {message.content ? (
                      <div className="prose-chat selectable"><Markdown source={message.content} /></div>
                    ) : null}
                    {message.error ? <AssistantErrorMessage message={message} /> : null}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </TranscriptDisclosureProvider>
      ) : null}
    </div>
  );
  if (!tabBody) return <section className="team-section team-transcript-section">{content}</section>;
  return (
    <DisclosureAnchorContext.Provider value={disclosureAnchorNotifier}>
      <div ref={scrollRef} className="team-work-tab-body" data-scroll-owner="follow" onScroll={handleScroll}
        role="log" aria-live="polite" aria-label={t("team.transcript")} tabIndex={0}>{content}</div>
      {showJump ? <TooltipButton className="jump-latest-btn team-work-tab-jump" tooltip={t("chat.scrollToBottom")}
        ariaLabel={t("chat.scrollToBottom")} onClick={jumpToLatest}><IconArrowDown size={14} /></TooltipButton> : null}
    </DisclosureAnchorContext.Provider>
  );
}
