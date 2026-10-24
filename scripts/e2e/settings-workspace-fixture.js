import { IPC } from "@pi-desktop/shared";

const STAMP = "2026-10-23T00:00:00.000Z";
const clone = value => structuredClone(value);
const makeGroup = (id, name, paths, legacy = false) => ({
  id, name, primaryPath: paths[0],
  roots: paths.map((path, position) => ({ path, name: path.split("/").at(-1), position })),
  legacy, createdAt: 1, updatedAt: 1, lastOpenedAt: 1, pinned: false,
});

/** Shared preview boundary. All records and mutations remain in memory. */
export function createWorkspaceFixture(parameters) {
  const chinese = parameters.get("locale")?.startsWith("zh");
  const empty = parameters.get("workspace") === "empty";
  const groups = empty ? [] : [
    makeGroup("desktop-demo", chinese ? "桌面应用" : "Desktop demo", ["/fixture/projects/desktop-demo", "/fixture/projects/desktop-assets"]),
    makeGroup("documentation", chinese ? "产品文档" : "Documentation", [`/fixture/projects/${"long-documentation-project-path-".repeat(8)}`]),
    makeGroup("legacy", chinese ? "旧项目文件夹" : "Legacy folder", ["/fixture/projects/legacy"], true),
  ];
  const sessions = empty ? [] : [{
    id: "workspace-fixture-session", title: chinese ? "检查设置界面" : "Review the Settings UI",
    projectPath: groups[0].primaryPath, projectName: groups[0].name,
    projectGroupId: groups[0].id, createdAt: STAMP, updatedAt: STAMP,
    mode: "agent", status: "idle", messageCount: 2,
  }];
  const memories = new Map();
  const instructions = new Map();
  const calls = [];
  let listingFails = parameters.get("workspace") === "error";
  let savingFails = parameters.get("memory") === "error";
  let revision = 1;
  let activePath = groups[0]?.primaryPath ?? null;
  const importedSkills = new Set();
  const importedMcp = new Set();
  const findGroup = input => {
    const group = groups.find(candidate => candidate.id === input?.groupId ||
      candidate.primaryPath === input?.projectPath || candidate.primaryPath === input?.path ||
      candidate.roots.some(root => root.path === input?.projectPath));
    if (!group) throw new Error("Unknown fixture project");
    return group;
  };
  const editorFor = input => {
    const group = findGroup(input);
    if (!memories.has(group.id)) memories.set(group.id, {
      owner: group.legacy ? `path:${group.primaryPath}` : `group:${group.id}`,
      autoRecordEnabled: false,
      memory: { updatedAt: 1, content: chinese ? "保留项目约定并检查窄窗口布局。" : "Keep project conventions and check the narrow layout.",
        entries: [{ id: `note-${group.id}`, title: chinese ? "项目约定" : "Project conventions", content: chinese ? "保留项目约定并检查窄窗口布局。" : "Keep project conventions and check the narrow layout." }] },
    });
    return memories.get(group.id);
  };
  const importEmpty = () => parameters.get("import") === "empty";
  const sessionCandidates = [{ source: "codex", externalId: "fixture-conversation", title: chinese ? "本机对话记录" : "Local conversation",
    projectPath: "/fixture/projects/desktop-demo", model: "fixture-model", createdAt: STAMP, updatedAt: STAMP, messageCount: 12 }];
  const providerCandidates = [{ source: "codex", externalId: "fixture-provider", name: chinese ? "本机服务配置" : "Local service configuration",
    baseUrl: "https://api.example.invalid/v1", apiStyle: "chat_completions", modelIds: ["fixture-model"], hasSecret: false }];
  const skillCandidates = [{ source: "claude-user", sourcePath: "/fixture/import/skills/review/SKILL.md", rootDir: "/fixture/import/skills/review", shape: "dir",
    id: "review", name: chinese ? "审查清单" : "Review checklist", description: chinese ? "导入本机的审查步骤。" : "Import local review steps.", bytes: 256, warnings: [] }];
  const mcpCandidates = [{ source: "codex", sourcePath: "/fixture/import/codex/config.toml", id: "docs", rawKey: "docs",
    label: chinese ? "文档服务" : "Documentation service", description: chinese ? "本机文档索引服务。" : "Local documentation index service.", transport: "stdio", command: "fixture-docs", args: [], env: {}, disabled: false, warnings: [] }];
  const known = new Set([
    IPC.invoke.projectList, IPC.invoke.projectGroupList, IPC.invoke.projectGroupCreate, IPC.invoke.projectGroupUpdate,
    IPC.invoke.projectGroupRename, IPC.invoke.projectPickFolders, IPC.invoke.projectGroupInstructionsGet,
    IPC.invoke.projectGroupInstructionsSave, IPC.invoke.projectMemoryEditorGet, IPC.invoke.projectMemoryEditorSave,
    IPC.invoke.projectAutoMemorySetEnabled, IPC.invoke.projectRemove, IPC.invoke.projectGet, IPC.invoke.projectSet,
    IPC.invoke.projectClear, IPC.invoke.sessionList, IPC.invoke.sessionImportScan, IPC.invoke.sessionImportRun,
    IPC.invoke.modelConfigImportScan, IPC.invoke.modelConfigImportRun, IPC.invoke.skillImportScan,
    IPC.invoke.skillImportRun, IPC.invoke.mcpImportScan, IPC.invoke.mcpImportRun,
  ]);
  function invoke(channel, input) {
    const projectInstruction = (channel === IPC.invoke.agentInstructionsGet || channel === IPC.invoke.agentInstructionsSave) && input?.projectPath;
    if (!known.has(channel) && !projectInstruction) return { handled: false };
    calls.push({ channel, input: clone(input) });
    const reply = data => ({ handled: true, data: clone(data) });
    if (channel === IPC.invoke.projectGroupList) {
      if (listingFails) throw new Error("Fixture project listing unavailable");
      return reply({ groups });
    }
    if (channel === IPC.invoke.projectList) return reply({ projects: groups.map(group => ({ id: group.id, name: group.name, path: group.primaryPath, pinned: group.pinned, createdAt: 1, lastOpenedAt: 1 })) });
    if (channel === IPC.invoke.sessionList) return reply({ sessions });
    if (channel === IPC.invoke.projectPickFolders) return reply({ folders: ["/fixture/projects/additional-folder"], canceled: false });
    if (channel === IPC.invoke.projectGroupCreate) {
      if (!input.name?.trim() || !input.folders?.length) throw new Error("Fixture project requires a name and folders");
      const group = makeGroup(`created-${++revision}`, input.name.trim(), input.folders);
      groups.push(group); return reply({ group });
    }
    if (channel === IPC.invoke.projectGroupUpdate || channel === IPC.invoke.projectGroupRename) {
      const group = findGroup(input);
      if (!input.name?.trim()) throw new Error("Fixture project name is required");
      group.name = input.name.trim();
      if (channel === IPC.invoke.projectGroupUpdate) {
        if (input.folders[0] !== group.primaryPath) throw new Error("Fixture primary root cannot change");
        group.roots = input.folders.map((path, position) => ({ path, position, name: path.split("/").at(-1) }));
      }
      return reply({ group });
    }
    if (channel === IPC.invoke.projectRemove) {
      const group = findGroup(input);
      groups.splice(groups.indexOf(group), 1);
      const previous = sessions.length;
      for (let index = sessions.length - 1; index >= 0; index--) if (sessions[index].projectPath === group.primaryPath) sessions.splice(index, 1);
      return reply({ removed: true, sessionsRemoved: previous - sessions.length });
    }
    if (channel === IPC.invoke.projectSet) activePath = input;
    if (channel === IPC.invoke.projectClear) { activePath = null; return reply({}); }
    if (channel === IPC.invoke.projectGet || channel === IPC.invoke.projectSet) {
      const group = activePath ? findGroup({ path: activePath }) : null;
      return reply({ workspace: group ? { name: group.name, path: group.primaryPath, groupId: group.id } : null });
    }
    if (channel === IPC.invoke.projectGroupInstructionsGet || channel === IPC.invoke.projectGroupInstructionsSave || projectInstruction) {
      const group = findGroup(input);
      if (channel === IPC.invoke.projectGroupInstructionsSave || channel === IPC.invoke.agentInstructionsSave) instructions.set(group.id, input.content);
      const content = instructions.get(group.id) ?? (chinese ? "遵循项目现有模式，验证受影响页面。" : "Follow existing project patterns and verify affected screens.");
      const file = { scope: "project", path: `${group.primaryPath}/AGENTS.md`, content, exists: true };
      return reply(channel === IPC.invoke.agentInstructionsGet ? { global: { scope: "global", path: "/fixture/AGENTS.md", content: "", exists: true }, project: file } : channel === IPC.invoke.agentInstructionsSave ? { file } : { content });
    }
    if ([IPC.invoke.projectMemoryEditorGet, IPC.invoke.projectMemoryEditorSave, IPC.invoke.projectAutoMemorySetEnabled].includes(channel)) {
      const editor = editorFor(input);
      if (channel !== IPC.invoke.projectMemoryEditorGet && input.expectedOwner !== editor.owner) throw new Error("Fixture memory owner changed");
      if (channel === IPC.invoke.projectAutoMemorySetEnabled) { editor.autoRecordEnabled = input.enabled; return reply({ autoRecordEnabled: editor.autoRecordEnabled }); }
      if (channel === IPC.invoke.projectMemoryEditorSave) {
        if (savingFails) throw new Error("Fixture memory save unavailable");
        if (JSON.stringify(input.expectedMemory) !== JSON.stringify(editor.memory)) throw new Error("Fixture memory conflict");
        editor.memory = { entries: clone(input.entries), content: input.entries.map(entry => entry.content).join("\n\n"), updatedAt: ++revision };
      }
      return reply({ editor });
    }
    if ([IPC.invoke.sessionImportScan, IPC.invoke.modelConfigImportScan, IPC.invoke.skillImportScan, IPC.invoke.mcpImportScan].includes(channel) && parameters.get("import") === "error") throw new Error("Fixture local scan unavailable");
    if (channel === IPC.invoke.sessionImportScan) return reply({ sessions: importEmpty() ? [] : sessionCandidates });
    if (channel === IPC.invoke.modelConfigImportScan) return reply({ providers: importEmpty() ? [] : providerCandidates });
    if (channel === IPC.invoke.skillImportScan) return reply({ candidates: importEmpty() ? [] : skillCandidates.filter(candidate => !importedSkills.has(candidate.id)), sources: [] });
    if (channel === IPC.invoke.mcpImportScan) return reply({ candidates: importEmpty() ? [] : mcpCandidates.filter(candidate => !importedMcp.has(candidate.id)), sources: [] });
    if (channel === IPC.invoke.sessionImportRun) {
      for (const item of input) sessions.push({ ...item, id: `imported-${++revision}`, mode: "agent", status: "idle" });
      return reply({ imported: input.length, skipped: 0, failed: 0 });
    }
    if (channel === IPC.invoke.modelConfigImportRun) return reply({ imported: input.length, skipped: 0, failed: 0 });
    if (channel === IPC.invoke.skillImportRun) {
      input.items.forEach(item => importedSkills.add(item.id));
      return reply({ imported: input.items.map(item => ({ item, skill: { id: item.id, name: item.name, enabled: true, level: input.level } })), skipped: [], failed: [] });
    }
    if (channel === IPC.invoke.mcpImportRun) {
      input.items.forEach(item => importedMcp.add(item.id));
      return reply({ imported: input.items.map(item => ({ item, server: { id: item.id, label: item.label, enabled: !item.disabled } })), skipped: [], failed: [] });
    }
    throw new Error(`Missing workspace fixture branch: ${channel}`);
  }
  return { invoke, groups, sessions, calls,
    get projects() { return groups.map(group => ({ id: group.id, name: group.name, path: group.primaryPath, pinned: group.pinned, createdAt: 1, lastOpenedAt: 1 })); },
    failList(value) { listingFails = value; }, failSave(value) { savingFails = value; } };
}
