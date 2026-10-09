import { lazy, Suspense, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { IconClose } from "../../components/icons";
import { portalOverlay, TooltipButton } from "../../components/ui";
import { useAppStore } from "../../stores/app-store";
import { closeContextInsightsDialog, useContextInsightsDialog } from "./dialog-state";

const Dashboard = lazy(() => import("../context-insights/ContextInsightsDashboard")
  .then((module) => ({ default: module.ContextInsightsDashboard })));

export function ContextInsightsDialog() {
  const sessionId = useContextInsightsDialog();
  const activeSessionId = useAppStore((state) => state.activeSessionId);
  const page = useAppStore((state) => state.page);
  const { t } = useTranslation();
  const dialog = useRef<HTMLDivElement>(null);
  const close = useRef<HTMLButtonElement>(null);
  const visible = sessionId !== null && sessionId === activeSessionId && page === "chat";

  useEffect(() => {
    if (sessionId && !visible) closeContextInsightsDialog();
  }, [sessionId, visible]);

  useEffect(() => {
    if (!visible) return;
    const previous = document.activeElement;
    close.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      if (event.key === "Escape") {
        event.preventDefault();
        closeContextInsightsDialog();
      }
      if (event.key !== "Tab") return;
      const elements = Array.from(dialog.current?.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], summary, [tabindex="0"]',
      ) ?? []).filter((element) => element.getClientRects().length > 0);
      const first = elements[0];
      const last = elements.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus();
    };
  }, [visible]);

  if (!visible || !sessionId) return null;
  return portalOverlay(
    <div className="overlay context-insights-overlay" onPointerDown={(event) => {
      if (event.target === event.currentTarget) closeContextInsightsDialog();
    }}>
      <div ref={dialog} className="dialog context-insights-dialog" role="dialog" aria-modal="true" aria-labelledby="context-insights-dialog-title">
        <header className="context-insights-dialog-heading">
          <h2 id="context-insights-dialog-title">{t("contextInsights.title")}</h2>
          <TooltipButton ref={close} className="icon-btn" tooltip={t("common.close")} onClick={closeContextInsightsDialog}><IconClose size={16} /></TooltipButton>
        </header>
        <Suspense fallback={<p role="status">{t("app.loadingView")}</p>}>
          <Dashboard key={sessionId} sessionId={sessionId} />
        </Suspense>
      </div>
    </div>,
  );
}
