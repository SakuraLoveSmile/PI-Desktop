/**
 * Floating quote affordance for a text selection (ADR 0223 / D398).
 *
 * The per-message action row can only quote what the user already selected, and
 * it lives at the end of the message: reaching it means scrolling away from the
 * sentence being quoted. This affordance follows the selection instead, so a
 * phrase, a formula, or a table quotes where it was picked.
 *
 * It is portaled to `document.body` and positioned in viewport coordinates, so
 * it never participates in the transcript's layout or scroll extent. The
 * selection is serialized back to Markdown when the affordance appears — the DOM
 * the range points at can change while it is on screen — and the click only
 * writes a composer draft: it never sends, never creates a session, and writes
 * nothing to the transcript.
 */
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import type { RefObject } from "react";
import { IconQuote } from "./icons";
import { useAppStore } from "../stores/app-store";
import {
  activeSelectionRange,
  placeSelectionQuote,
  quotableRowFor,
  selectionAnchorRect,
  serializeSelectionMarkdown,
  type SelectionQuoteRect,
} from "../lib/selection-quote";

type PendingQuote = {
  /** The selection, already reduced to the Markdown the composer receives. */
  markdown: string;
  /** The selection's last line, in viewport coordinates. */
  anchor: SelectionQuoteRect;
};

export function SelectionQuoteButton({
  scrollRef,
  title,
}: {
  /** The transcript this instance quotes from; selections elsewhere are ignored. */
  scrollRef: RefObject<HTMLElement | null>;
  /** Source title for the quote attribution line. */
  title: string;
}) {
  const { t } = useTranslation();
  const quoteMessageIntoComposer = useAppStore((s) => s.quoteMessageIntoComposer);
  const [pending, setPending] = useState<PendingQuote | null>(null);
  const [placement, setPlacement] = useState<{ top: number; left: number } | null>(
    null,
  );
  const buttonRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    let frame = 0;
    const hide = () => {
      if (frame) {
        cancelAnimationFrame(frame);
        frame = 0;
      }
      setPending(null);
      setPlacement(null);
    };
    const sync = () => {
      frame = 0;
      const range = activeSelectionRange();
      const row = range ? quotableRowFor(range.startContainer) : null;
      // A selection in another surface — the composer, a panel, a second pane —
      // is not this transcript's to quote.
      if (!range || !row || !scrollRef.current?.contains(row)) {
        hide();
        return;
      }
      const anchor = selectionAnchorRect(range);
      const markdown = serializeSelectionMarkdown(range);
      if (!anchor || !markdown) {
        hide();
        return;
      }
      setPlacement(null);
      setPending({ markdown, anchor });
    };
    const schedule = () => {
      if (frame) return;
      // A drag fires selectionchange many times per frame, and each pass clones
      // DOM; one rAF per frame keeps a long drag from serializing repeatedly.
      frame = requestAnimationFrame(sync);
    };
    document.addEventListener("selectionchange", schedule);
    // Scroll does not bubble, so the capture phase is what catches the thread's
    // own scroller; either way the recorded rectangle is stale afterwards.
    window.addEventListener("scroll", hide, { capture: true, passive: true });
    window.addEventListener("resize", hide);
    return () => {
      hide();
      document.removeEventListener("selectionchange", schedule);
      window.removeEventListener("scroll", hide, { capture: true });
      window.removeEventListener("resize", hide);
    };
  }, [scrollRef]);

  // The affordance is laid out before it is measured, so the first painted
  // frame already has its final place: no visible jump from a provisional spot.
  useLayoutEffect(() => {
    if (!pending) return;
    const size = buttonRef.current?.getBoundingClientRect();
    if (!size) return;
    setPlacement(
      placeSelectionQuote({
        anchor: pending.anchor,
        size,
        viewport: { width: window.innerWidth, height: window.innerHeight },
      }),
    );
  }, [pending]);

  if (!pending) return null;

  return createPortal(
    <button
      type="button"
      ref={buttonRef}
      className="selection-quote-btn"
      data-testid="selection-quote-btn"
      aria-label={t("chat.quoteSelection")}
      style={
        placement
          ? { top: placement.top, left: placement.left }
          : { top: 0, left: 0, visibility: "hidden" }
      }
      // Keeping the selection alive through the press is what lets the quote be
      // taken from it rather than from a collapsed caret.
      onPointerDown={(event) => event.preventDefault()}
      onClick={() => {
        quoteMessageIntoComposer({ title, text: pending.markdown });
        setPending(null);
        setPlacement(null);
      }}
    >
      <IconQuote size={13} />
      <span>{t("chat.quoteSelection")}</span>
    </button>,
    document.body,
  );
}
