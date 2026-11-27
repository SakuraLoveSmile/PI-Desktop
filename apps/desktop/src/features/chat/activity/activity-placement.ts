/** The chat width at which the rail fits beside the transcript instead of moving into the work panel. */
export const ACTIVITY_INLINE_MIN_WIDTH = 820;

/**
 * Where the session summary lives: beside the chat, as the first work panel tab, behind a button that opens that
 * tab, or nowhere at all. Only the chat width decides between the first three, because the rail sits inside the chat
 * surface: moving it into the panel never changes the width it was measured against, so no hysteresis is needed.
 */
export type ActivityPlacement = "inline" | "docked" | "button" | "none";

export function activityPlacement({ visible, hasSession, panelOpen, surfaceWidth }: {
  visible: boolean;
  hasSession: boolean;
  panelOpen: boolean;
  surfaceWidth: number;
}): ActivityPlacement {
  if (!visible || !hasSession) return "none";
  if (surfaceWidth >= ACTIVITY_INLINE_MIN_WIDTH) return "inline";
  return panelOpen ? "docked" : "button";
}
