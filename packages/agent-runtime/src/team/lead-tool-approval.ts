import type { AgentTool } from "@earendil-works/pi-agent-core";
import type { RuntimeHost } from "../host-client.js";

/** Authorize at execution time, including tools that run inside the sidecar. */
export function withTeamLeadApproval(
  tool: AgentTool,
  context: {
    host: RuntimeHost;
    teamSessionId: string;
    callerSessionId: string;
    getTurnId: () => string | undefined;
    currentModeDenial: () => string | undefined;
  },
): AgentTool {
  return {
    ...tool,
    execute: async (...args: Parameters<AgentTool["execute"]>) => {
      const turnId = context.getTurnId();
      await context.host.call("team.authorizeLeadTool", {
        teamSessionId: context.teamSessionId,
        callerSessionId: context.callerSessionId,
        toolName: tool.name,
      });
      args[2]?.throwIfAborted();
      if (context.getTurnId() !== turnId) {
        throw new Error("TEAM_APPROVAL_REQUIRED: the active turn changed during authorization");
      }
      const modeDenial = context.currentModeDenial();
      if (modeDenial) throw new Error(modeDenial);
      return tool.execute(...args);
    },
  };
}
