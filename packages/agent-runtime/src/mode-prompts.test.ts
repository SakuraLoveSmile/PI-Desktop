import { describe, expect, it } from "vitest";
import {
  composeModeSystemPrompt,
  PLAN_MODE_SYSTEM_PROMPT,
} from "./mode-prompts.js";

describe("mode-specific system prompts", () => {
  it("composes Plan instructions over the shared runtime prompt", () => {
    const prompt = composeModeSystemPrompt("plan", "base instructions");

    expect(prompt).toContain("base instructions");
    expect(prompt).toContain(PLAN_MODE_SYSTEM_PROMPT);
    expect(prompt).toContain("Inspect the workspace");
    expect(prompt).toContain("SubmitPlan");
    expect(prompt).toContain("exact Markdown snapshot");
    expect(prompt).toContain("Do not write a plan file yourself");
    expect(prompt).toContain("host writes the .pi/plan artifact");
    expect(prompt).toContain("Do not wait for chat confirmation");
    expect(prompt).toContain("Do not use Write, Edit, plugin tools");
    expect(prompt).toContain("Bash is available under the active permission policy");
  });

  it("keeps Agent composition separate from Plan composition", () => {
    const prompt = composeModeSystemPrompt("agent", "base instructions");

    expect(prompt).toContain("operating in Agent mode");
    expect(prompt).not.toContain("Do not use Write, Edit, plugin tools");
  });
});
