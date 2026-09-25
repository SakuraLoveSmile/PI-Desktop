import { IPC } from "@pi-desktop/shared";
import type { HostProcess } from "../host-process";

export type GoalReportIpcDependencies = {
  handle: (channel: string, handler: (...args: any[]) => Promise<unknown>) => void;
  getHost: () => HostProcess | null;
};

export function registerGoalReportIpc({
  handle,
  getHost,
}: GoalReportIpcDependencies): void {
  handle(IPC.invoke.goalReportGet, async (params: { sessionId: string; reportId?: string; executionId?: string }) => {
    const host = getHost();
    if (!host) throw new Error("host unavailable");
    const sessionId = String(params?.sessionId ?? "").trim();
    if (!sessionId) throw new Error("sessionId required");
    const reportId = params?.reportId ? String(params.reportId).trim() : undefined;
    const executionId = params?.executionId ? String(params.executionId).trim() : undefined;
    if (!reportId && !executionId) {
      throw new Error("reportId or executionId required");
    }
    return host.call("goalReports.get", {
      sessionId,
      ...(reportId ? { reportId } : {}),
      ...(executionId ? { executionId } : {}),
    });
  });

  handle(IPC.invoke.goalReportList, async (params: { sessionId: string }) => {
    const host = getHost();
    if (!host) throw new Error("host unavailable");
    const sessionId = String(params?.sessionId ?? "").trim();
    if (!sessionId) throw new Error("sessionId required");
    return host.call("goalReports.list", { sessionId });
  });

  handle(IPC.invoke.goalReportRetry, async (params: { sessionId: string; executionId: string }) => {
    const host = getHost();
    if (!host) throw new Error("host unavailable");
    const sessionId = String(params?.sessionId ?? "").trim();
    if (!sessionId) throw new Error("sessionId required");
    const executionId = String(params?.executionId ?? "").trim();
    if (!executionId) throw new Error("executionId required");
    return host.call("goalReports.retry", { sessionId, executionId });
  });
}
