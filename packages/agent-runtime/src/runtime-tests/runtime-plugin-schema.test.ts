import "./runtime-test-harness.js";
import { it, expect } from "vitest";
import { type PluginToolDef } from "../runtime.js";
import { createRuntime, runtimeMatches } from "./runtime-test-harness.js";

it("does not reuse stale plugin declarations when schema or permission metadata changes", async () => {
  const plugin: PluginToolDef = { name: "plugin_fixture", description: "Inspect", parameters: { type: "object", properties: { path: { type: "string" } } } };
  const runtime = createRuntime({ pluginTools: [plugin] });
  try {
    expect(runtimeMatches(runtime, { pluginTools: [{ ...plugin }] })).toBe(true);
    expect(runtimeMatches(runtime, { pluginTools: [{ ...plugin, parameters: { type: "object", properties: { file: { type: "string" } } } }] })).toBe(false);
    expect(runtimeMatches(runtime, { pluginTools: [{ ...plugin, planSafeActions: ["inspect"] }] })).toBe(false);
  } finally { await runtime.dispose(); }
});
