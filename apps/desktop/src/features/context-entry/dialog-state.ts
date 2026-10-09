import { useSyncExternalStore } from "react";

let sessionId: string | null = null;
const listeners = new Set<() => void>();

export function openContextInsightsDialog(id: string) {
  sessionId = id;
  for (const listener of listeners) listener();
}

export function closeContextInsightsDialog() {
  sessionId = null;
  for (const listener of listeners) listener();
}

export function useContextInsightsDialog() {
  return useSyncExternalStore(
    (listener) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    () => sessionId,
    () => null,
  );
}
