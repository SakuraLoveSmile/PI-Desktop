import React from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { catalogs, flattenCatalog } from '@pi-desktop/i18n';
import { IPC } from '@pi-desktop/shared';
import { SettingsPage } from '../../src/features/settings/SettingsPage';
import { useAppStore } from '../../src/stores/app-store';
import { Sidebar } from '../../src/components/Sidebar';
import { ProjectsPage } from '../../src/pages/ProjectsPage';

const clone = value => structuredClone(value);
const parameters = new URLSearchParams(window.location.search);
const workspaceMode = parameters.get('mode') === 'workspace';
const group = (id, name, paths, legacy = false) => ({ id, name, primaryPath: paths[0],
  roots: paths.map((path, position) => ({ path, name: path.split('/').at(-1), position })),
  legacy, createdAt: 1, updatedAt: 1, lastOpenedAt: 1, pinned: false });
const sharedMemory = { id: 'memory-a', name: 'Project A', primaryPath: '/fixture/a',
  paths: ['/fixture/a', '/fixture/worktrees/a-review'] };
const settingsGroups = [{ ...group('a', 'Project A', ['/fixture/a', '/fixture/a-extra']), memoryProject: sharedMemory },
  { ...group('a-review', 'Review worktree', ['/fixture/worktrees/a-review']), memoryProject: sharedMemory },
  group('b', 'Project B', ['/fixture/b/' + 'long-unbroken-project-path-'.repeat(12)]), group('legacy', 'Legacy folder', ['/fixture/legacy'], true)];
const checkoutPaths = ['/fixture/music/main', '/fixture/worktrees/music/review', '/fixture/pool/music/slot-3'];
const otherPath = '/fixture/other/checkout';
const missingPrimary = '/fixture/absent/other-main';
const workspaceGroups = [
  ...checkoutPaths.map((path, index) => ({ ...group(`music-${index}`, index ? 'Review checkout' : 'Music', [path]),
    memoryProject: { id: 'music-memory', name: 'Music', primaryPath: checkoutPaths[0], paths: checkoutPaths } })),
  { ...group('other', 'Music', [otherPath]), memoryProject: { id: 'other-memory', name: 'Music',
    primaryPath: missingPrimary, paths: [missingPrimary, otherPath] } },
];
const initialGroups = workspaceMode ? workspaceGroups : settingsGroups;
const workspaceSessions = [...checkoutPaths, otherPath].map((projectPath, index) => ({
  id: ['main-task', 'branch-task', 'slot-task', 'other-task'][index],
  title: ['Main decision', 'Branch verification', 'Slot review', 'Other repository task'][index],
  projectPath, projectName: 'Music', memoryProjectId: index < 3 ? 'music-memory' : 'other-memory',
  mode: 'agent', executionProfile: 'standard', messageCount: 1, providerId: 'fixture-provider', modelId: 'fixture-model',
  createdAt: '2026-10-23T00:00:00.000Z', updatedAt: `2026-10-23T00:0${3 - index}:00.000Z`,
}));
let savedSessions = clone(workspaceSessions);
let currentWorkspace = { path: checkoutPaths[2], name: 'Music', branch: 'detached' };
let createdSessions = 0;
const projects = new Map(initialGroups.map(project => [project.primaryPath, {
  owner: project.memoryProject ? `memory:${project.memoryProject.id}` : project.legacy ? 'path:/fixture/legacy' : `group:${project.id}`, enabled: false,
  memory: { content: `${project.name} context`, updatedAt: 1,
    entries: [{ id: `entry-${project.id}`, title: `${project.name} note`, content: `${project.name} context` }] },
}]));
if (!workspaceMode) projects.set('/fixture/worktrees/a-review', projects.get('/fixture/a'));
let groups = clone(initialGroups);
let failList = false;
const requests = [];
const editorFor = state => ({ owner: state.owner, memory: clone(state.memory), autoRecordEnabled: state.enabled,
  migrationRequired: state.migrationRequired });
const failure = (code, message) => ({ ok: false, error: { code, message, retriable: false, details: { errorCode: code } } });
window.piDesktop = {
  platform: 'darwin', on: () => () => {},
  async invoke(channel, input) {
    requests.push({ channel, input: clone(input) });
    if (channel === IPC.invoke.pluginScenicThemesDestinations) return { ok: true, data: [] };
    if (channel === IPC.invoke.agentInstructionsGet) return { ok: true, data: { global: { path: '/fixture/AGENTS.md', content: '', exists: true } } };
    if (channel === IPC.invoke.projectGroupList) return failList
      ? failure('INJECTED', 'Project listing unavailable') : { ok: true, data: { groups: clone(groups) } };
    if (workspaceMode) {
      const ok = data => ({ ok: true, data });
      if (channel === IPC.invoke.updatesGetState) return ok(null);
      if (channel === IPC.invoke.projectGet) return ok({ workspace: clone(currentWorkspace) });
      if (channel === IPC.invoke.projectSet) {
        if (![...checkoutPaths, otherPath].includes(input)) return failure('NOT_FOUND', 'Fixture checkout does not exist');
        currentWorkspace = { path: input, name: 'Music', branch: input === checkoutPaths[2] ? 'detached' : 'main' };
        return ok({ workspace: clone(currentWorkspace) });
      }
      if (channel === IPC.invoke.projectClear) { currentWorkspace = null; return ok({}); }
      if (channel === IPC.invoke.sessionList) return ok({ sessions: clone(savedSessions) });
      if (channel === IPC.invoke.sessionGet) {
        const session = savedSessions.find(candidate => candidate.id === input.id);
        return ok({ session: session ? { ...clone(session), messages: session.messageCount ? [{
          id: `message-${session.id}`, role: 'user', content: `Saved source from ${session.projectPath}`,
          createdAt: session.createdAt,
        }] : [], messageStart: 0, hasMoreBefore: false } : null });
      }
      if (channel === IPC.invoke.sessionCreate) {
        const session = { ...workspaceSessions[2], ...clone(input), id: `created-${++createdSessions}`, messageCount: 0,
          memoryProjectId: input.projectPath === otherPath ? 'other-memory' : 'music-memory' };
        savedSessions.unshift(session);
        return ok({ session: clone(session) });
      }
      if (channel === IPC.invoke.plansPending) return ok({ plans: [], state: 'inactive' });
      if (channel === IPC.invoke.pendingInteractive) return ok({ asks: [], permissions: [] });
      if (channel === IPC.invoke.goalReportList) return ok({ reports: [] });
      if (channel === IPC.invoke.projectOpenFolder) return ok({ opened: true });
      if (channel === IPC.invoke.projectRemove) {
        const before = savedSessions.length;
        savedSessions = savedSessions.filter(session => session.projectPath !== input.path);
        groups = groups.filter(candidate => candidate.primaryPath !== input.path);
        return ok({ removed: true, sessionsRemoved: before - savedSessions.length });
      }
      throw new Error(`Unexpected workspace fixture IPC: ${channel}`);
    }
    const state = projects.get(input?.projectPath);
    if (!state) throw new Error(`Unexpected fixture IPC: ${channel}`);
    if (channel === IPC.invoke.projectMemoryEditorGet) return { ok: true, data: { editor: editorFor(state) } };
    if (input.expectedOwner !== state.owner) return failure('PROJECT_CHANGED', 'Project memory owner changed');
    if (channel === IPC.invoke.projectAutoMemorySetEnabled) {
      state.enabled = input.enabled;
      return { ok: true, data: { autoRecordEnabled: state.enabled } };
    }
    if (channel === IPC.invoke.projectMemoryEditorSave) {
      if (JSON.stringify(input.expectedMemory) !== JSON.stringify(state.memory)) return failure('CONFLICT', 'Memory changed');
      state.memory = { entries: clone(input.entries), content: input.entries.map(entry => entry.content).join('\n\n'), updatedAt: state.memory.updatedAt + 1 };
      return { ok: true, data: { editor: editorFor(state) } };
    }
    throw new Error(`Unexpected fixture IPC: ${channel}`);
  },
};
const requestedLocale = parameters.get('locale');
const locale = ['en', 'zh-CN', 'zh-TW'].includes(requestedLocale) ? requestedLocale : 'en';
const theme = parameters.get('theme') === 'dark' ? 'dark' : 'light';
await i18n.use(initReactI18next).init({ lng: locale, fallbackLng: 'en', keySeparator: false,
  resources: Object.fromEntries(['en', 'zh-CN', 'zh-TW'].map(locale => [locale, { translation: flattenCatalog(catalogs[locale]) }])),
  interpolation: { escapeValue: false } });
document.documentElement.dataset.theme = theme;
useAppStore.setState({ settingsTab: 'instructions', settings: {
  theme, developerMode: false, defaultMode: 'agent', enterToSend: true,
}, sessions: [], workspace: null, openProjectPaths: [], projectMeta: {} });
const root = createRoot(document.getElementById('root'));
function WorkspaceFixture() {
  const workspace = useAppStore(state => state.workspace);
  const active = useAppStore(state => state.activeSessionId);
  return <div style={{ display: 'grid', gridTemplateColumns: '300px minmax(0, 1fr)', height: '100vh' }}>
    <Sidebar onToggleSidebar={() => {}} sidebarToggleShortcut="" sidebarWidth={300}
      onWidthChange={() => {}} onWidthCommit={() => {}} onResizeCollapse={() => {}} />
    <main style={{ minWidth: 0, overflow: 'auto' }}>
      <div data-fixture-workspace-state style={{ padding: '8px 20px', fontSize: 12 }}>
        Isolated renderer fixture · {workspace?.path ?? 'No checkout'} · {active ?? 'No active task'}
      </div>
      <ProjectsPage />
    </main>
  </div>;
}
function seedWorkspace() {
  groups = clone(workspaceGroups);
  savedSessions = clone(workspaceSessions);
  currentWorkspace = { path: checkoutPaths[2], name: 'Music', branch: 'detached' };
  useAppStore.setState({ page: 'settings', settingsTab: 'projects', sessions: clone(savedSessions),
    workspace: clone(currentWorkspace), activeProjectPath: currentWorkspace.path,
    activeSessionId: undefined, messages: [], openProjectPaths: [...checkoutPaths, otherPath],
    openProjects: [...checkoutPaths, otherPath].map(path => ({ path, name: 'Music' })),
    projectMeta: {}, projectCollapsed: {}, sessionMeta: {}, notifications: [],
    sessionView: { archived: false, sort: 'recent' }, projectSort: 'recent',
    providers: [{ id: 'fixture-provider', name: 'Fixture', models: [{ id: 'fixture-model' }] }],
    settings: { theme, developerMode: false, defaultMode: 'agent', enterToSend: true,
      defaultProviderId: 'fixture-provider', defaultModelId: 'fixture-model' },
  });
}
if (workspaceMode) seedWorkspace();
flushSync(() => root.render(workspaceMode ? <WorkspaceFixture /> : <SettingsPage />));
window.settingsMemoryFixture = {
  requests,
  state: path => clone(projects.get(path)),
  tab: () => useAppStore.getState().settingsTab,
  failList: enabled => { failList = enabled; },
  empty: enabled => { groups = enabled ? [] : clone(initialGroups); },
  migration: (path, required) => { projects.get(path).migrationRequired = required; },
  async locale(value) { await i18n.changeLanguage(value); },
  theme(value) { document.documentElement.dataset.theme = value; },
  workspace() {
    const state = useAppStore.getState();
    return clone({ workspace: state.workspace, activeSessionId: state.activeSessionId,
      sessions: state.sessions, projectMeta: state.projectMeta, openProjectPaths: state.openProjectPaths,
      error: state.error, toasts: state.toasts });
  },
  mode: workspaceMode ? 'workspace' : 'settings',
};
