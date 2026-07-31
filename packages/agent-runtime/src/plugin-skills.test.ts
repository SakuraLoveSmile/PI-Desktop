import { describe, expect, it } from "vitest";
import {
  MAX_PLUGIN_SKILL_BYTES,
  MAX_PLUGIN_SKILL_TOTAL_BYTES,
  clampPluginSkills,
  pluginSkillsDigest,
  type PluginSkill,
} from "./plugin-skills.js";
import { pluginSkillsPrompt } from "./plugin-skills-prompt.js";

function skill(overrides: Partial<PluginSkill> = {}): PluginSkill {
  return {
    pluginId: "demo.notes",
    pluginName: "Notes",
    id: "demo.notes/summarise",
    body: "Group notes by tag.",
    ...overrides,
  };
}

describe("clampPluginSkills", () => {
  it("keeps order and trims surrounding whitespace", () => {
    const clamped = clampPluginSkills([
      skill({ id: "a", body: "\n  first  \n" }),
      skill({ id: "b", body: "second" }),
    ]);
    expect(clamped?.entries.map((entry) => entry.id)).toEqual(["a", "b"]);
    expect(clamped?.entries[0].body).toBe("first");
  });

  it("returns undefined when nothing survives", () => {
    expect(clampPluginSkills([])).toBeUndefined();
    expect(clampPluginSkills([skill({ body: "   \n  " })])).toBeUndefined();
  });

  it("clamps a single oversized skill to the per-skill ceiling", () => {
    const clamped = clampPluginSkills([skill({ body: "x".repeat(20_000) })]);
    expect(Buffer.byteLength(clamped!.entries[0].body, "utf8")).toBe(
      MAX_PLUGIN_SKILL_BYTES,
    );
  });

  it("drops later skills instead of truncating them to a stub", () => {
    const clamped = clampPluginSkills(
      [
        skill({ id: "a", body: "a".repeat(6) }),
        skill({ id: "b", body: "b".repeat(6) }),
        skill({ id: "c", body: "c".repeat(6) }),
      ],
      { maxTotalBytes: 8, maxSkillBytes: 6 },
    );
    expect(clamped?.entries.map((entry) => entry.id)).toEqual(["a", "b"]);
    expect(clamped?.entries[1].body).toBe("bb");
  });

  it("never exceeds the total budget across many plugins", () => {
    const entries = Array.from({ length: 20 }, (_, index) =>
      skill({ id: `plugin-${index}`, body: "y".repeat(4096) }),
    );
    const clamped = clampPluginSkills(entries)!;
    const total = clamped.entries.reduce(
      (sum, entry) => sum + Buffer.byteLength(entry.body, "utf8"),
      0,
    );
    expect(total).toBeLessThanOrEqual(MAX_PLUGIN_SKILL_TOTAL_BYTES);
    expect(clamped.entries.length).toBeLessThan(entries.length);
  });

  it("cuts on a character boundary so multi-byte text stays valid", () => {
    const clamped = clampPluginSkills([skill({ body: "日本語テキスト" })], {
      maxSkillBytes: 7,
    })!;
    // Two characters fit in 7 bytes; the third would need a ninth byte.
    expect(clamped.entries[0].body).toBe("日本");
  });
});

describe("pluginSkillsDigest", () => {
  it("is empty for an absent or empty skill set", () => {
    expect(pluginSkillsDigest()).toBe("");
    expect(pluginSkillsDigest({ entries: [] })).toBe("");
  });

  it("changes when a body, id or ordering changes", () => {
    const base = pluginSkillsDigest({ entries: [skill()] });
    expect(pluginSkillsDigest({ entries: [skill()] })).toBe(base);
    expect(pluginSkillsDigest({ entries: [skill({ body: "Group by date." })] })).not.toBe(
      base,
    );
    expect(pluginSkillsDigest({ entries: [skill({ id: "other" })] })).not.toBe(base);
    expect(
      pluginSkillsDigest({ entries: [skill({ id: "a" }), skill({ id: "b" })] }),
    ).not.toBe(pluginSkillsDigest({ entries: [skill({ id: "b" }), skill({ id: "a" })] }));
  });

  it("ignores fields that do not reach the prompt body", () => {
    expect(pluginSkillsDigest({ entries: [skill({ pluginName: "Renamed" })] })).toBe(
      pluginSkillsDigest({ entries: [skill()] }),
    );
  });
});

describe("pluginSkillsPrompt", () => {
  it("returns undefined without skills", () => {
    expect(pluginSkillsPrompt()).toBeUndefined();
    expect(pluginSkillsPrompt({ entries: [] })).toBeUndefined();
  });

  it("renders a heading per skill and falls back to the id for a title", () => {
    const prompt = pluginSkillsPrompt({
      entries: [
        skill({ name: "Summarise notes", description: "a digest is requested" }),
        skill({ id: "demo.notes/tag", body: "Tag notes on save." }),
      ],
    })!;
    expect(prompt.startsWith("# Plugin skills")).toBe(true);
    expect(prompt).toContain("## Summarise notes (Notes)");
    expect(prompt).toContain("Use when: a digest is requested");
    expect(prompt).toContain("## demo.notes/tag (Notes)");
    expect(prompt).not.toContain("Use when: \n");
    expect(prompt.endsWith("Tag notes on save.")).toBe(true);
  });
});
