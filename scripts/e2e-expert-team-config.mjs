#!/usr/bin/env node
/** Real Host/shared-contract coverage without starting a provider or user profile. */
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Host, resolveHostBinary } from './e2e/host.mjs';
import { validateExpertTeamSettings } from '../packages/shared/dist/index.js';

const scratch = await mkdtemp(join(tmpdir(), 'pi-expert-config-'));
const host = new Host(resolveHostBinary(), join(scratch, 'data'));
try {
  await host.start();
  const alpha = join(scratch, 'alpha');
  const beta = join(scratch, 'beta');
  await mkdir(alpha); await mkdir(beta);
  await host.call('workspace.set', { path: alpha });
  const { provider } = await host.call('providers.create', {
    name: 'Isolated expert configuration fixture', vendorKey: 'custom', type: 'openai_compatible',
    protocol: 'openai_compatible', baseUrl: 'http://127.0.0.1:1/v1', authKind: 'none',
    apiStyle: 'chat_completions', defaultModelId: 'lead-model',
    models: [{ id: 'lead-model' }, { id: 'expert-model' }],
  });
  await host.call('settings.set', { defaultProviderId: provider.id, defaultModelId: 'lead-model', defaultMode: 'agent', defaultPermissionMode: 'auto' });
  const create = async (path, title) => (await host.call('session.create', {
    title, mode: 'agent', executionProfile: 'team', projectPath: path,
    providerId: provider.id, modelId: 'lead-model', permissionMode: 'auto',
  })).session;
  const lead = await create(alpha, 'Alpha expert fixture');
  const other = await create(beta, 'Beta expert fixture');
  const expertTeam = { schemaVersion: 1, userDefaults: { qa: {
    providerId: provider.id, modelId: 'expert-model', thinkingLevel: 'off',
    tools: ['Read'], instructions: 'User-level QA instruction',
  } }, projectOverrides: { [lead.projectPath]: { qa: { tools: [], instructions: 'Alpha QA instruction' } } } };
  assert(validateExpertTeamSettings(expertTeam), 'Shared schema must accept the Host fixture');
  await host.call('settings.set', { expertTeam, expertTeamExpected: null });
  assert.deepEqual((await host.call('settings.get')).expertTeam, expertTeam);
  const declare = async (session, name) => {
    const { turnId } = await host.call('session.beginTurn', { sessionId: session.id });
    return host.call('team.declareStrategy', {
      teamSessionId: session.id, callerSessionId: session.id, leadTurnId: turnId,
      strategy: 'delegate', reason: 'Bounded expert configuration verification',
      members: [{ name, presetId: 'qa', contextKind: 'fresh', description: 'Configuration fixture' }],
    });
  };
  const first = await declare(lead, 'configured-qa');
  assert.equal(first.review.members[0].selection.modelId, 'expert-model');
  assert.deepEqual(first.review.members[0].expertConfig.tools, []);
  assert.equal(first.review.members[0].expertConfig.instructions, 'Alpha QA instruction');
  const second = await declare(other, 'other-qa');
  assert.deepEqual(second.review.members[0].expertConfig.tools, ['Read']);
  assert.equal(second.review.members[0].expertConfig.instructions, 'User-level QA instruction');
  // Changes after proposal creation must not alter its pending or confirmed snapshot.
  await host.call('settings.set', { expertTeam: { ...expertTeam, userDefaults: { qa: { tools: ['Write'], instructions: 'Later value' } } }, expertTeamExpected: expertTeam });
  const confirmed = await host.call('team.confirmLaunchReview', {
    teamSessionId: lead.id, reviewId: first.review.reviewId, expectedRevision: first.review.revision,
  });
  const member = confirmed.decision.memberSessionIds[0];
  const context = await host.call('team.getRuntimeContext', { sessionId: member });
  assert.deepEqual(context.expertConfig, first.review.members[0].expertConfig);
  await assert.rejects(host.call('tools.authorizeLocal', { sessionId: member, toolName: 'Write' }), /confirmed expert configuration/);
  await assert.rejects(host.call('tools.authorizeLocal', { sessionId: member, toolName: 'mcp_fixture' }), /confirmed expert configuration/);
  const { session } = await host.call('session.get', { id: member });
  assert.equal(session.modelId, 'expert-model');
  await host.stop(); await host.start();
  assert.deepEqual((await host.call('team.getRuntimeContext', { sessionId: member })).expertConfig, context.expertConfig);
  assert.equal((await host.call('session.get', { id: member })).session.modelId, 'expert-model');
  const before = await host.call('settings.get');
  await assert.rejects(host.call('settings.set', { expertTeam: { ...expertTeam, userDefaults: { qa: { tools: ['mcp_fixture'] } } } }));
  assert.deepEqual((await host.call('settings.get')).expertTeam, before.expertTeam, 'Malformed settings must not partially replace stored config');
  const base = (await host.call('settings.get')).expertTeam;
  const updated = { ...base, userDefaults: { ...base.userDefaults, reviewer: { tools: ['Read'] } } };
  await host.call('settings.set', { expertTeam: updated, expertTeamExpected: base });
  await assert.rejects(host.call('settings.set', { expertTeam: base, expertTeamExpected: base }), error => error.errorCode === 'TEAM_CONFIG_CONFLICT');
  await host.call('settings.set', { theme: 'light' });
  const after = await host.call('settings.get');
  assert.deepEqual(after.expertTeam, updated);
  await assert.rejects(host.call('settings.set', { ...after, theme: 'dark', expertTeam: base }), error => error.errorCode === 'TEAM_CONFIG_CONFLICT');
  assert.deepEqual(await host.call('settings.get'), after, 'Legacy stale snapshot must not mutate config or unrelated preferences');
  assert(!('expertTeamExpected' in after), 'CAS metadata must never persist');
  console.log('EXPERT_TEAM_CONFIG ' + JSON.stringify({ ok: true, checks: ['shared-host-settings-roundtrip', 'user-project-precedence-and-isolation', 'pinned-route', 'proposal-confirmed-snapshot', 'local-and-external-tool-denial', 'host-restart-policy-and-route', 'invalid-setting-atomicity', 'atomic-config-conflict', 'unrelated-setting-isolation', 'legacy-stale-snapshot-rejected'], provider: 'not-called', state: 'isolated-SQLite-Host' }));
} finally {
  await host.stop();
  await rm(scratch, { recursive: true, force: true });
}
