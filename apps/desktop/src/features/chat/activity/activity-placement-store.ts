import { create } from "zustand";
import type { ActivityPlacement } from "./activity-placement";

/**
 * The placement one visible chat surface last reported, and the session it belongs to. A hidden retained surface
 * never overwrites the visible one: it releases only its own claim, so the work panel keeps following the session
 * on screen instead of a pane that is merely still mounted.
 */
type ActivityPlacementState = {
  sessionId: string | null;
  placement: ActivityPlacement;
  report: (sessionId: string, placement: ActivityPlacement, visible?: boolean) => void;
  release: (sessionId: string) => void;
};

export const useActivityPlacementStore = create<ActivityPlacementState>((set, get) => ({
  sessionId: null,
  placement: "none",
  // A surface that is not on screen reports nothing, so a hidden retained pane cannot take the panel from the one
  // the person is reading.
  report: (sessionId, placement, visible = true) => {
    if (!visible) return;
    set({ sessionId, placement });
  },
  release: (sessionId) => {
    if (get().sessionId !== sessionId) return;
    set({ sessionId: null, placement: "none" });
  },
}));
