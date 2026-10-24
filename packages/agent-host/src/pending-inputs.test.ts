import { describe, expect, it, vi } from "vitest";
import type { AskToolRequest } from "@pi-desktop/shared";
import { AgentHost } from "./agent-host.js";
import { MemoryQueueStore, type Principal, type QueuedTurnRecord, type RuntimePort } from "./ports.js";

const owner: Principal = { subject: "desktop", roles: ["owner"], pairedDevice: true };
const request: AskToolRequest = { requestId: "ask", sessionId: "lead", toolCallId: "call", questions: [{ question: "Resume?", options: ["Review"] }], teamPending: { deferredAt: new Date(0).toISOString(), requiresNewApproval: true } };

function fixture(readDurableInputs?: ConstructorParameters<typeof AgentHost>[0]["readDurableInputs"], isBusy = () => false, steer?: RuntimePort["steer"]) {
  const prompts: unknown[]=[];
  const host=new AgentHost({ readDurableInputs,
    runtime: { prompt: async input => { prompts.push(input); return { turnId:"new-user-turn" }; }, stop:async()=>({ requested:true }),abort:async()=>{},respondInput:async()=>{},isBusy, ...(steer ? { steer } : {}) },
    sessions: { get:async id=>({ id,title:"Lead",mode:"agent",permissionMode:"ask",planningState:"inactive",createdAt:new Date(0).toISOString(),updatedAt:new Date(0).toISOString() }), history:async()=>({ items:[],hasMore:false }) },
    approvals: { resolveTool:async()=>{},resolveContract:async()=>{},listPendingTools:async()=>[] },
    queueStore:new MemoryQueueStore(),
  });
  return { host,prompts };
}

function answerRecord(): QueuedTurnRecord {
  return { id: "asktool-answer:ask", sessionId: "lead", principalSubject: "desktop",
    userMessageId: "asktool-answer:ask", content: "User answer: Review",
    effectivePermissionMode: "ask", inputHash: "fixture", createdAt: 0 };
}

async function holdQueuedWork(host: AgentHost) {
  host.queue.hold("lead", "team:lead");
  await host.enqueueTurn(owner, { sessionId: "lead", input: { text: "Restored user work" },
    context: { requestId: "restored-user-work" } });
  await host.enqueueTeamMessage(owner, { sessionId: "lead", idempotencyKey: "team-message:mail",
    input: { text: "Held expert report", sessionMessageId: "mail" }, context: { requestId: "mail" } });
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

  it("starts only the authenticated live answer while its Team and restored expert mail stay held", async () => {
    const { host, prompts } = fixture();
    await holdQueuedWork(host);
    host.queue.hold("lead", "restore");
    const record = answerRecord();
    await host.admitPersistedAnswer(owner, record);
    await vi.waitFor(() => expect(prompts).toHaveLength(1));
    expect(prompts).toEqual([expect.objectContaining({ content: record.content, userMessageId: record.id })]);
    expect(prompts[0]).not.toHaveProperty("sessionMessageId");
    expect(host.queue.list("lead")).toEqual([
      expect.objectContaining({ content: "Restored user work" }),
      expect.objectContaining({ sessionMessageId: "mail" }),
    ]);
    expect(host.queue.isHeld("lead")).toBe(true);
    await host.admitPersistedAnswer(owner, record);
    expect(prompts).toHaveLength(1);
    await expect(host.admitPersistedAnswer(owner, { ...record, userMessageId: "different-answer" }))
      .rejects.toMatchObject({ code: "FORBIDDEN" });
    host.ingest({ sessionId: "lead", turnId: "new-user-turn", ts: Date.now(), event: { type: "agent_end", messageIds: [] } });
    await host.startTurn(owner, { sessionId: "lead", admission: "queue", input: { text: "Other work" },
      context: { requestId: "other" } });
    expect(prompts).toHaveLength(1);
    expect(host.queue.list("lead")).toHaveLength(3);
    expect(host.queue.isHeld("lead")).toBe(true);
  });

  it.each(["delivery-barrier", "team:other"])("keeps a live answer queued behind independent hold %s", async (hold) => {
    const { host, prompts } = fixture();
    await holdQueuedWork(host);
    host.queue.hold("lead", hold);
    await host.admitPersistedAnswer(owner, answerRecord());
    // Joining the admission gate provides a deterministic drain boundary.
    await host.startTurn(owner, { sessionId: "lead", admission: "queue", input: { text: "Other work" },
      context: { requestId: "other" } });
    expect(prompts).toEqual([]);
    expect(host.queue.find("asktool-answer:ask")).toBeDefined();
    host.queue.resume("lead", hold);
    host.kick("lead");
    await vi.waitFor(() => expect(prompts).toHaveLength(1));
    expect(prompts[0]).toMatchObject({ userMessageId: "asktool-answer:ask" });
    expect(host.queue.list("lead")).toHaveLength(3);
    expect(host.queue.isHeld("lead")).toBe(true);
  });

  it("never treats an unanswered restore read as a fresh authenticated answer", async () => {
    const { host, prompts } = fixture();
    await holdQueuedWork(host);
    await host.admitPersistedAnswer(owner, answerRecord(), true);
    await host.attach(owner, { sessionId: "lead" });
    await host.startTurn(owner, { sessionId: "lead", admission: "queue", input: { text: "Other work" },
      context: { requestId: "other" } });
    expect(prompts).toEqual([]);
    expect(host.queue.find("asktool-answer:ask")).toBeDefined();
    expect(host.queue.isHeld("lead")).toBe(true);
  });

  it("does not steer promoted ordinary work or expert mail into the live answer across a Team hold", async () => {
    const steer = vi.fn(async () => ({ accepted: true }));
    const { host, prompts } = fixture(undefined, () => false, steer);
    await holdQueuedWork(host);
    for (const record of host.queue.list("lead")) await host.prioritizeTurn(owner, record.id);
    const promoted = host.queue.list("lead");
    expect(promoted.every(record => record.priority !== undefined)).toBe(true);
    await host.admitPersistedAnswer(owner, answerRecord());
    await vi.waitFor(() => expect(prompts).toHaveLength(1));
    await host.startTurn(owner, { sessionId: "lead", admission: "queue", input: { text: "Other work" },
      context: { requestId: "other" } });
    expect(steer).not.toHaveBeenCalled();
    expect(host.queue.list("lead").slice(0, 2)).toEqual(promoted);
    expect(host.queue.isHeld("lead")).toBe(true);
    host.ingest({ sessionId: "lead", turnId: "new-user-turn", ts: Date.now(),
      event: { type: "agent_end", messageIds: [] } });
    await host.startTurn(owner, { sessionId: "lead", admission: "queue", input: { text: "Still held" },
      context: { requestId: "still-held" } });
    expect(prompts).toHaveLength(1);
    expect(steer).not.toHaveBeenCalled();
    expect(host.queue.list("lead").slice(0, 2)).toEqual(promoted);
    expect(host.queue.isHeld("lead")).toBe(true);
  });

  it.each(["runtime", "planning", "active"])("preserves %s occupancy before admitting the live answer", async (gate) => {
    let busy = gate === "runtime";
    const { host, prompts } = fixture(undefined, () => busy);
    if (gate === "active") await host.startTurn(owner, { sessionId: "lead", input: { text: "Active work" },
      context: { requestId: "active" } });
    if (gate === "planning") host.ingest({ sessionId: "lead", ts: Date.now(),
      event: { type: "planning_state", state: "awaiting_approval", kind: "goal", proposalId: "proposal", title: "Goal", question: "Approve?" } });
    await holdQueuedWork(host);
    const before = prompts.length;
    await host.admitPersistedAnswer(owner, answerRecord());
    await host.startTurn(owner, { sessionId: "lead", admission: "queue", input: { text: "Other work" },
      context: { requestId: "other" } });
    expect(prompts).toHaveLength(before);
    if (gate === "active") host.ingest({ sessionId: "lead", turnId: "new-user-turn", ts: Date.now(),
      event: { type: "agent_end", messageIds: [] } });
    if (gate === "planning") host.ingest({ sessionId: "lead", ts: Date.now(),
      event: { type: "planning_state", state: "inactive" } });
    busy = false;
    host.kick("lead");
    await vi.waitFor(() => expect(prompts).toHaveLength(before + 1));
    expect(prompts.at(-1)).toMatchObject({ userMessageId: "asktool-answer:ask" });
    expect(host.queue.list("lead")).toHaveLength(3);
    expect(host.queue.isHeld("lead")).toBe(true);
  });
});
