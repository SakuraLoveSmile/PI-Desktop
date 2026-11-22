import { createContext, useContext, type ReactNode } from "react";

/** The section frame owns the drag handle; the heading row inside the section decides where it sits. */
export const ActivitySectionGripContext = createContext<ReactNode>(null);

export function ActivitySectionGrip() {
  return <>{useContext(ActivitySectionGripContext)}</>;
}
