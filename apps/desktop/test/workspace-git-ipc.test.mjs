import assert from 'node:assert/strict';
import { register } from 'node:module';
import test from 'node:test';
import { IPC, IPC_WHITELIST } from '@pi-desktop/shared';
register(new URL('./helpers/ts-import-hooks.mjs', import.meta.url));
const { registerWorkspaceGitIpc } = await import('../electron/main/ipc/workspace-git-ipc.ts');
function setup() {
 const handlers = new Map(); const calls=[];
 registerWorkspaceGitIpc({handle:(channel,handler)=>handlers.set(channel,handler),getHost:()=>({call:async(method,params)=>{calls.push({method,params});return {git:null};}})});
 return {handlers,calls};
}
test('Git IPC preserves owner and expected checkout identity through allowlisted channels',async()=>{
 const {handlers,calls}=setup();
 const request={projectPath:'/isolated/project',sessionId:'local',expectedHead:'abc',expectedBranch:'main',branch:'topic',arbitraryTarget:'/forbidden'};
 for(const channel of [IPC.invoke.workspaceGitGet,IPC.invoke.workspaceGitSwitch,IPC.invoke.workspaceGitCreateBranch,IPC.invoke.workspaceGitCreateWorktree]) {
  assert.ok(IPC_WHITELIST.has(channel));await handlers.get(channel)(request);
 }
 assert.deepEqual(calls[0],{method:'workspace.git.get',params:{projectPath:request.projectPath,sessionId:'local'}});
 assert.deepEqual(calls.slice(1).map(call=>call.method),['workspace.git.switchBranch','workspace.git.createBranch','workspace.git.createWorktree']);
 for(const call of calls.slice(1)) {assert.equal(call.params.expectedBranch,'main');assert.equal(call.params.expectedHead,'abc');assert.equal(call.params.branch,'topic');assert.ok(!('arbitraryTarget' in call.params));}
});
test('invalid owners and missing CAS fields cannot reach native Git',()=>{
 const {handlers,calls}=setup();const handler=handlers.get(IPC.invoke.workspaceGitSwitch);
 const valid={projectPath:'/isolated/project',sessionId:'local',expectedHead:null,expectedBranch:null,branch:'topic'};
 for(const patch of [{projectPath:'relative'},{sessionId:'remote:h:s'},{sessionId:'native-pi:a'},{sessionId:12},{sessionId:''},{branch:''},{expectedHead:undefined},{expectedBranch:42}])assert.throws(()=>handler({...valid,...patch}));
 assert.equal(calls.length,0);
});
