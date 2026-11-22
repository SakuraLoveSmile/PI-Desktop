import {
  useEffect, useId, useLayoutEffect, useRef, useState,
  type KeyboardEvent, type PointerEvent as ReactPointerEvent, type ReactNode, type RefObject,
} from "react";
import { useTranslation } from "react-i18next";
import { IconGripVertical } from "../../../components/icons";
import { Button, TooltipButton } from "../../../components/ui";
import { ActivitySectionGripContext } from "./ActivitySectionGrip";
import {
  ACTIVITY_SECTION_IDS, ACTIVITY_SECTION_LABEL_KEYS, dragActivitySectionOrder, sameActivitySectionOrder, stepActivitySection,
  type ActivitySectionId, type ActivitySectionRect,
} from "./activity-section-order";
import { useActivitySectionOrder } from "./use-activity-section-order";
import "./session-activity-sections.css";

export type ActivityRailSectionSpec = { id: ActivitySectionId; node: ReactNode };
type Drag = { id: ActivitySectionId; origin: readonly ActivitySectionId[]; order: readonly ActivitySectionId[] };

const asSectionId = (value: string | undefined): ActivitySectionId | undefined => ACTIVITY_SECTION_IDS.find((id) => id === value);

/**
 * A grip drag follows the pointer on the window, so it survives the dragged section being re-parented by
 * the live reorder. Escape, a cancelled pointer or losing focus put the original order back.
 */
function useSectionPointerDrag(container: RefObject<HTMLElement | null>, onFinish: (drag: Drag, commit: boolean) => void) {
  const [drag, setDrag] = useState<Drag | null>(null);
  const live = useRef<Drag | null>(null);
  const finish = useRef(onFinish);
  useEffect(() => { finish.current = onFinish; });
  const active = drag !== null;
  useEffect(() => {
    if (!active) return;
    const rects = (): ActivitySectionRect[] => [...(container.current?.querySelectorAll<HTMLElement>("[data-activity-section]") ?? [])].flatMap((element) => {
      const id = asSectionId(element.dataset.activitySection);
      if (!id) return [];
      const box = element.getBoundingClientRect();
      return [{ id, top: box.top, height: box.height }];
    });
    const end = (commit: boolean) => {
      const done = live.current;
      live.current = null;
      setDrag(null);
      if (done) finish.current(done, commit);
    };
    const move = (event: PointerEvent) => {
      const current = live.current;
      if (!current) return;
      const order = dragActivitySectionOrder(current.order, current.id, event.clientY, rects());
      if (sameActivitySectionOrder(order, current.order)) return;
      live.current = { ...current, order };
      setDrag(live.current);
    };
    const up = () => end(true);
    const cancel = () => end(false);
    const key = (event: globalThis.KeyboardEvent) => { if (event.key === "Escape") { event.preventDefault(); end(false); } };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", cancel);
    window.addEventListener("keydown", key);
    window.addEventListener("blur", cancel);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", cancel);
      window.removeEventListener("keydown", key);
      window.removeEventListener("blur", cancel);
    };
  }, [active, container]);
  const start = (id: ActivitySectionId, order: readonly ActivitySectionId[]) => {
    if (live.current) return;
    live.current = { id, origin: order, order };
    setDrag(live.current);
  };
  return { drag, start };
}

/** Lays the rail's sections out in the person's chosen order, each behind a hairline and carrying its own grip. */
export function ActivityRailSections({ sections }: { sections: readonly ActivityRailSectionSpec[] }) {
  const { t } = useTranslation();
  const { order, isDefault, commitVisible, reset } = useActivitySectionOrder();
  const container = useRef<HTMLDivElement>(null);
  const hintId = useId();
  const refocus = useRef<ActivitySectionId | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const nodes = new Map(sections.map((section) => [section.id, section.node]));
  const stored = order.filter((id) => nodes.has(id));
  const label = (id: ActivitySectionId) => t(ACTIVITY_SECTION_LABEL_KEYS[id]);
  const announce = (id: ActivitySectionId, next: readonly ActivitySectionId[]) =>
    setAnnouncement(t("panel.activity.sections.moved", { name: label(id), position: next.indexOf(id) + 1, count: next.length }));
  const { drag, start } = useSectionPointerDrag(container, (done, commit) => {
    if (!commit || sameActivitySectionOrder(done.order, done.origin)) return;
    commitVisible(done.order);
    announce(done.id, done.order);
  });
  const shown = (drag?.order ?? stored).filter((id) => nodes.has(id));
  useLayoutEffect(() => {
    const id = refocus.current;
    if (!id) return;
    refocus.current = null;
    container.current?.querySelector<HTMLElement>(`[data-activity-section-grip="${id}"]`)?.focus();
  });
  const onGripKeyDown = (event: KeyboardEvent<HTMLButtonElement>, id: ActivitySectionId) => {
    if ((event.key !== "ArrowUp" && event.key !== "ArrowDown") || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    event.preventDefault();
    const next = stepActivitySection(stored, id, event.key === "ArrowUp" ? -1 : 1);
    if (!next) return;
    commitVisible(next);
    refocus.current = id;
    announce(id, next);
  };
  const onGripPointerDown = (event: ReactPointerEvent<HTMLButtonElement>, id: ActivitySectionId) => {
    if (event.button !== 0) return;
    event.preventDefault();
    start(id, stored);
  };
  const resetOrder = () => {
    reset();
    refocus.current = ACTIVITY_SECTION_IDS.find((id) => nodes.has(id)) ?? null;
    setAnnouncement(t("panel.activity.sections.resetDone"));
  };
  return <div ref={container} className="session-activity-sections" data-dragging={drag ? "true" : undefined}>
    {shown.map((id) => <div key={id} className="session-activity-section" data-activity-section={id} data-dragging={drag?.id === id ? "true" : undefined}>
      <ActivitySectionGripContext.Provider value={
        <TooltipButton type="button" className="session-activity-grip" data-activity-section-grip={id}
          tooltip={t("panel.activity.sections.gripTooltip")} ariaLabel={t("panel.activity.sections.grip", { name: label(id) })}
          aria-describedby={hintId} onPointerDown={(event) => onGripPointerDown(event, id)} onKeyDown={(event) => onGripKeyDown(event, id)}>
          <IconGripVertical size={14} aria-hidden />
        </TooltipButton>}>
        {nodes.get(id)}
      </ActivitySectionGripContext.Provider>
    </div>)}
    {!isDefault && <Button variant="ghost" size="sm" className="session-activity-sections-reset" onClick={resetOrder}>
      {t("panel.activity.sections.reset")}
    </Button>}
    {/* The tooltip's sentence, kept reachable for assistive technology: it is where the arrow keys are explained. */}
    <p id={hintId} hidden>{t("panel.activity.sections.gripTooltip")}</p>
    <p className="session-activity-sections-status" role="status" aria-live="polite">{announcement}</p>
  </div>;
}
