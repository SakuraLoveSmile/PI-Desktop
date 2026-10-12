import type { RuntimeHost } from "./host-client.js";

export const PROJECT_CONTEXT_METHODS = new Set([
  "project.autoMemory.agentList",
  "project.autoMemory.agentUpsert",
  "project.autoMemory.agentDelete",
  "project.history.search",
  "project.history.context",
  "project.codeSearch",
  "backgroundProcesses.read",
]);

/** Captures the trusted launch binding outside model-controlled tool arguments. */
export function bindProjectContextHost(host: RuntimeHost, sessionId: string, bindingId?: string): RuntimeHost {
  return {
    call: <T>(method: string, params?: unknown, timeoutOverrideMs?: number) => {
      if (!PROJECT_CONTEXT_METHODS.has(method)) return host.call<T>(method, params, timeoutOverrideMs);
      if (!bindingId) return Promise.reject(new Error("Project context requires a bound project session"));
      const values = params && typeof params === "object" && !Array.isArray(params)
        ? params as Record<string, unknown> : {};
      return host.call<T>(method, { ...values, sessionId, projectContextBindingId: bindingId }, timeoutOverrideMs);
    },
    ...(host.onNotification ? { onNotification: handler => host.onNotification!(handler) } : {}),
    ...(host.onClose ? { onClose: handler => host.onClose!(handler) } : {}),
  };
}
