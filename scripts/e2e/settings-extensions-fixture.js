import { IPC } from '@pi-desktop/shared';

const clone = value => structuredClone(value);
export const scenicDestination = {
  pluginId: 'fixture.scenic', id: 'scenic', label: 'Fixture scenery', description: 'Fixture scenery choices',
  themes: [
    { themeId: 'fixture.a', label: 'Alpine', description: 'Alpine scenery', previewUrl: 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg"/%3E', blur: 6 },
    { themeId: 'fixture.b', label: 'Beach', description: 'Beach scenery', previewUrl: 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg"/%3E', blur: 3 },
  ],
};
export function createExtensionsFixture({ configured = false, remoteError = false, remoteHosts = [], syncError = false, approvals = false, syncLoadError = false, locked = false } = {}) {
  let state = { configured, enabled: configured, paused: false, locked,
    status: configured ? locked ? 'locked' : 'upToDate' : 'notConfigured', remoteMode: 'strict',
    endpoint: configured ? 'https://fixture.invalid/dav' : '', username: '', directory: 'pi-desktop', deviceLabel: 'Fixture',
    categories: { application: true, providers: true, credentials: false, mcp: true, skills: true,
      subagents: true, instructions: true, projects: true, plugins: true, automation: true, memory: false },
    includeSecrets: false, includeMemory: false, automaticSync: true, pendingApprovals: approvals ? [{ id: "fixture-approval", digest: "fixture-digest", label: "Fixture skill", reason: "newDevice" }] : [], mappings: [] };
  let hosts = clone(remoteHosts);
  let deferBlur = false;
  let settleBlur;
  let failBlur = false;
  let blurSettled = 0;
  let syncResolve;
  let deferSync = false;
  const requests = [];
  const listeners = new Map();
  return {
    requests,
    on(channel, listener) { const entries = listeners.get(channel) ?? new Set(); entries.add(listener); listeners.set(channel, entries); return () => entries.delete(listener); },
    deferBlur(value) { deferBlur = value; },
    settleBlur() { const settle = settleBlur; settleBlur = undefined; settle?.(); },
    failBlur(value) { failBlur = value; },
    blurSettled: () => blurSettled,
    failSync(value) { syncError = value; },
    failSyncLoad(value) { syncLoadError = value; },
    deferSync(value) { deferSync = value; },
    settleSync() { syncResolve?.(); syncResolve = undefined; },
    progress(value) { for (const listener of listeners.get(IPC.event.configSyncProgress) ?? []) listener(value); },
    failRemote(value) { remoteError = value; },
    state: () => clone(state),
    async invoke(channel, input) {
      requests.push({ channel, input: clone(input) });
      const success = data => ({ handled: true, data: clone(data) });
      if (channel === IPC.invoke.pluginScenicThemesSetBlur) {
        if (deferBlur) await new Promise(resolve => { settleBlur = resolve; });
        blurSettled += 1;
        if (failBlur) throw new Error('Injected blur failure');
        return success({});
      }
      if (channel === IPC.invoke.remoteHostList) {
        if (remoteError) throw new Error('Injected remote list failure');
        return success({ hosts });
      }
      if (channel === IPC.invoke.remoteHostPair || channel === IPC.invoke.remoteHostBootstrap) {
        const host = { hostKey: 'fixture-host', label: input.label, url: input.url ?? `ssh://${input.host}`,
          connected: true, transport: channel === IPC.invoke.remoteHostBootstrap ? 'ssh' : 'direct' };
        hosts.push(host); return success({ host });
      }
      if (channel === IPC.invoke.remoteHostRemove) { hosts = hosts.filter(host => host.hostKey !== input.hostKey); return success({ ok: true }); }
      if (channel === IPC.invoke.configSyncGetState) {
        if (syncLoadError) throw new Error('Injected sync load failure');
        return success(state);
      }
      if (channel === IPC.invoke.configSyncUnlock) { state = { ...state, locked: false, status: 'upToDate' }; return success(state); }
      if (channel === IPC.invoke.configSyncListHistory) return success([]);
      if (channel === IPC.invoke.configSyncTest) return success({ conditionalWrites: true, appendOnly: true });
      if (channel === IPC.invoke.configSyncConfigure) { state = { ...state, endpoint: input.endpoint, username: input.username, directory: input.directory, deviceLabel: input.deviceLabel, categories: clone(input.categories), remoteMode: input.remoteMode, includeSecrets: input.includeSecrets, includeMemory: input.includeMemory, configured: true, enabled: true, locked: false, status: 'upToDate' }; return success(state); }
      if (channel === IPC.invoke.configSyncSyncNow) {
        if (deferSync) await new Promise(resolve => { syncResolve = resolve; });
        if (syncError) throw new Error('Injected sync failure');
        return success(state);
      }
      if (channel === IPC.invoke.configSyncApprove || channel === IPC.invoke.configSyncReject) {
        const approval = state.pendingApprovals.find(item => item.id === input.approvalId);
        if (!approval || approval.digest !== input.digest) throw new Error('Invalid approval digest');
        state.pendingApprovals = state.pendingApprovals.filter(item => item.id !== input.approvalId);
        return success(state);
      }
      if (channel === IPC.invoke.configSyncPause) { state.paused = input.paused; return success(state); }
      if (channel === IPC.invoke.configSyncDisconnect) { state = { ...state, configured: false, enabled: false, status: 'notConfigured' }; return success(state); }
      return { handled: false };
    },
  };
}
