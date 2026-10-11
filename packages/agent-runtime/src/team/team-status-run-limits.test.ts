import { expect, it } from "vitest";
import { createTeamTools } from "./team-tools.js";
import type { RuntimeHost } from "../types.js";

it("shows the Host run budget together with ordinary Lead mailbox metadata", async () => {
  const runLimits = { enabled: true, softMs: 21600000, hardMs: 36000000,
    runId: "scope-1", startedAt: 1000, elapsedMs: 2000, softMessageId: null, hardReachedAt: null };
  const host: RuntimeHost = { call: async <T>(method: string): Promise<T> => {
    const values: Record<string, unknown> = {
      "team.getRoster": { teamSessionId: "lead", paused: false, members: [], runLimits },
      "team.getBoard": { teamSessionId: "lead", revision: 1, tasks: [] },
      "team.getPlanning": null,
      "team.listMessages": { messages: [] },
    };
    if (!(method in values)) throw new Error(`Unexpected ${method}`);
    return values[method] as T;
  } };
  const status = createTeamTools({ teamSessionId: "lead", callerSessionId: "lead", isLead: true, host })
    .find(tool => tool.name === "team_status")!;
  const result = await status.execute("status", {});
  if (result.content[0].type !== "text") throw new Error("Missing status text");
  expect(JSON.parse(result.content[0].text)).toMatchObject({ runLimits,
    pendingMessagesCount: 0, pendingMessageSenders: [], oldestPendingMessageAgeSeconds: null });
});
