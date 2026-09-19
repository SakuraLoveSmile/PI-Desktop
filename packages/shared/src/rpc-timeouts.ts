export const DEFAULT_RPC_TIMEOUT_MS = 130_000;
export const PERMISSION_TIMEOUT_MS = 120_000;
export const DEFAULT_COMMAND_TIMEOUT_MS = 60_000;
export const COMMAND_RPC_BUFFER_MS = 10_000;
export const DEFAULT_BASH_RPC_TIMEOUT_MS =
  PERMISSION_TIMEOUT_MS + DEFAULT_COMMAND_TIMEOUT_MS + COMMAND_RPC_BUFFER_MS;
/**
 * host-core's dispatch budget for `plugin_*` / `mcp_*` tools, which Electron
 * main executes. It outlasts Electron's plugin tool budget (110s). Mirrors
 * `DESKTOP_TOOL_DISPATCH_TIMEOUT_MS` in `crates/host-core/src/tools/mod.rs`.
 */
export const DESKTOP_TOOL_DISPATCH_TIMEOUT_MS = 120_000;
export const DEFAULT_DESKTOP_TOOL_RPC_TIMEOUT_MS =
  PERMISSION_TIMEOUT_MS + DESKTOP_TOOL_DISPATCH_TIMEOUT_MS + COMMAND_RPC_BUFFER_MS;
const MAX_TIMER_DELAY_MS = 2_147_483_647;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isDesktopDispatchedTool(toolName: unknown): boolean {
  return (
    typeof toolName === "string" &&
    (toolName.startsWith("plugin_") || toolName.startsWith("mcp_"))
  );
}

/**
 * Return the transport deadline for an RPC call. Bash and desktop-dispatched
 * (`plugin_*` / `mcp_*`) tools include the permission wait, the effective
 * execution timeout, and transport slack, so the transport never gives up
 * before host-core reports its own timeout. Every call has a finite deadline so
 * a lost response cannot leave a pending promise forever.
 */
export function rpcTimeoutMs(
  method: string,
  params: unknown,
): number {
  if (method !== "tools.execute") return DEFAULT_RPC_TIMEOUT_MS;

  const input = isRecord(params) ? params : undefined;
  if (isDesktopDispatchedTool(input?.toolName)) {
    return executionRpcTimeoutMs(input?.timeoutMs, DEFAULT_DESKTOP_TOOL_RPC_TIMEOUT_MS);
  }
  if (input?.toolName !== "Bash") return DEFAULT_RPC_TIMEOUT_MS;
  if (input?.timeoutMs === undefined) return DEFAULT_BASH_RPC_TIMEOUT_MS;
  return executionRpcTimeoutMs(input.timeoutMs, DEFAULT_BASH_RPC_TIMEOUT_MS);
}

/** Permission wait + execution timeout + slack, or `fallbackMs` when absent or invalid. */
function executionRpcTimeoutMs(executionTimeoutMs: unknown, fallbackMs: number): number {
  if (
    typeof executionTimeoutMs !== "number" ||
    !Number.isFinite(executionTimeoutMs) ||
    executionTimeoutMs <= 0
  ) {
    return fallbackMs;
  }

  return Math.min(
    MAX_TIMER_DELAY_MS,
    PERMISSION_TIMEOUT_MS + Math.ceil(executionTimeoutMs) + COMMAND_RPC_BUFFER_MS,
  );
}
