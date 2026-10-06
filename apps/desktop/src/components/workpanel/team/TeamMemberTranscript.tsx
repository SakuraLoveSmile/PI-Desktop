import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { UiMessage } from "@pi-desktop/shared";
import { api } from "../../../lib/api";
import { IconCircleAlert, IconRefresh } from "../../icons";
import { TranscriptDisclosureProvider } from "../../../features/chat/transcript/disclosure";
import { ToolRow } from "../../../features/chat/transcript/ToolRow";
import { Markdown } from "../../Markdown";
import { AssistantErrorMessage, ThinkingRow } from "../../../features/chat/transcript/shared";
import { buildTeamMemberTranscriptRows } from "../../../lib/team-member-transcript";

export function TeamMemberTranscript({ memberSessionId, isRunning = false }: { memberSessionId: string; isRunning?: boolean }) {
  const { t } = useTranslation();
  const [messages, setMessages] = useState<UiMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const loadSeqRef = useRef(0);

  useEffect(() => {
    const seq = ++loadSeqRef.current;
    setLoading(true);
    setError(null);
    api.getSession(memberSessionId)
      .then((detail) => {
        if (seq !== loadSeqRef.current) return;
        setMessages(detail?.session?.messages ?? []);
      })
      .catch((err) => {
        if (seq !== loadSeqRef.current) return;
        setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (seq === loadSeqRef.current) setLoading(false);
      });
  }, [memberSessionId]);

  const rows = useMemo(() => buildTeamMemberTranscriptRows(messages), [messages]);

  return (
    <section className="team-section team-transcript-section">
      <div className="team-section-header">
        <span>{t("team.transcript")}</span>
      </div>
      {loading ? (
        <div className="team-loading-state">
          <IconRefresh className="animate-spin" size={18} />
          <span>{t("common.loading")}</span>
        </div>
      ) : error ? (
        <div className="team-error-state">
          <IconCircleAlert size={20} />
          <span>{error}</span>
        </div>
      ) : rows.length === 0 ? (
        <div className="team-empty-state">{t("team.noTranscript")}</div>
      ) : (
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
      )}
    </section>
  );
}
