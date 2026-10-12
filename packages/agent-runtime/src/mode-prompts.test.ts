import { describe, expect, it } from "vitest";
import {
  composeModeSystemPrompt,
  GOAL_MODE_SYSTEM_PROMPT,
  PLAN_MODE_SYSTEM_PROMPT,
} from "./mode-prompts.js";

describe("mode-specific system prompts", () => {
  it.each(["plan", "goal"] as const)("asks the same AI to summarize the %s approval separately from full Markdown", (mode) => {
    const prompt = composeModeSystemPrompt(mode);
    expect(prompt).toContain("Summarize the complete contract yourself");
    expect(prompt).toContain("1-2 short plain-text sentences");
    expect(prompt).toContain("user's language");
    expect(prompt).toContain("Do not copy the plan body");
    expect(prompt).toContain("important unresolved choices");
  });
  it("composes Plan instructions over the shared runtime prompt", () => {
    const prompt = composeModeSystemPrompt("plan", "base instructions");

    expect(prompt).toContain("base instructions");
    expect(prompt).toContain(PLAN_MODE_SYSTEM_PROMPT);
    expect(prompt).toContain("Inspect the workspace");
    expect(prompt).toContain("SubmitPlan");
    expect(prompt).toContain("When any initial or revised plan is ready");
    expect(prompt).toContain("immediately exactly once in the current turn");
    expect(prompt).toContain("one complete Markdown snapshot");
    expect(prompt).toContain("Do not write or edit a plan file yourself");
    expect(prompt).toContain("host writes a new .pi/plan artifact");
    expect(prompt).toContain("An accepted new Plan prompt means no prior approval is pending");
    expect(prompt).toContain("historical immutable checkpoints");
    expect(prompt).toContain("After reject, expiry, or interruption");
    expect(prompt).toContain("follow the same one-SubmitPlan rule");
    expect(prompt).toContain("Do not wait for chat confirmation");
    expect(prompt).toContain("Do not use Write, Edit");
    expect(prompt).toContain("Do not create, overwrite, delete, or otherwise mutate workspace files in Plan mode");
    expect(prompt).toContain("including through Bash");
    expect(prompt).toContain("ask them to switch to Agent mode");
    expect(prompt).toContain("Plugin tools that declare plan-safe actions are available for inspection");
    expect(prompt).toContain("Bash is available under the active permission policy");
  });

  it("composes Goal instructions asking for a contract, not steps", () => {
    const prompt = composeModeSystemPrompt("goal", "base instructions");

    expect(prompt).toContain("base instructions");
    expect(prompt).toContain(GOAL_MODE_SYSTEM_PROMPT);
    expect(prompt).toContain("SubmitGoal");
    expect(prompt).toContain("acceptance criteria");
    expect(prompt).toContain("boundaries");
    expect(prompt).toContain("Do not enumerate implementation steps");
    expect(prompt).toContain("host writes a new .pi/goal artifact");
    expect(prompt).toContain("follow the same one-SubmitGoal rule");
    expect(prompt).toContain("pursue it autonomously");
    expect(prompt).toContain("Do not use Write, Edit");
    expect(prompt).toContain("Do not create, overwrite, delete, or otherwise mutate workspace files in Goal mode");
    // Goal mode negotiates outcomes; the Plan contract must not leak into it.
    expect(prompt).not.toContain("SubmitPlan");
    expect(prompt).not.toContain(PLAN_MODE_SYSTEM_PROMPT);
  });

  it("keeps Agent composition separate from Plan composition", () => {
    const prompt = composeModeSystemPrompt("agent", "base instructions");

    expect(prompt).toContain("operating in Agent mode");
    expect(prompt).not.toContain("Do not use Write, Edit");
    expect(prompt).not.toContain("SubmitGoal");
  });

  it("explains unknown costs and resolves spending boundaries before Goal submission", () => {
    const prompt = composeModeSystemPrompt("goal");

    expect(prompt).toContain("Unknown provider pricing or usage cost is unknown, not zero");
    expect(prompt).toContain("not a Host-enforced spending limit");
    expect(prompt).toContain("whether cost can actually be measured and constrained");
    expect(prompt).toContain("use asktool to resolve any unsettled spending boundary");
    expect(prompt).toContain("do not claim a hard monetary guarantee you cannot enforce");
  });

  it("negotiates human and external dependencies without inventing trusted approval", () => {
    const prompt = composeModeSystemPrompt("goal");

    expect(prompt).toContain("which checks you can actually perform");
    expect(prompt).toContain("which require user participation or external evidence");
    expect(prompt).toContain("Negotiate human approvals, paid actions, publication");
    expect(prompt).toContain("explicit stage boundaries or user-participation items before SubmitGoal");
    expect(prompt).toContain("Stop at an unmet boundary");
    expect(prompt).toContain("Never approve on the user's behalf");
    expect(prompt).toContain("scanned Markdown or model-authored approval text");
    expect(prompt).not.toContain("Every acceptance criterion must be objectively checkable by you");
  });

  it("keeps ordinary Agent checklists while respecting a restricted tool catalog", () => {
    const prompt = composeModeSystemPrompt("agent");

    expect(prompt).toContain("when TodoWrite is available in your current tool catalog");
    expect(prompt).toContain("keep the user's session checklist current with TodoWrite");
    expect(prompt).toContain("keep at most one item in progress");
    expect(prompt).toContain("follow that role's progress workflow");
    expect(prompt).not.toContain("Host-enforced spending limit");
  });
});
