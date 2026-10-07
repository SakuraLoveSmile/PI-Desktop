import { describe, expect, it, vi } from "vitest";
import { Type } from "@earendil-works/pi-ai";
import type { RuntimeHost } from "../host-client.js";
import { withTeamLeadApproval } from "./lead-tool-approval.js";

// The Host reply is an external async boundary. A stale grant cannot execute.
describe("Team Lead authorization lifecycle", () => {
  it.each(["turn", "mode", "abort"])("rejects %s changes while Host authorization is pending", async (change) => {
    let finish: (() => void) | undefined;
    const pending = new Promise<void>((resolve) => { finish = resolve; });
    const host: RuntimeHost = {
      call: async <T>() => { await pending; return { authorized: true } as T; },
    };
    let turn = "old-turn";
    let denial: string | undefined;
    const abort = new AbortController();
    const execute = vi.fn(async () => ({ content: [{ type: "text" as const, text: "side effect" }], details: {} }));
    const tool = withTeamLeadApproval({
      name: "plugin_mutation", label: "Fixture plugin", description: "External side effect",
      parameters: Type.Object({}), execute,
    }, { host, teamSessionId: "lead", callerSessionId: "lead", getTurnId: () => turn, currentModeDenial: () => denial });
    const result = tool.execute("call", {}, abort.signal);
    if (change === "turn") turn = "new-turn";
    if (change === "mode") denial = "Tool is not allowed in plan mode";
    if (change === "abort") abort.abort();
    finish!();
    await expect(result).rejects.toBeDefined();
    expect(execute).not.toHaveBeenCalled();
  });
});
