// Controlled-clock Node runtime + real Main services. Rust test owns the RPC endpoint.
import assert from "node:assert/strict";
import { createInterface } from "node:readline";
import { register } from "node:module";
import { mock } from "node:test";

register(new URL("../helpers/ts-import-hooks.mjs", import.meta.url));
const { DesktopAgentRuntime } = await import("../../../../packages/agent-runtime/dist/index.js");
const { createPlanRuntime } = await import("../../electron/main/runtime/plans.ts");
const { createSessionCoordination } = await import("../../electron/main/runtime/session-coordination.ts");
const { createEventPersistence } = await import("../../electron/main/runtime/event-persistence.ts");
const { createAgentHostBridge } = await import("../../electron/main/agent-host-bridge.ts");
const { PersistenceOutbox } = await import("../../electron/main/persistence-outbox.ts");
const { InflightCheckpointer } = await import("../../../../packages/host-runtime/dist/index.js");
const { createAssistantMessageEventStream } = await import("../../../../packages/agent-runtime/node_modules/@earendil-works/pi-ai/dist/index.js");
const { IPC } = await import("@pi-desktop/shared");
const input=createInterface({input:process.stdin});
const pending=new Map();let sequence=0;
input.on("line",line=>{
  const response=JSON.parse(line);const entry=pending.get(response.id);pending.delete(response.id);
  if(response.error) entry.reject(Object.assign(new Error(response.error.message),{errorCode:response.error.data?.errorCode}));
  else entry.resolve(response.result);
});
const calls=[];
const host={isAvailable:()=>true,async call(method,params={}){
  calls.push({method,params});const id=++sequence;
  const result=await new Promise((resolve,reject)=>{pending.set(id,{resolve,reject});process.stdout.write(JSON.stringify({id,method,params})+"\n");});
  if(method==="team.registerLeadAsk") mock.timers.setTime(result.deadlineMs-1800000);
  return result;
}};

let runtime;let checkpointer;
try {
  const {provider}=await host.call("providers.create",{name:"Goal ask replay",vendorKey:"custom",authKind:"none",apiStyle:"chat_completions",baseUrl:"http://127.0.0.1:9/v1",defaultModelId:"fixture",models:[{id:"fixture",thinkingLevels:["off"]}]});
  const {session}=await host.call("session.create",{title:"Team Goal ask replay",mode:"agent",executionProfile:"team",providerId:provider.id,modelId:"fixture",permissionMode:"ask"});
  const {turnId:negotiation}=await host.call("session.beginTurn",{sessionId:session.id});
  await host.call("plans.enter",{sessionId:session.id,turnId:negotiation,toolCallId:"enter",requestedMode:"goal",kind:"goal"});
  const {proposal}=await host.call("plans.submit",{sessionId:session.id,turnId:negotiation,toolCallId:"submit",title:"Bounded Goal",markdown:"# Goal\n\nAsk a bounded user question before continuing.\n",question:"Approve?",kind:"goal"});
  await host.call("session.endTurn",{turnId:negotiation,status:"completed",createNotification:false});
  const {execution}=await host.call("plans.resolve",{proposalId:proposal.id,sessionId:session.id,turnId:proposal.turnId,toolCallId:proposal.toolCallId,version:proposal.version,action:"approve",targetPermissionMode:"ask"});
  const activeTurns=new Map();const coordination=createSessionCoordination({activeTurns,getMainWindow:()=>null,getViewingSessionId:()=>null});
  const executionIds=new Map();const executionTurns=new Map();const activeTools=new Map();const submissionTurns=new Set();
  const outbox=new PersistenceOutbox(process.argv[2],()=>{});
  checkpointer=new InflightCheckpointer(value=>host.call("session.saveInflight",value));
  const runtimeState={host};const finished=new Set();const finishes=[];const events=[];
  let resolveExecution;const executionSettled=new Promise(resolve=>{resolveExecution=resolve;});
  let resolveAsk;const askSeen=new Promise(resolve=>{resolveAsk=resolve;});
  let running;let token;
  const sidecar={async call(method,params){
    assert.equal(method,"agent.executeApprovedPlan");
    running=runtime.executeApprovedPlan(params.execution,params.turnId);
    return {accepted:true};
  }};
  runtimeState.sidecar=sidecar;
  const bridge=createAgentHostBridge({channels:IPC.invoke,getHost:()=>host,isSessionBusy:coordination.isSessionBusy,log(){},invoke:async()=>{throw new Error("Unexpected user prompt or old-token replay");}});
  runtimeState.agentHostBridge=bridge;
  const plan=createPlanRuntime({runtimeState,planState:{approvedExecutionDrain:null},logger:{app(){}},sendToRenderer(){},coordination,
    scheduledRunsBySession:new Map(),activeToolCalls:activeTools,planSubmissionTurnIds:submissionTurns,approvedExecutionIdsBySession:executionIds,claimedExecutionSessions:new Map(),approvedExecutionTurns:executionTurns,
    startedApprovedExecutions:new Set(),finishedApprovedExecutions:finished,dispatchingApprovedExecutions:new Set(),inFlightExecutionFinishes:new Set(),pendingExecutionFinishes:new Map(),announceTurnEnded(){},emitAgentEvent(){},
    acquireSessionOperation:coordination.acquireSessionOperation,resolveAgentRuntimeLaunch:async()=>({providerId:provider.id,modelId:"fixture",sidecarParams:{sessionId:session.id}}),isQuitting:()=>false,persistenceOutbox:outbox,
  });
  const persistence=createEventPersistence({runtimeState,steeringReplies:new Set(),activeTurns,activeToolCalls:activeTools,activeToolCallKey:coordination.activeToolCallKey,approvedExecutionIdsBySession:executionIds,approvedExecutionTurns:executionTurns,
    planSubmissionTurnIds:submissionTurns,planSubmissionTurnKey:coordination.planSubmissionTurnKey,inflightCheckpointer:checkpointer,persistenceOutbox:outbox,addActiveTurnUsage:coordination.addActiveTurnUsage,logger:{app(){}},finishTurn:plan.finishTurn,
    lockExecutionInterruption:plan.lockExecutionInterruption,isStaleTerminalEvent:coordination.isStaleTerminalEvent,
    finishApprovedExecution:(...args)=>{const promise=plan.finishApprovedExecution(...args);finishes.push(promise);promise.then(()=>{if(finished.has(execution.id))resolveExecution();});return promise;},emitAgentEvent(){},
  });
  const runtimeHost={async call(method,params){const result=await host.call(method,params);if(method==="goalProgress.issueToken")token=result.writeToken;return result;}};
  runtime=new DesktopAgentRuntime({host:runtimeHost,sessionId:session.id,mode:"agent",executionProfile:"team",teamContext:{teamSessionId:session.id,callerSessionId:session.id,isLead:true},
    provider:{id:provider.id,name:"Fixture",baseUrl:"http://127.0.0.1:9/v1",modelId:"fixture",apiKey:"",authKind:"none",modelConfig:{source:"generic",name:"Fixture",baseUrl:"http://127.0.0.1:9/v1",reasoning:false,input:["text"],cost:{input:0,output:0,cacheRead:0,cacheWrite:0},contextWindow:128000,maxTokens:2048}},
    commandShell:{id:"bash",label:"Bash",dialect:"posix",available:true,isDefault:true},thinkingLevel:"off",
    onEvent:envelope=>{events.push(envelope);bridge.ingest(envelope);persistence.persistAgentEvent(envelope);if(envelope.event.type==="asktool_request"&&!envelope.event.request.teamPending)resolveAsk(envelope);},
  });
  runtime.models={streamSimple:()=>{
    const message={role:"assistant",api:"openai-completions",provider:provider.id,model:"fixture",timestamp:Date.now(),stopReason:"toolUse",usage:{input:1,output:1,cacheRead:0,cacheWrite:0,totalTokens:2,cost:{input:0,output:0,cacheRead:0,cacheWrite:0,total:0}},
      content:[{type:"toolCall",id:"ask-call",name:"asktool",arguments:{questions:[{question:"Confirm a recovery choice?",options:["Review","Wait"]}]}}]};
    const stream=createAssistantMessageEventStream();queueMicrotask(()=>{stream.push({type:"start",partial:message});stream.push({type:"done",reason:"toolUse",message});stream.end(message);});return stream;
  }};
  mock.timers.enable({apis:["setTimeout","Date"],now:Date.now()});
  await plan.dispatchApprovedPlan(execution);
  const askEnvelope=await askSeen;
  assert.equal(runtime.getStatus().isRunning,true);
  mock.timers.tick(1800000);
  await running;
  await coordination.waitForTurnSettlement(session.id,askEnvelope.turnId);
  await executionSettled;
  await Promise.all(finishes);
  await outbox.flush(()=>host);
  assert.equal(finished.has(execution.id),true);
  assert.equal(bridge.agentHost.getTurn(askEnvelope.turnId).status,"interrupted");
  assert.equal(events.some(e=>e.event.type==="asktool_request"&&e.event.request.teamPending),true);
  assert.deepEqual(calls.filter(c=>c.method==="plans.finishExecution").map(c=>c.params.status),["interrupted"]);
  assert.equal(calls.some(c=>c.method==="goalReports.finalizeReport"||c.method==="goalReports.submitDraft"),false);
  assert.ok(typeof token === "string" && token.startsWith("gptk_"), "a genuine pre-interruption token was issued");
  await assert.rejects(host.call("goalProgress.update",{sessionId:session.id,executionId:execution.id,writeToken:token,items:[]}),error=>["GOAL_PROGRESS_NOT_RUNNING","UNAUTHORIZED"].includes(error.errorCode));
  const restored=await bridge.pendingInteractiveRequests(session.id);
  assert.equal(restored.asks.length,1);assert.ok(restored.asks[0].teamPending);
  process.stderr.write("PASS Team approved Goal ask: runtime → Main → Rust interrupted, no successful report, old token rejected\n");
  await host.call("__fixture.done",{sessionId:session.id,executionId:execution.id});
} catch(error) {process.stderr.write(String(error.stack??error)+"\n");process.exitCode=1;}
finally {mock.timers.reset();checkpointer?.dispose();await runtime?.dispose();input.close();process.stdin.destroy();}
