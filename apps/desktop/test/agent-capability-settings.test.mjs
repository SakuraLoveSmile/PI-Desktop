import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { loadStyles } from "./helpers/styles.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const srcDir = join(here, "../src");
const settingsDir = join(srcDir, "components/settings");
const read = (path) => readFileSync(join(here, path), "utf8");
const settingsPage = read("../src/pages/SettingsPage.tsx");
const pluginsPage = read("../src/pages/PluginsPage.tsx");
const layout = read("../src/components/settings/AgentCapabilityLayout.tsx");
const skills = read("../src/components/settings/AgentSkillsPage.tsx");
const mcp = read("../src/components/settings/AgentMcpPage.tsx");
const subagents = read("../src/components/settings/AgentSubagentsPage.tsx");
const mcpEditor = read("../src/components/extensions/McpEditorSheet.tsx");
const electron = read("../electron/main/index.ts");
const skillImport = electron.slice(
  electron.indexOf("handle(IPC.invoke.skillImport"),
  electron.indexOf("handle(IPC.invoke.skillUpdate"),
);
const styles = await loadStyles();

// Keep this suite source-oriented like the neighboring desktop contracts: it
// catches IA regressions without requiring an Electron window or a native picker.
test("agent settings have three independent destinations and extensions have two tabs", () => {
  assert.match(settingsPage, /tab === "skills" && <AgentSkillsPage \/>/);
  assert.match(settingsPage, /tab === "mcp" && <AgentMcpPage \/>/);
  assert.match(settingsPage, /tab === "subagents" && <AgentSubagentsPage \/>/);
  assert.match(pluginsPage, /type TabId = "installed" \| "market"/);
  assert.doesNotMatch(pluginsPage, /plugins-(?:tab|panel)-(?:mcp|skills|subagents)/);
});

test("skills and MCP use global/project columns with a selectable project", () => {
  for (const source of [skills, mcp]) {
    assert.match(source, /useAgentProjects\(\)/);
    assert.match(source, /AgentProjectPicker/);
    assert.match(source, /level: "global"/);
    assert.match(source, /level: "project"/);
  }
  assert.match(layout, /AgentCapabilityColumn/);
  assert.match(layout, /agent-capability-list/);
  assert.match(layout, /agent-capability-column-dot/);
  assert.match(layout, /count !== undefined/);
  assert.doesNotMatch(subagents, /AgentProjectPicker|projectPath/);
  assert.match(subagents, /scope="global"/);
  assert.match(subagents, /count=\{subagents\.length\}/);
  assert.match(subagents, /t\("settings\.subagentsEmpty"\)/);
  assert.doesNotMatch(subagents, /settings\.subagents\.empty|t\("subagents\.empty"\)/);
});

test("capability lists keep a fixed height and render disabled rows", () => {
  assert.match(styles, /\.agent-capability-list\s*\{[\s\S]*?height:\s*360px/);
  assert.match(styles, /\.agent-capability-list\s*\{[\s\S]*?min-height:\s*360px/);
  assert.match(styles, /\.agent-capability-row\.is-off\s*\{[\s\S]*?opacity:/);
  assert.match(layout, /agent-capability-loading/);
  assert.match(styles, /\.agent-capability-loading\s*\{[\s\S]*?min-height:\s*100%/);
  assert.match(layout, /agent-capability-empty/);
});

test("capability surfaces use the compact studio hierarchy", () => {
  assert.match(styles, /\.agent-capability-intro\s*\{[\s\S]*?border-left:\s*3px solid var\(--ds-accent\)/);
  assert.match(styles, /\.agent-capability-column\s*\{[\s\S]*?border-radius:\s*var\(--radius-md-plus\)/);
  assert.match(styles, /\.agent-capability-column-title code\s*\{[\s\S]*?background:/);
  assert.match(styles, /\.agent-capability-empty\s*\{[\s\S]*?border:\s*1px dashed/);
});

test("capability scope labels stay intact when a column narrows", () => {
  assert.match(styles, /\.agent-capability-column\s*\{[\s\S]*?container-type:\s*inline-size/);
  assert.match(styles, /\.agent-capability-column-label\s*\{[\s\S]*?white-space:\s*nowrap/);
  assert.match(styles, /@container\s*\(max-width:\s*600px\)[\s\S]*?\.agent-capability-column-head[\s\S]*?flex-direction:\s*column/);
});

test("capability updates disable competing controls and expose state", () => {
  assert.match(layout, /settings\.capabilityCount/);
  assert.match(layout, /aria-busy=\{busy \|\| undefined\}/);
  assert.match(styles, /\.settings-toggle:focus-visible/);
  assert.match(skills, /busy=\{busyKey !== null\}/);
  assert.match(mcp, /disabled=\{loading \|\| busyKey !== null\}/);
});

test("skill import is one native file and is copied through the host", () => {
  assert.notEqual(skillImport, "", "skill import handler should be present");
  assert.match(skillImport, /properties:\s*\["openFile"\]/);
  assert.doesNotMatch(skillImport, /properties:\s*\[[^\]]*(?:multiSelections|openDirectory)/);
  assert.match(skillImport, /host\.call\("skills\.import"/);
  assert.match(read("../../../crates/host-core/src/user_skills.rs"), /fs::copy\(&source_path, &target\)/);
});

test("MCP management reuses the validated modal and blocks same-level duplicates", () => {
  assert.match(mcp, /<McpEditorSheet/);
  assert.match(mcp, /settings\.mcpDuplicate/);
  assert.match(mcpEditor, /role="dialog"/);
  assert.match(mcpEditor, /disabled=\{!!editing\}/);
  assert.match(mcpEditor, /\^\[a-zA-Z\]\[a-zA-Z0-9_-\]\{0,63\}\$/);
  assert.match(mcp, /api\.testMcpServer/);
});

test("capability state stays outside capability files and active merge shadows disabled project rows", () => {
  const capabilities = read("../../../crates/host-core/src/agent_capabilities.rs");
  const mcpRegistry = read("../../../crates/host-core/src/mcp_servers.rs");
  const skillRegistry = read("../../../crates/host-core/src/user_skills.rs");
  assert.match(capabilities, /agent-capabilities/);
  assert.match(mcpRegistry, /\.agents\/servers/);
  assert.match(skillRegistry, /\.agents\/skills/);
  assert.match(mcpRegistry, /existing\.id != record\.id/);
  assert.match(mcpRegistry, /if record\.enabled \{/);
  assert.match(skillRegistry, /existing\.id != record\.id/);
  assert.match(skillRegistry, /if record\.enabled \{/);
});

test("all capability paths are agents roots, not legacy capability directories", () => {
  for (const source of [layout, skills, mcp, subagents, mcpEditor, electron]) {
    assert.doesNotMatch(source, /\.pi\/(?:agents|skills|mcp)/);
  }
});
