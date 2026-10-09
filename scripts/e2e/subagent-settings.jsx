// Production SettingsPage/store/API, with fixture I/O only at preload.
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import { catalogs } from "@pi-desktop/i18n";
import { IPC, fallbackBuiltinDefinitions } from "@pi-desktop/shared";
import { api } from "../../apps/desktop/src/lib/api";
import { SettingsPage } from "../../apps/desktop/src/features/settings/SettingsPage";
import { useAppStore } from "../../apps/desktop/src/stores/app-store";

let stored = { language: "zh-CN", theme: "light", defaultMode: "agent", enterToSend: true };
let failSave = false;
const writes = [];
window.piDesktop = {
  platform: "darwin", locale: "zh-CN", on: () => () => {},
  async invoke(channel, input) {
    let data = null;
    switch (channel) {
      case IPC.invoke.settingsGet: data = structuredClone(stored); break;
      case IPC.invoke.settingsSet:
        if (failSave) return { ok: false, error: { code: "TEST_SAVE", message: "Fixture settings unavailable" } };
        writes.push(structuredClone(input));
        stored = { ...stored, ...input };
        break;
      case IPC.invoke.subagentList: data = { subagents: [] }; break;
      case IPC.invoke.subagentCatalog: data = { builtins: fallbackBuiltinDefinitions().map(definition => ({ ...definition, enabled: true })), subagents: [] }; break;
      case IPC.invoke.pluginScenicThemesDestinations:
      case IPC.invoke.systemFontsList: data = []; break;
    }
    return { ok: true, data };
  },
};
await i18n.use(initReactI18next).init({ lng: "zh-CN", fallbackLng: "en", interpolation: { escapeValue: false },
  resources: Object.fromEntries(Object.entries(catalogs).map(([language, catalog]) => [language, { translation: catalog }])) });
document.documentElement.dataset.theme = "light";
const root = createRoot(document.getElementById("root"));
let revision = 0;
const assert = (value, message) => { if (!value) throw new Error(message); };
const settled = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
const field = name => document.querySelector(`input[aria-label="${i18n.t(`settings.${name}`)}"]`);
async function until(condition, label) {
  const deadline = performance.now() + 5000;
  while (!condition() && performance.now() < deadline) await settled();
  assert(condition(), label);
}
async function mount() {
  useAppStore.setState({ settingsTab: "subagents", settings: await api.getSettings(), version: null });
  flushSync(() => root.render(<SettingsPage key={++revision} />));
  await until(() => field("subagentMaxDepth") && !document.querySelector(".agent-capability-skeleton"), "Subagent settings render and finish loading");
}
async function enter(name, value, commit = "blur") {
  const input = field(name);
  assert(input && !input.disabled, `${name} must accept input`);
  input.focus();
  input.select();
  await window.subagentFixtureInput(value, commit);
  await until(() => !field(name).disabled, `${name} save settled`);
  await settled();
}
window.subagentSettingsProbe = async () => {
  const checks = [];
  await mount();
  assert(field("subagentMaxDepth").value === "1" && field("subagentMaxConcurrency").value === "10", "Legacy settings display default 1/10");
  assert(field("subagentMaxDepth").min === "0" && field("subagentMaxDepth").max === "8", "Depth native limits are 0..8");
  assert(field("subagentMaxConcurrency").min === "1" && field("subagentMaxConcurrency").max === "32", "Concurrency native limits are 1..32");
  checks.push("legacy-defaults-and-native-bounds");
  await enter("subagentMaxDepth", "2");
  assert(stored.subagentMaxDepth === 2 && useAppStore.getState().settings.subagentMaxDepth === 2, `Blur commits Host-confirmed depth: ${JSON.stringify({ stored, writes, value: field("subagentMaxDepth").value })}`);
  assert(JSON.stringify(writes.at(-1)) === JSON.stringify({ subagentMaxDepth: 2 }), "Only edited depth field reaches IPC");
  await enter("subagentMaxConcurrency", "4", "Enter");
  assert(stored.subagentMaxConcurrency === 4 && useAppStore.getState().settings.subagentMaxConcurrency === 4, "Enter commits concurrency");
  assert(JSON.stringify(writes.at(-1)) === JSON.stringify({ subagentMaxConcurrency: 4 }), "Only edited concurrency reaches IPC");
  checks.push("blur-and-Enter-save-through-typed-IPC");

  for (const [name, value, expected] of [["subagentMaxDepth", "9", "2"], ["subagentMaxDepth", "1.5", "2"],
    ["subagentMaxDepth", "", "2"], ["subagentMaxConcurrency", "0", "4"], ["subagentMaxConcurrency", "33", "4"]]) {
    const before = writes.length;
    await enter(name, value);
    assert(field(name).value === expected && writes.length === before, "Invalid input reverts without an IPC write");
  }
  assert(useAppStore.getState().toasts.some(toast => toast.variant === "error"), "Invalid values report an error");
  checks.push("invalid-empty-fractional-and-out-of-range-revert");
  failSave = true;
  await enter("subagentMaxDepth", "3");
  assert(field("subagentMaxDepth").value === "2" && stored.subagentMaxDepth === 2, "Failed save retains confirmed depth");
  assert(useAppStore.getState().toasts.some(toast => toast.message.includes("Fixture settings unavailable")), "Host failure reaches user error notification");
  failSave = false;
  await enter("subagentMaxDepth", "0");
  await enter("subagentMaxConcurrency", "1");
  assert(stored.subagentMaxDepth === 0 && stored.subagentMaxConcurrency === 1, "Lower bounds persist");
  await enter("subagentMaxDepth", "8");
  await enter("subagentMaxConcurrency", "32");
  assert(stored.subagentMaxDepth === 8 && stored.subagentMaxConcurrency === 32, "Upper bounds persist");
  checks.push("save-failure-and-both-boundaries");
  await enter("subagentMaxDepth", "2");
  await enter("subagentMaxConcurrency", "4");
  await mount();
  assert(field("subagentMaxDepth").value === "2" && field("subagentMaxConcurrency").value === "4", "Reload restores confirmed preferences");
  assert([...document.querySelectorAll(".agent-subagents-page [aria-label]")].some(element => element.getAttribute("aria-label").includes("每位专家拥有独立的任务树")), "Chinese policy description is reachable from the standard help control");
  checks.push("reload-and-localized-expert-policy");
  await settled();
  await Promise.allSettled(document.getAnimations().filter(animation => animation.effect?.getComputedTiming().endTime !== Infinity).map(animation => animation.finished));
  await settled();
  const rects = [field("subagentMaxDepth"), field("subagentMaxConcurrency")].map(input => input.getBoundingClientRect());
  assert(rects.every(rect => rect.width >= 70 && rect.right <= window.innerWidth && rect.top >= 0 && rect.bottom <= window.innerHeight), "Both inputs remain visible and usable");
  return { ok: true, checks, finalValues: { depth: stored.subagentMaxDepth, concurrency: stored.subagentMaxConcurrency }, writes: writes.length,
    boundary: "isolated preload fixture; production SettingsPage/store/API and compiled production CSS" };
};
