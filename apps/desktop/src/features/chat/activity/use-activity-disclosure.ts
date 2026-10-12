import { useCallback, useEffect, useState } from "react";
import { reconcileActivityDisclosure, type ActivityDisclosureState } from "./activity-rail-presentation";

const memory = new Map<string, ActivityDisclosureState>();
const prefix = "pi-desktop:activity-disclosure:v1:";

function readDisclosure(key: string, initialOpen: boolean): ActivityDisclosureState {
  const remembered = memory.get(key);
  if (remembered) return remembered;
  try {
    const raw = globalThis.localStorage?.getItem(prefix + key);
    const saved: unknown = raw ? JSON.parse(raw) : undefined;
    if (saved && typeof saved === "object" && "open" in saved && typeof saved.open === "boolean"
      && "attention" in saved && Array.isArray(saved.attention) && saved.attention.every((item) => typeof item === "string")) {
      return { open: saved.open, attention: saved.attention };
    }
  } catch (error) { console.warn("Activity disclosure preference could not be read", error instanceof Error ? error.name : "UnknownError"); }
  return { open: initialOpen, attention: [] };
}

export function useActivityDisclosure(sessionId: string, group: string, initialOpen: boolean, attention: string[], trackAttention = true, preserveMissing = false) {
  const key = `${sessionId}:${group}`;
  const [stored, setStored] = useState(() => readDisclosure(key, initialOpen));
  const state = trackAttention ? reconcileActivityDisclosure(stored, attention, preserveMissing) : stored;
  useEffect(() => {
    if (state !== stored) setStored(state);
    memory.set(key, state);
    try { globalThis.localStorage?.setItem(prefix + key, JSON.stringify(state)); }
    catch (error) { console.warn("Activity disclosure preference could not be saved", error instanceof Error ? error.name : "UnknownError"); }
  }, [key, state, stored]);
  const expand = useCallback(() => setStored((current) => current.open ? current : { ...current, open: true }), []);
  return { open: state.open, toggle: () => setStored({ ...state, open: !state.open }), expand };
}
