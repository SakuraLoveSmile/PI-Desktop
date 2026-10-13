import { IPC } from "@pi-desktop/shared";
import type { ResumeBlockedGoalInput } from "../runtime/goal-resume";
import type { HostProcess } from "../host-process";

export type GoalReportIpcDependencies = {
  handle: (channel: string, handler: (...args: any[]) => Promise<unknown>) => void;
  getHost: () => HostProcess | null;
  resumeBlockedGoal?: (input: ResumeBlockedGoalInput) => Promise<unknown>;
};

export function registerGoalReportIpc({
  handle,
  getHost,
  resumeBlockedGoal,
}: GoalReportIpcDependencies): void {
  handle(IPC.invoke.goalExecutionGet, async (params: { sessionId: string; executionId?: string }) => {
    const host = getHost();
    if (!host) throw new Error("host unavailable");
    const sessionId = String(params?.sessionId ?? "").trim();
    if (!sessionId) throw new Error("sessionId required");
    return host.call("goalExecutions.get", { sessionId, ...(params.executionId ? { executionId: params.executionId } : {}) });
  });
  handle(IPC.invoke.goalResume, async (params: ResumeBlockedGoalInput) => {
    if (!resumeBlockedGoal) throw new Error("Goal resume unavailable");
    if (!params?.sessionId?.trim() || !params.executionId?.trim() || !Number.isSafeInteger(params.expectedVersion)) throw new Error("Goal resume identity and version required");
    return resumeBlockedGoal(params);
  });
  handle(IPC.invoke.goalClose, async (params: { sessionId: string; executionId: string; expectedVersion: number; action: "accept" | "abandon" }) => {
    const host = getHost();
    if (!host) throw new Error("host unavailable");
    if (!params?.sessionId?.trim() || !params.executionId?.trim() || !Number.isSafeInteger(params.expectedVersion) || !["accept", "abandon"].includes(params.action)) throw new Error("Goal close identity, version and action required");
    return host.call("goalExecutions.close", params);
  });

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
  handle(
    IPC.invoke.goalReportGetAsset,
    async (params: {
      sessionId: string;
      executionId: string;
      screenshotId: string;
      offset?: number;
      length?: number;
    }) => {
      const host = getHost();
      if (!host) throw new Error("host unavailable");
      const sessionId = String(params?.sessionId ?? "").trim();
      if (!sessionId) throw new Error("sessionId required");
      const executionId = String(params?.executionId ?? "").trim();
      if (!executionId) throw new Error("executionId required");
      const screenshotId = String(params?.screenshotId ?? "").trim();
      if (!screenshotId) throw new Error("screenshotId required");
      return host.call("goalReports.getAsset", {
        sessionId,
        executionId,
        screenshotId,
        ...(typeof params?.offset === "number" ? { offset: params.offset } : {}),
        ...(typeof params?.length === "number" ? { length: params.length } : {}),
      });
    },
  );
}
