import assert from "node:assert/strict";
import test from "node:test";
import { register } from "node:module";
import { SETTINGS_NAV, searchSettings } from "../src/lib/settings-search.ts";

register(new URL("./helpers/ts-import-hooks.mjs", import.meta.url));
const { catalogs, flattenCatalog } = await import("../../../packages/i18n/src/index.ts");
const translate = locale => {
  const catalog = flattenCatalog(catalogs[locale]);
  return key => catalog[key] ?? key;
};
const options = { limit: Infinity, developerMode: true, includeDevelopmentOnly: true };
const hit = (tab, rowKey) => ({
  tab,
  tabLabelKey: SETTINGS_NAV.find(entry => entry.id === tab).labelKey,
  rowKey,
});

test("translated options and help copy point to their visible owning row", () => {
  for (const locale of ["en", "zh-CN", "zh-TW"]) {
    const t = translate(locale);
    for (const [keyword, tab, target] of [
      ["settings.languageAuto", "general", "settings.language"],
      ["settings.proxyCustom", "general", "settings.proxy"],
      ["settings.proxyUrl", "general", "settings.proxy"],
      ["settings.keepAwakeWhileRunningDesc", "general", "settings.keepAwakeWhileRunning"],
      ["settings.permissionModeAcceptEdits", "ai", "settings.permissionMode"],
      ["settings.thinkingDisplayCompact", "ai", "settings.thinkingDisplayMode"],
      ["settings.promptEnhancementEdit", "ai", "settings.promptEnhancementCustomTemplate"],
      ["settings.apiKey", "agent", "settings.providers"],
      ["project.memoryAdd", "memory", "settings.memory.projectsTitle"],
    ]) {
      assert.ok(searchSettings(t(keyword), t, options).some(result =>
        result.tab === tab && result.rowKey === target), `${locale}: ${keyword}`);
      assert.ok(!searchSettings(t(keyword), t, options).some(result =>
        result.tab === tab && result.rowKey === keyword), `${locale}: not the option/help key ${keyword}`);
    }
  }
});

test("direct row matches remain precise and duplicate aliases produce one target", () => {
  const t = translate("en");
  assert.deepEqual(searchSettings(t("settings.fontSize"), t, options), [hit("general", "settings.fontSize")]);
  const proxy = searchSettings("proxy", t, options).filter(result => result.tab === "general");
  assert.deepEqual(proxy, [hit("general", "settings.proxy"), hit("general", "settings.networkRelaxedMode")]);
  const keepingAwake = searchSettings("keep computer awake", t, options).filter(result => result.tab === "general");
  assert.deepEqual(keepingAwake, [hit("general", "settings.keepAwakeWhileRunning")]);
});

test("dynamic fields fall back to the category and identical page titles are not repeated", () => {
  const t = translate("en");
  assert.deepEqual(searchSettings(t("extensions.skills.add"), t, options), [hit("skills", null)]);
  const voice = searchSettings(t("liveVoice.title"), t, options).filter(result => result.tab === "voice");
  assert.deepEqual(voice, [hit("voice", null), hit("voice", "liveVoice.enable")]);
});

test("category labels precede specific rows and matching descriptive page titles work", () => {
  const t = translate("en");
  const results = searchSettings(t("settings.nav.memory"), t, options).filter(result => result.tab === "memory");
  assert.deepEqual(results, [hit("memory", null), hit("memory", "settings.memory.projectsTitle")]);
  assert.ok(searchSettings(t("settings.configuration"), t, options).some(result =>
    result.tab === "agent" && result.rowKey === null));
});

test("image-model lookup leads to model configuration rather than AI defaults", () => {
  for (const locale of ["en", "zh-CN", "zh-TW"]) {
    const t = translate(locale);
    const results = searchSettings(t("settings.imageModel"), t, options);
    assert.ok(results.some(result => result.tab === "agent" && result.rowKey === "settings.defaultsTitle"));
    assert.ok(results.every(result => result.tab !== "ai"));
  }
});

test("every indexed keyword remains discoverable with the existing visibility and limit rules", () => {
  const t = translate("en");
  for (const entry of SETTINGS_NAV) {
    for (const keyword of entry.keywordKeys) {
      assert.ok(searchSettings(t(keyword), t, options).some(result => result.tab === entry.id), keyword);
    }
  }
  assert.deepEqual(searchSettings("   ", t, options), []);
  assert.deepEqual(searchSettings("not-a-settings-match", t, options), []);
  assert.ok(searchSettings(t("settings.configSync.endpoint"), t).every(result => result.tab !== "sync"));
  assert.ok(searchSettings(t("settings.remoteHosts.addTitle"), t, {
    ...options, includeDevelopmentOnly: false,
  }).every(result => result.tab !== "remoteHosts"));
  assert.equal(searchSettings("settings", key => key, { limit: 2 }).length, 2);
  assert.equal(searchSettings("settings", key => key, { limit: 0 }).length, 0);
});
