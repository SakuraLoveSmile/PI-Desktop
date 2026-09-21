import { afterEach, expect, it, vi } from "vitest";
import { AgentSidecar, type SidecarHostLink } from "./agent-sidecar.js";

// A real stdio child forwards requested calls over the production reverse RPC.
const child = `const rl=require('node:readline').createInterface({input:process.stdin});
const pending=new Map(); rl.on('line',line=>{const m=JSON.parse(line);
if(m.method==='probe'){pending.set('r'+m.id,m.id);console.log(JSON.stringify({id:'r'+m.id,method:'host.proxy',params:m.params}));}
else if(pending.has(m.id)){console.log(JSON.stringify({...m,id:pending.get(m.id)}));pending.delete(m.id);}});`;
const sidecars: AgentSidecar[] = [];
afterEach(async () => {
  await Promise.all(sidecars.splice(0).map((sidecar) => sidecar.dispose()));
});
function harness(allowed = true) {
  const sidecar = new AgentSidecar({
    launch: { command: process.execPath, args: ["-e", child] },
    onStderr: () => {},
  });
  sidecars.push(sidecar);
  const calls: string[] = [];
  const host: SidecarHostLink = {
    async call<T>(method: string): Promise<T> {
      calls.push(method);
      return { ok: allowed, content: allowed ? { authorized: true } : "denied" } as T;
    },
    onNotification: () => () => {},
    onExit: () => () => {},
  };
  sidecar.setHost(host);
  const execute = (mode = "agent", toolCallId = "i") =>
    sidecar.call<{ ok: boolean }>("probe", {
      method: "tools.execute",
      params: {
        sessionId: "s",
        toolCallId,
        mode,
        toolName: "GenerateImages",
        args: { items: [{ prompt: "image" }] },
      },
    });
  return { sidecar, calls, execute };
}

it("authorizes image calls through the host before executing the local handler", async () => {
  const { sidecar, calls, execute } = harness();
  sidecar.setLocalTool("GenerateImages", async () => {
    calls.push("generated");
    return { ok: true, content: "image" };
  });
  expect((await execute()).ok).toBe(true);
  expect(calls).toEqual(["tools.execute", "generated"]);
});

it("denied and Plan calls never reach the image service", async () => {
  const { sidecar, execute } = harness(false);
  const generate = vi.fn().mockResolvedValue({ ok: true, content: "image" });
  sidecar.setLocalTool("GenerateImages", generate);
  expect((await execute()).ok).toBe(false);
  expect((await execute("plan")).ok).toBe(false);
  expect(generate).not.toHaveBeenCalled();
});

it("tools.abort reaches the in-flight request and still forwards host cancellation", async () => {
  const { sidecar, calls, execute } = harness();
  let started!: () => void;
  const ready = new Promise<void>((resolve) => {
    started = resolve;
  });
  sidecar.setLocalTool("GenerateImages", async ({ signal }) => {
    started();
    await new Promise<void>((resolve) =>
      signal.addEventListener("abort", () => resolve(), { once: true }),
    );
    return { ok: false, content: "cancelled" };
  });
  const pending = execute();
  await ready;
  await sidecar.call("probe", {
    method: "tools.abort",
    params: { sessionId: "s", toolCallId: "i" },
  });
  expect((await pending).ok).toBe(false);
  expect(calls).toEqual(["tools.execute", "tools.abort"]);
});
