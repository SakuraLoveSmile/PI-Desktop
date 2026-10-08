import { afterEach, describe, expect, it } from "vitest";
import { AgentSidecar, type SidecarHostLink } from "./agent-sidecar.js";

const child = `const rl=require('node:readline').createInterface({input:process.stdin});
const bindings=new Map(), pending=new Map();rl.on('line',line=>{const m=JSON.parse(line);
if(m.method==='agent.prompt'){bindings.set(m.params.sessionId,m.params.projectContextBindingId);
console.log(JSON.stringify({id:m.id,result:{accepted:true}}));}
else if(m.method==='probe'){const id='r'+m.id;pending.set(id,m.id);
const binding=bindings.get(m.params.launchSessionId);
console.log(JSON.stringify({id,method:'host.proxy',params:{method:m.params.method,
params:{...m.params.params,projectContextBindingId:binding}}}));}
else if(pending.has(m.id)){console.log(JSON.stringify({...m,id:pending.get(m.id)}));pending.delete(m.id);}});`;
const sidecars: AgentSidecar[] = [];
afterEach(async () => {
  await Promise.all(sidecars.splice(0).map(sidecar => sidecar.dispose()));
});

function fixture(handler?: (method: string, params: unknown) => Promise<unknown>) {
  const sidecar = new AgentSidecar({ launch: { command: process.execPath, args: ["-e", child] }, onStderr: () => {} });
  sidecars.push(sidecar);
  const calls: Array<{ method: string; params: unknown }> = [];
  const host: SidecarHostLink = {
    async call<T>(method: string, params?: unknown): Promise<T> {
      calls.push({ method, params });
      return (handler ? await handler(method, params) : { memory: { content: "", entries: [] }, autoRecordEnabled: true }) as T;
    },
    onNotification: () => () => {}, onExit: () => () => {},
  };
  sidecar.setHost(host);
  const launch = async (sessionId: string, path: string) => {
    sidecar.setProjectInstructionRoot(sessionId, path);
    await sidecar.call("agent.prompt", { sessionId, projectPath: path });
  };
  const probe = (method: string, params: Record<string, unknown>, launchSessionId = "bound") =>
    sidecar.call("probe", { method, params, launchSessionId });
  return { sidecar, calls, launch, probe };
}

describe("project context reverse RPC binding", () => {
  it("uses only the launch-bound path and entry preconditions", async () => {
    const { launch, probe, calls } = fixture();
    await launch("bound", "/trusted/root");
    await probe("project.autoMemory.agentList", { sessionId: "bound", boundPath: "/spoofed", enabled: false });
    await probe("project.autoMemory.agentUpsert", {
      sessionId: "bound", boundPath: "/spoofed", id: "note", title: "Stack", content: "Use pnpm",
      expectedTitle: "Stack", expectedContent: "Use npm", enabled: true,
    });
    expect(calls).toEqual([
      { method: "project.autoMemory.agentList", params: { sessionId: "bound", boundPath: "/trusted/root" } },
      { method: "project.autoMemory.agentUpsert", params: { sessionId: "bound", boundPath: "/trusted/root", id: "note",
        title: "Stack", content: "Use pnpm", expectedTitle: "Stack", expectedContent: "Use npm" } },
    ]);
    await expect(probe("project.autoMemory.setEnabled", { sessionId: "bound", enabled: true })).rejects.toThrow("not allowed");
    expect(calls).toHaveLength(2);
  });

  it("rejects another registered session and revoked or missing launch bindings", async () => {
    const { sidecar, launch, probe, calls } = fixture();
    await launch("bound", "/trusted/root");
    await launch("other", "/other/root");
    for (const method of ["project.autoMemory.agentDelete", "project.history.search", "project.history.context", "project.codeSearch"]) {
      await expect(probe(method, { sessionId: "other", id: "note" })).rejects.toThrow("bound project session");
      await expect(probe(method, { sessionId: "bound" }, "missing")).rejects.toThrow("bound project session");
    }
    sidecar.clearProjectInstructionRoot("bound");
    await expect(probe("project.autoMemory.agentList", { sessionId: "bound" })).rejects.toThrow("bound project session");
    expect(calls).toHaveLength(0);
  });

  it("keeps historical source identity separate from the caller and binds code search actions", async () => {
    const { launch, probe, calls } = fixture();
    await launch("bound", "/trusted/root");
    await probe("project.history.context", {
      sessionId: "bound", targetSessionId: "source", messageId: "message", query: "decision", boundPath: "/spoofed",
    });
    await probe("project.codeSearch", { sessionId: "bound", action: "status", boundPath: "/spoofed" });
    expect(calls).toEqual([
      { method: "project.history.context", params: { sessionId: "bound", boundPath: "/trusted/root",
        targetSessionId: "source", messageId: "message", query: "decision" } },
      { method: "project.codeSearch", params: { sessionId: "bound", boundPath: "/trusted/root", action: "status" } },
    ]);
  });

  it("rejects a stale response after rebind without exposing the old memory", async () => {
    let resolveRead!: (value: unknown) => void;
    let notifyRead!: () => void;
    const readStarted = new Promise<void>(resolve => { notifyRead = resolve; });
    const { sidecar, launch, probe } = fixture(async () => {
      notifyRead();
      return new Promise(resolve => { resolveRead = resolve; });
    });
    await launch("bound", "/trusted/root");
    const reading = probe("project.autoMemory.agentList", { sessionId: "bound" });
    const rejected = expect(reading).rejects.toThrow("binding changed");
    await readStarted;
    sidecar.setProjectInstructionRoot("bound", "/new/root");
    resolveRead({ memory: { content: "old private memory", entries: [] }, autoRecordEnabled: true });
    await rejected;
    await expect(probe("project.autoMemory.agentList", { sessionId: "bound" })).rejects.toThrow("bound project session");
  });

  it("fails closed without a host", async () => {
    const sidecar = new AgentSidecar({ launch: { command: process.execPath, args: ["-e", child] }, onStderr: () => {} });
    sidecars.push(sidecar);
    await expect(sidecar.call("probe", { method: "project.autoMemory.agentList", params: { sessionId: "bound" } })).rejects.toThrow("host unavailable");
  });
});
