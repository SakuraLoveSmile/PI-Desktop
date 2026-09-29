import { describe, expect, it } from "vitest";
import { ErrorCodes } from "@pi-desktop/shared";
import { classifySidecarCrash, sidecarCrashErrorCode } from "./sidecar-crash.js";

const OOM_TAIL = ["<--- Last few GCs --->", "FATAL ERROR: Reached heap limit Allocation failed - JavaScript heap out of memory"].join("\n");

describe("classifySidecarCrash", () => {
  it("classifies V8 heap exhaustion", () => {
    const crash = classifySidecarCrash(OOM_TAIL);
    expect(crash.kind).toBe("oom");
    expect(sidecarCrashErrorCode(crash.kind)).toBe("AGENT_SIDECAR_OOM");
  });

  it("classifies the real string[] stderr payload", () => {
    expect(classifySidecarCrash(OOM_TAIL.split("\n")).kind).toBe("oom");
    expect(classifySidecarCrash(["Segmentation fault", "core dumped"]).kind).toBe("crashed");
  });

  it("filters non-string array entries", () => {
    expect(classifySidecarCrash(["FATAL ERROR: Reached heap limit", undefined, 42]).kind).toBe("oom");
  });

  it("keeps unknown and old payloads generic", () => {
    expect(classifySidecarCrash(undefined).kind).toBe("crashed");
    expect(classifySidecarCrash(null).kind).toBe("crashed");
    expect(sidecarCrashErrorCode("crashed")).toBe("AGENT_SIDECAR_CRASHED");
  });

  it("uses registered shared codes", () => {
    expect(ErrorCodes.AGENT_SIDECAR_OOM).toBe("AGENT_SIDECAR_OOM");
    expect(ErrorCodes.AGENT_SIDECAR_CRASHED).toBe("AGENT_SIDECAR_CRASHED");
  });
});
