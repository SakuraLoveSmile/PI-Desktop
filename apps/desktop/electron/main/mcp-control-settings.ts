/**
 * Machine-local preference for the optional local MCP control plane.
 *
 * The choice is a per-machine runtime preference, not plugin content and not
 * synced configuration: it lives in the Electron user-data directory as
 * `mcp-control-settings.json`, it is never uploaded, and it never carries
 * credential material. The bearer token stays in `mcp-control.token` and the
 * connection record stays in `mcp-control.json` (both mode `0600`, written by
 * `mcp-control.ts`), so this file can be read by the settings surface without
 * touching either.
 *
 * Effective value rule (D370, ADR 0203): an explicit startup environment
 * (`PI_DESKTOP_MCP_CONTROL=0|1`) wins over the saved preference, which wins
 * over the `false` default. Only the exact values `0` and `1` are explicit;
 * any other value is treated as unset so a mistyped variable cannot silently
 * turn the control plane off.
 */
import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { McpControlSource } from "@pi-desktop/shared";

/** Startup environment that explicitly forces the control plane on or off. */
export const MCP_CONTROL_ENV = "PI_DESKTOP_MCP_CONTROL";

/** Optional startup environment that selects a different loopback port. */
export const MCP_CONTROL_PORT_ENV = "PI_DESKTOP_MCP_PORT";

/** Saved machine-local preference; additive to the runtime files in ADR 0203. */
export const MCP_CONTROL_SETTINGS_FILE = "mcp-control-settings.json";

/** Connection record an external MCP client reads. Owned by `mcp-control.ts`. */
export const MCP_CONTROL_CONNECTION_FILE = "mcp-control.json";

export type McpControlEffective = {
  enabled: boolean;
  source: McpControlSource;
};

/**
 * The saved preference, or `undefined` when it is missing, malformed, or the
 * file cannot be read. A damaged file is not an enabled control plane: the
 * caller decides the fallback, and every caller currently defaults to off.
 */
export function readMcpControlPreference(dataDir: string): boolean | undefined {
  try {
    const value: unknown = JSON.parse(
      readFileSync(join(dataDir, MCP_CONTROL_SETTINGS_FILE), "utf8"),
    );
    if (!value || typeof value !== "object" || !("enabled" in value)) return undefined;
    const enabled = (value as { enabled?: unknown }).enabled;
    return typeof enabled === "boolean" ? enabled : undefined;
  } catch {
    // Missing or malformed preferences fall back to the documented default.
    return undefined;
  }
}

/**
 * Atomically persist the preference through a `0600` temporary file and a
 * rename. A failed write leaves the previous file untouched and fails visibly
 * to the caller; it never leaves a half-written preference behind.
 */
export function writeMcpControlPreference(dataDir: string, enabled: boolean): void {
  mkdirSync(dataDir, { recursive: true });
  const destination = join(dataDir, MCP_CONTROL_SETTINGS_FILE);
  const temporary = `${destination}.${randomUUID()}.tmp`;
  try {
    writeFileSync(temporary, JSON.stringify({ enabled }), { encoding: "utf8", mode: 0o600 });
    renameSync(temporary, destination);
  } finally {
    rmSync(temporary, { force: true });
  }
}

/**
 * Explicit startup override, or `undefined` when the launch environment does
 * not decide the control plane. Only `0` and `1` count.
 */
export function environmentMcpControlOverride(
  env: NodeJS.ProcessEnv = process.env,
): boolean | undefined {
  const raw = env[MCP_CONTROL_ENV];
  if (raw === "1") return true;
  if (raw === "0") return false;
  return undefined;
}

/** Apply the documented precedence to one launch. */
export function resolveMcpControlEffective(request: {
  dataDir: string;
  env?: NodeJS.ProcessEnv;
}): McpControlEffective {
  const override = environmentMcpControlOverride(request.env ?? process.env);
  if (override !== undefined) return { enabled: override, source: "environment" };
  return {
    enabled: readMcpControlPreference(request.dataDir) ?? false,
    source: "preference",
  };
}

/** Absolute path of the connection record, safe to show and to copy. */
export function mcpControlConnectionFile(dataDir: string): string {
  return join(dataDir, MCP_CONTROL_CONNECTION_FILE);
}
