import { IPC } from "@pi-desktop/shared";
import { isAbsolute } from "node:path";
import type { HostProcess } from "../host-process";
import type { IpcRegistrar } from "./types";

export function registerWorkspaceGitIpc({ handle, getHost }: {
  handle: IpcRegistrar["handle"];
  getHost: () => HostProcess | null;
}): void {
  for (const [channel, method] of [
    [IPC.invoke.workspaceGitGet, "workspace.git.get"],
    [IPC.invoke.workspaceGitSwitch, "workspace.git.switchBranch"],
    [IPC.invoke.workspaceGitCreateBranch, "workspace.git.createBranch"],
    [IPC.invoke.workspaceGitCreateWorktree, "workspace.git.createWorktree"],
  ] as const) {
    handle(channel, (value: unknown) => {
      if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Git workspace input required");
      const input = value as Record<string, unknown>;
      if (typeof input.projectPath !== "string" || !isAbsolute(input.projectPath)) throw new Error("Absolute projectPath required");
      if (input.sessionId !== undefined && (typeof input.sessionId !== "string" || !input.sessionId.trim() || /^(remote:|native-pi:)/.test(input.sessionId))) throw new Error("Local sessionId required");
      const params: Record<string, unknown> = { projectPath: input.projectPath, ...(input.sessionId === undefined ? {} : { sessionId: input.sessionId }) };
      if (method !== "workspace.git.get") {
        if (typeof input.branch !== "string" || !input.branch.trim()) throw new Error("Branch required");
        for (const key of ["expectedHead", "expectedBranch"] as const) {
          if (input[key] !== null && (typeof input[key] !== "string" || !input[key])) throw new Error(`${key} required`);
          params[key] = input[key];
        }
        params.branch = input.branch;
      }
      const host = getHost();
      if (!host) throw new Error("Host unavailable");
      return host.call(method, params, 120_000);
    });
  }
}
