import { IPC } from "@pi-desktop/shared";
import type { HostProcess } from "../host-process";
import type { IpcRegistrar } from "./types";

export type GoalProgressIpcDependencies = {
  handle: IpcRegistrar["handle"];
  getHost: () => HostProcess | null;
};

export function registerGoalProgressIpc({
  handle,
  getHost,
}: GoalProgressIpcDependencies): void {
  handle(
    IPC.invoke.goalProgressGet,
    async (params: { sessionId?: string; executionId: string }) => {
      const host = getHost();
      if (!host) throw new Error("host unavailable");
      const executionId = String(params?.executionId ?? "").trim();
      if (!executionId) throw new Error("executionId required");
      const sessionId = params?.sessionId ? String(params.sessionId).trim() : undefined;
      return host.call("goalProgress.get", {
        executionId,
        ...(sessionId ? { sessionId } : {}),
      });
    },
  );
}
