import { describe, expect, it } from "vitest";
import { createTeamTools } from "./team-tools.js";
import type { RuntimeHost } from "../host-client.js";

describe("typed task dispatch receipt", () => {
  it("sends explicit task identity and exposes Host queue facts without claiming delivery", async () => {
    const calls: Array<Record<string, unknown> | undefined> = [];
    const host = { async call<T>(_method: string, params?: Record<string, unknown>) {
      calls.push(params);
      return { message: {
        id: "mail-1", targetMemberName: "builder", status: "queued", deliveryStatus: "acknowledged",
        targetState: "running", queuePosition: 2, sentAt: "2026-10-11T01:00:00.000Z", targetBusyAtSend: true,
        taskDispatch: params?.taskDispatch,
      } } as T;
    } } satisfies Pick<RuntimeHost, "call">;
    const tools = createTeamTools({ teamSessionId: "lead", callerSessionId: "lead", isLead: true, host: host as RuntimeHost });
    const send = tools.find(tool => tool.name === "send_message");
    if (!send) throw new Error("send_message missing");
    const result = await send.execute("send", { targetMemberName: "builder", content: "Replace the prior approach", taskDispatch: { taskId: "task-1", expectedRevision: 2 } });
    expect(calls).toEqual([{ teamSessionId: "lead", callerSessionId: "lead", target: "builder", content: "Replace the prior approach", taskDispatch: { taskId: "task-1", expectedRevision: 2 } }]);
    const output = result.content[0];
    if (output.type !== "text") throw new Error("receipt must be text");
    expect(JSON.parse(output.text)).toMatchObject({ messageId: "mail-1", targetState: "running", queuePosition: 2, queuePositionScope: "team_mailbox", delivered: false, targetBusyAtSend: true, sentAt: "2026-10-11T01:00:00.000Z", taskDispatch: { taskId: "task-1", expectedRevision: 2 } });
    await send.execute("report", { targetMemberName: "Lead", content: "task-1 is complete" });
    expect(calls[1]).not.toHaveProperty("taskDispatch");
  });
});
