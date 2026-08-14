import { describe, expect, it } from "vitest";
import {
  DEFAULT_SUBAGENT_MAX_TURNS,
  DEFAULT_SUBAGENT_TOOLS,
  MAX_SUBAGENT_DEFINITIONS,
  MAX_SUBAGENT_MAX_TURNS,
  mergeSubagentDefinitions,
  normalizeSubagentName,
  parseSubagentDefinition,
  subagentCanMutate,
  subagentPinnedProviders,
  type SubagentDefinition,
} from "./subagent-definition.js";

function parse(raw: string, fallbackName = "reviewer") {
  return parseSubagentDefinition(raw, { source: "project", fallbackName });
}

function definition(
  overrides: Partial<SubagentDefinition> = {},
): SubagentDefinition {
  return {
    name: "reviewer",
    description: "Reviews a diff.",
    tools: ["Read"],
    maxTurns: DEFAULT_SUBAGENT_MAX_TURNS,
    prompt: "Review it.",
    source: "project",
    ...overrides,
  };
}

describe("parseSubagentDefinition", () => {
  it("reads the document a project would actually write", () => {
    const result = parse(`---
name: code-reviewer
description: Reviews changed files for correctness bugs.
tools: Read, Grep, Glob
model: anthropic/claude-opus-5
thinkingLevel: high
maxTurns: 12
---

Review the diff and report only defects you can point at a line for.
`);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.definition).toEqual({
      name: "code-reviewer",
      description: "Reviews changed files for correctness bugs.",
      tools: ["Read", "Grep", "Glob"],
      model: { providerId: "anthropic", modelId: "claude-opus-5" },
      thinkingLevel: "high",
      maxTurns: 12,
      prompt:
        "Review the diff and report only defects you can point at a line for.",
      source: "project",
    });
    expect(result.warnings).toEqual([]);
  });

  it("is read-only when the document says nothing about tools", () => {
    const result = parse(`---
description: Explains a subsystem.
---
Explain it.`);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.definition.tools).toEqual([...DEFAULT_SUBAGENT_TOOLS]);
    expect(subagentCanMutate(result.definition)).toBe(false);
    expect(result.definition.name).toBe("reviewer");
    expect(result.definition.maxTurns).toBe(DEFAULT_SUBAGENT_MAX_TURNS);
    expect(result.definition.permission).toBeUndefined();
  });

  it("parses a declared permission scope and defaults to inherit", () => {
    const scoped = parse(`---
description: Writes a feature.
tools: [Read, Edit, Write]
permission: accept-edits
---
Implement it.`);
    expect(scoped.ok).toBe(true);
    if (!scoped.ok) return;
    expect(scoped.definition.permission).toBe("accept-edits");
    expect(scoped.warnings).toEqual([]);

    const inherited = parse(`---
description: Explains a subsystem.
permission: inherit
---
Explain it.`);
    expect(inherited.ok).toBe(true);
    if (!inherited.ok) return;
    expect(inherited.definition.permission).toBeUndefined();
  });

  it("warns on an unknown permission scope", () => {
    const result = parse(`---
description: Explains a subsystem.
permission: everything
---
Explain it.`);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.definition.permission).toBeUndefined();
    expect(result.warnings.join("\n")).toContain(
      "ignoring unknown permission",
    );
  });

  it("takes mutation rights only when they are declared", () => {
    const result = parse(`---
description: Applies a mechanical rename.
tools:
  - Read
  - Edit
  - Write
---
Rename it.`);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.definition.tools).toEqual(["Read", "Edit", "Write"]);
    expect(subagentCanMutate(result.definition)).toBe(true);
  });

  it("expands `*` to every assignable tool", () => {
    const result = parse(`---
description: Does everything.
tools: "*"
---
Go.`);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.definition.tools).toContain("Bash");
    expect(result.definition.tools).toContain("Write");
    // Plugin, skill and mode tools stay out of a delegate's reach.
    expect(result.definition.tools).not.toContain("Task");
    expect(result.definition.tools).not.toContain("ToolSearch");
  });

  it("drops unknown tools with a warning instead of failing", () => {
    const result = parse(`---
description: Reads code.
tools: [Read, Teleport]
---
Read it.`);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.definition.tools).toEqual(["Read"]);
    expect(result.warnings).toEqual(['ignoring unknown tool "Teleport"']);
  });

  it("rejects a tools list where nothing survives", () => {
    const result = parse(`---
description: Reads code.
tools: [Teleport]
---
Read it.`);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors).toContain("`tools` lists no usable tool");
  });

  it("accepts the explicit provider spelling and keeps slashes in model ids", () => {
    const explicit = parse(`---
description: Reads code.
provider: openrouter
model: anthropic/claude-opus-5
---
Read it.`);
    expect(explicit.ok).toBe(true);
    if (explicit.ok) {
      expect(explicit.definition.model).toEqual({
        providerId: "openrouter",
        modelId: "anthropic/claude-opus-5",
      });
    }

    const compact = parse(`---
description: Reads code.
model: openrouter/anthropic/claude-opus-5
---
Read it.`);
    expect(compact.ok).toBe(true);
    if (compact.ok) {
      expect(compact.definition.model).toEqual({
        providerId: "openrouter",
        modelId: "anthropic/claude-opus-5",
      });
    }
  });

  it("fails on a model pin it cannot resolve to a provider", () => {
    const bare = parse(`---
description: Reads code.
model: claude-opus-5
---
Read it.`);
    expect(bare.ok).toBe(false);

    const orphanProvider = parse(`---
description: Reads code.
provider: anthropic
---
Read it.`);
    expect(orphanProvider.ok).toBe(false);
    if (!orphanProvider.ok) {
      expect(orphanProvider.errors).toContain(
        "`provider` given without `model`",
      );
    }
  });

  it("requires a description and a body", () => {
    const noDescription = parse(`---
name: reviewer
---
Review it.`);
    expect(noDescription.ok).toBe(false);
    if (!noDescription.ok) {
      expect(noDescription.errors).toContain("missing `description`");
    }

    const noBody = parse(`---
description: Reviews a diff.
---
`);
    expect(noBody.ok).toBe(false);
    if (!noBody.ok) {
      expect(noBody.errors).toContain(
        "document body is empty (nothing to instruct)",
      );
    }
  });

  it("clamps and normalizes maxTurns", () => {
    const tooMany = parse(`---
description: Reads code.
max-turns: 500
---
Read it.`);
    expect(tooMany.ok).toBe(true);
    if (tooMany.ok) {
      expect(tooMany.definition.maxTurns).toBe(MAX_SUBAGENT_MAX_TURNS);
      expect(tooMany.warnings).toEqual([
        `clamping \`maxTurns\` 500 to ${MAX_SUBAGENT_MAX_TURNS}`,
      ]);
    }

    const nonsense = parse(`---
description: Reads code.
max_turns: soon
---
Read it.`);
    expect(nonsense.ok).toBe(true);
    if (nonsense.ok) {
      expect(nonsense.definition.maxTurns).toBe(DEFAULT_SUBAGENT_MAX_TURNS);
    }
  });

  it("rejects a name that cannot be used as a Task argument", () => {
    const result = parseSubagentDefinition(
      `---
name: Code Reviewer!
description: Reviews a diff.
---
Review it.`,
      { source: "project" },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors[0]).toMatch(/invalid name/);
    }
  });

  it("fails a document with no frontmatter at all", () => {
    const result = parse("Just some prose.");
    expect(result.ok).toBe(false);
  });
});

describe("normalizeSubagentName", () => {
  it("turns a file path into a Task argument", () => {
    expect(normalizeSubagentName("/w/.pi/agents/Code_Reviewer.md")).toBe(
      "code-reviewer",
    );
    expect(normalizeSubagentName("reviewer")).toBe("reviewer");
  });
});

describe("mergeSubagentDefinitions", () => {
  it("lets a project document shadow the builtin of the same name", () => {
    const merged = mergeSubagentDefinitions([
      definition({ name: "reviewer", source: "builtin", prompt: "builtin" }),
      definition({ name: "reviewer", source: "project", prompt: "project" }),
      definition({ name: "explorer", source: "builtin" }),
    ]);

    expect(merged.definitions).toHaveLength(2);
    const reviewer = merged.definitions.find((d) => d.name === "reviewer");
    expect(reviewer?.source).toBe("project");
    expect(reviewer?.prompt).toBe("project");
    expect(merged.dropped).toEqual([]);
  });

  it("ranks project over the user's own registry over builtin", () => {
    const merged = mergeSubagentDefinitions([
      definition({ name: "reviewer", source: "builtin", prompt: "builtin" }),
      definition({ name: "reviewer", source: "user", prompt: "user" }),
      definition({ name: "reviewer", source: "project", prompt: "project" }),
      definition({ name: "explorer", source: "builtin", prompt: "builtin" }),
      definition({ name: "explorer", source: "user", prompt: "user" }),
    ]);

    expect(merged.definitions).toHaveLength(2);
    expect(merged.definitions.find((d) => d.name === "reviewer")?.prompt).toBe(
      "project",
    );
    // With no project document, the user's own definition retunes the builtin.
    expect(merged.definitions.find((d) => d.name === "explorer")?.prompt).toBe("user");
    expect(merged.dropped).toEqual([]);
  });

  it("caps the catalog and reports what it dropped", () => {
    const many = Array.from({ length: MAX_SUBAGENT_DEFINITIONS + 2 }, (_, i) =>
      definition({ name: `agent-${i}`, source: "builtin" }),
    );
    const merged = mergeSubagentDefinitions(many);

    expect(merged.definitions).toHaveLength(MAX_SUBAGENT_DEFINITIONS);
    expect(merged.dropped).toEqual([
      `agent-${MAX_SUBAGENT_DEFINITIONS}`,
      `agent-${MAX_SUBAGENT_DEFINITIONS + 1}`,
    ]);
  });
});

describe("subagentPinnedProviders", () => {
  it("lists each pinned provider once", () => {
    const providers = subagentPinnedProviders([
      definition({ name: "a", model: { providerId: "p1", modelId: "m" } }),
      definition({ name: "b", model: { providerId: "p1", modelId: "m2" } }),
      definition({ name: "c", model: { providerId: "p2", modelId: "m" } }),
      definition({ name: "d" }),
    ]);
    expect(providers).toEqual(["p1", "p2"]);
  });
});
