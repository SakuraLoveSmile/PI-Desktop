import { describe, expect, it } from "vitest";
import { normalizeSubagentLimits } from "./subagent-limits.js";

describe("subagent runtime limits", () => {
  it("preserves the existing direct-child and ten-active defaults", () => {
    expect(normalizeSubagentLimits()).toEqual({ maxDepth: 1, maxConcurrency: 10 });
  });
  it("supports disabling Task and bounded recursive delegation", () => {
    expect(normalizeSubagentLimits({ subagentMaxDepth: 0, subagentMaxConcurrency: 1 }))
      .toEqual({ maxDepth: 0, maxConcurrency: 1 });
    expect(normalizeSubagentLimits({ subagentMaxDepth: 8, subagentMaxConcurrency: 32 }))
      .toEqual({ maxDepth: 8, maxConcurrency: 32 });
  });
  it("defaults invalid persisted values independently", () => {
    for (const value of [-1, 9, 1.5, NaN, Infinity]) {
      expect(normalizeSubagentLimits({ subagentMaxDepth: value, subagentMaxConcurrency: 3 }))
        .toEqual({ maxDepth: 1, maxConcurrency: 3 });
    }
    for (const value of [0, -1, 33, 2.5, NaN, Infinity]) {
      expect(normalizeSubagentLimits({ subagentMaxDepth: 3, subagentMaxConcurrency: value }))
        .toEqual({ maxDepth: 3, maxConcurrency: 10 });
    }
  });
});
