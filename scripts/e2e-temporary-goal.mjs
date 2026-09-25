#!/usr/bin/env node
// Real desktop/Host/sidecar; only the model is a loopback SSE fixture.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { createServer as createTcpServer } from 'node:net';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Host, resolveHostBinary } from './e2e/host.mjs';
import { resolveElectronBinary } from './e2e/boot.mjs';
import { waitFor } from './e2e/wait.mjs';

const root = mkdtempSync(join(tmpdir(), 'pi-temporary-goal-e2e-'));
const dataDir = join(root, 'data');
const project = join(root, 'unrelated-project');
mkdirSync(project);
const markdown = '# Temporary Goal\n\n## Acceptance criteria\n- goal-result.txt contains GOAL_OK.\n';
let calls = 0;
let fixtureError;
const server = createServer(async (req, res) => {
  try {
    let body = ''; for await (const part of req) body += part;
    const request = JSON.parse(body);
    calls++;
    const base = { id: `goal-fixture-${calls}`, object: 'chat.completion.chunk', created: 1, model: request.model };
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    const emit = (delta, finish_reason = null) => res.write(`data: ${JSON.stringify({ ...base, choices: [{ index: 0, delta, finish_reason }] })}\n\n`);
    const name = calls === 1 ? 'SubmitGoal' : calls === 2 ? 'Write' : null;
    if (name) {
      assert.ok(request.tools.some(tool => tool.function.name === name), `${name} must be available`);
      const args = name === 'SubmitGoal' ? { title: 'Temporary Goal', markdown, question: 'Approve this goal?' } : { path: 'goal-result.txt', content: 'GOAL_OK' };
      emit({ role: 'assistant', tool_calls: [{ index: 0, id: `fixture-${name}`, type: 'function', function: { name, arguments: JSON.stringify(args) } }] });
      emit({}, 'tool_calls');
    } else {
      assert.equal(calls, 3, 'no extra execution or recovery request');
      emit({ role: 'assistant', content: 'Goal complete. goal-result.txt contains GOAL_OK.' });
      emit({}, 'stop');
    }
    res.end('data: [DONE]\n\n');
  } catch (error) { fixtureError = error; if (!res.headersSent) res.writeHead(500); res.end(); }
});
await new Promise(done => server.listen(0, '127.0.0.1', done));
const host = new Host(resolveHostBinary(), dataDir);
let child, ws, output = '';
try {
  await host.start();
  await host.call('workspace.set', { path: project });
  const { provider } = await host.call('providers.create', {
    name: 'Goal fixture', vendorKey: 'custom', type: 'openai_compatible', protocol: 'openai_compatible',
    baseUrl: `http://127.0.0.1:${server.address().port}/v1`, authKind: 'none', defaultModelId: 'fixture', apiStyle: 'chat_completions',
  });
  await host.call('settings.set', { language: 'en', defaultProviderId: provider.id, defaultModelId: 'fixture', defaultMode: 'agent', defaultPermissionMode: 'auto' });
  const { session } = await host.call('session.create', { title: 'Temporary Goal E2E', mode: 'goal', projectPath: null, providerId: provider.id, modelId: 'fixture' });
  assert.equal(session.projectPath ?? null, null);
  const { path: scratch } = await host.call('session.getScratchPath', { sessionId: session.id });
  await host.stop();
  const portProbe = createTcpServer(); await new Promise(done => portProbe.listen(0, '127.0.0.1', done));
  const port = portProbe.address().port; await new Promise(done => portProbe.close(done));
  const { electronBinary, appDir } = resolveElectronBinary();
  const env = { ...process.env, PI_DESKTOP_DATA_DIR: dataDir, PI_DESKTOP_HOST_BIN: resolveHostBinary(), ELECTRON_RENDERER_URL: '', PI_DESKTOP_START_MAXIMIZED: '0' };
  for (const key of ['ELECTRON_RUN_AS_NODE', 'PI_DESKTOP_TEST_API_KEY', 'PI_DESKTOP_TEST_BASE_URL', 'PI_DESKTOP_TEST_MODEL']) delete env[key];
  child = spawn(electronBinary, [`--remote-debugging-port=${port}`, `--user-data-dir=${join(root, 'profile')}`, '.'], { cwd: appDir, env, stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout.on('data', data => { output += data; }); child.stderr.on('data', data => { output += data; });
  let target;
  await waitFor(async () => {
    try { target = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(item => item.type === 'page' && item.url.includes('index.html') && !item.url.includes('plugin-launcher')); return !!target; } catch { return false; }
  }, 30000, 'desktop target');
  ws = new WebSocket(target.webSocketDebuggerUrl); await once(ws, 'open');
  let seq = 0; const pending = new Map();
  ws.onmessage = ({ data }) => { const message = JSON.parse(data), entry = pending.get(message.id); if (!entry) return; pending.delete(message.id); clearTimeout(entry.timer); if (message.error) entry.reject(new Error(JSON.stringify(message.error))); else entry.resolve(message.result); };
  const send = (method, params = {}) => new Promise((resolve, reject) => { const id = ++seq; const timer = setTimeout(() => { pending.delete(id); reject(new Error(`CDP timeout: ${method}`)); }, 30000); pending.set(id, { resolve, reject, timer }); ws.send(JSON.stringify({ id, method, params })); });
  const evaluate = async expression => { const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }); if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? JSON.stringify(result.exceptionDetails)); return result.result.value; };
  const invoke = (name, ...args) => evaluate(`(async () => { const r = await window.piDesktop.invoke(window.piDesktop.channels.invoke[${JSON.stringify(name)}], ...${JSON.stringify(args)}); if (!r.ok) throw new Error(JSON.stringify(r.error)); return r.data; })()`);
  await waitFor(() => evaluate(`!!document.querySelector('[data-sidebar-session-row="${session.id}"]') && !document.querySelector('.startup-splash')`), 30000, 'session row');
  await evaluate(`(document.querySelector('[data-sidebar-session-row="${session.id}"] button.thread-item-main') || document.querySelector('[data-sidebar-session-row="${session.id}"]'))?.click()`);
  await waitFor(() => evaluate(`!!document.querySelector('[data-sidebar-session-row="${session.id}"].active')`), 10000, 'selected temporary session');
  await invoke('agentPrompt', { sessionId: session.id, content: 'Create goal-result.txt containing GOAL_OK after I approve the goal.', viewingSessionId: session.id });
  let proposal;
  await waitFor(async () => { if (fixtureError) throw fixtureError; const result = await invoke('plansPending', { sessionId: session.id }); proposal = result.plans?.find(item => item.status === 'pending'); return !!proposal; }, 30000, 'Goal approval');
  assert.equal(calls, 1, 'submission pauses for approval');
  assert.equal(readFileSync(join(scratch, proposal.artifact.relativePath), 'utf8'), markdown);
  assert.equal(proposal.artifact.workspaceKind, 'scratch', 'artifact workspaceKind must be scratch');
  assert.equal(existsSync(join(project, '.pi')), false, 'visible project is untouched');
  await waitFor(() => evaluate(`!!document.querySelector('[data-testid="plan-open-artifact"]')`), 10000, 'artifact action');
  await evaluate(`document.querySelector('[data-testid="plan-open-artifact"]').click()`);
  await waitFor(() => evaluate(`document.querySelector('.file-viewer-body')?.innerText.includes('goal-result.txt contains GOAL_OK')`), 10000, 'scratch goal preview');
  const screenshot = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(join(root, 'goal-approval.png'), Buffer.from(screenshot.data, 'base64'));
  await evaluate(`document.querySelector('.plan-approval-approve-menu').click()`);
  await waitFor(() => evaluate(`!!document.querySelector('[data-approval-mode="auto"]')`), 5000, 'approval mode menu');
  await evaluate(`document.querySelector('[data-approval-mode="auto"]').click()`);
  await waitFor(async () => { if (fixtureError) throw fixtureError; const { session: current } = await invoke('sessionGet', { id: session.id }); return current.messages.some(message => message.role === 'assistant' && message.content.includes('Goal complete.')); }, 30000, 'approved Goal execution');
  assert.equal(readFileSync(join(scratch, 'goal-result.txt'), 'utf8'), 'GOAL_OK');
  assert.equal(existsSync(join(project, 'goal-result.txt')), false);
  assert.equal(calls, 3);
  const { session: finished } = await invoke('sessionGet', { id: session.id });
  assert.equal(finished.mode, 'agent'); assert.equal(finished.projectPath ?? null, null);
  const submit = finished.messages.find(message => message.toolName === 'SubmitGoal');
  assert.ok(submit && !submit.isError && submit.toolStatus !== 'error');
  console.log('PASS temporary Goal: submit, visible approval, exact scratch preview, approve, real sidecar Write, isolated output, no implicit project');
  console.log(`Evidence: ${root}`);
} catch (error) { console.error(output.slice(-3500)); throw error; }
finally { ws?.close(); if (child && child.exitCode === null) { child.kill(); await Promise.race([once(child, 'exit'), new Promise(done => setTimeout(done, 5000))]); } await host.stop(); server.closeAllConnections(); await new Promise(done => server.close(done)); }
