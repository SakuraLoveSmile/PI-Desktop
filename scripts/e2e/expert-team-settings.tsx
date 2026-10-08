import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { createInstance } from "i18next";
import { I18nextProvider } from "react-i18next";
import { catalogs } from "@pi-desktop/i18n";
import type { AppSettings, ExpertTeamPresetId, ProviderPublic } from "@pi-desktop/shared";
import { api } from "../../apps/desktop/src/lib/api";
import { SettingsPage } from "../../apps/desktop/src/features/settings/SettingsPage";
import { useAppStore } from "../../apps/desktop/src/stores/app-store";
import "../../apps/desktop/src/styles/tokens.css";
import "../../apps/desktop/src/styles/base.css";
import "../../apps/desktop/src/styles/ui-kit.css";
import "../../apps/desktop/src/styles/settings.css";
import "../../apps/desktop/src/styles/providers.css";
import "../../apps/desktop/src/styles/overlays.css";

declare global {
  var expertTeamSettingsProbe: () => Promise<unknown>;
  var expertTeamSettingsCleanup: (() => void) | undefined;
  var expertTeamSettingsViewportProbe: () => Promise<unknown>;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const assert = (value: unknown, message: string) => { if (!value) throw new Error(message); };
async function until(condition: () => boolean, label: string) {
  const deadline = performance.now() + 6000;
  while (!condition() && performance.now() < deadline) {
    await act(async () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));
  }
  assert(condition(), `Expected UI state: ${label}`);
}
function findButton(parent: ParentNode, label: string): HTMLButtonElement {
  const found = [...parent.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent?.trim() === label);
  if (!found) throw new Error(`Missing button: ${label}`);
  return found;
}
async function click(button: HTMLButtonElement) {
  assert(!button.disabled, `Button disabled: ${button.textContent}`);
  await act(async () => { button.click(); });
}
async function enter(textarea: HTMLTextAreaElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
  assert(setter && !textarea.disabled, "Textarea must accept edits");
  await act(async () => {
    setter?.call(textarea, value);
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function settleVisualTransitions() {
  await act(async () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));
  const finite = document.getAnimations().filter((animation) =>
    animation.effect?.getComputedTiming().endTime !== Infinity);
  // Canceled CSS transitions reject finished; their replacement styles are
  // checked after all current finite transitions have settled.
  await Promise.allSettled(finite.map((animation) => animation.finished));
  await act(async () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));
}

function textContrast(element: Element, background: string): number {
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Color verification context unavailable");
  const luminance = (color: string) => {
    context.clearRect(0, 0, 1, 1);
    context.fillStyle = color;
    context.fillRect(0, 0, 1, 1);
    const rgb = [...context.getImageData(0, 0, 1, 1).data].slice(0, 3).map((channel) => {
      const value = channel / 255;
      return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];
  };
  const foreground = luminance(getComputedStyle(element).color);
  const backdrop = luminance(background);
  return (Math.max(foreground, backdrop) + 0.05) / (Math.min(foreground, backdrop) + 0.05);
}

globalThis.expertTeamSettingsProbe = async () => {
  const i18n = createInstance();
  await i18n.init({ lng: "zh-CN", resources: { "zh-CN": { translation: catalogs["zh-CN"] }, en: { translation: catalogs.en } } });
  const t = (key: string) => i18n.t(key);
  document.documentElement.dataset.theme = "dark";
  document.documentElement.dataset.platform = "darwin";
  const container = document.createElement("div");
  container.style.height = "100vh";
  document.body.append(container);
  const root = createRoot(container);
  const original = { getSettings: api.getSettings, setSettings: api.setSettings, listProjects: api.listProjects,
    listPluginScenicThemesDestinations: api.listPluginScenicThemesDestinations, onPluginChanged: api.onPluginChanged };
  const initial: AppSettings = { language: "zh-CN", theme: "dark", defaultMode: "agent", enterToSend: true,
    expertTeam: { schemaVersion: 1, userDefaults: {}, projectOverrides: {} } };
  let stored = structuredClone(initial);
  let writeCount = 0;
  let interleave: (() => void) | null = null;
  let failSave = false;
  let readGate: Promise<void> | null = null;
  let revision = 0;
  const checks: string[] = [];
  const provider: ProviderPublic = {
    id: "fixture-service", name: "Fixture Service", vendorKey: "custom", type: "custom", protocol: "openai-completions",
    enabled: true, authKind: "none", hasSecret: false, supportsReasoning: true, supportedThinkingLevels: ["low", "high"],
    createdAt: "", updatedAt: "", models: [{ id: "fixture-model", contextWindow: 16000, maxTokens: 4096,
      thinkingLevels: ["low", "high"], defaultThinkingLevel: "high" }],
  };
  api.getSettings = async () => { if (readGate) await readGate; return structuredClone(stored); };
  api.setSettings = async (settings) => {
    if (failSave) throw new Error("Fixture storage unavailable");
    interleave?.();
    interleave = null;
    if (JSON.stringify(settings.expertTeamExpected) !== JSON.stringify(stored.expertTeam)) {
      throw Object.assign(new Error("Concurrent settings"), { code: "TEAM_CONFIG_CONFLICT" });
    }
    writeCount++;
    stored = { ...stored, expertTeam: structuredClone(settings.expertTeam) };
  };
  api.listProjects = async () => ({ projects: [
    { id: 1, path: "/fixture/StarTool", name: "StarTool", pinned: false, createdAt: 1, lastOpenedAt: 1 },
    { id: 2, path: "/fixture/Music", name: "Music", pinned: false, createdAt: 1, lastOpenedAt: 1 },
  ] });
  api.listPluginScenicThemesDestinations = async () => [];
  api.onPluginChanged = () => () => {};
  const mount = async () => {
    useAppStore.setState({ settings: structuredClone(stored), settingsTab: "expertTeam", providers: [provider],
      providerModels: {}, activeProjectPath: "/fixture/StarTool", version: null });
    await act(async () => { root.render(createElement(I18nextProvider, { i18n }, createElement(SettingsPage, { key: ++revision }))); });
    await until(() => document.querySelector('[role="tab"] span[title="/fixture/StarTool"]') !== null, "Host project scopes");
  };
  const roleCard = (role: ExpertTeamPresetId) => {
    const card = document.querySelector<HTMLElement>(`[data-testid="expert-team-role-${role}"]`);
    if (!card) throw new Error(`Missing role: ${role}`);
    return card;
  };
  const edit = async (role: ExpertTeamPresetId) => click(findButton(roleCard(role), t("settings.expertTeam.edit")));
  const roleAction = async (role: ExpertTeamPresetId, key: string) => click(findButton(roleCard(role), t(`settings.expertTeam.${key}`)));
  const scope = async (name: string) => {
    const tabs = document.querySelector('[role="tablist"]');
    if (!tabs) throw new Error("Missing scopes");
    const button = [...tabs.querySelectorAll<HTMLButtonElement>("button")].find((item) => item.textContent?.trim().startsWith(name));
    if (!button) throw new Error(`Missing scope ${name}`);
    await click(button);
  };
  const inheritCheckbox = async (role: ExpertTeamPresetId, key: string) => {
    const labels = [...roleCard(role).querySelectorAll("label.ui-checkbox")];
    const checkbox = labels.find((label) => label.textContent === t(`settings.expertTeam.${key}`))?.querySelector<HTMLInputElement>("input");
    assert(checkbox && !checkbox.disabled, `Missing inheritance field: ${key}`);
    await act(async () => { checkbox?.click(); });
  };
  const pick = async (role: ExpertTeamPresetId, key: string, label: string) => {
    const trigger = [...roleCard(role).querySelectorAll<HTMLButtonElement>("button")].find((button) => button.getAttribute("aria-label") === t(`settings.expertTeam.${key}`));
    if (!trigger) throw new Error(`Missing picker: ${key}`);
    await click(trigger);
    const option = [...document.querySelectorAll<HTMLButtonElement>('[role="option"]')].find((item) => item.textContent?.trim() === label);
    if (!option) throw new Error(`Missing model option: ${label}`);
    await click(option);
  };
  const save = async (role: ExpertTeamPresetId) => {
    await roleAction(role, "save");
    await until(() => !roleCard(role).querySelector(".expert-team-role-editor"), "saved editor closes");
  };
  try {
    await mount();
    assert(document.querySelectorAll(".expert-team-role-card").length === 6, "Six built-in roles must match reference");
    const rail = document.querySelector(".settings-nav-scroll");
    assert(rail && findButton(rail, t("settings.expertTeam.title")), "Explicit expert team navigation must be reachable");
    await click(findButton(rail!, t("settings.expertTeam.title")));
    checks.push("production Settings navigation and six roles");
    await edit("researcher");
    await pick("researcher", "model", "Fixture Service · fixture-model");
    await pick("researcher", "thinking", "high");
    await inheritCheckbox("researcher", "toolsInherit");
    await click(findButton(roleCard("researcher"), "Read"));
    await inheritCheckbox("researcher", "instructionsInherit");
    await enter(roleCard("researcher").querySelector<HTMLTextAreaElement>("textarea")!, "Investigate before changing files.");
    // Simulate a concurrent edit of an unrelated preference unseen by the renderer.
    stored = { ...stored, enterToSend: false };
    await save("researcher");
    assert(stored.enterToSend === false, "Save must retain newest unrelated Host settings");
    assert(stored.expertTeam?.userDefaults.researcher?.providerId === provider.id, "Model must store provider identity");
    assert(stored.expertTeam?.userDefaults.researcher?.tools?.join(",") === "Read", "Role tool assignment must persist");
    await mount();
    await edit("researcher");
    assert(roleCard("researcher").querySelector("textarea")?.value === "Investigate before changing files.", "Saved config must reopen");
    checks.push("edit configured model, supported thinking, tools, instructions; save and reopen");

    await scope("StarTool");
    await edit("researcher");
    assert(roleCard("researcher").textContent?.includes("Fixture Service · fixture-model"), "Project scope must show inherited model");
    await inheritCheckbox("researcher", "instructionsInherit");
    await enter(roleCard("researcher").querySelector<HTMLTextAreaElement>("textarea")!, "StarTool-specific guidance.");
    await save("researcher");
    const override = stored.expertTeam?.projectOverrides["/fixture/StarTool"]?.researcher;
    assert(override?.instructions === "StarTool-specific guidance." && override.providerId === undefined, "Project only overrides edited field");
    await scope("Music");
    await edit("researcher");
    assert(roleCard("researcher").querySelector("textarea")?.value === "Investigate before changing files.", "Another project must inherit user defaults");
    await scope("StarTool");
    await edit("researcher");
    await roleAction("researcher", "reset");
    await until(() => !roleCard("researcher").querySelector(".expert-team-role-editor"), "reset closes editor");
    assert(stored.expertTeam?.projectOverrides["/fixture/StarTool"] === undefined, "Reset must delete only selected override");
    checks.push("project field inheritance, project isolation, reset to current defaults");

    await scope(t("settings.expertTeam.userScope"));
    await edit("qa");
    await inheritCheckbox("qa", "instructionsInherit");
    await enter(roleCard("qa").querySelector<HTMLTextAreaElement>("textarea")!, "Keep failure draft.");
    failSave = true;
    await roleAction("qa", "save");
    await until(() => roleCard("qa").querySelector('[role="alert"]') !== null, "save failure visible");
    assert(roleCard("qa").querySelector("textarea")?.value === "Keep failure draft.", "Save failure must preserve draft");
    assert(stored.expertTeam?.userDefaults.qa === undefined, "Failure cannot update confirmed config");
    failSave = false;
    await save("qa");
    checks.push("Host save failure visible, draft retained and retry succeeds");

    await edit("qa");
    await enter(roleCard("qa").querySelector<HTMLTextAreaElement>("textarea")!, "CAS QA edit.");
    interleave = () => {
      stored = { ...stored, theme: "light", expertTeam: { ...stored.expertTeam!, userDefaults: {
        ...stored.expertTeam!.userDefaults, fullstack: { instructions: "Other window fullstack" },
      } } };
    };
    await save("qa");
    assert(stored.theme === "light" && stored.expertTeam?.userDefaults.fullstack?.instructions === "Other window fullstack", "CAS rebase must preserve concurrent unrelated fields and other roles");
    await edit("qa");
    await enter(roleCard("qa").querySelector<HTMLTextAreaElement>("textarea")!, "Stale QA edit.");
    interleave = () => { stored.expertTeam!.userDefaults.qa = { instructions: "Other window QA edit" }; };
    await roleAction("qa", "save");
    await until(() => roleCard("qa").querySelector('[role="alert"]') !== null, "same role collision visible");
    assert(roleCard("qa").querySelector("textarea")?.value === "Stale QA edit.", "Conflict must preserve local draft");
    assert(stored.expertTeam!.userDefaults.qa!.instructions === "Other window QA edit", "Conflict must preserve other window's edit");
    await roleAction("qa", "cancel");
    await edit("qa");
    assert(roleCard("qa").querySelector("textarea")?.value === "Other window QA edit", "Cancel and reopen must recover the confirmed other window config");
    await roleAction("qa", "cancel");
    checks.push("interleaved settings CAS rebases other-role edit once; same-role edit conflicts visibly");

    await edit("qa");
    await enter(roleCard("qa").querySelector<HTMLTextAreaElement>("textarea")!, "Discard on scope change.");
    const beforeSwitch = writeCount;
    await scope("Music");
    assert(writeCount === beforeSwitch && !document.querySelector(".expert-team-role-editor"), "Scope changes must discard drafts without autosaving");
    await scope(t("settings.expertTeam.userScope"));
    await edit("qa");
    assert(roleCard("qa").querySelector("textarea")?.value === "Other window QA edit", "Scope switch must not transfer abandoned edits");
    checks.push("scope switch discards unsaved draft without autosave");

    stored.expertTeam!.userDefaults.debugger = { providerId: "removed", modelId: "old-model" };
    await mount();
    await edit("debugger");
    assert(roleCard("debugger").textContent?.includes("removed · old-model"), "Unavailable saved route must stay visible");
    assert(roleCard("debugger").querySelector('[role="alert"]') && findButton(roleCard("debugger"), t("settings.expertTeam.save")).disabled,
      "Unavailable model must show error and prevent silently replacing it");
    await roleAction("debugger", "reset");
    await until(() => !roleCard("debugger").querySelector(".expert-team-role-editor"), "unavailable config reset");
    checks.push("unavailable saved model remains visible; explicit reset recovers");

    stored.expertTeam!.projectOverrides["/fixture/DeletedProject"] = { debugger: { instructions: "Old project configuration" } };
    await mount();
    await scope("DeletedProject");
    assert(document.querySelector(".expert-team-project-path")?.textContent === "/fixture/DeletedProject", "Removed project scope must stay visible with exact identity");
    await click(findButton(document.querySelector(".expert-team-settings")!, t("settings.expertTeam.removeProjectOverrides")));
    await until(() => stored.expertTeam?.projectOverrides["/fixture/DeletedProject"] === undefined, "deleted project config removal");
    assert(stored.expertTeam?.userDefaults.researcher?.modelId === "fixture-model", "Project removal cannot delete user role defaults");
    checks.push("removed project scope stays visible and explicit clear removes only its overrides");

    await edit("qa");
    await enter(roleCard("qa").querySelector<HTMLTextAreaElement>("textarea")!, "Never submit after navigation.");
    let release!: () => void;
    readGate = new Promise<void>((resolve) => { release = resolve; });
    const beforeNavigation = writeCount;
    await roleAction("qa", "save");
    await act(async () => { root.render(null); });
    readGate = null;
    release();
    await act(async () => { await Promise.resolve(); });
    assert(writeCount === beforeNavigation, "Unmount while reading latest settings must cancel stale submission");
    checks.push("navigation while save read is pending cancels stale submission");

    stored = structuredClone(initial);
    await mount();
    globalThis.expertTeamSettingsViewportProbe = async () => {
      stored = { ...stored, theme: "light" };
      await act(async () => {
        useAppStore.setState({ settings: structuredClone(stored) });
        document.documentElement.dataset.theme = "light";
      });
      await edit("researcher");
      await settleVisualTransitions();
      assert(useAppStore.getState().settings?.theme === "light" && document.documentElement.dataset.theme === "light",
        "Confirmed settings and rendered theme must agree");
      const content = document.querySelector<HTMLElement>(".settings-content");
      assert(content, "Settings content must remain mounted");
      assert(content!.scrollWidth <= content!.clientWidth + 1, "Narrow settings content cannot overflow horizontally");
      const card = roleCard("researcher").getBoundingClientRect();
      for (const field of roleCard("researcher").querySelectorAll<HTMLElement>(".settings-menu-select-anchor, textarea")) {
        const rect = field.getBoundingClientRect();
        assert(rect.right <= card.right + 1 && rect.left >= card.left - 1, "Narrow editor fields must remain within their role card");
      }
      const background = getComputedStyle(document.documentElement).getPropertyValue("--ds-bg-primary");
      const cancel = findButton(roleCard("researcher"), t("settings.expertTeam.cancel"));
      const readability = [
        ...document.querySelectorAll(".settings-nav-item, .expert-team-scope-tabs .settings-segment-item"), cancel,
      ].map((element) => ({ label: element.textContent?.trim(), contrast: textContrast(element, background) }));
      assert(readability.every((item) => item.contrast >= 3), `Stable light labels must remain readable: ${JSON.stringify(readability)}`);
      return { ok: true, theme: "light", viewport: window.innerWidth, minimumLabelContrast: Math.min(...readability.map((item) => item.contrast)) };
    };
    return { ok: true, checks, writes: writeCount };
  } finally {
    globalThis.expertTeamSettingsCleanup = () => {
      root.unmount(); container.remove(); Object.assign(api, original);
    };
  }
};
