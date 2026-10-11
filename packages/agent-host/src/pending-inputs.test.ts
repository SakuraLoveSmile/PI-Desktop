import { describe, expect, it, vi } from "vitest";
import type { AskToolRequest } from "@pi-desktop/shared";
import { AgentHost } from "./agent-host.js";
import { MemoryQueueStore, type Principal, type QueuedTurnRecord } from "./ports.js";

const owner: Principal = { subject: "desktop", roles: ["owner"], pairedDevice: true };
const request: AskToolRequest = { requestId: "ask", sessionId: "lead", toolCallId: "call", questions: [{ question: "Resume?", options: ["Review"] }], teamPending: { deferredAt: new Date(0).toISOString(), requiresNewApproval: true } };

function fixture(readDurableInputs?: ConstructorParameters<typeof AgentHost>[0]["readDurableInputs"]) {
  const prompts: unknown[]=[];
  const host=new AgentHost({ readDurableInputs,
    runtime: { prompt: async input => { prompts.push(input); return { turnId:"new-user-turn" }; }, stop:async()=>({ requested:true }),abort:async()=>{},respondInput:async()=>{},isBusy:()=>false },
    sessions: { get:async id=>({ id,title:"Lead",mode:"agent",permissionMode:"ask",planningState:"inactive",createdAt:new Date(0).toISOString(),updatedAt:new Date(0).toISOString() }), history:async()=>({ items:[],hasMore:false }) },
    approvals: { resolveTool:async()=>{},resolveContract:async()=>{},listPendingTools:async()=>[] },
    queueStore:new MemoryQueueStore(),
  });
  return { host,prompts };
}

describe("durable Team inputs",()=>{
  it("preserves interruption through the complete deferred-ask terminal event sequence",async()=>{
    const {host}=fixture();
    const events:Array<{kind:string}>=[];
    host.subscribe(owner,{scope:"session",sessionId:"lead"},{deliver:event=>events.push(event),close:()=>{}});
    const emit=(event:import("@pi-desktop/shared").AgentEvent)=>host.ingest({sessionId:"lead",turnId:"original-turn",ts:Date.now(),event});
    emit({type:"agent_start"});
    emit({type:"asktool_request",request:{...request,teamManaged:true}});
    emit({type:"error",error:{code:"TURN_ABORTED",message:"Question pending after 30 minutes",retriable:false}});
    emit({type:"turn_end"});
    emit({type:"agent_end",messageIds:[]});
    expect(host.getTurn("original-turn").status).toBe("interrupted");
    expect(events.filter(event=>event.kind==="turn.interrupted")).toHaveLength(1);
    expect(events.some(event=>event.kind==="turn.completed")).toBe(false);
    expect(host.pendingInputRequests("lead")).toHaveLength(1);
  });

  it("restores a pending question in a fresh RACP snapshot and enforces input/respond roles",async()=>{
    let pending=true;
    const {host}=fixture(async()=>pending?[{request,turnId:"old-interrupted-turn"}]:[]);
    const snapshot=await host.snapshot("lead");
    expect(snapshot.pendingInputs[0]).toMatchObject({ id:"ask",turnId:"old-interrupted-turn",teamPending:request.teamPending });
    await expect(host.respondInput({subject:"viewer",roles:["viewer"]},{inputId:"ask",answers:[["Review"]],context:{requestId:"respond"}})).rejects.toMatchObject({code:"FORBIDDEN"});
    pending=false;await host.respondInput(owner,{inputId:"ask",answers:[["Review"]],context:{requestId:"respond"}});
    expect((await host.snapshot("lead")).pendingInputs).toEqual([]);
  });

  it("does not resurrect an answered input from an older Host read",async()=>{
    let release:((value:Array<{request:AskToolRequest;turnId:string}>)=>void)|undefined;
    const {host}=fixture(()=>new Promise(resolve=>{release=resolve;}));
    const read=host.refreshPendingInputs("lead");
    host.closePendingInput("lead","ask");
    release!([{request,turnId:"old-turn"}]);await read;
    expect(host.pendingInputRequests("lead")).toEqual([]);
  });

  it("admits a persisted answer once and sends normal user input without old execution metadata",async()=>{
    const {host,prompts}=fixture();
    const record:QueuedTurnRecord={id:"asktool-answer:ask",sessionId:"lead",principalSubject:"desktop",userMessageId:"asktool-answer:ask",content:"User answer: Review",effectivePermissionMode:"ask",inputHash:"fixture",createdAt:0};
    await host.admitPersistedAnswer(owner,record);
    await vi.waitFor(()=>expect(prompts).toHaveLength(1));
    await host.admitPersistedAnswer(owner,record);
    expect(prompts).toEqual([expect.objectContaining({sessionId:"lead",userMessageId:record.userMessageId,content:record.content})]);
    expect(host.queue.list("lead")).toEqual([]);
    await expect(host.admitPersistedAnswer({subject:"viewer",roles:["viewer"]},record)).rejects.toMatchObject({code:"FORBIDDEN"});
  });
});
