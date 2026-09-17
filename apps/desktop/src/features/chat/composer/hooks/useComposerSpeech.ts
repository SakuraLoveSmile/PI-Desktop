import { useEffect, useRef, useState } from "react";
import type { TFunction } from "i18next";
import type { SpeechStatus } from "@pi-desktop/shared";
import { stripInlineComposerFileReferenceTokens } from "@pi-desktop/shared";
import { materializeDraftSession } from "../../../../stores/app-store";
import { api } from "../../../../lib/api";
import { isComposerAudioReference, type ComposerFileReference } from "../editor";

type SpeechToast = (message: string, options?: { variant?: "error" | "info" }) => void;

export function useComposerSpeech({
  activeSessionId,
  value,
  enhancementDraft,
  activeFileReferences,
  applyEditorDraft,
  t,
  showToast,
  controlsBlocked,
}: {
  activeSessionId: string | null | undefined;
  value: string;
  enhancementDraft: string;
  activeFileReferences: ComposerFileReference[];
  applyEditorDraft: (next: string, refs: ComposerFileReference[], cursor: number) => void;

  t: TFunction;
  showToast: SpeechToast;
  controlsBlocked: boolean;
}) {
  const [status, setStatus] = useState<SpeechStatus | null>(null);
  const [transcribing, setTranscribing] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const playbackRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    void api.speechStatus().then(
      (next) => {
        if (!cancelled) setStatus(next);
      },
      () => {
        if (!cancelled) setStatus(null);
      },
    );
    return () => {
      cancelled = true;
      playbackRef.current?.pause();
      playbackRef.current = null;
    };
  }, []);

  const audioAttachments = activeFileReferences.filter(isComposerAudioReference);
  const transcribeEnabled = Boolean(status?.transcribe.available) && audioAttachments.length > 0 && !controlsBlocked;
  const speakEnabled = Boolean(status?.synthesize.available) && Boolean(enhancementDraft.trim()) && !controlsBlocked;

  const transcribe = async () => {
    if (!transcribeEnabled || transcribing) return;
    setTranscribing(true);
    try {
      const sessionId = activeSessionId ?? (await materializeDraftSession());
      if (!sessionId) throw new Error("session unavailable");
      const chunks: string[] = [];
      for (const file of audioAttachments) {
        const result = await api.speechTranscribe({
          sessionId,
          path: file.path,
          mimeType: file.mimeType,
        });
        if (result.text.trim()) chunks.push(result.text.trim());
      }
      if (!chunks.length) return;
      const insertion = chunks.join("\n");
      const prefix = value.trim() ? `${value.replace(/\s+$/, "")}\n` : "";
      const next = `${prefix}${insertion}`;
      applyEditorDraft(next, activeFileReferences, next.length);
    } catch (error) {
      showToast(error instanceof Error ? error.message : t("chat.transcribeFailed"), { variant: "error" });
    } finally {
      setTranscribing(false);
    }
  };

  const speak = async () => {
    if (!speakEnabled || speaking) return;
    const text = stripInlineComposerFileReferenceTokens(enhancementDraft, activeFileReferences).trim();
    if (!text) return;
    setSpeaking(true);
    try {
      const sessionId = activeSessionId ?? (await materializeDraftSession());
      if (!sessionId) throw new Error("session unavailable");
      const result = await api.speechSynthesize({ sessionId, text });
      if (result.dataUrl) {
        const audio = new Audio(result.dataUrl);
        playbackRef.current = audio;
        await audio.play();
      } else {
        showToast(t("chat.speakSaved", { path: result.path }), { variant: "info" });
      }
    } catch (error) {
      showToast(error instanceof Error ? error.message : t("chat.speakFailed"), { variant: "error" });
    } finally {
      setSpeaking(false);
    }
  };

  return {
    transcribeEnabled,
    speakEnabled,
    transcribing,
    speaking,
    transcribe,
    speak,
  };
}
