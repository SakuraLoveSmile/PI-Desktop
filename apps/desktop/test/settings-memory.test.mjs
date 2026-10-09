import assert from 'node:assert/strict';
import test from 'node:test';
import { SETTINGS_NAV, visibleSettingsNav, isSettingsDestinationHidden, searchSettings } from '../src/lib/settings-search.ts';

test('Memory is one top-level workspace destination in packaged and development builds', () => {
  const entries = SETTINGS_NAV.filter(entry => entry.id === 'memory');
  assert.equal(entries.length, 1);
  assert.equal(entries[0].group, 'workspace');
  for (const developerMode of [false, true]) {
    for (const includeDevelopmentOnly of [false, true]) {
      assert.ok(visibleSettingsNav(developerMode, includeDevelopmentOnly).some(entry => entry.id === 'memory'));
      assert.equal(isSettingsDestinationHidden('memory', developerMode, includeDevelopmentOnly), false);
      assert.ok(visibleSettingsNav(developerMode, includeDevelopmentOnly).some(entry => entry.id === 'projects'));
    }
  }
});

test('Memory is searchable by its translated menu label and editing actions', () => {
  for (const [label, project, automatic, add, remove] of [
    ['Memory', 'Project memory', 'Automatically record memory', 'Add memory', 'Remove memory'],
    ['记忆', '项目记忆', '自动记录记忆', '添加记忆', '删除记忆'],
  ]) {
    const translations = {
      'settings.nav.memory': label,
      'settings.memory.projectsTitle': project,
      'project.autoMemoryToggle': automatic,
      'project.memoryAdd': add,
      'project.memoryRemove': remove,
    };
    for (const query of [label, project, automatic, add, remove]) {
      const hits = searchSettings(` ${query} `, key => translations[key] ?? key, { includeDevelopmentOnly: false });
      assert.ok(hits.some(hit => hit.tab === 'memory'), query);
    }
    assert.deepEqual(searchSettings(label, key => translations[key] ?? key, { limit: 1 }), [
      { tab: 'memory', tabLabelKey: 'settings.nav.memory', rowKey: null },
    ]);
  }
});
