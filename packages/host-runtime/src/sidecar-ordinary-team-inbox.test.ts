import { afterEach, describe, expect, it } from "vitest";
import { AgentSidecar, type SidecarHostLink } from "./agent-sidecar.js";

const sidecars: AgentSidecar[] = [];
afterEach(async () => { await Promise.all(sidecars.splice(0).map(sidecar => sidecar.dispose())); });

function fixture() {
  const proxyUrl = new URL("../../agent-runtime/src/parent-host-proxy.ts", import.meta.url).href;
  const source = `
    import { createInterface } from 'node:readline';
    const { ParentHostProxy } = await import(${JSON.stringify(proxyUrl)});
    const proxy = new ParentHostProxy();
    createInterface({ input: process.stdin }).on('line', async (line) => {
      const message = JSON.parse(line);
      if (proxy.handleParentMessage(message)) return;
      try { console.log(JSON.stringify({ id: message.id, result: await proxy.call(message.params.method, message.params.params) })); }
      catch (error) { console.log(JSON.stringify({ id: message.id, error: { code: error.code, message: error.message, data: error.data } })); }
    });`;
  const sidecar = new AgentSidecar({ launch: { command: process.execPath, args: ["--input-type=module", "-e", source] }, onStderr: () => {} });
  sidecars.push(sidecar);
  const calls: string[] = [];
  const host: SidecarHostLink = { async call<T>(method: string): Promise<T> {
    calls.push(method);
    return { capability: "ordinary-team-inbox-v1" } as T;
  }, onNotification: () => () => {}, onExit: () => () => {} };
  sidecar.setHost(host);
  const request = (method: string) => sidecar.call("probe", { method, params: {
    teamSessionId: "lead", callerSessionId: "lead", leadTurnId: "turn", boundaryId: "boundary", messageIds: ["report"],
  } });
  return { sidecar, host, calls, request };
}

describe("ordinary Team inbox transport", () => {
  it("falls back safely without an embedding admission handler and never directly forwards bodies", async () => {
    const { request, calls } = fixture();
    for (const method of ["team.getOrdinaryInboxCapability", "team.readOrdinaryInbox", "team.ackOrdinaryInbox"]) {
      await expect(request(method)).rejects.toMatchObject({ code: -32601 });
    }
    expect(calls).toEqual([]);
  });

  it("negotiates Host capability then routes read and ACK only through the Main admission callback", async () => {
    const { sidecar, request, calls } = fixture();
    const admitted: string[] = [];
    sidecar.setOrdinaryTeamInboxHandler(async (method, params) => {
      admitted.push(method);
      expect(params.leadTurnId).toBe("turn");
      return { admitted: true };
    });
    expect(await request("team.getOrdinaryInboxCapability")).toEqual({ capability: "ordinary-team-inbox-v1" });
    expect(await request("team.readOrdinaryInbox")).toEqual({ admitted: true });
    expect(await request("team.ackOrdinaryInbox")).toEqual({ admitted: true });
    expect(calls).toEqual(["team.getOrdinaryInboxCapability"]);
    expect(admitted).toEqual(["team.readOrdinaryInbox", "team.ackOrdinaryInbox"]);
  });

  it("drops an old transport response if the Host was replaced while Main admitted the report", async () => {
    const { sidecar, host, request } = fixture();
    let entered!: () => void;
    let release!: () => void;
    const started = new Promise<void>(resolve => { entered = resolve; });
    const gate = new Promise<void>(resolve => { release = resolve; });
    sidecar.setOrdinaryTeamInboxHandler(async () => { entered(); await gate; return { content: "must not reach replacement" }; });
    const pending = request("team.readOrdinaryInbox");
    await started;
    sidecar.setHost({ ...host });
    release();
    await expect(pending).rejects.toMatchObject({ data: { errorCode: "TEAM_TURN_INVALID" } });
  });
});
