import type { BackgroundProcessSummary } from "@pi-desktop/shared";
import { backgroundProcessName } from "./activity-rail-presentation";

/** A running process that announced a local address: what the rail's Servers section lists. */
export type ActivityServer = {
  id: string;
  /** The command's short title without its port: the address already says which. */
  name: string;
  /** `localhost:3000`, the origin without its scheme. */
  display: string;
  /** The origin a click on the address opens. */
  url: string;
  /** A stop that is under way reads differently from a server that is up. */
  status: "running" | "stopping";
  command: string;
  cwd: string;
};

// The Host sends `scheme://host:port` with a loopback host and a port from 1 to 65535 (see the server address ADR).
// The value came from a process's own output, so it is checked again here and anything that does not fit is no address.
const ADDRESS = /^(https?):\/\/(localhost|127(?:\.(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}|\[::1\]):([1-9]\d{0,4})$/;

export function serverAddress(value: unknown): { display: string; url: string } | null {
  if (typeof value !== "string" || value.length > 64) return null;
  const match = ADDRESS.exec(value);
  if (!match || Number(match[3]) > 65535) return null;
  return { display: `${match[2]}:${match[3]}`, url: `${match[1]}://${match[2]}:${match[3]}/` };
}

/**
 * Processes that are up and announced an address are servers, whatever their kind; they are listed under Servers
 * instead of Live. Everything else, including a Team service with no address, stays where it was.
 */
export function splitServerProcesses(
  processes: readonly BackgroundProcessSummary[], sessionId: string,
): { servers: ActivityServer[]; rest: BackgroundProcessSummary[] } {
  const servers: ActivityServer[] = [];
  const rest: BackgroundProcessSummary[] = [];
  for (const process of processes) {
    if (process.sessionId === sessionId && (process.status === "running" || process.status === "stopping")) {
      const address = serverAddress(process.address);
      if (address) {
        servers.push({ id: process.id, name: backgroundProcessName(process.command), ...address, status: process.status,
          command: process.command, cwd: process.cwd });
        continue;
      }
    }
    rest.push(process);
  }
  return { servers, rest };
}
