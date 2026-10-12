import { expect, it } from "vitest";
import { bashTimeoutPayload, validateBashBackgroundKind } from "./background-bash.js";

it("explicit services require managed background launch and reject a command timeout", () => {
  expect(() => validateBashBackgroundKind({ backgroundKind: "service" })).toThrow("run_in_background");
  expect(() => validateBashBackgroundKind({ backgroundKind: "service", run_in_background: false })).toThrow("run_in_background");
  for (const timeout of [undefined, 60, 21600]) {
    expect(() => validateBashBackgroundKind({ backgroundKind: "service", run_in_background: true, timeout })).toThrow("timeout");
  }
  expect(() => validateBashBackgroundKind({ backgroundKind: "service", run_in_background: true })).not.toThrow();
  expect(bashTimeoutPayload({ backgroundKind: "service", run_in_background: true }, 60000)).toEqual({});
});

it("legacy and explicitly timed commands preserve the existing timeout transport", () => {
  for (const backgroundKind of [undefined, "command"]) {
    const kind = backgroundKind ? { backgroundKind } : {};
    expect(() => validateBashBackgroundKind({ command: "fixture", ...kind })).not.toThrow();
    expect(bashTimeoutPayload({ ...kind }, 60000)).toEqual({ timeoutMs: 60000 });
    expect(bashTimeoutPayload({ ...kind, run_in_background: true }, 60000)).toEqual({});
    expect(bashTimeoutPayload({ ...kind, run_in_background: true, timeout: 60 }, 60000)).toEqual({ timeoutMs: 60000 });
  }
});

it("rejects unknown process kinds rather than silently treating them as ordinary commands", () => {
  for (const backgroundKind of ["daemon", "", true, null]) {
    expect(() => validateBashBackgroundKind({ backgroundKind })).toThrow("backgroundKind");
  }
});
