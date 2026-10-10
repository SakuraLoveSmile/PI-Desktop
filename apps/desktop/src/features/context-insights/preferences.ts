import { useState } from "react";

export type ContextInsightsPreferences = {
  granularity: "step" | "turn";
  measure: "total" | "delta";
  fileSort: "recent" | "name" | "calls";
  toolSort: "tokens" | "name";
  placement: "panel" | "modal";
};

const KEY = "pi-desktop.context-insights.preferences.v1";
const defaults: ContextInsightsPreferences = {
  granularity: "step",
  measure: "total",
  fileSort: "recent",
  toolSort: "tokens",
  placement: "panel",
};

export function readContextInsightsPreferences(): ContextInsightsPreferences {
  if (typeof window === "undefined") return { ...defaults };
  try {
    const value: unknown = JSON.parse(window.localStorage.getItem(KEY) ?? "null");
    if (!value || typeof value !== "object") return { ...defaults };
    const source = value as Record<string, unknown>;
    return {
      granularity: source.granularity === "turn" ? "turn" : "step",
      measure: source.measure === "delta" ? "delta" : "total",
      fileSort:
        source.fileSort === "name" || source.fileSort === "calls" ? source.fileSort : "recent",
      toolSort: source.toolSort === "name" ? "name" : "tokens",
      placement: source.placement === "modal" ? "modal" : "panel",
    };
  } catch {
    // Browsing remains available when storage is disabled by the environment.
    return { ...defaults };
  }
}

export function useContextInsightsPreferences() {
  const [preferences, setPreferences] = useState(readContextInsightsPreferences);
  const update = (patch: Partial<ContextInsightsPreferences>) => {
    setPreferences((previous) => {
      const next = { ...previous, ...patch };
      try {
        window.localStorage.setItem(KEY, JSON.stringify(next));
      } catch {
        /* Optional view preferences must not prevent reading diagnostics. */
      }
      return next;
    });
  };
  return [preferences, update] as const;
}
