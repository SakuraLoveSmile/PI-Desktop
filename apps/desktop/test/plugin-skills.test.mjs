import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const desktopRoot = join(here, "..");
const repoRoot = join(desktopRoot, "../..");

const runtimeSrc = readFileSync(join(desktopRoot, "electron/main/plugin-runtime.ts"), "utf8");
const builtinSrc = readFileSync(join(desktopRoot, "electron/main/builtin-skills.ts"), "utf8");
const devToolsSrc = readFileSync(join(desktopRoot, "electron/main/plugin-dev-tools.ts"), "utf8");
const mainSrc = readFileSync(join(desktopRoot, "electron/main/index.ts"), "utf8");
const packageJson = JSON.parse(readFileSync(join(desktopRoot, "package.json"), "utf8"));
const skillDoc = readFileSync(
  join(desktopRoot, "resources/skills/plugin-development.md"),
  "utf8",
);
const agentRuntimeSrc = readFileSync(
  join(repoRoot, "packages/agent-runtime/src/runtime.ts"),
  "utf8",
);

test("contributed skills require agent.prompt.inject and stay inside the plugin", () => {
  const getSkills = runtimeSrc.slice(runtimeSrc.indexOf("getSkills()"));
  assert.match(getSkills, /permissions\.has\("agent\.prompt\.inject"\)/);
  // Same containment guard the gated fs APIs use.
  assert.match(getSkills, /ensureWithinRoot\(loaded\.path, relative\)/);
  // Denials and unreadable files are audited, never thrown at the caller.
  assert.match(getSkills, /plugin\.skills\.denied/);
  assert.match(getSkills, /plugin\.skills\.error/);
});

test("skill documents are read per prompt so an edit needs no reload", () => {
  // A cached copy would defeat hot reload: getSkills must hit the disk itself.
  assert.match(runtimeSrc, /getSkills\(\): PluginSkillDoc\[\]/);
  assert.match(runtimeSrc.slice(runtimeSrc.indexOf("getSkills()")), /readFileSync\(full/);
  assert.doesNotMatch(runtimeSrc, /this\.skills\s*=/);
});

test("the built-in plugin skill only activates for plugin workspaces", () => {
  assert.match(builtinSrc, /isPluginWorkspace/);
  assert.match(builtinSrc, /schemaVersion.*number/s);
  assert.match(builtinSrc, /pluginPaths\.some/);
  assert.match(builtinSrc, /if \(!isPluginWorkspace\(input\.workspacePath, input\.pluginPaths\)\) return \[\]/);
});

test("the built-in skill ships as a packaged resource with a dev fallback", () => {
  const resources = packageJson.build.extraResources.map((entry) => entry.to);
  assert.ok(resources.includes("skills"), "resources/skills must be packaged");
  assert.match(builtinSrc, /process\.resourcesPath/);
  assert.match(builtinSrc, /resources\/skills/);
});

test("the built-in skill documents the constraints a plugin author will hit", () => {
  assert.match(skillDoc, /^---\n/);
  assert.match(skillDoc, /description: /);
  for (const token of [
    "PluginScaffold",
    "PluginCheck",
    "PluginPack",
    "agent.prompt.inject",
    "store-only",
    "schemaVersion",
  ]) {
    assert.ok(skillDoc.includes(token), `built-in skill must mention ${token}`);
  }
});

test("plugin skills reach the sidecar clamped and behind the built-in gate", () => {
  assert.match(mainSrc, /clampPluginSkills\(\[/);
  assert.match(mainSrc, /builtinSkills\(\{/);
  assert.match(mainSrc, /plugins\.getSkills\(\)/);
  assert.match(mainSrc, /\n\s+pluginSkills,\n/);
});

test("plugin dev tools resolve paths inside the workspace and report failures", () => {
  assert.match(devToolsSrc, /resolveWithinRoot\(root, value\)/);
  assert.match(devToolsSrc, /no workspace is open/);
  assert.match(devToolsSrc, /isError: true/);
  // Scaffolding loads the plugin so the first edit is already a hot reload.
  assert.match(devToolsSrc, /registerDevPlugin\(target\.path\)/);
  assert.match(devToolsSrc, /loadPlugin\(target\.path, permissions\)/);
});

test("only PluginCheck is available outside agent mode", () => {
  const builder = agentRuntimeSrc.slice(agentRuntimeSrc.indexOf("const tools = ["));
  const baseline = builder.slice(0, builder.indexOf("\n    if (this.mode"));
  assert.match(baseline, /"PluginCheck"/);
  assert.doesNotMatch(baseline, /PluginScaffold|PluginPack/);
  const agentOnly = builder.slice(builder.indexOf("if (this.mode"));
  assert.match(agentOnly, /"PluginScaffold", "PluginPack"/);
});

test("main registers the three plugin dev tools as local tools", () => {
  assert.match(mainSrc, /registerPluginDevTools\(s, \{/);
  for (const name of ["PluginScaffold", "PluginCheck", "PluginPack"]) {
    assert.ok(
      devToolsSrc.includes(`setLocalTool("${name}"`),
      `${name} must be served by main, not host-core`,
    );
  }
});
