import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { UiMessage } from "@pi-desktop/shared";
import { api } from "../../../lib/api";
import { IconCircleAlert, IconRefresh } from "../../icons";
import { TranscriptDisclosureProvider } from "../../../features/chat/transcript/disclosure";
import { ToolRow } from "../../../features/chat/transcript/ToolRow";
import { Markdown } from "../../Markdown";
import { AssistantErrorMessage } from "../../../features/chat/transcript/shared";
import { ReviewChangeCard } from "../../ReviewChangeCard";

export function TeamMemberTranscript({ memberSessionId }: { memberSessionId: string }) {
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
      ) : messages.length === 0 ? (
        <div className="team-empty-state">{t("team.noTranscript")}</div>
      ) : (
        <TranscriptDisclosureProvider key={memberSessionId}>
          <div className="team-transcript-list">
            {messages.map((message) => {
              if (message.role === "user") {
                return (
                  <div key={message.id} className="message-row user">
                    <div className="message-col">
                      <div className="message-bubble">
                        <div className="message-user-text selectable">
                          {message.content}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              }
              if (message.role === "assistant") {
                if (message.toolName) {
                  return (
                    <div key={message.id} className="team-transcript-tool-item">
                      <ToolRow message={message} />
                      <ReviewChangeCard message={message} />
                    </div>
                  );
                }
                if (message.content) {
                  return (
                    <div
                      key={message.id}
                      className="message-row assistant"
                      data-message-id={message.id}
                    >
                      <div className="message-col">
                        <div className="message-bubble">
                          <div className="prose-chat selectable">
                            <Markdown source={message.content} />
                          </div>
                          {message.error ? (
                            <AssistantErrorMessage message={message} />
                          ) : null}
                        </div>
                      </div>
                    </div>
                  );
                }
                if (message.error) {
                  return (
                    <div key={message.id} className="message-row assistant">
                      <div className="message-col">
                        <div className="message-bubble">
                          <AssistantErrorMessage message={message} />
                        </div>
                      </div>
                    </div>
                  );
                }
              }
              return null;
            })}
          </div>
        </TranscriptDisclosureProvider>
      )}
    </section>
  );
}
