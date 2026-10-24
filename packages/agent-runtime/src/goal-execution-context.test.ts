import { expect, it } from "vitest";
import type { PlanExecution } from "@pi-desktop/shared";
import { approvedGoalInstruction, parseGoalResume } from "./goal-execution-context.js";

it("delivers the frozen verification requirements to initial and resumed execution without replacing the approved Markdown", () => {
  const execution: PlanExecution = {
    id: "exec", proposalId: "proposal", sessionId: "session", kind: "goal", state: "running",
    title: "Goal", question: "Proceed?", plan: "# Exact approved contract",
    artifact: { relativePath: ".pi/goal/contract.md", sha256: "hash", sizeBytes: 25 }, targetPermissionMode: "auto",
    requiredVerificationCommands: ["cargo test --locked", "pnpm test -- --run"],
  };
  for (const resume of [undefined, { segment: 2, reasons: [{ code: "report_invalid" as const }] }]) {
    const instruction = approvedGoalInstruction(execution, resume);
    expect(instruction).toContain(execution.plan);
    expect(instruction).toContain(JSON.stringify(execution.requiredVerificationCommands));
    expect(instruction).toContain("exitCode null");
    expect(instruction).toContain("within this execution");
  }
  const { requiredVerificationCommands: _requirements, ...legacy } = execution;
  expect(approvedGoalInstruction(legacy)).not.toContain("The approval binds these exact verification commands");
});

it("validates resume reasons, segment identity and user supplement at admission", () => {
  expect(parseGoalResume(undefined)).toBeUndefined();
  const value = { segment: 2, userMessage: "Use the approved source", reasons: [
    { code: "agent_error:NETWORK_ERROR", detail: "Reconnect", tasks: [{ id: "task", title: "Verify", status: "pending", assigneeId: "expert" }] },
    { code: "report_missing" },
  ] };
  expect(parseGoalResume(value)).toEqual(value);
});

it.each([
  null, [], {}, { segment: 1, reasons: [] }, { segment: 2.1, reasons: [] },
  { segment: 2, reasons: [{ code: "unknown_reason" }] },
  { segment: 2, reasons: [{ code: "agent_error:" }] },
  { segment: 2, reasons: [{ code: "team_unsettled", detail: 1 }] },
  { segment: 2, reasons: [{ code: "team_unsettled", tasks: [{ id: "task" }] }] },
  { segment: 2, reasons: [], userMessage: 42 },
  { segment: 2, reasons: [], priorTurnIds: null },
  { segment: 2, reasons: [], priorTurnIds: "turn" },
  { segment: 2, reasons: [], priorTurnIds: [42] },
  { segment: 2, reasons: [], priorTurnIds: [""] },
  { segment: 2, reasons: [], priorTurnIds: ["  "] },
])("rejects invalid resume payload %# before execution", value => {
  expect(() => parseGoalResume(value)).toThrow("Invalid Goal resume context");
});

it("retains and deduplicates explicit Host segment identities, including an empty scope", () => {
  expect(parseGoalResume({ segment: 3, reasons: [], priorTurnIds: ["first", "second", "first"] }))
    .toEqual({ segment: 3, reasons: [], priorTurnIds: ["first", "second"] });
  expect(parseGoalResume({ segment: 2, reasons: [], priorTurnIds: [] }))
    .toEqual({ segment: 2, reasons: [], priorTurnIds: [] });
});
