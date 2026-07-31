import { describe, expect, it } from "vitest";
import { ErrorCodes, err, ok } from "./errors.js";

describe("result helpers", () => {
  it("creates ok results", () => {
    expect(ok(1)).toEqual({ ok: true, data: 1 });
  });

  it("creates error results", () => {
    const result = err("NOT_FOUND", "missing");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("NOT_FOUND");
    }
  });

  it("exposes approved-plan execution failure codes", () => {
    expect(ErrorCodes.PLAN_ARTIFACT_INVALID).toBe("PLAN_ARTIFACT_INVALID");
    expect(ErrorCodes.PLAN_EXECUTION_INTERRUPTED).toBe(
      "PLAN_EXECUTION_INTERRUPTED",
    );
  });

  it("exposes command shell contract failure codes", () => {
    expect(ErrorCodes.COMMAND_SHELL_CHANGED).toBe("COMMAND_SHELL_CHANGED");
    expect(ErrorCodes.SHELL_NOT_FOUND).toBe("SHELL_NOT_FOUND");
    expect(ErrorCodes.COMMAND_SHELL_INVALID).toBe("COMMAND_SHELL_INVALID");
  });
});
