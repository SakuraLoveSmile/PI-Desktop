import { expect, it, vi } from "vitest";
import { bindProjectContextHost, PROJECT_CONTEXT_METHODS } from "./project-context-host.js";

it("captures session identity and launch capability outside model arguments", async () => {
  const call = vi.fn(async (_method: string, _params?: unknown) => ({}));
  const scoped = bindProjectContextHost({ call: <T>(method: string, params?: unknown) => call(method, params) as Promise<T> }, "real", "launch-capability");
  for (const method of PROJECT_CONTEXT_METHODS) {
    await scoped.call(method, { sessionId: "spoofed", projectContextBindingId: "spoofed", query: "preference" });
    expect(call).toHaveBeenLastCalledWith(method, { sessionId: "real", projectContextBindingId: "launch-capability", query: "preference" });
  }
  await scoped.call("session.get", { id: "other" });
  expect(call).toHaveBeenLastCalledWith("session.get", { id: "other" });
  await expect(bindProjectContextHost({ call: scoped.call }, "real").call("project.codeSearch", {})).rejects.toThrow("bound project session");
});
