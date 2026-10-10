import assert from 'node:assert/strict';
import { register } from 'node:module';
import test from 'node:test';
import { IPC, IPC_WHITELIST } from '@pi-desktop/shared';
register(new URL('./helpers/ts-import-hooks.mjs', import.meta.url));
const { registerSessionActivityIpc }=await import('../electron/main/ipc/session-activity-ipc.ts');
function setup(){const handlers=new Map();const calls=[];registerSessionActivityIpc({handle:(channel,fn)=>handlers.set(channel,fn),getHost:()=>({call:async(method,params)=>{calls.push({method,params});return {ok:true};}})});return {handlers,calls};}

test('notes and process IPC preserve explicit session ownership and CAS across public channels', async()=>{
  const {handlers,calls}=setup();
  await handlers.get(IPC.invoke.sessionNotesSet)({sessionId:'a',content:'\n 中文🙂\n',expectedRevision:7});
  await handlers.get(IPC.invoke.backgroundProcessesRead)({sessionId:'a',id:'owned'});
  await handlers.get(IPC.invoke.backgroundProcessesStop)({sessionId:'b',id:'owned'});
  assert.deepEqual(calls,[
    {method:'sessionNotes.set',params:{sessionId:'a',content:'\n 中文🙂\n',expectedRevision:7}},
    {method:'backgroundProcesses.read',params:{sessionId:'a',id:'owned'}},
    {method:'backgroundProcesses.stop',params:{sessionId:'b',id:'owned'}},
  ]);
  for(const channel of handlers.keys()) assert.ok(IPC_WHITELIST.has(channel));
});

test('malformed and unsupported resource requests never reach Host',()=>{
 const {handlers,calls}=setup();
 for(const sessionId of ['',null,12,'remote:host:a','native-pi:a']) assert.throws(()=>handlers.get(IPC.invoke.sessionNotesGet)({sessionId}));
 for(const expectedRevision of [-1,1.5,'7',NaN]) assert.throws(()=>handlers.get(IPC.invoke.sessionNotesSet)({sessionId:'a',content:'x',expectedRevision}));
 assert.throws(()=>handlers.get(IPC.invoke.backgroundProcessesStop)({sessionId:'a',id:''}));
 assert.equal(calls.length,0);
});

test('complete session activity IPC forwards a bounded cursor and rejects foreign or malformed reads', async()=>{
  const {handlers,calls}=setup();
  await handlers.get(IPC.invoke.sessionActivityGet)({sessionId:'owned',offset:50});
  assert.deepEqual(calls,[{method:'sessionActivity.get',params:{sessionId:'owned',offset:50}}]);
  for(const offset of [-1,0.5,'50',NaN]) assert.throws(()=>handlers.get(IPC.invoke.sessionActivityGet)({sessionId:'owned',offset}));
  for(const sessionId of ['',null,'remote:a','native-pi:a']) assert.throws(()=>handlers.get(IPC.invoke.sessionActivityGet)({sessionId}));
  assert.equal(calls.length,1);
});
