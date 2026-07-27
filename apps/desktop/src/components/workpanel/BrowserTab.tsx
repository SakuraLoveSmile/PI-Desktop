import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { BrowserState } from "@pi-desktop/shared";
import { api } from "../../lib/api";
import { cx } from "../ui";
import {
  IconChevronLeft,
  IconChevronRight,
  IconClose,
  IconExternal,
  IconGlobe,
  IconSnapshot,
} from "../icons";

const LAST_URL_KEY = "pi.desktop.workPanel.browserUrl";

/**
 * The preview surface itself is a main-process WebContentsView (D100);
 * this component renders the chrome, measures the placeholder rect, and
 * mirrors navigation state pushed from main. Mount/unmount plus the
 * `blocked` prop drive the view's visibility.
 */
export function BrowserTab({ blocked = false }: { blocked?: boolean }) {
  const { t } = useTranslation();
  const surfaceRef = useRef<HTMLDivElement | null>(null);
  const [state, setState] = useState<BrowserState | null>(null);
  const [input, setInput] = useState("");
  const [started, setStarted] = useState(false);
  const inputFocused = useRef(false);

  // Mirror navigation state pushed from the main process.
  useEffect(() => {
    const off = api.onBrowserState((next) => {
      setState(next);
      setStarted(true);
      if (!inputFocused.current) setInput(next.url);
      if (next.url) {
        try {
          localStorage.setItem(LAST_URL_KEY, next.url);
        } catch {
          // best-effort
        }
      }
    });
    void api.browserGetState().then((existing) => {
      if (existing && existing.url) {
        setState(existing);
        setStarted(true);
        if (!inputFocused.current) setInput(existing.url);
      } else {
        try {
          const last = localStorage.getItem(LAST_URL_KEY);
          if (last) setInput(last);
        } catch {
          // best-effort
        }
      }
    });
    return off;
  }, []);

  // Visibility follows mount/blocked state; bounds follow the measured rect.
  useEffect(() => {
    const surface = surfaceRef.current;
    if (!surface) return;
    let frame = 0;
    const report = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const rect = surface.getBoundingClientRect();
        void api.browserSetBounds({
          x: rect.x,
          y: rect.y,
          width: rect.width,
          height: rect.height,
        });
      });
    };
    const observer = new ResizeObserver(report);
    observer.observe(surface);
    window.addEventListener("resize", report);
    report();
    // Attach only after the first navigation (an idle view is a blank
    // rectangle over the empty-state hint) and never while a blocking
    // A blocking overlay (palette or search) is open — the view always
    // composites above renderer content.
    void api.browserSetVisible(started && !blocked);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", report);
      cancelAnimationFrame(frame);
      void api.browserSetVisible(false);
    };
  }, [started, blocked]);

  const navigate = useCallback((raw: string) => {
    const value = raw.trim();
    if (!value) return;
    setStarted(true);
    void api.browserNavigate(value).then((next) => {
      if (next) setState(next);
    });
  }, []);

  return (
    <div className="work-browser">
      <div className="work-browser-chrome">
        <button
          type="button"
          className="icon-btn"
          disabled={!state?.canGoBack}
          onClick={() => void api.browserAction("back")}
          title={t("panel.browser.back")}
        >
          <IconChevronLeft size={14} />
        </button>
        <button
          type="button"
          className="icon-btn"
          disabled={!state?.canGoForward}
          onClick={() => void api.browserAction("forward")}
          title={t("panel.browser.forward")}
        >
          <IconChevronRight size={14} />
        </button>
        <button
          type="button"
          className="icon-btn"
          disabled={!started}
          onClick={() =>
            void api.browserAction(state?.isLoading ? "stop" : "reload")
          }
          title={state?.isLoading ? t("panel.browser.stop") : t("panel.browser.reload")}
        >
          {state?.isLoading ? <IconClose size={14} /> : <IconSnapshot size={14} />}
        </button>
        <form
          className="work-browser-url"
          onSubmit={(e) => {
            e.preventDefault();
            navigate(input);
          }}
        >
          <input
            value={input}
            placeholder={t("panel.browser.urlPlaceholder")}
            spellCheck={false}
            onChange={(e) => setInput(e.target.value)}
            onFocus={(e) => {
              inputFocused.current = true;
              e.target.select();
            }}
            onBlur={() => {
              inputFocused.current = false;
              if (state?.url) setInput(state.url);
            }}
          />
        </form>
        <button
          type="button"
          className="icon-btn"
          disabled={!state?.url}
          onClick={() => void api.browserOpenExternal()}
          title={t("panel.browser.openExternal")}
        >
          <IconExternal size={14} />
        </button>
      </div>
      <div
        ref={surfaceRef}
        className={cx("work-browser-surface", !started && "empty")}
      >
        {!started && (
          <div className="work-tab-empty">
            <IconGlobe size={20} />
            <p>{t("panel.browser.empty")}</p>
          </div>
        )}
      </div>
    </div>
  );
}
