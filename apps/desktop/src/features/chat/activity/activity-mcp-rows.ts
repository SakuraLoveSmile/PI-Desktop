import type { AgentCapabilityLevel, McpConnectionState, McpServerRecord, McpServerStatus } from "@pi-desktop/shared";

/**
 * The server a failed row can handshake with again, addressed the way the Extensions page addresses its test button:
 * a project server by its project, a global one by its level alone.
 */
export type McpReconnectTarget = { serverId: string; label: string; level: AgentCapabilityLevel; projectPath?: string };

/** One row of the Skills & MCP section. An MCP row also says what the rail knows of its server. */
export type ActivityReference = {
  id: string;
  label: string;
  kind?: "skill" | "mcp";
  onOpen?: () => void;
  /** Present when the tool belongs to a server whose record was found. `reconnect` is set when a retry could help. */
  mcp?: { state: McpConnectionState; authRequired: boolean; message?: string; reconnect?: McpReconnectTarget };
};

/** The runtime names a server's tools `mcp_<id>_<tool>`, with every character outside [A-Za-z0-9_] replaced by `_`. */
const toolPrefix = (serverId: string) => `mcp_${serverId.replace(/[^a-zA-Z0-9_]/g, "_")}_`;

/** The Extensions page's rule: an HTTP server that sends no Authorization header of its own and still asks for sign-in. */
export function mcpNeedsAuth(server: McpServerRecord, status?: McpServerStatus): boolean {
  const ownHeader = Object.keys(server.headers ?? {}).some((name) => name.toLowerCase() === "authorization");
  return server.transport === "http" && !ownHeader && Boolean(status?.authRequired);
}

/** The records the Host lists carry their level and, for a project server, the project they belong to. */
export function mcpReconnectTarget(server: McpServerRecord): McpReconnectTarget {
  const level = server.level ?? "global";
  return { serverId: server.id, label: server.label.trim() || server.id, level,
    ...(level === "project" && server.projectPath ? { projectPath: server.projectPath } : {}) };
}

/**
 * The session records MCP tool names; the section lists servers. Every tool of a known server folds into that
 * server's one row, carrying its live state; a tool whose server is gone (or not loaded yet) keeps a row of its own.
 * When two servers could own a tool the longer id wins, since ids may contain underscores. A server that failed
 * for a reason other than a missing sign-in also says how to reconnect to it.
 */
export function activityMcpReferences(
  tools: readonly { id: string; label: string }[],
  servers: readonly McpServerRecord[],
  statuses: readonly McpServerStatus[],
): ActivityReference[] {
  const rows = new Map<string, ActivityReference>();
  for (const tool of tools) {
    let owner: McpServerRecord | undefined;
    let ownerPrefix = 0;
    for (const server of servers) {
      const prefix = toolPrefix(server.id);
      if (tool.label.length > prefix.length && tool.label.startsWith(prefix) && prefix.length > ownerPrefix) {
        owner = server;
        ownerPrefix = prefix.length;
      }
    }
    if (!owner) {
      rows.set(`mcp:${tool.id}`, { id: `mcp:${tool.id}`, label: tool.label, kind: "mcp" });
      continue;
    }
    const id = `mcp-server:${owner.id}`;
    if (rows.has(id)) continue;
    const status = statuses.find((candidate) => candidate.serverId === owner.id);
    const state = status?.state ?? "idle";
    const authRequired = mcpNeedsAuth(owner, status);
    rows.set(id, { id, label: owner.label.trim() || owner.id, kind: "mcp",
      mcp: { state, authRequired, ...(status?.message ? { message: status.message } : {}),
        ...(state === "failed" && !authRequired ? { reconnect: mcpReconnectTarget(owner) } : {}) } });
  }
  return [...rows.values()];
}

/** A server that is being reconnected reads as connecting until its answer arrives. */
export function withReconnecting(statuses: readonly McpServerStatus[], serverIds: ReadonlySet<string>): McpServerStatus[] {
  if (serverIds.size === 0) return [...statuses];
  return statuses.map((status) => serverIds.has(status.serverId) ? { ...status, state: "connecting" } : status);
}

/** The Host's answer for one server replaces what was read for it, wherever that sits in the list. */
export function withStatus(statuses: readonly McpServerStatus[], next: McpServerStatus): McpServerStatus[] {
  return statuses.some((status) => status.serverId === next.serverId)
    ? statuses.map((status) => status.serverId === next.serverId ? next : status)
    : [...statuses, next];
}
