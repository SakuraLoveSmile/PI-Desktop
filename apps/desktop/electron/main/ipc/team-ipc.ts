import { IPC } from "@pi-desktop/shared";
import type { HostProcess } from "../host-process";
import type { Logger } from "../logger";
import type { IpcRegistrar } from "./types";

export interface RegisterTeamIpcDependencies {
  registrar: IpcRegistrar;
  getHost: () => HostProcess | null;
  logger: Logger;
  teamDelivery: {
    pauseTeam: (teamSessionId: string) => Promise<unknown>;
    resumeTeam: (teamSessionId: string) => Promise<unknown>;
  };
}

export function registerTeamIpc({
  registrar,
  getHost,
  logger,
  teamDelivery,
}: RegisterTeamIpcDependencies): void {
  const { handle } = registrar;

  handle(IPC.invoke.teamGetRoster, async (input: { teamSessionId: string }) => {
    const host = getHost();
    if (!host) throw new Error("host unavailable");
    return host.call("team.getRoster", {
      ...input,
      callerSessionId: input.teamSessionId,
    });
  });

  handle(IPC.invoke.teamGetBoard, async (input: { teamSessionId: string }) => {
    const host = getHost();
    if (!host) throw new Error("host unavailable");
    return host.call("team.getBoard", {
      ...input,
      callerSessionId: input.teamSessionId,
    });
  });
  handle(IPC.invoke.teamGetSnapshot, async (input: { teamSessionId: string }) => {
    const host = getHost();
    if (!host) throw new Error("host unavailable");
    return host.call("team.getSnapshot", {
      teamSessionId: input?.teamSessionId,
      callerSessionId: input?.teamSessionId,
    });
  });

  handle(IPC.invoke.teamPause, async (input: { teamSessionId: string }) => {
    if (!getHost()) throw new Error("host unavailable");
    logger.app("session", "info", "team pause requested", {
      sessionId: input.teamSessionId,
    });
    return teamDelivery.pauseTeam(input.teamSessionId);
  });

  handle(IPC.invoke.teamResume, async (input: { teamSessionId: string }) => {
    if (!getHost()) throw new Error("host unavailable");
    logger.app("session", "info", "team resume requested", {
      sessionId: input.teamSessionId,
    });
    return teamDelivery.resumeTeam(input.teamSessionId);
  });

  handle(
    IPC.invoke.teamGetExecutionDecision,
    async (input: { teamSessionId: string; leadTurnId?: string }) => {
      const host = getHost();
      if (!host) throw new Error("host unavailable");
      return host.call("team.getExecutionDecision", {
        ...input,
        callerSessionId: input.teamSessionId,
      });
    },
  );

  handle(
    IPC.invoke.teamGetLaunchReview,
    async (input: { teamSessionId: string; reviewId?: string }) => {
      const host = getHost();
      if (!host) throw new Error("host unavailable");
      return host.call("team.getLaunchReview", {
        ...input,
        callerSessionId: input.teamSessionId,
      });
    },
  );

  handle(
    IPC.invoke.teamUpdateLaunchReview,
    async (input: {
      teamSessionId: string;
      reviewId: string;
      expectedRevision: number;
      selections: unknown[];
    }) => {
      const host = getHost();
      if (!host) throw new Error("host unavailable");
      return host.call("team.updateLaunchReview", {
        ...input,
        callerSessionId: input.teamSessionId,
      });
    },
  );

  handle(
    IPC.invoke.teamConfirmLaunchReview,
    async (input: {
      teamSessionId: string;
      reviewId: string;
      expectedRevision: number;
    }) => {
      const host = getHost();
      if (!host) throw new Error("host unavailable");
      return host.call("team.confirmLaunchReview", {
        ...input,
        callerSessionId: input.teamSessionId,
      });
    },
  );

  handle(
    IPC.invoke.teamCancelLaunchReview,
    async (input: {
      teamSessionId: string;
      reviewId: string;
      expectedRevision: number;
    }) => {
      const host = getHost();
      if (!host) throw new Error("host unavailable");
      return host.call("team.cancelLaunchReview", {
        ...input,
        callerSessionId: input.teamSessionId,
      });
    },
  );
}
