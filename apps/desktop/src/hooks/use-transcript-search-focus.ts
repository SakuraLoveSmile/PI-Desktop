import { useLayoutEffect, useRef, type RefObject } from "react";
import type { TranscriptSearchTarget } from "../lib/transcript-reading";
import { locateTranscriptSearch } from "../lib/transcript-search-highlight";
import { transcriptSearchSelector } from "../lib/transcript-search-context";

const READING_KEYS = new Set(["ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End", " "]);
const GESTURES = ["wheel", "touchstart", "touchmove", "pointerdown", "keydown"];

/** Both transcript surfaces share source mapping, highlighting, and scroll ownership. */
export function useTranscriptSearchFocus({
  target,
  source,
  visible = true,
  scrollRef,
  contentRef,
  contentVersion,
  onNavigate,
  onPosition,
}: {
  target: TranscriptSearchTarget | null;
  source: string;
  visible?: boolean;
  scrollRef: RefObject<HTMLDivElement | null>;
  contentRef: RefObject<HTMLDivElement | null>;
  contentVersion: unknown;
  onNavigate: (fresh: boolean) => void;
  onPosition?: (scrollTop: number) => void;
}) {
  const position = useRef({ requestId: 0, alignUntil: 0 });
  useLayoutEffect(() => {
    const scroller = scrollRef.current;
    const content = contentRef.current;
    if (!visible || !target || !scroller || !content) return;

    let removeFocus: (() => void) | undefined;
    let observer: MutationObserver | undefined;
    const install = () => {
      if (removeFocus) return true;
      const targetElement = content.querySelector<HTMLElement>(
        transcriptSearchSelector(target),
      );
      if (!targetElement || !transcriptSearchTargetVisible(target, targetElement, content)) {
        return false;
      }
      removeFocus = installTranscriptSearchFocus({
        target,
        targetElement,
        source,
        scroller,
        content,
        position,
        onNavigate,
        onPosition,
      });
      return Boolean(removeFocus);
    };

    if (!install()) {
      observer = new MutationObserver(() => {
        if (!install()) return;
        observer?.disconnect();
        observer = undefined;
      });
      observer.observe(content, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ["aria-hidden", "class", "hidden", "inert"],
      });
      // Close the gap between the first lookup and observer registration.
      if (install()) {
        observer?.disconnect();
        observer = undefined;
      }
    }

    return () => {
      observer?.disconnect();
      removeFocus?.();
    };
  }, [contentRef, contentVersion, onNavigate, onPosition, scrollRef, source, target, visible]);
}

function transcriptSearchTargetVisible(
  target: TranscriptSearchTarget,
  element: HTMLElement,
  content: HTMLElement,
): boolean {
  for (
    let current: HTMLElement | null = element;
    current && current !== content;
    current = current.parentElement
  ) {
    if (
      current.hidden ||
      current.hasAttribute("inert") ||
      current.getAttribute("aria-hidden") === "true"
    ) {
      return false;
    }
  }

  const itemKind = target.item?.kind;
  const disclosureItem =
    itemKind === "thinking" ||
    itemKind === "tool" ||
    itemKind === "hostedSearch" ||
    (!itemKind && element.classList.contains("tool-row"));
  return !disclosureItem || element.classList.contains("open");
}

type SearchPosition = { current: { requestId: number; alignUntil: number } };

/** Install one browser focus effect; cleanup is safe during StrictMode replay. */
export function installTranscriptSearchFocus({
  target,
  targetElement,
  source,
  scroller,
  content,
  position,
  onNavigate,
  onPosition,
}: {
  target: TranscriptSearchTarget;
  targetElement?: HTMLElement;
  source: string;
  scroller: HTMLElement;
  content: HTMLElement;
  position: SearchPosition;
  onNavigate: (fresh: boolean) => void;
  onPosition?: (scrollTop: number) => void;
}) {
  const message = targetElement ?? content.querySelector<HTMLElement>(
    transcriptSearchSelector(target),
  );
  if (!message || !transcriptSearchTargetVisible(target, message, content)) return;
  const row = message.closest<HTMLElement>(".message-row") ?? message;
  row.classList.add("transcript-search-target");
  const fresh = position.current.requestId !== target.requestId;
  if (fresh)
    position.current = { requestId: target.requestId, alignUntil: performance.now() + 1500 };
  onNavigate(fresh);

  let match = locateTranscriptSearch(message, target.query, source);
  let highlight: Highlight | undefined;
  const paint = () => {
    match.sourceElement?.classList.add("transcript-search-source-match");
    if (typeof Highlight !== "undefined" && CSS.highlights && match.ranges.length) {
      highlight = new Highlight(...match.ranges);
      CSS.highlights.set("transcript-search", highlight);
    }
  };
  const unpaint = () => {
    match.sourceElement?.classList.remove("transcript-search-source-match");
    if (highlight && CSS.highlights?.get("transcript-search") === highlight)
      CSS.highlights.delete("transcript-search");
  };
  const align = () => {
    if (performance.now() >= position.current.alignUntil) return;
    const rect =
      match.ranges[0]?.getBoundingClientRect() ??
      (match.sourceElement ?? message).getBoundingClientRect();
    const viewport = scroller.getBoundingClientRect();
    scroller.scrollTop += rect.top - viewport.top - Math.min(160, scroller.clientHeight / 3);
    onPosition?.(scroller.scrollTop);
  };
  paint();
  align();
  // Geometry changes reuse the match. Only a text mutation rebuilds ranges.
  const resize = new ResizeObserver(align);
  resize.observe(content);
  const stopAlignment = () => {
    position.current.alignUntil = 0;
    resize.disconnect();
    for (const event of GESTURES) scroller.removeEventListener(event, gesture);
  };
  const gesture = (event: Event) => {
    if (event.type !== "keydown" || READING_KEYS.has((event as KeyboardEvent).key)) stopAlignment();
  };
  for (const event of GESTURES) scroller.addEventListener(event, gesture, { passive: true });
  const timer = window.setTimeout(
    stopAlignment,
    Math.max(0, position.current.alignUntil - performance.now()),
  );
  const mutation = new MutationObserver(() => {
    unpaint();
    match = locateTranscriptSearch(message, target.query, source);
    paint();
    align();
  });
  mutation.observe(message, { childList: true, subtree: true, characterData: true });
  return () => {
    window.clearTimeout(timer);
    resize.disconnect();
    for (const event of GESTURES) scroller.removeEventListener(event, gesture);
    mutation.disconnect();
    row.classList.remove("transcript-search-target");
    unpaint();
  };
}
