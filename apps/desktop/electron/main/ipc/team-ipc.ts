import { IPC } from "@pi-desktop/shared";
import type { HostProcess } from "../host-process";
import type { Logger } from "../logger";
import type { IpcRegistrar } from "./types";

export interface RegisterTeamIpcDependencies {
  registrar: IpcRegistrar;
  getHost: () => HostProcess | null;
  logger: Logger;
}

export function registerTeamIpc({
  registrar,
  getHost,
  logger,
}: RegisterTeamIpcDependencies): void {
  const { handle } = registrar;

  handle(IPC.invoke.teamGetRoster, async (input: { teamSessionId: string }) => {
    const host = getHost();
    if (!host) throw new Error("host unavailable");
    return host.call("team.getRoster", input);
  });

  handle(IPC.invoke.teamGetBoard, async (input: { teamSessionId: string }) => {
    const host = getHost();
    if (!host) throw new Error("host unavailable");
    return host.call("team.getBoard", input);
  });

  handle(IPC.invoke.teamPause, async (input: { teamSessionId: string }) => {
    const host = getHost();
    if (!host) throw new Error("host unavailable");
    logger.app("session", "info", "team pause requested", {
      sessionId: input.teamSessionId,
    });
    return host.call("team.pause", input);
  });

  handle(IPC.invoke.teamResume, async (input: { teamSessionId: string }) => {
    const host = getHost();
    if (!host) throw new Error("host unavailable");
    logger.app("session", "info", "team resume requested", {
      sessionId: input.teamSessionId,
    });
    return host.call("team.resume", input);
  });
}
