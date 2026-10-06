import { createContext } from "react";
import type { PlanTranscriptIndex } from "./plan-transcript";

export const PlanTranscriptContext = createContext<PlanTranscriptIndex>({
  byEntry: new Map(),
  beforeEntries: [],
});
