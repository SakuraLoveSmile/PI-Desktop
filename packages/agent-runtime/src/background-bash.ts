/** Keep the Host's default provenance for background launches; foreground payloads stay unchanged. */
export const backgroundBashDescription =
  "Start a Host-managed background process and return its ID immediately. It remains visible in the session activity panel until stopped or completed. The timeout still applies: default 60 seconds; pass timeout in seconds (1-21600) for long runs.";

export function bashTimeoutPayload(params: unknown, timeoutMs: number | undefined): { timeoutMs?: number } {
  if (params && typeof params === "object" && "run_in_background" in params &&
      params.run_in_background === true && !("timeout" in params)) return {};
  return { timeoutMs };
}
