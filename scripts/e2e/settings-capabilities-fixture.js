import { IPC, fallbackBuiltinDefinitions } from "@pi-desktop/shared";

const STAMP = "2026-10-23T00:00:00.000Z";
const PROJECT_PATH = "/fixture/projects/desktop-demo";
const GLOBAL = { mode: "global", projects: [] };
const clone = (value) => structuredClone(value);

/** Strict, in-memory preload boundary for the capability Settings previews. */
export function createCapabilitiesFixture(parameters = new URLSearchParams()) {
  const populated = parameters.get("capabilities") !== "empty";
  const projects = populated ? [
    { id: 1, path: PROJECT_PATH, name: "Desktop demo", pinned: false, createdAt: 1, lastOpenedAt: 1 },
    { id: 2, path: "/fixture/projects/utility-demo", name: "Utility demo", pinned: false, createdAt: 1, lastOpenedAt: 1 },
  ] : [];
  let instructions = { scope: "global", exists: true, path: "/fixture/home/.agents/AGENTS.md", content: "# Global instructions\n\nKeep changes focused and verify the result." };
  const servers = populated ? [{ id: "fixture-docs", label: "Documentation", description: "Search the project documentation.", transport: "stdio", command: "npx", args: ["-y", "fixture-docs"], enabled: true, level: "global", scope: GLOBAL, path: "/fixture/home/.agents/servers/fixture-docs.json", createdAt: STAMP, updatedAt: STAMP }] : [];
  const subagents = populated ? [{ id: "fixture-reviewer", name: "fixture-reviewer", description: "Review focused changes and report concrete findings.", tools: ["Read", "Glob", "Grep"], enabled: true, level: "global", scope: GLOBAL, path: "/fixture/home/.agents/subagents/fixture-reviewer.md", sizeBytes: 100, createdAt: STAMP, updatedAt: STAMP }] : [];
  const bodies = new Map(subagents.map((row) => [row.id, "Review the change, its boundaries and its tests."]));
  const builtins = fallbackBuiltinDefinitions().map((definition) => ({ ...definition, enabled: true }));
  let control = { enabled: false, running: false, source: "preference", connectionFile: "/fixture/profile/mcp-control.json", error: null };
  const calls = [];
  let mcpWritten = false;
  let subagentWritten = false;
  const failures = new Set();
  function failOnce(name, expected) {
    if (parameters.get(name) === expected && !failures.has(name)) { failures.add(name); throw new Error(`Fixture ${name} unavailable`); }
  }
  const required = new Set([
    IPC.invoke.agentInstructionsGet, IPC.invoke.agentInstructionsSave,
    IPC.invoke.mcpList, IPC.invoke.mcpUpsert, IPC.invoke.mcpSetEnabled, IPC.invoke.mcpRemove,
    IPC.invoke.mcpSetScope, IPC.invoke.mcpTransfer, IPC.invoke.mcpTest,
    IPC.invoke.mcpControlGet, IPC.invoke.mcpControlSet,
    IPC.invoke.subagentList, IPC.invoke.subagentCatalog, IPC.invoke.subagentRead,
    IPC.invoke.subagentCreate, IPC.invoke.subagentUpdate, IPC.invoke.subagentRemove,
    IPC.invoke.subagentSetEnabled, IPC.invoke.subagentSetBuiltinEnabled, IPC.invoke.subagentSetScope,
    IPC.invoke.subagentReveal, IPC.invoke.mcpMarketSearch, IPC.invoke.skillMarketSearch, IPC.invoke.skillMarketFetch,
  ]);
  function invoke(channel, input) {
    if (!required.has(channel)) return { handled: false };
    calls.push({ channel, input: clone(input) });
    const server = () => {
      const value = servers.find((row) => row.id === input.id && row.level === (input.level ?? "global") && (row.level !== "project" || row.projectPath === input.projectPath));
      if (!value) throw new Error(`Unknown fixture MCP server ${input.id}`);
      return value;
    };
    const subagent = (id = input.id) => {
      const value = subagents.find((row) => row.id === id);
      if (!value) throw new Error(`Unknown fixture subagent ${id}`);
      return value;
    };
    let data;
    switch (channel) {
      case IPC.invoke.agentInstructionsGet:
        failOnce("instructions", "error"); data = { global: clone(instructions) }; break;
      case IPC.invoke.agentInstructionsSave:
        failOnce("instructionsSave", "error");
        if (input.scope !== "global") throw new Error("This fixture only owns global instructions");
        instructions = { ...instructions, content: input.content }; data = { file: clone(instructions) }; break;
      case IPC.invoke.mcpList:
        failOnce("mcp", "error");
        if (mcpWritten) failOnce("mcpRefresh", "error");
        data = { servers: clone(servers.filter((row) => row.level === (input?.level ?? "global") && (row.level !== "project" || row.projectPath === input.projectPath))), statuses: [] }; break;
      case IPC.invoke.mcpUpsert: {
        failOnce("mcpSave", "error");
        if (!input.id || (input.level === "project" && !input.projectPath)) throw new Error("Fixture MCP identity and project are required");
        const prior = servers.findIndex((row) => row.id === input.id && row.level === (input.level ?? "global") && row.projectPath === input.projectPath);
        const value = { ...input, label: input.label || input.id, enabled: input.enabled ?? true, level: input.level ?? "global", createdAt: STAMP, updatedAt: STAMP };
        if (prior < 0) servers.push(value); else servers[prior] = value;
        mcpWritten = true;
        data = { server: clone(value) }; break;
      }
      case IPC.invoke.mcpSetEnabled: server().enabled = input.enabled; data = {}; break;
      case IPC.invoke.mcpSetScope: server().scope = clone(input.scope); data = {}; break;
      case IPC.invoke.mcpRemove: servers.splice(servers.indexOf(server()), 1); data = {}; break;
      case IPC.invoke.mcpTransfer: {
        const value = servers.find((row) => row.id === input.id && row.level === input.from.level);
        if (!value) throw new Error("Unknown MCP move source");
        Object.assign(value, { level: input.to.level, projectPath: input.to.projectPath, scope: input.to.level === "global" ? GLOBAL : { mode: "projects", projects: [input.to.projectPath] } });
        data = { server: clone(value) }; break;
      }
      case IPC.invoke.mcpTest: data = { status: { serverId: server().id, state: "ready", toolCount: 3 } }; break;
      case IPC.invoke.mcpControlGet: data = clone(control); break;
      case IPC.invoke.mcpControlSet: control = { ...control, enabled: input.enabled, running: input.enabled }; data = clone(control); break;
      case IPC.invoke.subagentList:
        if (subagentWritten) failOnce("subagentRefresh", "error");
        data = { subagents: clone(subagents) }; break;
      case IPC.invoke.subagentCatalog: data = { subagents: clone(builtins), builtins: clone(builtins), diagnostics: [], projectPath: null }; break;
      case IPC.invoke.subagentRead: data = { subagent: clone(subagent(input)), body: bodies.get(input) }; break;
      case IPC.invoke.subagentCreate:
      case IPC.invoke.subagentUpdate: {
        failOnce("subagentSave", "error");
        const id = input.id ?? input.name;
        if (!id) throw new Error("Fixture subagent identity is required");
        const value = { ...input, id, name: input.name ?? id, level: "global", path: `/fixture/home/.agents/subagents/${id}.md`, enabled: input.enabled ?? true, tools: input.tools ?? ["Read"], createdAt: STAMP, updatedAt: STAMP, sizeBytes: (input.body ?? "").length };
        const prior = subagents.findIndex((row) => row.id === id);
        if (channel === IPC.invoke.subagentCreate && prior >= 0) throw new Error("Duplicate fixture subagent");
        if (prior < 0) subagents.push(value); else subagents[prior] = value;
        bodies.set(id, input.body ?? ""); subagentWritten = true; data = { subagent: clone(value) }; break;
      }
      case IPC.invoke.subagentSetEnabled: subagent().enabled = input.enabled; data = {}; break;
      case IPC.invoke.subagentSetScope: subagent().scope = clone(input.scope); data = {}; break;
      case IPC.invoke.subagentSetBuiltinEnabled: {
        const value = builtins.find((row) => row.name === input.id);
        if (!value) throw new Error("Unknown builtin fixture subagent");
        value.enabled = input.enabled; data = { id: input.id, enabled: input.enabled }; break;
      }
      case IPC.invoke.subagentRemove: subagents.splice(subagents.indexOf(subagent(input)), 1); data = {}; break;
      case IPC.invoke.subagentReveal: subagent(input.id); data = {}; break;
      case IPC.invoke.mcpMarketSearch:
        failOnce("mcpMarket", "error"); data = { entries: [], failedSources: [], exhausted: true }; break;
      case IPC.invoke.skillMarketSearch:
        failOnce("skillMarket", "error"); data = { entries: [], failedSources: [] }; break;
      case IPC.invoke.skillMarketFetch:
        data = { name: input.entry.name, description: input.entry.description, body: "# Fixture skill\n\nUse this isolated skill for the preview." }; break;
      default: throw new Error(`Missing capabilities fixture branch ${channel}`);
    }
    return { handled: true, data };
  }
  return { invoke, calls, projects, sessions: [], populated };
}
