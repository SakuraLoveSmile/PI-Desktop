export const DEFAULT_RPC_TIMEOUT_MS = 130_000;
export const PERMISSION_TIMEOUT_MS = 120_000;
export const COMMAND_RPC_BUFFER_MS = 10_000;
const MAX_TIMER_DELAY_MS = 2_147_483_647;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Return the transport deadline for an RPC call. An unbounded Bash command is
 * intentionally allowed to outlive the transport; host-core owns its process
 * until the caller aborts it or it exits.
 */
export function rpcTimeoutMs(
  method: string,
  params: unknown,
): number | undefined {
  if (method !== "tools.execute") return DEFAULT_RPC_TIMEOUT_MS;

  const input = isRecord(params) ? params : undefined;
  if (input?.toolName !== "Bash") return DEFAULT_RPC_TIMEOUT_MS;
  if (input.timeoutMs === undefined) return undefined;

  const commandTimeoutMs = input.timeoutMs;
  if (
    typeof commandTimeoutMs !== "number" ||
    !Number.isFinite(commandTimeoutMs) ||
    commandTimeoutMs <= 0
  ) {
    return DEFAULT_RPC_TIMEOUT_MS;
  }

  return Math.min(
    MAX_TIMER_DELAY_MS,
    PERMISSION_TIMEOUT_MS + Math.ceil(commandTimeoutMs) + COMMAND_RPC_BUFFER_MS,
  );
}
