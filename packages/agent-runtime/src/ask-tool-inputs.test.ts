import { expect, it } from "vitest";
import { AskToolInputs } from "./ask-tool-inputs.js";

const request = { sessionId: "s", requestId: "r", toolCallId: "t", questions: [{ question: "Which?", options: ["One", "Two"] }] };
it("pins identity and rejects malformed answers before consuming the waiter", async () => {
  const inputs = new AskToolInputs(() => undefined);
  const wait = inputs.wait(request);
  const resolution = { sessionId: "s", requestId: "r", expectedToolCallId: "t", answers: [["One"]] };
  for (const change of [{ sessionId: "other" }, { expectedToolCallId: "other" }]) {
    expect(() => inputs.resolve({ ...resolution, ...change }, "s")).toThrowError(expect.objectContaining({ errorCode: "ASKTOOL_IDENTITY_MISMATCH" }));
  }
  for (const answers of [[], [[]], [[" "]], [[1]], [["One", "Two"]], ["One"]]) {
    expect(() => inputs.resolve({ ...resolution, answers: answers as Array<string[] | null> }, "s")).toThrowError(expect.objectContaining({ errorCode: "ASKTOOL_INVALID_ARGUMENT" }));
  }
  expect(inputs.resolve(resolution, "s")).toEqual({ ok: true });
  const answer = await wait;
  expect(answer).toEqual([["One"]]);
  expect(inputs.resolutionKind(answer)).toBe("answered");
  expect(() => inputs.resolve(resolution, "s")).toThrowError(expect.objectContaining({ errorCode: "ASKTOOL_NOT_FOUND" }));
});

it("ordinary stop leaves Team waits intact and abort settles the remaining wait", async () => {
  const inputs = new AskToolInputs(() => undefined);
  const ordinary = inputs.wait(request);
  const team = inputs.wait({ ...request, requestId: "team", teamManaged: true });
  inputs.cancelAll("stopped", true);
  const stopped = await ordinary;
  expect(inputs.resolutionKind(stopped)).toBe("stopped");
  expect(inputs.resolve({ sessionId: "s", requestId: "team", answers: [["Two"]] }, "s")).toEqual({ ok: true });
  expect(await team).toEqual([["Two"]]);
  const aborted = inputs.wait({ ...request, requestId: "abort" });
  inputs.cancelAll();
  expect(inputs.resolutionKind(await aborted)).toBe("aborted");
});

it("simultaneous answers consume only the first value and synchronous resolution removes abort listeners", async () => {
  const controller = new AbortController();
  let inputs!: AskToolInputs;
  inputs = new AskToolInputs(ask => inputs.resolve({ ...ask, answers: [["One"]] }, "s"));
  const answer = await inputs.wait(request, controller.signal);
  controller.abort();
  expect(answer).toEqual([["One"]]);
  expect(inputs.resolutionKind(answer)).toBe("answered");
  expect(() => inputs.resolve({ ...request, answers: [["Two"]] }, "s")).toThrowError(expect.objectContaining({ errorCode: "ASKTOOL_NOT_FOUND" }));
});

it("preserves original labels and custom text, using trim only to reject blank values", async () => {
  const inputs = new AskToolInputs(() => undefined);
  const wait = inputs.wait({ ...request, questions: [{ question: "Which?", options: [" One ", "One"], multiSelect: true }] });
  inputs.resolve({ ...request, expectedToolCallId: "t", answers: [[" One ", "One", "  custom  "]] }, "s");
  expect(await wait).toEqual([[" One ", "One", "  custom  "]]);
});
