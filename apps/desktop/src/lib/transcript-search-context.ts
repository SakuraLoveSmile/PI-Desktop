import { createContext, useContext } from "react";
import type { TranscriptItemTarget, TranscriptSearchTarget } from "./transcript-reading";

export const TranscriptSearchContext = createContext<TranscriptSearchTarget | null>(null);

export function transcriptItemKey(messageId: string, kind: TranscriptItemTarget["kind"], roundId?: string) {
  return JSON.stringify([messageId, kind, roundId ?? ""]);
}

export function transcriptSearchSelector(target: TranscriptSearchTarget) {
  if (!target.item) return `[data-message-id="${CSS.escape(target.messageId)}"]`;
  const item = target.item;
  return `[data-transcript-item="${CSS.escape(transcriptItemKey(
    target.messageId, item.kind, item.kind === "hostedSearch" ? item.roundId : undefined,
  ))}"]`;
}

/** Legacy message navigation opens tool content, never unrelated reasoning. */
export function useItemReveal(messageId: string, kind: TranscriptItemTarget["kind"], roundId?: string) {
  const target = useContext(TranscriptSearchContext);
  if (!target || target.messageId !== messageId) return undefined;
  if (!target.item) return kind === "tool" || kind === "message" ? target.requestId : undefined;
  if (target.item.kind !== kind) return undefined;
  if (target.item.kind === "hostedSearch" && target.item.roundId !== roundId) return undefined;
  return target.requestId;
}
