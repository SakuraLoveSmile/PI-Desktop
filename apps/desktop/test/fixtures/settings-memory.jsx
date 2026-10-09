import React from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { catalogs, flattenCatalog } from '@pi-desktop/i18n';
import { IPC } from '@pi-desktop/shared';
import { SettingsPage } from '../../src/features/settings/SettingsPage';
import { useAppStore } from '../../src/stores/app-store';

const clone = value => structuredClone(value);
const group = (id, name, paths, legacy = false) => ({ id, name, primaryPath: paths[0],
  roots: paths.map((path, position) => ({ path, name: path.split('/').at(-1), position })),
  legacy, createdAt: 1, updatedAt: 1, lastOpenedAt: 1, pinned: false });
const initialGroups = [group('a', 'Project A', ['/fixture/a', '/fixture/a-extra']),
  group('b', 'Project B', ['/fixture/b/' + 'long-unbroken-project-path-'.repeat(12)]), group('legacy', 'Legacy folder', ['/fixture/legacy'], true)];
const projects = new Map(initialGroups.map(project => [project.primaryPath, {
  owner: project.legacy ? 'path:/fixture/legacy' : `group:${project.id}`, enabled: false,
  memory: { content: `${project.name} context`, updatedAt: 1,
    entries: [{ id: `entry-${project.id}`, title: `${project.name} note`, content: `${project.name} context` }] },
}]));
let groups = clone(initialGroups);
let failList = false;
const requests = [];
const editorFor = state => ({ owner: state.owner, memory: clone(state.memory), autoRecordEnabled: state.enabled });
const failure = (code, message) => ({ ok: false, error: { code, message, retriable: false, details: { errorCode: code } } });
window.piDesktop = {
  platform: 'darwin', on: () => () => {},
  async invoke(channel, input) {
    requests.push({ channel, input: clone(input) });
    if (channel === IPC.invoke.pluginScenicThemesDestinations) return { ok: true, data: [] };
    if (channel === IPC.invoke.agentInstructionsGet) return { ok: true, data: { global: { path: '/fixture/AGENTS.md', content: '', exists: true } } };
    if (channel === IPC.invoke.projectGroupList) return failList
      ? failure('INJECTED', 'Project listing unavailable') : { ok: true, data: { groups: clone(groups) } };
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
const parameters = new URLSearchParams(window.location.search);
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
flushSync(() => root.render(<SettingsPage />));
window.settingsMemoryFixture = {
  requests,
  state: path => clone(projects.get(path)),
  tab: () => useAppStore.getState().settingsTab,
  failList: enabled => { failList = enabled; },
  empty: enabled => { groups = enabled ? [] : clone(initialGroups); },
  async locale(value) { await i18n.changeLanguage(value); },
  theme(value) { document.documentElement.dataset.theme = value; },
};
