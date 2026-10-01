/**
 * Settings IPC for the local MCP control plane.
 *
 * This channel pair only reports status and sets the on/off preference; it
 * cannot create a second server, choose another port, or read the connection
 * record. Responses and logs therefore carry no bearer token and no rendered
 * manifest — `connectionFile` is a path the user may copy, nothing more.
 *
 * The channels are deliberately absent from the reviewed MCP operation catalog
 * (`MCP_CONTROL_CATALOG_CHANNEL_KEYS`), so an external MCP client cannot switch
 * off or on the control plane that serves it.
 */
import { ErrorCodes, IPC, type McpControlStatus } from "@pi-desktop/shared";
import {
  getActiveMcpControlLifecycle,
  type McpControlLifecycle,
} from "../mcp-control-lifecycle";
import type { IpcRegistrar } from "./types";

export type McpControlIpcDependencies = {
  registrar: IpcRegistrar;
};

function lifecycle(): McpControlLifecycle {
  const active = getActiveMcpControlLifecycle();
  if (!active) {
    throw Object.assign(new Error("local MCP control plane is not available"), {
      errorCode: ErrorCodes.INTERNAL,
    });
  }
  return active;
}

/** `{enabled: boolean}` is required and strictly typed; anything else is rejected. */
function readEnabled(input: unknown): boolean {
  const enabled = (input as { enabled?: unknown } | null | undefined)?.enabled;
  if (typeof enabled !== "boolean") {
    throw Object.assign(new Error("enabled must be a boolean"), {
      errorCode: ErrorCodes.INVALID_PARAMS,
    });
  }
  return enabled;
}

export function registerMcpControlIpc({ registrar }: McpControlIpcDependencies): void {
  const { handle } = registrar;

  handle(IPC.invoke.mcpControlGet, async (): Promise<McpControlStatus> => lifecycle().status());

  handle(IPC.invoke.mcpControlSet, async (input?: unknown): Promise<McpControlStatus> =>
    lifecycle().setEnabled(readEnabled(input)),
  );
}
