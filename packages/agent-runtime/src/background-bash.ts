/** Keep the Host's default provenance for background launches; foreground payloads stay unchanged. */
export const backgroundBashDescription =
  "Start a Host-managed background process and return its ID immediately. It remains visible in the session activity panel until stopped or completed. Ordinary commands keep the timeout: default 60 seconds; pass timeout in seconds (1-21600) for long runs. Explicit backgroundKind: service uses the Team-owned six-hour lifetime instead; do not pass timeout.";

export const backgroundKindDescription =
  "Optional process kind; defaults to command. Use service only for a tracked service in the current confirmed Team Agent run, with run_in_background: true and no timeout. Services retain shell capacity, expire after six hours, and stop on any Team pause or owner/run end. No automatic restart.";

/** Validate intent before transport; the Host independently authenticates Team/run ownership. */
export function validateBashBackgroundKind(params: unknown): void {
  if (!params || typeof params !== "object" || !("backgroundKind" in params)) return;
  if (params.backgroundKind !== "command" && params.backgroundKind !== "service") {
    throw Object.assign(new Error("backgroundKind must be command or service."), { errorCode: "INVALID_ARGUMENT" });
  }
  if (params.backgroundKind !== "service") return;
  if (!("run_in_background" in params) || params.run_in_background !== true) {
    throw Object.assign(new Error("backgroundKind: service requires run_in_background: true."), { errorCode: "INVALID_ARGUMENT" });
  }
  if ("timeout" in params) {
    throw Object.assign(new Error("Do not pass timeout with backgroundKind: service; the Host applies the fixed six-hour service lifetime."), { errorCode: "INVALID_ARGUMENT" });
  }
}

export function bashTimeoutPayload(params: unknown, timeoutMs: number | undefined): { timeoutMs?: number } {
  if (params && typeof params === "object" && "run_in_background" in params &&
      params.run_in_background === true && !("timeout" in params)) return {};
  return { timeoutMs };
}
