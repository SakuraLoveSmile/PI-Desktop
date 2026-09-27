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

function waitForChildExit(child, timeoutMs) {
  if (!child || child.exitCode !== null) return Promise.resolve(true);
  return new Promise(resolveExit => {
    const finish = exited => {
      clearTimeout(timer);
      resolveExit(exited);
    };
    const timer = setTimeout(() => finish(false), timeoutMs);
    child.once('exit', () => finish(true));
  });
}

async function terminateElectronTree(child) {
  if (!child || child.exitCode !== null) return;
  const signalTree = async signal => {
    if (process.platform === 'win32') {
      await new Promise(resolveKill => {
        let timer;
        const finish = () => {
          clearTimeout(timer);
          resolveKill();
        };
        const killer = spawn('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], {
          stdio: 'ignore',
          windowsHide: true,
        });
        killer.once('exit', finish);
        killer.once('error', finish);
        timer = setTimeout(finish, 5000);
      });
      return;
    }
    try {
      process.kill(-child.pid, signal);
    } catch {
      try { child.kill(signal); } catch {}
    }
  };

  await signalTree('SIGTERM');
  const exited = await waitForChildExit(child, 5000);
  if (!exited || process.platform !== 'win32') await signalTree('SIGKILL');
  await waitForChildExit(child, 5000);
}

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
    const availableTools = request.tools.map(tool => tool.function.name);
    const name = calls === 1 ? 'SubmitGoal' : calls === 2 ? 'Write' : calls === 3 ? 'SubmitGoalReport' : null;
    if (name) {
      assert.ok(request.tools.some(tool => tool.function.name === name), `${name} must be available`);
      const args = name === 'SubmitGoal'
        ? { title: 'Temporary Goal', markdown, question: 'Approve this goal?' }
        : name === 'Write'
          ? { path: 'goal-result.txt', content: 'GOAL_OK' }
          : {
              summary: 'Created goal-result.txt in the isolated scratch workspace and verified its contents.',
              verdict: 'met',
              criteria: [{
                id: 'goal-result',
                text: 'goal-result.txt contains GOAL_OK.',
                verdict: 'met',
                explanation: 'The file was written and its contents were verified after execution.',
              }],
              steps: [{
                id: 'write-file',
                title: 'Write goal-result.txt',
                status: 'completed',
                detail: 'Wrote the requested content in the temporary Goal scratch workspace.',
              }],
              files: [{
                path: 'goal-result.txt',
                changeType: 'created',
                attribution: 'direct',
              }],
              checks: [{
                id: 'content-check',
                command: 'read goal-result.txt',
                result: 'passed',
                detail: 'The file contains GOAL_OK.',
              }],
              evidences: [{
                id: 'file-check',
                kind: 'file',
                refId: 'goal-result.txt',
                summary: 'The scratch file contains GOAL_OK.',
              }],
            };
      emit({ role: 'assistant', tool_calls: [{ index: 0, id: `fixture-${name}`, type: 'function', function: { name, arguments: JSON.stringify(args) } }] });
      emit({}, 'tool_calls');
    } else {
      assert.equal(calls, 4, 'no extra execution or recovery request');
      assert.ok(availableTools.includes('SubmitGoalReport'), 'SubmitGoalReport must remain available before the final response');
      emit({ role: 'assistant', content: 'Goal complete. goal-result.txt contains GOAL_OK.' });
      emit({}, 'stop');
    }
    res.end('data: [DONE]\n\n');
  } catch (error) { fixtureError = error; if (!res.headersSent) res.writeHead(500); res.end(); }
});
await new Promise(done => server.listen(0, '127.0.0.1', done));
const host = new Host(resolveHostBinary(), dataDir);
let child, ws, output = '';

async function startDesktop() {
  const portProbe = createTcpServer();
  await new Promise(done => portProbe.listen(0, '127.0.0.1', done));
  const port = portProbe.address().port;
  await new Promise(done => portProbe.close(done));
  const { electronBinary, appDir } = resolveElectronBinary();
  const env = {
    ...process.env,
    PI_DESKTOP_DATA_DIR: dataDir,
    PI_DESKTOP_HOST_BIN: resolveHostBinary(),
    ELECTRON_RENDERER_URL: '',
    PI_DESKTOP_START_MAXIMIZED: '0',
  };
  for (const key of ['ELECTRON_RUN_AS_NODE', 'PI_DESKTOP_TEST_API_KEY', 'PI_DESKTOP_TEST_BASE_URL', 'PI_DESKTOP_TEST_MODEL']) delete env[key];
  child = spawn(electronBinary, [`--remote-debugging-port=${port}`, `--user-data-dir=${join(root, 'profile')}`, '.'], {
    cwd: appDir,
    env,
    detached: process.platform !== 'win32',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', data => { output += data; });
  child.stderr.on('data', data => { output += data; });
  let target;
  await waitFor(async () => {
    try {
      target = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json())
        .find(item => item.type === 'page' && item.url.includes('index.html') && !item.url.includes('plugin-launcher'));
      return !!target;
    } catch {
      return false;
    }
  }, 30000, 'desktop target');
  ws = new WebSocket(target.webSocketDebuggerUrl);
  await once(ws, 'open');
  let seq = 0;
  const pending = new Map();
  ws.onmessage = ({ data }) => {
    const message = JSON.parse(data);
    const entry = pending.get(message.id);
    if (!entry) return;
    pending.delete(message.id);
    clearTimeout(entry.timer);
    if (message.error) entry.reject(new Error(JSON.stringify(message.error)));
    else entry.resolve(message.result);
  };
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++seq;
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`CDP timeout: ${method}`));
    }, 30000);
    pending.set(id, { resolve, reject, timer });
    ws.send(JSON.stringify({ id, method, params }));
  });
  const evaluate = async expression => {
    const result = await send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
    if (result.exceptionDetails) {
      throw new Error(result.exceptionDetails.exception?.description ?? JSON.stringify(result.exceptionDetails));
    }
    return result.result.value;
  };
  const invoke = (name, ...args) => evaluate(
    `(async () => { const r = await window.piDesktop.invoke(window.piDesktop.channels.invoke[${JSON.stringify(name)}], ...${JSON.stringify(args)}); if (!r.ok) throw new Error(JSON.stringify(r.error)); return r.data; })()`,
  );
  return { send, evaluate, invoke };
}

try {
  await host.start();
  await host.call('workspace.set', { path: project });
  const { provider } = await host.call('providers.create', {
    name: 'Goal fixture', vendorKey: 'custom', type: 'openai_compatible', protocol: 'openai_compatible',
    baseUrl: `http://127.0.0.1:${server.address().port}/v1`, authKind: 'none', defaultModelId: 'fixture', apiStyle: 'chat_completions',
  });
  const theme = process.env.PI_DESKTOP_E2E_THEME === 'light' ? 'light' : 'dark';
  await host.call('settings.set', { language: 'en', theme, defaultProviderId: provider.id, defaultModelId: 'fixture', defaultMode: 'agent', defaultPermissionMode: 'auto' });
  const { session } = await host.call('session.create', { title: 'Temporary Goal E2E', mode: 'goal', projectPath: null, providerId: provider.id, modelId: 'fixture' });
  assert.equal(session.projectPath ?? null, null);
  const { path: scratch } = await host.call('session.getScratchPath', { sessionId: session.id });
  await host.stop();
  let { send, evaluate, invoke } = await startDesktop();
  await waitFor(() => evaluate(`document.documentElement?.dataset?.theme === ${JSON.stringify(theme)}`), 10000, `${theme} theme`);
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
  assert.equal(calls, 4);
  const { session: finished } = await invoke('sessionGet', { id: session.id });
  assert.equal(finished.mode, 'agent'); assert.equal(finished.projectPath ?? null, null);
  const submit = finished.messages.find(message => message.toolName === 'SubmitGoal');
  assert.ok(submit && !submit.isError && submit.toolStatus !== 'error');
  const reportTool = finished.messages.find(message => message.toolName === 'SubmitGoalReport');
  assert.ok(reportTool && !reportTool.isError && reportTool.toolStatus !== 'error', 'SubmitGoalReport must complete successfully');
  await waitFor(() => evaluate(`!!document.querySelector('[data-testid="goal-report-card"][data-execution-id]')`), 30000, 'Goal report card');
  const reportCard = await evaluate(`({ text: document.querySelector('[data-testid="goal-report-card"]')?.innerText ?? '', executionId: document.querySelector('[data-testid="goal-report-card"]')?.getAttribute('data-execution-id'), className: document.querySelector('[data-testid="goal-report-card"]')?.className ?? '' })`);
  assert.ok(reportCard.executionId, 'report card must expose the approved execution');
  assert.match(reportCard.className, /status-completed/, 'report card style must use the execution status');
  assert.match(reportCard.text, /Temporary Goal|Goal complete|Created goal-result/);
  const reportResult = await invoke('goalReportGet', { sessionId: session.id, executionId: reportCard.executionId });
  assert.equal(reportResult.report?.execution.status, 'completed', 'Host report must describe the completed execution');
  assert.equal(reportResult.report?.executionId, reportCard.executionId, 'Host report must match the visible report card');
  assert.equal(reportResult.report?.verdict, 'met');
  const reportList = await invoke('goalReportList', { sessionId: session.id });
  const reportSummary = reportList.reports?.find(item => item.executionId === reportCard.executionId);
  assert.equal(reportSummary?.status, 'ready', 'Host must list the report as ready');
  await evaluate(`document.querySelector('[data-testid="goal-report-card-open-btn"]').click()`);
  await waitFor(() => evaluate(`!!document.querySelector('[data-testid="work-panel"] [role="tabpanel"]') && document.querySelector('[data-testid="work-panel"]')?.innerText.includes('Created goal-result.txt')`), 30000, 'Goal report Work Panel');
  const reportScreenshotPath = join(root, 'goal-report.png');
  const reportScreenshot = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(reportScreenshotPath, Buffer.from(reportScreenshot.data, 'base64'));
  ws.close();
  ws = null;
  await terminateElectronTree(child);
  child = null;
  await host.start();
  const retrySessionResponse = await host.call('session.create', {
    title: 'Failed Goal Retry E2E',
    mode: 'agent',
    projectPath: null,
    providerId: provider.id,
    modelId: 'fixture',
  });
  const retrySession = retrySessionResponse.session;
  assert.ok(retrySession?.id, 'retry fixture session must be created');
  const retryTurn = await host.call('session.beginTurn', { sessionId: retrySession.id });
  const retryToolCallId = 'failed-goal-retry-fixture';
  await host.call('plans.enter', {
    sessionId: retrySession.id,
    turnId: retryTurn.turnId,
    toolCallId: `${retryToolCallId}-enter`,
    requestedMode: 'goal',
    kind: 'goal',
  });
  const retryProposal = await host.call('plans.submit', {
    sessionId: retrySession.id,
    turnId: retryTurn.turnId,
    toolCallId: retryToolCallId,
    title: 'Failed Goal Retry',
    markdown: '# Failed Goal Retry\n\n- Verify fallback recovery.\n',
    question: 'Approve the retry fixture?',
    kind: 'goal',
  });
  const retryApproval = await host.call('plans.resolve', {
    sessionId: retrySession.id,
    turnId: retryTurn.turnId,
    toolCallId: retryToolCallId,
    proposalId: retryProposal.proposal.id,
    version: retryProposal.proposal.version,
    action: 'approve',
    targetPermissionMode: 'ask',
  });
  const failedExecutionId = retryApproval.execution?.id;
  assert.ok(failedExecutionId, 'approved retry fixture must have an execution');
  await host.call('plans.claimExecution', { executionId: failedExecutionId });
  await host.call('plans.finishExecution', { executionId: failedExecutionId, status: 'completed' });
  const markedFailed = await host.call('goalReports.markFailed', {
    sessionId: retrySession.id,
    executionId: failedExecutionId,
    errorCode: 'REPORT_PERSISTENCE_BARRIER_FAILED',
  });
  assert.equal(markedFailed.report?.status, 'failed');
  await host.call('session.endTurn', {
    turnId: retryTurn.turnId,
    status: 'completed',
    createNotification: false,
  });
  await host.call('session.appendMessage', {
    sessionId: retrySession.id,
    message: {
      id: 'failed-goal-retry-fixture-message',
      role: 'user',
      content: 'Open the completed Goal report.',
      createdAt: new Date().toISOString(),
    },
  });
  await host.stop();

  ({ send, evaluate, invoke } = await startDesktop());
  await waitFor(() => evaluate(`!!document.querySelector('[data-sidebar-session-row="${retrySession.id}"]') && !document.querySelector('.startup-splash')`), 30000, 'retry fixture session after restart');
  await evaluate(`(document.querySelector('[data-sidebar-session-row="${retrySession.id}"] button.thread-item-main') || document.querySelector('[data-sidebar-session-row="${retrySession.id}"]'))?.click()`);
  await waitFor(() => evaluate(`!!document.querySelector('[data-sidebar-session-row="${retrySession.id}"].active')`), 10000, 'selected failed Goal after restart');
  const failedCardSelector = `[data-testid="goal-report-card"][data-execution-id="${failedExecutionId}"]`;
  const failedCardOpenSelector = `${failedCardSelector} [data-testid="goal-report-card-open-btn"]`;
  await waitFor(() => evaluate(`!!document.querySelector(${JSON.stringify(failedCardOpenSelector)})`), 30000, 'failed report card');
  await evaluate(`document.querySelector(${JSON.stringify(failedCardOpenSelector)})?.click()`);
  await waitFor(() => evaluate(`!!document.querySelector('[data-testid="goal-report-retry-btn"]')`), 30000, 'failed report Retry action');
  const failureText = await evaluate(`document.querySelector('.goal-report-error-card')?.innerText ?? ''`);
  assert.match(failureText, /failed|error|REPORT_FAILED|INTERNAL/i);
  const failureScreenshotPath = join(root, 'goal-report-failed.png');
  const failureScreenshot = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(failureScreenshotPath, Buffer.from(failureScreenshot.data, 'base64'));

  await evaluate(`document.querySelector('[data-testid="goal-report-retry-btn"]').click()`);
  await waitFor(() => evaluate(`!!document.querySelector('[data-testid="goal-report-fallback-notice"]')`), 30000, 'retried fallback report');
  const retriedList = await invoke('goalReportList', { sessionId: retrySession.id });
  const retriedSummary = retriedList.reports?.find(item => item.executionId === failedExecutionId);
  assert.equal(retriedSummary?.status, 'ready');
  assert.equal(retriedSummary?.integrity, 'fallback');
  assert.equal(retriedSummary?.verdict, 'unknown');
  const retriedReport = await invoke('goalReportGet', { sessionId: retrySession.id, executionId: failedExecutionId });
  assert.equal(retriedReport.report?.verdict, 'unknown');
  assert.deepEqual(retriedReport.report?.checks, [], 'fallback must not invent passed checks');
  assert.equal(calls, 4, 'report Retry must not rerun the Goal or call the model');
  const retriedScreenshotPath = join(root, 'goal-report-retried.png');
  const retriedScreenshot = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(retriedScreenshotPath, Buffer.from(retriedScreenshot.data, 'base64'));

  console.log(`PASS temporary Goal ${theme}: approval, scratch execution, structured report, Work Panel, failure after restart, safe Retry fallback without another model call`);
  console.log(`Evidence: ${root}`);
  console.log(`Report screenshot: ${reportScreenshotPath}`);
  console.log(`Failure screenshot: ${failureScreenshotPath}`);
  console.log(`Retried screenshot: ${retriedScreenshotPath}`);
} catch (error) { console.error(output.slice(-3500)); throw error; }
finally {
  ws?.close();
  await terminateElectronTree(child);
  await host.stop();
  server.closeAllConnections();
  await new Promise(done => server.close(done));
}
