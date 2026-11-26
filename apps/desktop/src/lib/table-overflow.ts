import { useEffect, type RefObject } from "react";

export type TableOverflow = "none" | "start" | "end" | "both";

export interface TableOverflowMetrics {
  scrollLeft: number;
  scrollWidth: number;
  clientWidth: number;
}

// Scroll offsets are fractional at some zoom levels; a full pixel of slack
// keeps a table at its left edge from flickering between "end" and "both".
const SLACK = 1;

export function tableOverflowState({
  scrollLeft,
  scrollWidth,
  clientWidth,
}: TableOverflowMetrics): TableOverflow {
  if (scrollWidth - clientWidth <= SLACK) return "none";
  if (scrollLeft <= SLACK) return "end";
  if (scrollLeft + clientWidth >= scrollWidth - SLACK) return "start";
  return "both";
}

/** Publishes the horizontal overflow edge as `data-overflow` on the element. */
export function useTableOverflow(ref: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => {
      // Rows inside `content-visibility: auto` report a zero box until they are
      // painted; keep the previous state instead of flashing "none".
      if (el.clientWidth === 0) return;
      el.dataset.overflow = tableOverflowState(el);
    };
    update();
    el.addEventListener("scroll", update, { passive: true });
    const observer = new ResizeObserver(update);
    observer.observe(el);
    const table = el.firstElementChild;
    // The container width only changes with the column; the table's own box
    // changes with font scale, so both resize events matter.
    if (table) observer.observe(table);
    return () => {
      el.removeEventListener("scroll", update);
      observer.disconnect();
    };
  }, [ref]);
}
