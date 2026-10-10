import "./runtime-test-harness.js";
import { describe, it, expect } from "vitest";
import { toToolDeclaration } from "@earendil-works/pi-ai";
import { subagentRuns, createRuntime } from "./runtime-test-harness.js";

describe("DesktopAgentRuntime tool schema completeness (#864)", () => {

  it("declares required for every object schema handed to the provider", async () => {
    // Plan mode keeps the read-only core (Read, Glob, Grep, BrowserPreview)
    // active instead of deferring it behind ToolSearch, and a plan-safe plugin
    // tool joins that same core set.
    const runtime = createRuntime({
      mode: "plan",
      pluginTools: [
        {
          name: "plugin_demo_read",
          description: "demo",
          planSafeActions: ["read"],
          // A manifest that spells out no `required` at all, like the built-ins
          // whose canonical argument is declared optional.
          parameters: { type: "object", properties: {} },
        },
      ],
    });
    type WireTool = {
      name: string;
      parameters?: { type?: unknown; required?: unknown };
    };
    const declarations = (
      (runtime as any).agent.state.tools as Array<unknown>
    ).map(
      (tool) => toToolDeclaration(tool as never) as unknown as WireTool,
    );
    const byName = new Map<string, WireTool>();
    for (const declaration of declarations) {
      byName.set(declaration.name, declaration);
    }

    // The alias tools require no argument, but the key still has to be an
    // array: a relay that decodes a missing key into a nil slice answers
    // `Invalid schema for function 'Read': null is not of type "array"`.
    for (const name of [
      "Read",
      "Glob",
      "Grep",
      "BrowserPreview",
      "plugin_demo_read",
    ]) {
      const declaration = byName.get(name);
      expect(
        declaration,
        `${name} missing from the active catalogue`,
      ).toBeDefined();
      expect(declaration!.parameters, name).toMatchObject({
        type: "object",
        required: [],
      });
    }
    for (const declaration of declarations) {
      const parameters = declaration.parameters;
      if (parameters?.type !== "object") continue;
      expect(
        Array.isArray(parameters.required),
        `${declaration.name}.required`,
      ).toBe(true);
    }
    // A tool that does have a required argument keeps exactly that list.
    expect(byName.get("Bash")!.parameters?.required).toEqual(["command"]);

    await runtime.dispose();
  });

  it("hands the same schema to a delegated Task run", async () => {
    // A delegate reads its tools straight from the tool catalogue, so a
    // normalisation applied only where the session agent is wired up would miss
    // it — and the default delegate toolset is exactly these read tools.
    const runtime = createRuntime({
      subagents: [
        {
          name: "worker",
          description: "Reads files.",
          tools: ["Read", "Glob", "Grep"],
          prompt: "Do the job.",
          source: "user",
        },
      ],
    });
    subagentRuns.calls.length = 0;
    subagentRuns.deferred = false;
    const task = (runtime as any).agent.state.tools.find(
      (tool: { name: string }) => tool.name === "Task",
    );
    await task.execute("delegate-1", { agent: "worker", task: "Read a file." });

    expect(subagentRuns.calls).toHaveLength(1);
    const delegateTools: Array<Record<string, any>> =
      subagentRuns.calls[0].tools;
    expect(delegateTools.map((tool) => tool.name)).toEqual(
      expect.arrayContaining(["Read", "Glob", "Grep"]),
    );
    for (const delegateTool of delegateTools) {
      expect(Array.isArray(delegateTool.parameters?.required)).toBe(true);
    }
    expect(
      delegateTools.find((tool) => tool.name === "Read")!.parameters.required,
    ).toEqual([]);

    await runtime.dispose();
  });
});
