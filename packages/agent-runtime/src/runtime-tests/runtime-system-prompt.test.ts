import "./runtime-test-harness.js";
import { describe, it, expect } from "vitest";
import { DesktopAgentRuntime } from "../runtime.js";
import { createRuntime, runtimeMatches } from "./runtime-test-harness.js";

describe("custom system prompt files (issue #542)", () => {

  const persona = "You are Custom, a specialized assistant.";

  const appendix = "MARKER-XYZ-123 Always end with the marker.";

  function promptOf(runtime: DesktopAgentRuntime): string {
    return (runtime as any).agent.state.systemPrompt as string;
  }

  it("replaces only the persona, keeping operational rules", async () => {
    const runtime = createRuntime({
      customSystemPrompt: { replace: persona },
    });
    const prompt = promptOf(runtime);

    expect(prompt).toContain(persona);
    expect(prompt).not.toContain("You are Pi-Desktop-Plus");
    // Operational rules from the default prompt must survive the replacement.
    expect(prompt).toContain("Complete the requested work and relevant checks");
    expect(prompt).toContain("Before each tool batch, briefly state its purpose");
    expect(prompt).toContain("User-visible progress updates");
    expect(prompt).toContain("1-2 short sentences");
    expect(prompt).toContain("Do not narrate internal phase names");
    expect(prompt).toContain("Editing workflow: inside the advertised workspace");
    expect(prompt).toContain("You are operating in Agent mode.");

    await runtime.dispose();
  });

  it("appends APPEND_SYSTEM.md after the base prompt and before project instructions", async () => {
    const runtime = createRuntime({
      customSystemPrompt: { append: appendix },
      projectInstructions: {
        entries: [{ source: "AGENTS.md", content: "Run unit tests." }],
      },
    });
    const prompt = promptOf(runtime);

    expect(prompt).toContain(appendix);
    expect(prompt).toContain("You are Pi-Desktop-Plus");
    expect(prompt).toContain("Run unit tests.");
    expect(prompt.indexOf(appendix)).toBeGreaterThan(
      prompt.indexOf("You are Pi-Desktop-Plus"),
    );
    expect(prompt.indexOf("Run unit tests.")).toBeGreaterThan(
      prompt.indexOf(appendix),
    );

    await runtime.dispose();
  });

  it("applies replace and append together", async () => {
    const runtime = createRuntime({
      customSystemPrompt: { replace: persona, append: appendix },
    });
    const prompt = promptOf(runtime);

    expect(prompt).toContain(persona);
    expect(prompt).toContain(appendix);
    expect(prompt).not.toContain("You are Pi-Desktop-Plus");

    await runtime.dispose();
  });

  it("keeps the default prompt without custom files", async () => {
    const runtime = createRuntime();
    const prompt = promptOf(runtime);

    expect(prompt).toContain("You are Pi-Desktop-Plus");
    expect(prompt).not.toContain("MARKER-XYZ-123");

    await runtime.dispose();
  });

  it("retires the runtime when custom prompt content changes", async () => {
    const runtime = createRuntime({
      customSystemPrompt: { append: appendix },
    });
    expect(
      runtimeMatches(runtime, { customSystemPrompt: { append: appendix } }),
    ).toBe(true);
    expect(
      runtimeMatches(runtime, {
        customSystemPrompt: { append: "Different appendix." },
      }),
    ).toBe(false);
    expect(
      runtimeMatches(runtime, { customSystemPrompt: undefined }),
    ).toBe(false);
    expect(
      runtimeMatches(runtime, { customSystemPrompt: { replace: persona } }),
    ).toBe(false);

    await runtime.dispose();
  });
});
