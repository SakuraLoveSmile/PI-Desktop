import { afterEach, describe, expect, it, vi } from "vitest";
import { ParentHostProxy } from "./parent-host-proxy.js";

describe("ParentHostProxy timeouts", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("honors a per-call timeout", async () => {
    vi.useFakeTimers();
    vi.spyOn(process.stdout, "write").mockImplementation(
      ((...args: any[]) => {
        const callback = args[1];
        if (typeof callback === "function") callback();
        return true;
      }) as typeof process.stdout.write,
    );

    const proxy = new ParentHostProxy();
    const pending = proxy.call("project.instructions.resolve", {}, 25);
    const rejected = expect(pending).rejects.toThrow(
      "parent host proxy timeout: project.instructions.resolve",
    );

    await vi.advanceTimersByTimeAsync(25);
    await rejected;
  });
});
