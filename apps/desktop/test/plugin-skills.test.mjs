import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const desktopRoot = join(here, "..");
const repoRoot = join(desktopRoot, "../..");

const runtimeSrc = readFileSync(join(desktopRoot, "electron/main/plugin-runtime.ts"), "utf8");
const mainSrc = readFileSync(join(desktopRoot, "electron/main/index.ts"), "utf8");
const agentRuntimeSrc = readFileSync(
  join(repoRoot, "packages/agent-runtime/src/runtime.ts"),
  "utf8",
);
const sidecarSrc = readFileSync(join(repoRoot, "packages/agent-runtime/src/sidecar.ts"), "utf8");

test("the plugin runtime indexes contributed skills under caps", () => {
  assert.match(runtimeSrc, /registerSkills/);
  assert.match(runtimeSrc, /getSkills\(\)/);
  assert.match(runtimeSrc, /MAX_SKILLS_PER_PLUGIN = 32/);
  assert.match(runtimeSrc, /MAX_SKILL_BYTES = 128 \* 1024/);
  assert.match(runtimeSrc, /MAX_SKILL_DESCRIPTION_CHARS/);
  // Contributed paths must stay inside the plugin directory.
  assert.match(runtimeSrc, /resolveInsidePlugin/);
});

test("skills only reach the agent with agent.prompt.inject", () => {
  const gate = /permissions\.has\("agent\.prompt\.inject"\)/;
  assert.match(runtimeSrc, gate);
  const registerSkills = runtimeSrc.slice(runtimeSrc.indexOf("private registerSkills"));
  assert.match(registerSkills, gate);
  assert.match(registerSkills, /plugin\.skills\.skipped/);
});

test("unloading a plugin withdraws its skills", () => {
  const clear = runtimeSrc.slice(
    runtimeSrc.indexOf("private clearContributions"),
    runtimeSrc.indexOf("private registerSkills"),
  );
  assert.match(clear, /this\.skills/);
});

test("loading a skill body strips front matter and re-checks the cap", () => {
  const load = runtimeSrc.slice(
    runtimeSrc.indexOf("loadSkillBody("),
    runtimeSrc.indexOf("registerSkills"),
  );
  assert.match(load, /parseSkillFrontmatter/);
  assert.match(load, /MAX_SKILL_BYTES/);
  assert.match(load, /NOT_FOUND/);
  assert.match(load, /plugin\.skill\.load/);
});

test("main forwards the skill catalog and serves the Skill tool locally", () => {
  assert.match(mainSrc, /pluginSkills: plugins\.getSkills\(\)/);
  assert.match(mainSrc, /setLocalTool\("Skill"/);
  assert.match(mainSrc, /loadSkillBody\(id\)/);
});

test("the agent runtime advertises skills and rebuilds when the catalog changes", () => {
  assert.match(agentRuntimeSrc, /pluginSkillsPrompt/);
  assert.match(agentRuntimeSrc, /SKILL_TOOL_NAME/);
  assert.match(agentRuntimeSrc, /pluginSkillIds/);
  assert.match(sidecarSrc, /pluginSkills/);
  assert.match(sidecarSrc, /pluginSkillIds/);
});
