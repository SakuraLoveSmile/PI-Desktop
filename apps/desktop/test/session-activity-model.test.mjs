import assert from 'node:assert/strict';
import { register } from 'node:module';
import test from 'node:test';
register(new URL('./helpers/ts-import-hooks.mjs', import.meta.url));
const { activityPlans, activityResources, activitySubagents } = await import('../src/features/chat/activity/session-activity-model.ts');
const { subagentAvatarVariant, subagentElapsed, subagentTimingIsLive, subagentRowText } = await import('../src/features/chat/activity/subagent-row-presentation.ts');
const msg = (id,role,content,extra={}) => ({id,role,content,createdAt:'2026-10-09T00:00:00Z',...extra});

test('activity plans remain session owned and deduplicate installed checkpoints', () => {
  const proposal={id:'plan',sessionId:'a',title:'Plan',status:'pending'};
  assert.deepEqual(activityPlans('a',proposal,proposal,[{...proposal,id:'b',sessionId:'b'}]),[proposal]);
  assert.deepEqual(activityPlans(undefined,proposal),[]);
});

test('actual task lifecycle updates the rail while progress remains readable', () => {
  const rows = activitySubagents([
    msg('task','tool','',{toolName:'Task',toolCallId:'call',toolStatus:'success',toolArgs:{agent:'reviewer',task:'Inspect'},toolResult:{details:{delegationId:'delegate',status:'running'}}}),
    msg('progress','assistant','Still working'),
    msg('wait','tool','',{toolName:'TaskWait',toolStatus:'success',toolResult:{details:{delegations:[{delegationId:'delegate',status:'completed'}]}}}),
  ],false);
  assert.equal(rows.length,1);
  assert.equal(rows[0].delegationId,'delegate');
  assert.equal(rows[0].agentName,'reviewer');
  assert.equal(rows[0].task,'Inspect');
  assert.equal(rows[0].status,'completed');
});

test('only recorded successful writes and safe captured sources become resources', () => {
  const resources=activityResources([
    msg('claim','assistant','Created fake.md'),
    msg('failed','tool','',{toolName:'Edit',toolStatus:'error',toolArgs:{path:'broken.md'}}),
    msg('edit','tool','',{toolName:'Edit',toolStatus:'success',toolArgs:{path:'real.md'}}),
    msg('source','assistant','',{hostedSearch:{status:'completed',rounds:[{id:'s',status:'completed',sources:[
      {url:'https://docs.example.org/start',title:'Docs'},
      {url:'javascript:alert(1)',title:'Unsafe'},
      {url:'https://user:password@example.org',title:'Credential URL'},
      {url:'not a URL',title:'Invalid'},
    ]}]}}),
  ]);
  assert.deepEqual(resources.changedFiles.map(x=>x.path),['real.md']);
  assert.deepEqual(resources.websites,[{id:'https://docs.example.org/start',label:'Docs',url:'https://docs.example.org/start',domain:'docs.example.org',sourceCount:1}]);
  assert.deepEqual(resources.references.memory,[]);
});

test('a background start receipt is not a successful command exit', async()=>{
  const {isBackgroundProcessStart}=await import('../src/lib/tool-presentation.ts');
  const receipt={toolName:'Bash',toolStatus:'success',toolResult:{details:{backgroundProcessId:'job',status:'starting'}}};
  assert.equal(isBackgroundProcessStart(receipt),true);
  assert.equal(isBackgroundProcessStart({...receipt,toolStatus:'error'}),false);
  assert.equal(isBackgroundProcessStart({...receipt,toolName:'plugin_example_Bash'}),false);
  assert.equal(isBackgroundProcessStart({...receipt,toolResult:{details:{exitCode:0}}}),false);
});

test('subagent rows use lifecycle runtime rather than the initial Task receipt duration', () => {
  const task = msg('task','tool','',{toolName:'Task',toolCallId:'call',toolStatus:'success',toolDurationMs:12,
    toolArgs:{agent:'researcher',task:'Verify ecosystem'},
    toolResult:{details:{delegationId:'delegate',status:'running',startedAt:1000}}});
  const live = activitySubagents([task],true)[0];
  assert.deepEqual(live.timing,{startedAt:1000});
  assert.equal(subagentTimingIsLive(live.status,live.timing),true);
  assert.equal(subagentElapsed(live.status,live.timing,11000),'10s');
  assert.equal(subagentElapsed(live.status,live.timing,12000),'11s');

  const settled = activitySubagents([task,msg('wait','tool','',{toolName:'TaskWait',toolStatus:'success',
    toolResult:{details:{delegations:[{delegationId:'delegate',status:'completed',startedAt:1000,completedAt:56000}]}}})],false)[0];
  assert.deepEqual(settled.timing,{startedAt:1000,completedAt:56000});
  assert.equal(subagentTimingIsLive(settled.status,settled.timing),false);
  assert.equal(subagentElapsed(settled.status,settled.timing,100000),'55s');
  assert.equal(subagentElapsed(settled.status,settled.timing,500000),'55s');
});

test('terminal subagent statuses remain distinct and never invent an elapsed end', () => {
  for (const status of ['completed','failed','stopped','aborted','timed_out','denied']) {
    const row = activitySubagents([msg('task','tool','',{toolName:'Task',toolStatus:'success',
      toolResult:{details:{delegationId:'delegate',status,startedAt:1000}}})],false)[0];
    assert.equal(row.status,status);
    assert.equal(subagentTimingIsLive(row.status,row.timing),false);
    assert.equal(subagentElapsed(row.status,row.timing,90000),undefined);
    assert.equal(subagentElapsed(status,{startedAt:1000,completedAt:26000},90000),'25s');
  }
  assert.equal(subagentElapsed('running',undefined,90000),undefined);
  assert.equal(subagentElapsed('completed',{completedAt:50000},90000),undefined);
  assert.equal(subagentElapsed('completed',{startedAt:1000,completedAt:0},90000),undefined);
});

test('inline subagent text keeps real names and task details with deterministic decorative avatars', () => {
  const task = 'Verify Flutter plugin ecosystem';
  assert.equal(subagentRowText('ecosystem-research',task,'Subagent Completed','55s'),
    'ecosystem-research · Verify Flutter plugin ecosystem · Subagent Completed 55s');
  assert.equal(subagentRowText('architect',undefined,'Subagent Failed',undefined),'architect · Subagent Failed');
  assert.equal(subagentRowText('Team member','Design',undefined,undefined),'Team member · Design');
  for (const id of ['delegate-a','delegate-b','team:member']) {
    assert.equal(subagentAvatarVariant(id),subagentAvatarVariant(id));
    assert.ok([0,1,2].includes(subagentAvatarVariant(id)));
  }
});

test('row text bounds a long multi-line delegation brief to one excerpt', () => {
  const brief = `你是只读代码复核者。\n\n工作树：/tmp/worktree\n${'检查边界条件与错误处理。'.repeat(20)}`;
  const label = subagentRowText('code-reviewer',brief,'Subagent Running','3m 12s');
  assert.equal(label.includes('\n'),false,label);
  assert.ok(label.startsWith('code-reviewer · 你是只读代码复核者。 工作树：/tmp/worktree 检查边界条件'),label);
  assert.ok(label.endsWith('… · Subagent Running 3m 12s'),label);
  assert.ok([...label].length <= 200,`row text is ${[...label].length} characters`);
});
