import { useCallback, useEffect, useRef, useState } from "react";
import type { SessionSummary } from "@pi-desktop/shared";

export type SessionHoverCardData = {
  session: SessionSummary;
  target: HTMLElement;
  temporary: boolean;
  space: string;
  branch?: string;
};

export function useSessionHoverCard() {
  const [card, setCard] = useState<SessionHoverCardData | null>(null);
  const requestRef = useRef<SessionHoverCardData | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const cancelPending = useCallback(() => {
    requestRef.current = null;
    clearTimeout(timerRef.current);
    timerRef.current = undefined;
  }, []);

  const hide = useCallback(() => {
    cancelPending();
    setCard(null);
  }, [cancelPending]);

  const show = useCallback((request: SessionHoverCardData) => {
    if (requestRef.current?.target === request.target) return;
    cancelPending();
    setCard(null);
    requestRef.current = request;
    timerRef.current = setTimeout(() => {
      timerRef.current = undefined;
      if (requestRef.current !== request || !request.target.isConnected || document.hidden) return;
      setCard(request);
    }, 500);
  }, [cancelPending]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") hide();
    };
    const onVisibility = () => {
      if (document.hidden) hide();
    };
    window.addEventListener("scroll", hide, true);
    window.addEventListener("resize", hide);
    window.addEventListener("pointerdown", hide);
    window.addEventListener("keydown", onKey);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      cancelPending();
      window.removeEventListener("scroll", hide, true);
      window.removeEventListener("resize", hide);
      window.removeEventListener("pointerdown", hide);
      window.removeEventListener("keydown", onKey);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [cancelPending, hide]);

  useEffect(() => {
    if (card && !card.target.isConnected) hide();
  });

  return { card, show, hide };
}
