/** The activity rail's sections in their default order. A new section joins this tuple where it should sit by default. */
export const ACTIVITY_SECTION_IDS = ["goals", "plans", "live", "server", "environment", "context", "artifacts", "skills", "changes"] as const;
export type ActivitySectionId = (typeof ACTIVITY_SECTION_IDS)[number];

export const ACTIVITY_SECTION_LABEL_KEYS: Record<ActivitySectionId, string> = {
  goals: "panel.activity.goals",
  plans: "panel.activity.plans",
  live: "panel.activity.liveStatus",
  server: "panel.activity.servers",
  environment: "panel.activity.environment",
  context: "panel.activity.context",
  artifacts: "panel.activity.artifacts",
  skills: "panel.activity.skills.sectionTitle",
  changes: "panel.activity.changes",
};

export type ActivitySectionRect = { id: ActivitySectionId; top: number; height: number };

const isSectionId = (value: unknown): value is ActivitySectionId =>
  typeof value === "string" && (ACTIVITY_SECTION_IDS as readonly string[]).includes(value);

export function sameActivitySectionOrder(a: readonly ActivitySectionId[], b: readonly ActivitySectionId[]): boolean {
  return a.length === b.length && a.every((id, index) => id === b[index]);
}

export function isDefaultActivitySectionOrder(order: readonly ActivitySectionId[]): boolean {
  return sameActivitySectionOrder(order, ACTIVITY_SECTION_IDS);
}

/**
 * Turns whatever was stored into a complete order. Unknown ids and repeats are dropped. A section the stored
 * value never saw lands right after its nearest default predecessor, so adding a section in a later release
 * does not disturb the order a person already chose.
 */
export function mergeActivitySectionOrder(stored: unknown): ActivitySectionId[] {
  const order: ActivitySectionId[] = [];
  if (Array.isArray(stored)) for (const id of stored) if (isSectionId(id) && !order.includes(id)) order.push(id);
  ACTIVITY_SECTION_IDS.forEach((id, index) => {
    if (order.includes(id)) return;
    let at = 0;
    for (let before = index - 1; before >= 0; before--) {
      const found = order.indexOf(ACTIVITY_SECTION_IDS[before]);
      if (found >= 0) { at = found + 1; break; }
    }
    order.splice(at, 0, id);
  });
  return order;
}

/** Writes a new relative order of the visible sections into their own slots; hidden sections keep theirs. */
export function applyVisibleActivitySectionOrder(
  full: readonly ActivitySectionId[], visibleOrder: readonly ActivitySectionId[],
): ActivitySectionId[] {
  const slots = new Set(visibleOrder);
  if (full.filter((id) => slots.has(id)).length !== visibleOrder.length) return [...full];
  let next = 0;
  return full.map((id) => (slots.has(id) ? visibleOrder[next++] : id));
}

/** One step up or down, or null at an edge or for an unknown section. */
export function stepActivitySection(
  order: readonly ActivitySectionId[], id: ActivitySectionId, delta: -1 | 1,
): ActivitySectionId[] | null {
  const from = order.indexOf(id);
  const to = from + delta;
  if (from < 0 || to < 0 || to >= order.length) return null;
  const next = [...order];
  [next[from], next[to]] = [next[to], next[from]];
  return next;
}

/** The dragged section lands before the first other section whose midpoint lies below the pointer, else last. */
export function dragActivitySectionOrder(
  order: readonly ActivitySectionId[], dragged: ActivitySectionId, pointerY: number, rects: readonly ActivitySectionRect[],
): ActivitySectionId[] {
  const others = order.filter((id) => id !== dragged);
  const before = others.find((id) => {
    const rect = rects.find((candidate) => candidate.id === id);
    return rect !== undefined && pointerY < rect.top + rect.height / 2;
  });
  const next = [...others];
  next.splice(before === undefined ? next.length : next.indexOf(before), 0, dragged);
  return next;
}
