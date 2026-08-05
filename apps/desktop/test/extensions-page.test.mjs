import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { loadStyles } from "./helpers/styles.mjs";
import { en } from "../../../packages/i18n/src/locales/en/index.ts";
import { zhCN } from "../../../packages/i18n/src/locales/zh-CN/index.ts";

const here = dirname(fileURLToPath(import.meta.url));
const extDir = join(here, "../src/components/extensions");
const componentFiles = readdirSync(extDir).filter((name) => name.endsWith(".tsx"));
const components = new Map(
  componentFiles.map((name) => [name, readFileSync(join(extDir, name), "utf8")]),
);
const pageSrc = readFileSync(join(here, "../src/pages/PluginsPage.tsx"), "utf8");
const styles = await loadStyles();

const allSources = [...components.values(), pageSrc].join("\n");

function lookup(catalog, key) {
  return key.split(".").reduce((node, part) => (node == null ? undefined : node[part]), catalog);
}

/**
 * Keys the extensions surfaces ask for. Both spellings are collected: `t("…")`
 * calls, and the bare key strings the draft validators return so the sheet can
 * name the first problem.
 */
function translationKeys(source) {
  const keys = new Set();
  for (const match of source.matchAll(/\bt\(\s*"((?:extensions|common)\.[^"]+)"/g)) {
    keys.add(match[1]);
  }
  for (const match of source.matchAll(/"((?:extensions|common)\.[A-Za-z0-9_.]+)"/g)) {
    keys.add(match[1]);
  }
  return keys;
}

test("every extensions key the UI asks for exists in both catalogs", () => {
  const keys = translationKeys(allSources);
  assert.ok(keys.size > 60, `expected the extensions surfaces to use many keys, saw ${keys.size}`);

  const missing = { en: [], "zh-CN": [] };
  for (const key of keys) {
    if (typeof lookup(en, key) !== "string") missing.en.push(key);
    if (typeof lookup(zhCN, key) !== "string") missing["zh-CN"].push(key);
  }
  assert.deepEqual(missing, { en: [], "zh-CN": [] });
});

// i18next resolves a `count` interpolation through the suffixed keys, so a flat
// key renders "1 tools" — or nothing at all.
test("count interpolations carry plural forms in both catalogs", () => {
  const counted = new Set();
  for (const match of allSources.matchAll(
    /\bt\(\s*"((?:extensions|common)\.[^"]+)",\s*\{[^)]*?\bcount\b/gs,
  )) {
    counted.add(match[1]);
  }
  assert.ok(counted.size >= 6, `expected several counted keys, saw ${counted.size}`);

  for (const key of counted) {
    for (const [name, catalog] of [
      ["en", en],
      ["zh-CN", zhCN],
    ]) {
      assert.equal(typeof lookup(catalog, `${key}_one`), "string", `${name} ${key}_one`);
      assert.equal(typeof lookup(catalog, `${key}_other`), "string", `${name} ${key}_other`);
    }
  }
});

test("the extensions page separates the four things a user installs or writes", () => {
  assert.match(pageSrc, /type TabId = "installed" \| "mcp" \| "skills" \| "market"/);
  for (const id of ["plugins-tab-mcp", "plugins-tab-skills"]) {
    assert.ok(pageSrc.includes(id), `missing segment ${id}`);
  }
  for (const id of ["plugins-panel-mcp", "plugins-panel-skills"]) {
    assert.ok(pageSrc.includes(id), `missing panel ${id}`);
  }
  // Each panel is a real tabpanel, not a bare div, so the segments are navigable.
  assert.match(pageSrc, /id="plugins-panel-mcp"[\s\S]{0,120}aria-labelledby="plugins-tab-mcp"/);
  assert.match(
    pageSrc,
    /id="plugins-panel-skills"[\s\S]{0,120}aria-labelledby="plugins-tab-skills"/,
  );
});

test("the extensions page uses tabs instead of a four-number overview band", () => {
  assert.doesNotMatch(pageSrc, /plugins-hero|plugins-stat|const summary\s*=/);
  assert.doesNotMatch(styles, /\.plugins-hero|\.plugins-stat/);
  assert.match(pageSrc, /className="plugins-segment"/);
});

// Scoping something to "this project" only means anything relative to the folder
// the window has open, and the picker cannot offer folders it was never given.
test("both new sections receive the project list and the open project", () => {
  for (const tag of ["<McpSection", "<SkillsSection"]) {
    const start = pageSrc.indexOf(tag);
    assert.ok(start > 0, `${tag} is not rendered`);
    const element = pageSrc.slice(start, pageSrc.indexOf("/>", start));
    assert.match(element, /projects=\{projects\}/);
    assert.match(element, /currentProjectPath=\{currentProjectPath\}/);
  }
  assert.match(pageSrc, /useAppStore\(\(s\) => s\.workspace\?\.path \?\? null\)/);
  assert.match(pageSrc, /api\s*\.\s*listProjects\(\)/);
});

test("plugins, MCP servers and skills all use the one scope control", () => {
  const users = ["PluginsPage.tsx", "McpSection.tsx", "SkillsSection.tsx"];
  for (const name of users) {
    const source = name === "PluginsPage.tsx" ? pageSrc : components.get(name);
    assert.match(source, /<ScopeControl/, `${name} does not render ScopeControl`);
  }
  // The plugin row's old boolean switch is gone: on/off is one end of the scope
  // track now, and two competing affordances would teach two different models.
  const row = pageSrc.slice(pageSrc.indexOf("<ScopeControl") - 4000, pageSrc.indexOf("<ScopeControl"));
  assert.doesNotMatch(row, /settings-toggle/);
  assert.match(pageSrc, /api\.setPluginScope\(/);
});

test("the scope track runs from least to most reach", () => {
  const control = components.get("ScopeControl.tsx");
  assert.match(control, /STATE_ORDER[^=]*=\s*\[\s*"off",\s*"projects",\s*"global"\s*\]/);
  // Choosing "this project" with nothing picked yet seeds the open folder, so the
  // common case is one gesture.
  assert.match(control, /scope\.projects\.length === 0 && currentProjectPath/);
  assert.match(control, /withProject\(scope, currentProjectPath\)/);
  // Widening to global keeps the project list, so narrowing again restores it.
  assert.match(control, /mode: "global", projects: scope\.projects/);
});

test("the skill editor treats the description as the part the model reads", () => {
  const sheet = components.get("SkillEditorSheet.tsx");
  const descriptionAt = sheet.indexOf("extensions.skills.description");
  const bodyAt = sheet.indexOf("extensions.skills.bodyHint");
  assert.ok(descriptionAt > 0 && bodyAt > 0);
  assert.ok(descriptionAt < bodyAt, "the body field precedes the description");
  assert.match(sheet, /errorDescription/);
  assert.match(sheet, /MAX_SKILL_BYTES = 128 \* 1024/);
});

test("a skill body is read only when it is opened for editing", () => {
  const section = components.get("SkillsSection.tsx");
  assert.match(section, /api\.readUserSkill\(/);
  const list = section.slice(section.indexOf("api.listUserSkills"), section.indexOf("openEdit"));
  assert.doesNotMatch(list, /readUserSkill/);
});

test("both new sections follow the plugin change event", () => {
  for (const name of ["McpSection.tsx", "SkillsSection.tsx"]) {
    assert.match(components.get(name), /api\.onPluginChanged\(/, name);
  }
});

/** Static class names the extensions components put in the DOM. */
function usedClasses() {
  const classes = new Set();
  for (const source of components.values()) {
    for (const match of source.matchAll(/className=(?:"([^"]*)"|\{cx\(([^)]*)\))/g)) {
      const literal = match[1] ?? "";
      const args = match[2] ?? "";
      const words = `${literal} ${[...args.matchAll(/"([^"$]*)"/g)].map((m) => m[1]).join(" ")}`;
      for (const word of words.split(/\s+/)) {
        if (/^(ext|scope|kv)-/.test(word)) classes.add(word);
      }
    }
  }
  return classes;
}

// The tabs compiled and typechecked long before they were styled; nothing but a
// test notices a class that renders as an unstyled div.
test("every extensions class the components use is styled", () => {
  const classes = usedClasses();
  assert.ok(classes.size > 60, `expected many extensions classes, saw ${classes.size}`);

  const unstyled = [...classes].filter(
    (name) => !new RegExp(`\\.${name}(?![\\w-])`).test(styles),
  );
  assert.deepEqual(unstyled, []);
});

test("the extensions stylesheet is part of the cascade", () => {
  const globals = readFileSync(join(here, "../src/styles/globals.css"), "utf8");
  const order = ["./plugins.css", "./extensions.css", "./responsive.css"];
  const positions = order.map((name) => globals.indexOf(`@import "${name}"`));
  assert.ok(positions.every((at) => at > 0), "extensions.css is not imported");
  assert.deepEqual(positions, [...positions].sort((a, b) => a - b));
});

// .settings-panel clips overflow for its rounded corners; the scope popover has
// to escape it, and inside a scrolling sheet it must not float at all.
test("the scope popover is not clipped by the surface it opens on", () => {
  assert.match(styles, /\.ext-list\s*\{[\s\S]*?overflow:\s*visible/);
  assert.match(styles, /\.ext-row:first-child\s*\{[\s\S]*?border-top-left-radius/);
  assert.match(styles, /\.ext-row:last-child\s*\{[\s\S]*?border-bottom-left-radius/);
  assert.match(styles, /\.scope-popover\.is-up\s*\{[\s\S]*?bottom:\s*calc\(100% \+ 6px\)/);
  assert.match(
    styles,
    /\.ext-field-group > \.scope-control \.scope-popover\s*\{[\s\S]*?position:\s*static/,
  );
  assert.match(components.get("ScopeControl.tsx"), /useLayoutEffect/);
});

// All three caught by looking at the rendered page rather than the stylesheet.
test("a validation message sits above the buttons it blocks, once there is one", () => {
  for (const name of ["McpEditorSheet.tsx", "SkillEditorSheet.tsx"]) {
    const sheet = components.get(name);
    const errorAt = sheet.indexOf('className="ext-sheet-error"');
    const actionsAt = sheet.indexOf('className="ext-sheet-actions"');
    assert.ok(errorAt > 0 && actionsAt > 0, name);
    assert.ok(errorAt < actionsAt, `${name} renders the error below the action row`);
    // A form nobody has typed into yet has nothing to complain about.
    assert.match(sheet, /errorKey && !pristine/, name);
    assert.match(sheet, /const pristine =\s*\n?\s*!editing/, name);
  }
  // Two adjacent top borders would read as a stray rule between them.
  assert.match(styles, /\.ext-sheet-error \+ \.ext-sheet-actions\s*\{/);
});

// `flex-basis: 100%` resolves against a max-content container, so the warning
// shared the chip's line and folded into a ragged block.
test("the empty-scope warning gets a line of its own", () => {
  const projects = styles.slice(styles.indexOf(".scope-projects {"));
  assert.match(projects.slice(0, 220), /flex-direction:\s*column/);
  assert.doesNotMatch(styles, /\.scope-warn\s*\{[^}]*flex:\s*0 0 100%/);
});

test("an extension that is off reads as off", () => {
  assert.match(styles, /\.ext-row\.is-off \.ext-row-copy\s*\{[\s\S]*?opacity/);
});

test("extensions styles use design tokens and respect reduced motion", () => {
  const start = styles.indexOf("/*\n * Extensions: MCP servers");
  assert.ok(start > 0, "extensions.css section missing from the cascade");
  const section = styles.slice(start);

  for (const bad of ["var(--accent", "var(--text-primary", "var(--border-subtle", "#fff;"]) {
    assert.equal(section.includes(bad), false, `leftover ${bad}`);
  }
  assert.match(section, /\.ext-row-glyph\.is-ready\s*\{[\s\S]*?--ds-success/);
  assert.match(section, /\.ext-row-glyph\.is-failed\s*\{[\s\S]*?--ds-error/);
  assert.match(section, /\.scope-seg\.is-active\s*\{[\s\S]*?--ds-text-primary/);
  assert.match(section, /\.scope-chip\.is-empty\s*\{[\s\S]*?--ds-warning/);
  assert.match(section, /\.ext-row\.is-off/);
  assert.match(section, /\.ext-row\.menu-open/);
  assert.match(section, /@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.scope-popover/);
});
