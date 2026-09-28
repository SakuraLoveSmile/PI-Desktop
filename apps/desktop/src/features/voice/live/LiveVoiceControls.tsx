import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { TFunction } from "i18next";
import { Badge, Button, Panel, TooltipButton } from "../../../components/ui";
import { IconMic } from "../../../components/icons";
import { getLiveCallController } from "./live-call-controller";
import "../../../styles/voice.css";

export function LiveVoiceControls({ t }: { t: TFunction }) {
  const controller = getLiveCallController();
  const snapshot = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const call = snapshot.call;
  const isActive = Boolean(call && !["ended", "failed", "idle"].includes(call.phase));
  const enabled = snapshot.status?.enabled === true;
  const selectable = snapshot.status?.bindings.some((item) => item.selectable) === true;
  const label = isActive ? t("liveVoice.openPanel") : t("liveVoice.start");

  useEffect(() => {
    if (!open) return;
    const firstAction = panelRef.current?.querySelector<HTMLButtonElement>("button:not(:disabled)");
    firstAction?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      setOpen(false);
      triggerRef.current?.focus();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open]);

  const closePanel = () => {
    setOpen(false);
    triggerRef.current?.focus();
  };

  return (
    <div className="live-voice-control">
      <TooltipButton
        type="button"
        className={`icon-btn icon-btn-square${isActive ? " voice-active" : ""}`}
        ariaLabel={label}
        aria-pressed={isActive}
        aria-expanded={open}
        aria-haspopup="dialog"
        tooltip={label}
        ref={triggerRef}
        onClick={() => {
          if (isActive || snapshot.starting) {
            setOpen((value) => !value);
            return;
          }
          setOpen(true);
          if (enabled && selectable) void controller.start().catch(() => undefined);
        }}
      >
        <IconMic size={15} aria-hidden="true" />
      </TooltipButton>
      {open ? (
        <div ref={panelRef} className="live-voice-panel" role="dialog" aria-label={t("liveVoice.title")}>
        <Panel className="live-voice-panel-surface">
          <div className="live-voice-panel-heading">
            <strong>{t("liveVoice.title")}</strong>
            <Badge aria-live="polite" aria-atomic="true" tone={call?.phase === "connected" ? "success" : snapshot.errorCode ? "error" : "neutral"}>
              {t(`liveVoice.phase.${call?.phase ?? (snapshot.starting ? "preparing" : "idle")}`)}
            </Badge>
          </div>
          {snapshot.status?.selectedBindingId ? (
            <div className="live-voice-provider">
              {snapshot.status.bindings.find((item) => item.bindingId === (call?.bindingId ?? snapshot.status?.selectedBindingId))?.providerLabel ?? t("liveVoice.providerUnavailable")}
            </div>
          ) : null}
          {call?.phase === "connected" ? (
            <div className="live-voice-provider">
              {call.userSpeaking ? t("liveVoice.userSpeaking") : call.assistantSpeaking ? t("liveVoice.assistantSpeaking") : call.muted ? t("liveVoice.muted") : t("liveVoice.phase.connected")}
            </div>
          ) : null}
          {snapshot.errorCode ? (
            <div className="live-voice-error" role="alert">
              {t(snapshot.errorCode === "LIVE_MICROPHONE_DENIED"
                ? "liveVoice.microphoneDenied"
                : snapshot.errorCode === "LIVE_MICROPHONE_BUSY"
                  ? "liveVoice.microphoneBusy"
                  : snapshot.errorCode === "LIVE_MICROPHONE_UNAVAILABLE"
                    ? "liveVoice.microphoneUnavailable"
                    : "liveVoice.errorGeneric")}
            </div>
          ) : null}
          {call?.playbackBlocked ? (
            <Button size="sm" variant="secondary" onClick={() => void controller.resumePlayback()}>
              {t("liveVoice.resumePlayback")}
            </Button>
          ) : null}
          {snapshot.transcripts.length > 0 ? (
            <div className="live-voice-transcripts" aria-live="polite" aria-relevant="additions text">
              {snapshot.transcripts.map((segment, index) => (
                <p key={`${segment.role}:${segment.id}:${index}`} data-role={segment.role}>{segment.text}</p>
              ))}
            </div>
          ) : null}
          <div className="live-voice-actions">
            {snapshot.starting ? (
              <Button size="sm" variant="secondary" onClick={() => void controller.cancelStart()}>{t("common.cancel")}</Button>
            ) : isActive ? (
              <>
                <Button size="sm" variant="secondary" aria-pressed={call?.muted ?? true} disabled={call?.phase !== "connected"} onClick={() => void controller.toggleMute()}>
                  {call?.muted ? t("liveVoice.unmute") : t("liveVoice.mute")}
                </Button>
                <Button size="sm" variant="secondary" onClick={() => void controller.end()}>{t("liveVoice.end")}</Button>
              </>
            ) : (
              <Button size="sm" variant="primary" disabled={!enabled || !selectable} onClick={() => void controller.start().catch(() => undefined)}>
                {t("liveVoice.start")}
              </Button>
            )}
            <Button size="sm" variant="ghost" onClick={closePanel}>{t("common.close")}</Button>
          </div>
          {!enabled ? <div className="live-voice-hint">{t("liveVoice.enableInSettings")}</div> : null}
          {enabled && !selectable && !isActive ? <div className="live-voice-hint">{t("liveVoice.noProvider")}</div> : null}
        </Panel>
        </div>
      ) : null}
    </div>
  );
}
