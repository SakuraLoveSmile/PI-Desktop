import assert from 'node:assert/strict';
import { register } from 'node:module';
import test from 'node:test';
import { IPC, IPC_WHITELIST } from '@pi-desktop/shared';
register(new URL('./helpers/ts-import-hooks.mjs', import.meta.url));
const { registerSessionSummaryIpc } = await import('../electron/main/ipc/session-summary-ipc.ts');

const STORED = {
  sessionId: 's1',
  text: 'Older note.',
  revision: 3,
  basedOnMessageCount: 4,
  updatedAt: '2026-11-22T01:00:00.000Z',
  behind: 2,
  diverged: false,
};
const note = (over = {}) => ({ ...STORED, ...over });
const rows = () => [
  { id: 'm1', role: 'user', content: 'Pin a summary card to the rail' },
  { id: 'm2', role: 'assistant', content: 'On it; the Host store comes first.' },
];

function setup(config = {}) {
  const handlers = new Map();
  const calls = [];
  const logs = [];
  const launches = [];
  const summaries = [];
  const clock = { now: 1_000_000 };
  const world = {
    settings: {},
    state: { summary: null, messageCount: 2 },
    session: { messageCount: 2, title: 'Rail work', providerId: 'p1', modelId: 'm1', permissionMode: 'inherit', team: null, messages: rows() },
    ...config,
  };
  const host = {
    call: async (method, params) => {
      calls.push({ method, params });
      if (method === 'settings.get') return world.settings;
      if (method === 'sessionSummary.get') {
        if (world.getError) throw world.getError;
        return world.state;
      }
      if (method === 'session.get') return { session: world.session };
      if (method === 'sessionSummary.set') {
        if (world.setError) throw world.setError;
        if (world.setResult) return world.setResult;
        return { summary: note({ text: params.text, revision: params.expectedRevision + 1, basedOnMessageCount: params.basedOnMessageCount, behind: 0 }) };
      }
      throw new Error(`unexpected Host method ${method}`);
    },
  };
  const launch = world.launch ?? { providerId: 'p1', modelId: 'm1', sidecarParams: { provider: { id: 'p1', authKind: 'apiKey', apiKey: 'k' } } };
  registerSessionSummaryIpc({
    handle: (channel, fn) => handlers.set(channel, fn),
    getHost: () => (world.noHost ? null : host),
    logger: { app: (...args) => logs.push(args) },
    vendorOAuth: { resolveAuth: async (providerId) => ({ token: `token-for-${providerId}` }) },
    resolveAgentRuntimeLaunch: async (...args) => {
      launches.push(args);
      return launch;
    },
    summarize: async (provider, input, options) => {
      summaries.push({ provider, input, options });
      if (world.summarize) return world.summarize(provider, input, options);
      return { text: 'Fresh note.', included: input.messages.length };
    },
    now: () => clock.now,
    ...(world.timeoutMs ? { timeoutMs: world.timeoutMs } : {}),
  });
  const refresh = (value) => handlers.get(IPC.invoke.sessionSummaryRefresh)(value);
  const get = (value) => handlers.get(IPC.invoke.sessionSummaryGet)(value);
  return { handlers, calls, logs, launches, summaries, clock, refresh, get, world };
}

const methods = (calls) => calls.map((call) => call.method);

test('both channels are public and malformed or unsupported input never reaches the Host', async () => {
  const { handlers, calls, refresh, get } = setup();
  assert.deepEqual([...handlers.keys()].sort(), [IPC.invoke.sessionSummaryGet, IPC.invoke.sessionSummaryRefresh].sort());
  for (const channel of handlers.keys()) assert.ok(IPC_WHITELIST.has(channel));
  for (const bad of [undefined, null, 'a', [], { sessionId: '' }, { sessionId: '  ' }, { sessionId: 12 }, {}]) {
    await assert.rejects(refresh(bad), { errorCode: 'INVALID_ARGUMENT' });
    await assert.rejects(get(bad), { errorCode: 'INVALID_ARGUMENT' });
  }
  for (const sessionId of ['remote:host:a', 'native-pi:a']) {
    await assert.rejects(refresh({ sessionId }), { errorCode: 'SESSION_SUMMARY_UNSUPPORTED' });
    await assert.rejects(get({ sessionId }), { errorCode: 'SESSION_SUMMARY_UNSUPPORTED' });
  }
  for (const force of ['yes', 1, null]) {
    await assert.rejects(refresh({ sessionId: 's1', force }), { errorCode: 'INVALID_ARGUMENT' });
  }
  assert.equal(calls.length, 0);
});

test('an automatic refresh reads the transcript tail, asks the session model once and stores the note against the count it was written from', async () => {
  const { calls, logs, launches, summaries, refresh, world } = setup();
  const result = await refresh({ sessionId: 's1' });
  assert.equal(result.outcome, 'updated');
  assert.equal(result.summary.text, 'Fresh note.');
  assert.equal(result.summary.revision, 1);
  assert.equal(result.summary.basedOnMessageCount, 2);
  assert.deepEqual(calls, [
    { method: 'settings.get', params: undefined },
    { method: 'sessionSummary.get', params: { sessionId: 's1' } },
    { method: 'session.get', params: { id: 's1', messageLimit: 60, contentLimit: 1200 } },
    { method: 'sessionSummary.set', params: { sessionId: 's1', text: 'Fresh note.', basedOnMessageCount: 2, expectedRevision: 0 } },
  ]);
  assert.equal(launches.length, 1);
  const [launchId, sessionArg, settingsArg, overrides] = launches[0];
  assert.equal(launchId, 'session-summary:s1');
  assert.equal(sessionArg.id, 'session-summary:s1');
  assert.equal(sessionArg.projectPath, undefined);
  assert.deepEqual(overrides, { mode: 'agent', executionProfile: 'standard', providerId: 'p1', modelId: 'm1', thinkingLevel: 'off' });
  assert.equal(settingsArg, world.settings);
  assert.equal(summaries.length, 1);
  assert.deepEqual(summaries[0].input, { messages: [
    { role: 'user', content: 'Pin a summary card to the rail' },
    { role: 'assistant', content: 'On it; the Host store comes first.' },
  ] });
  assert.equal(summaries[0].options.sessionId, 's1');
  assert.equal(summaries[0].options.signal.aborted, false);
  assert.equal(summaries[0].provider.apiKey, 'k');
  assert.equal(logs.length, 1);
  assert.deepEqual(logs[0].slice(0, 3), ['session', 'info', 'session summary updated']);
  assert.ok(!JSON.stringify(logs).includes('Fresh note.'));
});

test('tool, system, thinking and nested agent rows never reach the model', async () => {
  const messages = [
    { id: '1', role: 'system', content: 'internal rules' },
    { id: '2', role: 'user', content: 'Run the build', attachments: [{ name: 'secret.pdf' }] },
    { id: '3', role: 'tool', content: 'build output with a token', toolName: 'Bash' },
    { id: '4', role: 'assistant', content: 'nested helper chatter', parentToolCallId: 'call_1' },
    { id: '5', role: 'assistant', content: 'tool echo', toolName: 'Task' },
    { id: '6', role: 'assistant', content: 'Build passed.', thinking: 'private reasoning' },
    { id: '7', role: 'user', content: 42 },
  ];
  const { summaries, refresh } = setup({ session: { messageCount: 7, messages } });
  await refresh({ sessionId: 's1' });
  assert.deepEqual(summaries[0].input.messages, [
    { role: 'user', content: 'Run the build' },
    { role: 'assistant', content: 'Build passed.' },
  ]);
  assert.ok(!JSON.stringify(summaries[0]).match(/internal rules|token|private reasoning|secret\.pdf|helper chatter/));
});

test('the new-message threshold and the interval gate automatic refreshes, and the refresh control skips both', async () => {
  const { calls, summaries, clock, refresh, world } = setup({ state: { summary: note({ behind: 1 }), messageCount: 5 } });
  const quiet = await refresh({ sessionId: 's1' });
  assert.deepEqual(quiet, { outcome: 'skipped', reason: 'not-behind', summary: note({ behind: 1 }) });
  assert.equal(summaries.length, 0);
  assert.ok(!methods(calls).includes('session.get'));

  world.state = { summary: note({ behind: 2 }), messageCount: 6 };
  assert.equal((await refresh({ sessionId: 's1' })).outcome, 'updated');
  assert.equal(summaries.length, 1);
  clock.now += 59_999;
  assert.deepEqual(await refresh({ sessionId: 's1' }), { outcome: 'skipped', reason: 'too-soon', summary: note({ behind: 2 }) });
  assert.equal(summaries.length, 1);
  clock.now += 1;
  assert.equal((await refresh({ sessionId: 's1' })).outcome, 'updated');
  assert.equal(summaries.length, 2);

  world.state = { summary: note({ behind: 0 }), messageCount: 4 };
  assert.equal((await refresh({ sessionId: 's1', force: true })).outcome, 'updated');
  assert.equal(summaries.length, 3);
  // The interval belongs to one session: another session is not held back by it.
  world.state = { summary: null, messageCount: 2 };
  assert.equal((await refresh({ sessionId: 's2' })).outcome, 'updated');
  assert.equal(summaries.length, 4);
});

test('the stored note continues the next one, but a rewound transcript starts fresh', async () => {
  const { summaries, calls, refresh, world } = setup({ state: { summary: note({ behind: 3 }), messageCount: 7 } });
  await refresh({ sessionId: 's1' });
  assert.equal(summaries[0].input.previousSummary, 'Older note.');
  assert.equal(calls.at(-1).params.expectedRevision, 3);

  world.state = { summary: note({ behind: 0, diverged: true, basedOnMessageCount: 9 }), messageCount: 2 };
  await refresh({ sessionId: 's1', force: true });
  assert.equal('previousSummary' in summaries[1].input, false);
  // Compare-and-set still names the stored revision, so a concurrent writer is still detected.
  assert.equal(calls.at(-1).params.expectedRevision, 3);

  world.state = { summary: note({ behind: 0, diverged: true, basedOnMessageCount: 9 }), messageCount: 2 };
  assert.equal((await refresh({ sessionId: 's9' })).outcome, 'updated');
});

test('one flight per session: a second ask joins the first and other sessions run alongside', async () => {
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const { summaries, refresh } = setup({ summarize: async () => { await gate; return { text: 'Joined note.', included: 2 }; } });
  const first = refresh({ sessionId: 's1' });
  const joined = refresh({ sessionId: 's1', force: true });
  const other = refresh({ sessionId: 's2' });
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(summaries.length, 2);
  release();
  const [a, b, c] = await Promise.all([first, joined, other]);
  assert.equal(a.outcome, 'updated');
  assert.deepEqual(b, a);
  assert.equal(c.outcome, 'updated');
  assert.equal(summaries.length, 2);
  assert.equal((await refresh({ sessionId: 's1', force: true })).outcome, 'updated');
  assert.equal(summaries.length, 3);
});

test('turning the setting off stops every refresh, forced ones included, before any model call', async () => {
  const { calls, summaries, launches, refresh, world } = setup({ settings: { autoSummarizeSessions: false } });
  for (const force of [false, true]) {
    assert.deepEqual(await refresh({ sessionId: 's1', force }), { outcome: 'skipped', reason: 'disabled', summary: null });
  }
  assert.deepEqual(methods(calls), ['settings.get', 'settings.get']);
  assert.equal(summaries.length + launches.length, 0);
  world.settings = { autoSummarizeSessions: true };
  assert.equal((await refresh({ sessionId: 's1' })).outcome, 'updated');
});

test('an empty session and a summarizer with nothing to describe store nothing', async () => {
  const empty = setup({ state: { summary: null, messageCount: 0 } });
  assert.deepEqual(await empty.refresh({ sessionId: 's1', force: true }), { outcome: 'skipped', reason: 'no-content', summary: null });
  assert.ok(!methods(empty.calls).includes('session.get'));
  assert.equal(empty.summaries.length, 0);

  const idle = setup({ summarize: async () => null });
  assert.deepEqual(await idle.refresh({ sessionId: 's1' }), { outcome: 'skipped', reason: 'no-content', summary: null });
  assert.ok(!methods(idle.calls).includes('sessionSummary.set'));
});

test('Team member and missing sessions are refused before any model call', async () => {
  const member = setup({ session: { messageCount: 2, team: { role: 'member' }, messages: rows() } });
  await assert.rejects(member.refresh({ sessionId: 's1', force: true }), { errorCode: 'SESSION_SUMMARY_UNSUPPORTED' });
  assert.equal(member.launches.length + member.summaries.length, 0);
  assert.ok(!methods(member.calls).includes('sessionSummary.set'));

  const lead = setup({ session: { messageCount: 2, team: { role: 'lead' }, messages: rows() } });
  assert.equal((await lead.refresh({ sessionId: 's1' })).outcome, 'updated');

  const missing = setup({ session: undefined });
  await assert.rejects(missing.refresh({ sessionId: 's1' }), { errorCode: 'NOT_FOUND' });
  assert.equal(missing.launches.length, 0);
});

test('a missing, older or failing Host surfaces a stable code and the log carries the code only', async () => {
  const none = setup({ noHost: true });
  await assert.rejects(none.refresh({ sessionId: 's1' }), { errorCode: 'HOST_UNAVAILABLE' });
  await assert.rejects(none.get({ sessionId: 's1' }), { errorCode: 'HOST_UNAVAILABLE' });

  const older = setup({ getError: Object.assign(new Error('method not found'), { errorCode: 'METHOD_NOT_FOUND' }) });
  await assert.rejects(older.get({ sessionId: 's1' }), { errorCode: 'METHOD_NOT_FOUND' });
  await assert.rejects(older.refresh({ sessionId: 's1' }), { errorCode: 'METHOD_NOT_FOUND' });
  assert.deepEqual(older.logs[0].slice(0, 3), ['session', 'warn', 'session summary failed']);
  assert.deepEqual(older.logs[0][3], { sessionId: 's1', data: { errorCode: 'METHOD_NOT_FOUND' } });

  const providerFailure = setup({ summarize: async () => { throw Object.assign(new Error('401 invalid key sk-secret'), { errorCode: 'PROVIDER_UNAUTHORIZED' }); } });
  await assert.rejects(providerFailure.refresh({ sessionId: 's1' }), { errorCode: 'PROVIDER_UNAUTHORIZED' });
  assert.deepEqual(providerFailure.logs[0][3].data, { errorCode: 'PROVIDER_UNAUTHORIZED' });
  assert.ok(!JSON.stringify(providerFailure.logs).includes('sk-secret'));
  assert.ok(!methods(providerFailure.calls).includes('sessionSummary.set'));
});

test('a stuck provider is cut off at the limit, counts against the interval and frees the flight', async () => {
  let stuck = true;
  const { summaries, refresh, world } = setup({
    timeoutMs: 20,
    summarize: (provider, input, options) => (stuck ? new Promise(() => {}) : Promise.resolve({ text: 'Recovered note.', included: 2 })),
  });
  await assert.rejects(refresh({ sessionId: 's1' }), { errorCode: 'TIMEOUT' });
  assert.equal(summaries[0].options.signal.aborted, true);
  assert.deepEqual(await refresh({ sessionId: 's1' }), { outcome: 'skipped', reason: 'too-soon', summary: null });
  stuck = false;
  const recovered = await refresh({ sessionId: 's1', force: true });
  assert.equal(recovered.outcome, 'updated');
  assert.equal(recovered.summary.text, 'Recovered note.');
  assert.equal(world.session.messageCount, 2);
});

test('a lost compare-and-set shows the winner instead of overwriting it', async () => {
  const winner = note({ text: 'Written in another window.', revision: 4 });
  const conflict = Object.assign(new Error('summary was changed'), { errorCode: 'SUMMARY_CONFLICT', data: { errorCode: 'SUMMARY_CONFLICT', currentRevision: 4, summary: winner } });
  const raced = setup({ setError: conflict });
  assert.deepEqual(await raced.refresh({ sessionId: 's1' }), { outcome: 'skipped', reason: 'conflict', summary: winner });

  const bare = setup({ setError: Object.assign(new Error('summary was changed'), { errorCode: 'SUMMARY_CONFLICT', data: {} }) });
  assert.deepEqual(await bare.refresh({ sessionId: 's1' }), { outcome: 'skipped', reason: 'conflict', summary: null });

  const gone = setup({ setError: Object.assign(new Error('session not found'), { errorCode: 'NOT_FOUND' }) });
  await assert.rejects(gone.refresh({ sessionId: 's1' }), { errorCode: 'NOT_FOUND' });

  const garbled = setup({ setResult: { summary: { text: '' } } });
  await assert.rejects(garbled.refresh({ sessionId: 's1' }), { errorCode: 'INTERNAL' });
});

test('OAuth providers get a live auth resolver and other providers keep their static key', async () => {
  const oauth = setup({ launch: { providerId: 'p-oauth', modelId: 'm1', sidecarParams: { provider: { id: 'p-oauth', authKind: 'oauth', apiKey: '' } } } });
  await oauth.refresh({ sessionId: 's1' });
  const provider = oauth.summaries[0].provider;
  assert.equal(typeof provider.resolveAuth, 'function');
  assert.deepEqual(await provider.resolveAuth(), { token: 'token-for-p-oauth' });

  const plain = setup();
  await plain.refresh({ sessionId: 's1' });
  assert.equal(plain.summaries[0].provider.resolveAuth, undefined);
});

test('reading a note returns the stored state and refuses a malformed Host answer', async () => {
  const stored = note({ behind: 0 });
  const { get, world } = setup({ state: { summary: stored, messageCount: 4 } });
  assert.deepEqual(await get({ sessionId: 's1' }), { summary: stored, messageCount: 4 });
  world.state = { summary: null, messageCount: 0 };
  assert.deepEqual(await get({ sessionId: 's1' }), { summary: null, messageCount: 0 });
  for (const garbage of [null, {}, { summary: { text: 'x' }, messageCount: 1 }, { summary: null, messageCount: -1 }, { summary: note({ text: 'x'.repeat(2001) }), messageCount: 1 }]) {
    world.state = garbage;
    await assert.rejects(get({ sessionId: 's1' }), { errorCode: 'INTERNAL' });
  }
});
