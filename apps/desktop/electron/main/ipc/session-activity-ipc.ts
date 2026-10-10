import { IPC } from "@pi-desktop/shared";
import type { HostProcess } from "../host-process";
import type { IpcRegistrar } from "./types";

type Dependencies = { handle: IpcRegistrar["handle"]; getHost: () => HostProcess | null };

function input(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("session activity input required");
  return value as Record<string, unknown>;
}
function sessionIdOf(value: Record<string, unknown>): string {
  const id = value.sessionId;
  if (typeof id !== "string" || !id.trim()) throw new Error("sessionId required");
  if (id.startsWith("remote:") || id.startsWith("native-pi:")) throw new Error("session activity is available for local Desktop sessions only");
  return id;
}
function processIdOf(value: Record<string, unknown>): string {
  if (typeof value.id !== "string" || !value.id.trim()) throw new Error("process id required");
  return value.id;
}

/** Local-only native session resources. Shell execution stays behind tools.execute. */
export function registerSessionActivityIpc({ handle, getHost }: Dependencies): void {
  const call = (method: string, params: Record<string, unknown>) => {
    const host = getHost();
    if (!host) throw new Error("host unavailable");
    return host.call(method, params);
  };
  handle(IPC.invoke.sessionActivityGet, (value: unknown) => {
    const params = input(value);
    const offset = params.offset ?? 0;
    if (typeof offset !== "number" || !Number.isSafeInteger(offset) || offset < 0) throw new Error("invalid activity offset");
    return call("sessionActivity.get", { sessionId: sessionIdOf(params), offset });
  });
  handle(IPC.invoke.sessionNotesGet, (value: unknown) => {
    const params = input(value);
    return call("sessionNotes.get", { sessionId: sessionIdOf(params) });
  });
  handle(IPC.invoke.sessionNotesSet, (value: unknown) => {
    const params = input(value);
    const sessionId = sessionIdOf(params);
    if (typeof params.content !== "string") throw new Error("note content required");
    if (typeof params.expectedRevision !== "number" || !Number.isSafeInteger(params.expectedRevision) || params.expectedRevision < 0) throw new Error("expectedRevision required");
    return call("sessionNotes.set", { sessionId, content: params.content, expectedRevision: params.expectedRevision });
  });
  handle(IPC.invoke.backgroundProcessesList, (value: unknown) => {
    const params = input(value);
    return call("backgroundProcesses.list", { sessionId: sessionIdOf(params) });
  });
  for (const [channel, method] of [
    [IPC.invoke.backgroundProcessesRead, "backgroundProcesses.read"],
    [IPC.invoke.backgroundProcessesStop, "backgroundProcesses.stop"],
  ] as const) {
    handle(channel, (value: unknown) => {
      const params = input(value);
      return call(method, { sessionId: sessionIdOf(params), id: processIdOf(params) });
    });
  }
}
