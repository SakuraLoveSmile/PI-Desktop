import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { McpServerRecord, McpServerStatus } from "@pi-desktop/shared";
import { api } from "../../../lib/api";
import { withReconnecting, withStatus, type McpReconnectTarget } from "./activity-mcp-rows";

/** `settled` is false until the first read for this project has finished, whether it worked or not. */
type McpServers = { servers: McpServerRecord[]; statuses: McpServerStatus[]; settled: boolean };
export type ActivityMcpServers = McpServers & {
  /**
   * Handshake with a failed server again, through the call behind the Extensions page's test button. Resolves to what
   * the server answered, or to `null` when the request was dropped: one for that server is already running, or the
   * pane moved on (another project, closed) before the answer came. Rejects when the Host could not be asked.
   */
  reconnect: (target: McpReconnectTarget) => Promise<McpServerStatus | null>;
};
const NONE: McpServers = { servers: [], statuses: [], settled: false };
const NO_PENDING: ReadonlySet<string> = new Set();
const POLL_MS = 2000;
const POLL_LIMIT = 20;
/** A reconnect in flight is told apart by its project as well as its server: two projects may each have a `docs`. */
const requestKey = (owner: string, serverId: string) => `${owner}\u0000${serverId}`;

/**
 * The user's MCP servers and their live states, read through the call the Extensions page uses. Project servers come
 * first so they win over a global one with the same id. A server that is still connecting is read again every couple
 * of seconds, a bounded number of times, so its row settles without a click. `refreshKey` rereads when the session
 * starts using another server. A server being reconnected reads as connecting until the Host answers, and the answer
 * replaces what was read for it.
 */
export function useActivityMcpServers(projectPath: string | undefined, enabled: boolean, refreshKey: string): ActivityMcpServers {
  const owner = projectPath ?? "";
  const [loaded, setLoaded] = useState<(McpServers & { owner: string }) | null>(null);
  // The ref refuses a second click in the same tick, before any render could hide the button; the state paints the spinner.
  const running = useRef(new Set<string>());
  const [pending, setPending] = useState<ReadonlySet<string>>(NO_PENDING);
  const latestOwner = useRef(owner);
  latestOwner.current = owner;
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let reads = 0;
    const read = async () => {
      try {
        const [global, project] = await Promise.all([
          api.listMcpServers({ level: "global", ...(projectPath ? { projectPath } : {}) }),
          projectPath ? api.listMcpServers({ level: "project", projectPath }) : Promise.resolve({ servers: [], statuses: [] }),
        ]);
        if (cancelled) return;
        const next = { owner, settled: true, servers: [...(project.servers ?? []), ...(global.servers ?? [])],
          statuses: [...(project.statuses ?? []), ...(global.statuses ?? [])] };
        setLoaded(next);
        if (next.statuses.some((status) => status.state === "connecting") && ++reads < POLL_LIMIT) timer = setTimeout(() => { void read(); }, POLL_MS);
      } catch (error) {
        if (cancelled) return;
        console.warn("Activity MCP states could not be read", error instanceof Error ? error.name : "UnknownError");
        // The rows fall back to the tool names they were recorded under rather than waiting for a read that failed.
        setLoaded((current) => current?.owner === owner ? current : { owner, settled: true, servers: [], statuses: [] });
      }
    };
    void read();
    return () => { cancelled = true; if (timer) clearTimeout(timer); };
  }, [enabled, projectPath, owner, refreshKey]);

  const reconnect = useCallback(async (target: McpReconnectTarget): Promise<McpServerStatus | null> => {
    const id = requestKey(owner, target.serverId);
    if (running.current.has(id)) return null;
    running.current.add(id);
    setPending(new Set(running.current));
    try {
      const { status } = await api.testMcpServer(target.serverId, { level: target.level, ...(target.projectPath ? { projectPath: target.projectPath } : {}) });
      // An answer for a project the pane has left would put another project's state on its rows.
      if (!mounted.current || latestOwner.current !== owner) return null;
      setLoaded((current) => current?.owner === owner ? { ...current, statuses: withStatus(current.statuses, status) } : current);
      return status;
    } finally {
      running.current.delete(id);
      if (mounted.current) setPending(new Set(running.current));
    }
  }, [owner]);

  const reconnecting = useMemo(() => {
    const prefix = requestKey(owner, "");
    return new Set([...pending].filter((id) => id.startsWith(prefix)).map((id) => id.slice(prefix.length)));
  }, [pending, owner]);
  const view = loaded?.owner === owner ? loaded : NONE;
  const statuses = useMemo(() => withReconnecting(view.statuses, reconnecting), [view.statuses, reconnecting]);
  return { servers: view.servers, statuses, settled: view.settled, reconnect };
}
