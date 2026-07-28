import { memo, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { BrandLogo } from "./BrandLogo";
import { ChatTranscript } from "./ChatTranscript";
import { Composer } from "./Composer";
import { IconX } from "./icons";
import { OnboardingChecklist } from "./OnboardingChecklist";
import { useAppStore } from "../stores/app-store";

const StableComposer = memo(Composer);

function i18nHasError(t: (key: string) => string, code: string) {
  const key = `errors.${code}`;
  return t(key) !== key;
}

function projectName(path?: string | null, name?: string | null) {
  if (name) return name;
  if (!path) return null;
  const parts = path.split(/[/\\]/).filter(Boolean);
  return parts[parts.length - 1] || path;
}

export const ChatSurface = memo(function ChatSurface() {
  const { t } = useTranslation();
  const activeSessionId = useAppStore((state) => state.activeSessionId);
  const messages = useAppStore((state) => state.messages);
  const isRunning = useAppStore((state) => state.isRunning);
  const workspace = useAppStore((state) => state.workspace);
  const openProject = useAppStore((state) => state.openProject);
  const error = useAppStore((state) => state.error);
  const errorCode = useAppStore((state) => state.errorCode);
  const errorRetriable = useAppStore((state) => state.errorRetriable);
  const activePermission = useAppStore((state) =>
    state.activeSessionId
      ? state.pendingPermissions[state.activeSessionId]
      : undefined,
  );

  const heroProject = useMemo(
    () => projectName(workspace?.path, workspace?.name),
    [workspace?.path, workspace?.name],
  );
  const emptyTitleParts = useMemo(() => {
    const marker = "__PROJECT__";
    const template = t("chat.emptyTitleInProject", { project: marker });
    const [before = "", after = ""] = template.split(marker);
    return { before, after };
  }, [t]);
  const hasTranscript =
    Boolean(activePermission) ||
    messages.some((message) => {
      const hasContent = Boolean((message.content || "").trim());
      const hasThinking =
        typeof message.thinking === "string" && Boolean(message.thinking.trim());
      if (message.role === "assistant") return hasContent || hasThinking;
      return hasContent || message.role === "tool";
    });

  return (
    <div className="chat-surface route-surface">
      {!hasTranscript ? (
        <div className="home-main-content" data-testid="home-empty">
          <div className="home-scroll">
            <div className="home-stack-inner">
              <div className="empty-hero">
                <div className="empty-hero-icon" data-testid="home-icon" aria-hidden>
                  <BrandLogo size={56} />
                </div>
                <h1>
                  {heroProject ? (
                    <>
                      {emptyTitleParts.before}
                      <button
                        type="button"
                        className="project-underline"
                        onClick={() => void openProject()}
                        title={workspace?.path || t("project.open")}
                      >
                        {heroProject}
                      </button>
                      {emptyTitleParts.after}
                    </>
                  ) : (
                    t("chat.emptyTitle")
                  )}
                </h1>
              </div>
              <OnboardingChecklist />
              <div className="home-composer-wrap">
                <StableComposer variant="home" />
              </div>
            </div>
          </div>
        </div>
      ) : (
        <>
          <ChatTranscript
            sessionId={activeSessionId}
            messages={messages}
            isRunning={isRunning}
            pendingPermission={activePermission}
          />
          <StableComposer variant="docked" />
        </>
      )}

      {error ? (
        <div className="chat-error-layer">
          <div className="chat-error-notice">
            <span title={error ?? undefined}>
              {errorCode && i18nHasError(t, errorCode)
                ? t(`errors.${errorCode}`)
                : error}
            </span>
            {(errorCode === "MODEL_NOT_CONFIGURED" ||
              errorCode === "PROVIDER_SECRET_MISSING" ||
              errorCode === "PROVIDER_UNAUTHORIZED") && (
              <button
                type="button"
                className="chat-error-action"
                onClick={() => {
                  const store = useAppStore.getState();
                  store.setSettingsTab("agent");
                  store.setPage("settings");
                }}
              >
                {t("errors.action.openSettings")}
              </button>
            )}
            {errorRetriable && !isRunning ? (
              <button
                type="button"
                className="chat-error-action"
                onClick={() => void useAppStore.getState().retryLastPrompt()}
              >
                {t("errors.action.retry")}
              </button>
            ) : null}
            <button
              type="button"
              aria-label={t("errors.action.dismiss")}
              className="chat-error-dismiss"
              onClick={() => useAppStore.getState().clearError()}
            >
              <IconX size={13} />
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
});
