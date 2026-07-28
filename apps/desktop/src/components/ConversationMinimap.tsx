import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type RefObject,
} from "react";
import { useTranslation } from "react-i18next";
import type { UiMessage } from "@pi-desktop/shared";
import {
  buildConversationMinimapMarkers,
  type ConversationMinimapMarker,
} from "../lib/conversation-minimap";

/* Codex-style conversation minimap: a packed stack of dashes on the left edge
 * of the thread, one per user turn or assistant response. Moving the cursor
 * along the rail magnifies nearby dashes with a macOS-Dock cosine falloff, the
 * nearest turn shows a preview popover, and clicking jumps to that turn. Dashes
 * grow horizontally only, so magnification never shifts the stack layout. */

/* Dock magnification: reach of the falloff and peak growth factor. */
const MAGNIFY_RADIUS = 46;
const MAGNIFY_BOOST = 1.3;
/* Cursor must be this close to a dash for the popover to pick it. */
const POPOVER_SNAP = 24;
const POPOVER_HEIGHT = 132;
/* Hide the rail until content actually overflows one viewport. */
const OVERFLOW_EPSILON_PX = 1;

export const ConversationMinimap = memo(function ConversationMinimap({
  scrollRef,
  messages,
}: {
  scrollRef: RefObject<HTMLDivElement | null>;
  messages: UiMessage[];
}) {
  const { t } = useTranslation();
  const [activeId, setActiveId] = useState<string | null>(null);
  const [hovered, setHovered] = useState<{
    marker: ConversationMinimapMarker;
    top: number;
  } | null>(null);
  const [overflows, setOverflows] = useState(false);
  const railRef = useRef<HTMLElement>(null);
  const markerEls = useRef(new Map<string, HTMLButtonElement>());
  const moveRaf = useRef(0);

  const markers = useMemo(
    () => buildConversationMinimapMarkers(messages),
    [messages],
  );
  const markerIdentity = useMemo(
    () => markers.map((marker) => marker.id).join("\u0000"),
    [markers],
  );
  const markersRef = useRef(markers);
  markersRef.current = markers;

  /* Message positions inside the scroll content, for jump + active tracking. */
  const getOffsets = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return [];
    const baseTop = el.getBoundingClientRect().top;
    const markerIds = new Set(markersRef.current.map((marker) => marker.id));
    const out: { id: string; offset: number }[] = [];
    el.querySelectorAll<HTMLElement>("[data-minimap-id]").forEach((node) => {
      const id = node.dataset.minimapId || "";
      if (!markerIds.has(id)) return;
      out.push({
        id,
        offset: node.getBoundingClientRect().top - baseTop + el.scrollTop,
      });
    });
    return out;
  }, [scrollRef]);

  const updateActive = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const offsets = getOffsets();
    if (offsets.length === 0) return;
    const anchor = el.scrollTop + el.clientHeight * 0.3;
    let current = offsets[0];
    for (const entry of offsets) {
      if (entry.offset <= anchor) current = entry;
      else break;
    }
    setActiveId(current.id);
  }, [scrollRef, getOffsets]);

  const updateOverflow = useCallback(() => {
    const el = scrollRef.current;
    if (!el) {
      setOverflows(false);
      return;
    }
    // One-page content has no scroll range; the rail is only useful when overflowing.
    setOverflows(el.scrollHeight - el.clientHeight > OVERFLOW_EPSILON_PX);
  }, [scrollRef]);

  useEffect(() => {
    updateOverflow();
  }, [markerIdentity, updateOverflow]);

  useEffect(() => {
    updateActive();
  }, [markerIdentity, updateActive]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    let scrollRaf = 0;
    let resizeRaf = 0;
    const scheduleScroll = () => {
      cancelAnimationFrame(scrollRaf);
      scrollRaf = requestAnimationFrame(() => {
        updateActive();
        updateOverflow();
      });
    };
    const scheduleResize = () => {
      cancelAnimationFrame(resizeRaf);
      resizeRaf = requestAnimationFrame(updateOverflow);
    };
    el.addEventListener("scroll", scheduleScroll, { passive: true });
    // Streamed content can change layout between marker identity changes.
    const content = el.firstElementChild;
    const ro =
      content && typeof ResizeObserver !== "undefined"
        ? new ResizeObserver(scheduleResize)
        : null;
    if (ro && content) ro.observe(content);
    // Viewport resizes can create or remove overflow without content changes.
    window.addEventListener("resize", scheduleScroll);
    return () => {
      el.removeEventListener("scroll", scheduleScroll);
      ro?.disconnect();
      cancelAnimationFrame(scrollRaf);
      cancelAnimationFrame(resizeRaf);
      window.removeEventListener("resize", scheduleScroll);
    };
  }, [scrollRef, updateActive, updateOverflow]);

  const jumpTo = useCallback(
    (id: string) => {
      const el = scrollRef.current;
      if (!el) return;
      const target = getOffsets().find((entry) => entry.id === id);
      if (!target) return;
      const reduceMotion = window.matchMedia(
        "(prefers-reduced-motion: reduce)",
      ).matches;
      el.scrollTo({
        top: Math.max(0, target.offset - 24),
        behavior: reduceMotion ? "auto" : "smooth",
      });
    },
    [scrollRef, getOffsets],
  );

  /* Dock magnification, applied imperatively so mousemove never re-renders.
   * Dash buttons keep a fixed height, so scaling is layout-stable. */
  const applyMagnify = useCallback((cursorY: number | null) => {
    let nearest: { id: string; dist: number; center: number } | null = null;
    for (const [id, btn] of markerEls.current) {
      const center = btn.offsetTop + btn.offsetHeight / 2;
      let scale = 1;
      if (cursorY != null) {
        const dist = Math.abs(center - cursorY);
        if (dist < MAGNIFY_RADIUS) {
          scale = 1 + MAGNIFY_BOOST * Math.cos((dist / MAGNIFY_RADIUS) * (Math.PI / 2));
        }
        if (dist <= POPOVER_SNAP && (!nearest || dist < nearest.dist)) {
          nearest = { id, dist, center };
        }
      }
      btn.style.setProperty("--magnify", scale.toFixed(3));
    }
    if (nearest) {
      const marker = markersRef.current.find((m) => m.id === nearest!.id);
      const rail = railRef.current;
      if (marker && rail) {
        const top = Math.min(
          Math.max(nearest.center - 36, 0),
          Math.max(rail.clientHeight - POPOVER_HEIGHT, 0),
        );
        setHovered((prev) =>
          prev?.marker.id === marker.id && prev.top === top
            ? prev
            : { marker, top },
        );
        return;
      }
    }
    setHovered(null);
  }, []);

  const handleMouseMove = useCallback(
    (event: React.MouseEvent) => {
      const rail = railRef.current;
      if (!rail) return;
      const y = event.clientY - rail.getBoundingClientRect().top;
      cancelAnimationFrame(moveRaf.current);
      moveRaf.current = requestAnimationFrame(() => applyMagnify(y));
    },
    [applyMagnify],
  );

  const handleMouseLeave = useCallback(() => {
    cancelAnimationFrame(moveRaf.current);
    applyMagnify(null);
  }, [applyMagnify]);

  useEffect(() => () => cancelAnimationFrame(moveRaf.current), []);

  if (markers.length < 2 || !overflows) return null;

  const roleLabel = (role: ConversationMinimapMarker["role"]) =>
    role === "user" ? t("chat.userMessage") : t("chat.assistantMessage");

  return (
    <nav
      className="minimap-rail"
      ref={railRef}
      aria-label={t("chat.minimap")}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
    >
      {markers.map((marker) => (
        <button
          key={marker.id}
          ref={(node) => {
            if (node) markerEls.current.set(marker.id, node);
            else markerEls.current.delete(marker.id);
          }}
          className={`minimap-marker ${marker.role} ${
            marker.id === activeId ? "active" : ""
          }`}
          aria-label={roleLabel(marker.role)}
          aria-current={marker.id === activeId ? "true" : undefined}
          onFocus={(event) =>
            setHovered({
              marker,
              top: Math.max(0, event.currentTarget.offsetTop - 36),
            })
          }
          onBlur={() => setHovered(null)}
          onClick={() => jumpTo(marker.id)}
        />
      ))}
      {hovered && hovered.marker.preview ? (
        <div
          className="minimap-popover"
          role="tooltip"
          style={{ top: `${hovered.top}px` }}
        >
          <div className="minimap-popover-role">
            {roleLabel(hovered.marker.role)}
          </div>
          <div className="minimap-popover-text">{hovered.marker.preview}</div>
        </div>
      ) : null}
    </nav>
  );
});
