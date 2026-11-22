import { useSyncExternalStore } from "react";
import {
  ACTIVITY_SECTION_IDS, applyVisibleActivitySectionOrder, isDefaultActivitySectionOrder, mergeActivitySectionOrder,
  sameActivitySectionOrder, type ActivitySectionId,
} from "./activity-section-order";

const STORAGE_KEY = "pi-desktop:activity-section-order:v1";
type OrderStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;
const failure = (error: unknown) => (error instanceof Error ? error.name : "UnknownError");

/**
 * The section order is one device preference shared by every rail. The store owns the cached value, its
 * storage entry and its subscribers; storage failures leave the in-memory order in force and stay visible.
 */
export function createActivitySectionOrderStore(getStorage: () => OrderStorage | undefined) {
  let current: readonly ActivitySectionId[] | undefined;
  const listeners = new Set<() => void>();
  const get = (): readonly ActivitySectionId[] => {
    if (current) return current;
    let stored: unknown;
    try {
      const raw = getStorage()?.getItem(STORAGE_KEY);
      stored = raw ? JSON.parse(raw) : undefined;
    } catch (error) { console.warn("Activity section order could not be read", failure(error)); }
    current = mergeActivitySectionOrder(stored);
    return current;
  };
  const set = (next: readonly ActivitySectionId[]) => {
    if (sameActivitySectionOrder(get(), next)) return;
    current = [...next];
    try {
      const storage = getStorage();
      if (isDefaultActivitySectionOrder(next)) storage?.removeItem(STORAGE_KEY);
      else storage?.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch (error) { console.warn("Activity section order could not be saved", failure(error)); }
    for (const listener of listeners) listener();
  };
  return {
    get,
    set,
    reset: () => set(ACTIVITY_SECTION_IDS),
    subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
  };
}

export const activitySectionOrderStore = createActivitySectionOrderStore(() => globalThis.localStorage);

export function useActivitySectionOrder() {
  const order = useSyncExternalStore(activitySectionOrderStore.subscribe, activitySectionOrderStore.get, activitySectionOrderStore.get);
  return {
    order,
    isDefault: isDefaultActivitySectionOrder(order),
    /** Commits the visible sections' new relative order; hidden sections keep their slots. */
    commitVisible: (visibleOrder: readonly ActivitySectionId[]) =>
      activitySectionOrderStore.set(applyVisibleActivitySectionOrder(activitySectionOrderStore.get(), visibleOrder)),
    reset: activitySectionOrderStore.reset,
  };
}
