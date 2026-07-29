import { describe, expect, it } from "vitest";
import {
  CHANGELOG,
  formatChangelogNotes,
  getChangelogEntry,
  normalizeChangelogVersion,
  resolveChangelogLocale,
} from "./changelog.js";

describe("changelog catalog", () => {
  it("keeps English and zh-CN version sets and highlight counts aligned", () => {
    const en = CHANGELOG.en;
    const zh = CHANGELOG["zh-CN"];
    expect(zh.map((e) => e.version)).toEqual(en.map((e) => e.version));
    for (let i = 0; i < en.length; i += 1) {
      expect(zh[i]?.highlights.length).toBe(en[i]?.highlights.length);
      expect(en[i]?.highlights.length).toBeGreaterThan(0);
    }
  });

  it("normalizes versions and resolves locales", () => {
    expect(normalizeChangelogVersion(" v0.2.7 ")).toBe("0.2.7");
    expect(resolveChangelogLocale("zh-CN")).toBe("zh-CN");
    expect(resolveChangelogLocale("zh-TW")).toBe("zh-CN");
    expect(resolveChangelogLocale("en-US")).toBe("en");
    expect(resolveChangelogLocale()).toBe("en");
  });

  it("looks up and formats notes with English fallback", () => {
    const entry = getChangelogEntry("v0.2.7", "en");
    expect(entry?.version).toBe("0.2.7");
    const notes = formatChangelogNotes("0.2.7", "en");
    expect(notes).toMatch(/^• /);
    expect(notes?.split("\n").length).toBe(entry?.highlights.length);
    expect(formatChangelogNotes("9.9.9", "en")).toBeUndefined();
  });
});
