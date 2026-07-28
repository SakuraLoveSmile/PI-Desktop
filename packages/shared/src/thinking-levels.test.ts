import { describe, expect, it } from "vitest";
import { highestSupportedThinkingLevel } from "./thinking-levels.js";

describe("highestSupportedThinkingLevel", () => {
  it("returns the highest canonical level regardless of provider ordering", () => {
    expect(highestSupportedThinkingLevel(["high", "off", "low"])).toBe("high");
    expect(highestSupportedThinkingLevel(["max", "off", "xhigh"])).toBe("max");
  });

  it("falls back to off when no supported level is published", () => {
    expect(highestSupportedThinkingLevel(undefined)).toBe("off");
    expect(highestSupportedThinkingLevel([])).toBe("off");
  });
});
