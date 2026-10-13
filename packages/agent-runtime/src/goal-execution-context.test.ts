import { expect, it } from "vitest";
import { parseGoalResume } from "./goal-execution-context.js";

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
])("rejects invalid resume payload %# before execution", value => {
  expect(() => parseGoalResume(value)).toThrow("Invalid Goal resume context");
});
