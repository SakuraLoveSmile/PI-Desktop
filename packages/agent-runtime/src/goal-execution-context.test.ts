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
