import { describe, expect, it } from "vitest";
import { deEntries } from "./changelog-de.js";
import { enEntries } from "./changelog-en.js";
import { esEntries } from "./changelog-es.js";
import { frEntries } from "./changelog-fr.js";
import { koEntries } from "./changelog-ko.js";
import { loadChangelogCatalog } from "./changelog-loader.js";
import { ptBREntries } from "./changelog-pt-BR.js";
import { trEntries } from "./changelog-tr.js";
import { zhCNEntries } from "./changelog-zh-CN.js";
import { zhTWEntries } from "./changelog-zh-TW.js";
import { CHANGELOG, type ChangelogEntry, type ChangelogLocale } from "./changelog.js";
import { PLUS_UPSTREAM_CUTOFF, withPlusEntries } from "./plus-changelog.js";

const upstreamCatalogs: Record<ChangelogLocale, readonly ChangelogEntry[]> = {
  en: enEntries,
  "zh-CN": zhCNEntries,
  "zh-TW": zhTWEntries,
  tr: trEntries,
  de: deEntries,
  es: esEntries,
  fr: frEntries,
  ko: koEntries,
  "pt-BR": ptBREntries,
};
const locales = Object.keys(upstreamCatalogs) as ChangelogLocale[];

describe("Plus changelog overlay", () => {
  it.each(locales)("preserves the cutoff history after Plus entries for %s", (locale) => {
    const upstream = upstreamCatalogs[locale];
    const cutoffIndex = upstream.findIndex((entry) => entry.version === PLUS_UPSTREAM_CUTOFF);

    // A sync that removes the cutoff must fail here rather than silently
    // accepting the runtime's Plus-only fallback as a complete catalog.
    expect(cutoffIndex).toBeGreaterThanOrEqual(0);
    const catalog = withPlusEntries(locale, upstream);
    expect(catalog[0]?.version).toBe("0.15.7");
    expect(catalog[0]?.date).toBe("2026-10-02");
    expect(catalog[1]).toBe(upstream[cutoffIndex]);
    expect(catalog.slice(1)).toEqual(upstream.slice(cutoffIndex));
    const visibleVersions = catalog.map((entry) => entry.version);
    for (const entry of upstream.slice(0, cutoffIndex)) {
      expect(visibleVersions).not.toContain(entry.version);
    }
  });

  it("keeps locale version lists and highlight counts aligned", () => {
    const en = CHANGELOG.en;
    for (const locale of locales) {
      const catalog = CHANGELOG[locale];
      expect(catalog.map((entry) => entry.version)).toEqual(en.map((entry) => entry.version));
      expect(catalog.map((entry) => entry.highlights.length)).toEqual(
        en.map((entry) => entry.highlights.length),
      );
    }
  });

  it.each(locales)("shares the lazy and synchronous catalog object for %s", async (locale) => {
    const catalog = await loadChangelogCatalog(locale);
    expect(catalog).toBe(CHANGELOG[locale]);
    expect(await loadChangelogCatalog(locale)).toBe(catalog);
    expect(withPlusEntries(locale, upstreamCatalogs[locale])).toBe(catalog);
  });

  it("cuts by position and leaves the upstream array unchanged", () => {
    const upstream: ChangelogEntry[] = [
      { version: "0.1.0", highlights: ["Before cutoff"] },
      { version: PLUS_UPSTREAM_CUTOFF, highlights: ["Cutoff"] },
      { version: "9.0.0", highlights: ["After cutoff"] },
    ];
    const before = structuredClone(upstream);
    expect(withPlusEntries("en", upstream).map((entry) => entry.version)).toEqual([
      "0.15.7", PLUS_UPSTREAM_CUTOFF, "9.0.0",
    ]);
    expect(upstream).toEqual(before);
  });

  it("retains the cutoff when it is the first upstream entry", () => {
    const upstream: ChangelogEntry[] = [
      { version: PLUS_UPSTREAM_CUTOFF, highlights: ["Cutoff"] },
      { version: "0.15.5", highlights: ["Older release"] },
    ];
    const catalog = withPlusEntries("en", upstream);
    expect(catalog.map((entry) => entry.version)).toEqual([
      "0.15.7", PLUS_UPSTREAM_CUTOFF, "0.15.5",
    ]);
    expect(catalog[1]).toBe(upstream[0]);
  });

  it("isolates cached results by upstream array and locale", () => {
    const upstream: ChangelogEntry[] = [{ version: PLUS_UPSTREAM_CUTOFF, highlights: ["Cutoff"] }];
    const en = withPlusEntries("en", upstream);
    const zh = withPlusEntries("zh-CN", upstream);
    expect(withPlusEntries("en", upstream)).toBe(en);
    expect(withPlusEntries("zh-CN", upstream)).toBe(zh);
    expect(zh).not.toBe(en);
    expect(zh[0]?.highlights).toEqual(CHANGELOG["zh-CN"][0]?.highlights);
    expect(zh[0]?.highlights).not.toEqual(en[0]?.highlights);
    expect(withPlusEntries("en", [...upstream])).not.toBe(en);
  });

  it("shows only Plus entries when the upstream cutoff is missing", () => {
    const upstream: ChangelogEntry[] = [{ version: "0.16.1", highlights: ["New upstream release"] }];
    const catalog = withPlusEntries("en", upstream);
    expect(catalog.map((entry) => entry.version)).toEqual(["0.15.7"]);
    expect(withPlusEntries("en", upstream)).toBe(catalog);
    expect(withPlusEntries("en", []).map((entry) => entry.version)).toEqual(["0.15.7"]);
  });
});
