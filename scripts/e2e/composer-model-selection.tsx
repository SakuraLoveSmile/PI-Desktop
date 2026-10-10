import { useState } from "react";
import { createInstance } from "i18next";
import { catalogs } from "@pi-desktop/i18n";
import { I18nextProvider } from "react-i18next";
import { ScheduledModelPicker } from "../../apps/desktop/src/features/scheduled/ScheduledModelPicker";
import type { ScheduledModelSelection } from "../../apps/desktop/src/features/scheduled/ScheduledExecutionSettings";
import { ComposerModelPicker } from "../../apps/desktop/src/features/chat/composer/ComposerModelPicker";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import type { ModelInfo, ProviderPublic, SessionThinkingLevel } from "@pi-desktop/shared";
import { useComposerModelMenu } from "../../apps/desktop/src/features/chat/composer/hooks/useComposerModelMenu";
import { useAppStore } from "./fixtures/composer-model-selection-store";

type MenuController = ReturnType<typeof useComposerModelMenu>;

declare global {
  var composerModelSelectionProbe: () => Promise<{
    model: string;
    switchedLevel: string;
    level: string;
    writes: Array<{ providerId?: string; modelId?: string; thinkingLevel: SessionThinkingLevel }>;
  }>;
  var composerModelSelectionController: MenuController | undefined;
}

const i18n = createInstance();

const provider: ProviderPublic = {
  id: "fixture-provider",
  name: "Fixture provider",
  vendorKey: "custom",
  type: "openai_compatible",
  protocol: "openai_compatible",
  enabled: true,
  authKind: "none",
  hasSecret: false,
  models: [
    { id: "model-a", contextWindow: 32_000, maxTokens: 4_000, thinkingLevels: ["low", "high"], defaultThinkingLevel: "high" },
    { id: "model-b", alias: "Focused B", contextWindow: 32_000, maxTokens: 4_000, thinkingLevels: ["low", "high"], defaultThinkingLevel: "high" },
  ],
  supportsReasoning: true,
  supportedThinkingLevels: ["low", "high"],
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

const models: ModelInfo[] = ["model-a", "model-b"].map((modelId) => ({
  modelId,
  displayName: modelId === "model-a" ? "Model A" : "Model B",
  providerId: provider.id,
  reasoning: true,
  contextWindow: 32_000,
  supportedThinkingLevels: ["low", "high"],
  capabilities: ["text", "reasoning"],
  source: "user",
}));

useAppStore.setState({ providers: [provider], providerModels: { [provider.id]: models } });

const host = document.createElement("div");
document.body.append(host);
const root = createRoot(host);
const writes: Array<{ providerId?: string; modelId?: string; thinkingLevel: SessionThinkingLevel }> = [];

function Fixture({ initialModel = "model-a" }: { initialModel?: string }) {
  const [modelId, setModelId] = useState(initialModel);
  // Start with a manual value that differs from Model A's default.
  const [thinkingLevel, setThinkingLevel] = useState<SessionThinkingLevel>("low");
  const controller = useComposerModelMenu({
    mode: "agent",
    activeSessionId: "fixture-session",
    provider,
    modelId,
    thinkingProvider: undefined,
    thinkingLevel,
    controlsBlocked: false,
    configureActiveSession: async (configuration) => {
      writes.push(configuration);
      setModelId(configuration.modelId ?? "model-a");
      setThinkingLevel(configuration.thinkingLevel);
    },
  });
  globalThis.composerModelSelectionController = controller;
  return (
    <div className="composer-stack" style={{ position: "absolute", left: 120, top: 300, width: 640 }}>
      <ComposerModelPicker
        t={i18n.t} controller={controller} modelLabel={modelId}
        thinkingLabel={thinkingLevel} thinkingLevel={thinkingLevel}
        selectedProviderId={provider.id} selectedModelId={modelId}
        controlsBlocked={false} onCloseOtherMenus={() => {}}
        onOpenModelSettings={() => useAppStore.getState().setSettingsTab("agent")}
      />
      <span className="selected-model">{modelId}</span>
      <span className="selected-thinking-level">{thinkingLevel}</span>
    </div>
  );
}

function ScheduledFixture() {
  const [selection, setSelection] = useState<ScheduledModelSelection>({
    providerId: provider.id, modelId: "model-a", thinkingLevel: "low",
  });
  const [draft, setDraft] = useState("Unsaved scheduled task draft");
  return <I18nextProvider i18n={i18n}>
    <div style={{ position: "absolute", left: 120, top: 300, width: 640 }}>
      <input className="scheduled-draft" value={draft} onChange={(event) => setDraft(event.target.value)} />
      <span className="scheduled-model">{selection.modelId ?? "default"}</span>
      <ScheduledModelPicker value={selection} disabled={false} onChange={setSelection} />
    </div>
  </I18nextProvider>;
}

const settle = () => new Promise<void>((resolve) =>
  requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
);

function element<T extends HTMLElement = HTMLElement>(selector: string): T {
  const found = document.querySelector<T>(selector);
  if (!found) throw new Error(`Missing ${selector}`);
  return found;
}
const assert = (value: unknown, message: string) => { if (!value) throw new Error(message); };
async function until(check: () => boolean, message: string) {
  const deadline = performance.now() + 5000;
  while (!check() && performance.now() < deadline) await settle();
  assert(check(), message);
}
function key(target: HTMLElement, value: string, isComposing = false) {
  flushSync(() => target.dispatchEvent(new KeyboardEvent("keydown", {
    key: value, isComposing, bubbles: true, cancelable: true,
  })));
}
globalThis.composerModelSelectionProbe = async () => {
  await i18n.init({ lng: "en", resources: { en: { translation: catalogs.en } },
    interpolation: { escapeValue: false } });
  flushSync(() => root.render(<Fixture />));
  await settle();
  element<HTMLButtonElement>(".composer-model-thinking-chip").click();
  await until(() => document.activeElement === document.querySelector('[title="model-a"]'),
    "opening the direct list must focus its current model");
  await until(() => {
    const menu = element(".composer-model-thinking-menu");
    return getComputedStyle(menu).transform === "none" && !menu.getAnimations().some(
      (animation) => animation.pending || animation.playState === "running",
    );
  }, "model menu entrance must settle before geometry checks");
  assert(!document.querySelector(".composer-model-search"), "the direct list has no search field");
  assert(document.querySelectorAll(".composer-model-option").length === 2, "models must show on first click");
  assert(!document.querySelector(".composer-menu-entry, .composer-menu-back"), "no model submenu navigation remains");
  assert(element('[title="model-a"]').getAttribute("aria-checked") === "true", "current model is selected");
  assert(element('[title="model-b"] .composer-model-label').textContent === "Focused B", "configured aliases remain visible");
  assert(element(".composer-model-option-provider").textContent?.trim() === "Fixture provider", "model metadata uses the actual provider");
  assert(element(".composer-model-option-ctx").textContent === "32K", "context window uses real metadata");
  assert(element(".composer-model-option-badge").getAttribute("aria-label") === i18n.t("chat.modelBadgeReasoning"), "capability icon is accessible");
  assert(getComputedStyle(element(".composer-model-option-main")).flexDirection === "column", "built styling places metadata below the name");
  assert(element(".composer-model-option-icon").getBoundingClientRect().width === 32, "built styling reserves the approved icon size");
  key(element('[title="model-a"]'), "ArrowDown");
  assert(element('[title="model-b"]').classList.contains("kb-active"), "ArrowDown selects next model");
  assert(document.activeElement === document.querySelector('[title="model-b"]'), "ArrowDown moves model focus");
  key(element('[title="model-b"]'), "Enter", true);
  await settle();
  assert(writes.length === 0, "IME Enter must not select a model");
  key(element('[title="model-b"]'), "ArrowUp");
  assert(document.activeElement === document.querySelector('[title="model-a"]'), "ArrowUp moves previous model focus");
  key(element('[title="model-a"]'), "ArrowDown");
  key(element('[title="model-b"]'), "Enter");
  await until(() => element(".selected-model").textContent === "model-b", "keyboard model selection failed");
  const switchedLevel = element(".selected-thinking-level").textContent?.trim() ?? "";
  assert(document.querySelector(".composer-model-thinking-menu"), "model selection preserves the reasoning surface");
  await until(() => document.querySelectorAll(".composer-model-option").length === 2, "model selection retains the complete list");
  const low = [...document.querySelectorAll<HTMLButtonElement>(".composer-thinking-tick")]
    .find((tick) => tick.textContent === "low")!;
  low.click();
  await until(() => element(".selected-thinking-level").textContent === "low", "slider commits a manual reasoning level");
  assert(element(".composer-model-thinking-chip").getAttribute("aria-expanded") === "true", "reasoning selection keeps the picker open");
  element<HTMLButtonElement>('[title="model-b"]').click();
  await until(() => writes.length === 3, "same-model pointer selection failed");
  key(element('[title="model-b"]'), "Escape");
  await until(() => !document.querySelector(".composer-model-thinking-menu"), "Escape closes the picker");
  assert(document.activeElement === document.querySelector(".composer-model-thinking-chip"), "closing restores trigger focus");
  element<HTMLButtonElement>(".composer-model-thinking-chip").click();
  await until(() => document.activeElement === document.querySelector('[title="model-b"]'), "reopening focuses the current model");
  element<HTMLButtonElement>(".composer-model-settings").click();
  await until(() => useAppStore.getState().settingsTab === "agent", "model management routes to the existing settings page");
  assert(!document.querySelector(".composer-model-thinking-menu"), "model management closes the picker");
  const result = {
    model: element(".selected-model").textContent?.trim() ?? "",
    switchedLevel,
    level: element(".selected-thinking-level").textContent?.trim() ?? "",
    writes: [...writes],
  };
  useAppStore.setState({ settingsTab: undefined });
  flushSync(() => root.render(<ScheduledFixture />));
  await settle();
  element<HTMLButtonElement>(".composer-model-thinking-chip").click();
  await until(() => document.querySelectorAll(".composer-model-option").length === 2, "scheduled picker opens the real model list");
  assert(!document.querySelector(".composer-model-settings"), "scheduled draft picker must not expose cross-page model settings");
  element<HTMLButtonElement>('[title="model-b"]').click();
  await until(() => element(".scheduled-model").textContent === "model-b", "scheduled model selection stays in the editor");
  assert(element<HTMLInputElement>(".scheduled-draft").value === "Unsaved scheduled task draft", "scheduled model selection preserves the unsaved draft");
  const reset = [...document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')]
    .find((button) => button.textContent === i18n.t("settings.defaultModel"));
  assert(reset, "scheduled picker retains its existing default-model action");
  reset!.click();
  await until(() => element(".scheduled-model").textContent === "default", "scheduled default-model action resets only model selection");
  assert(element<HTMLInputElement>(".scheduled-draft").value === "Unsaved scheduled task draft", "default-model action preserves the unsaved draft");
  assert(useAppStore.getState().settingsTab === undefined, "scheduled selection never navigates to settings");
  assert(!document.querySelector(".composer-model-thinking-menu"), "scheduled default-model action closes the picker");
  useAppStore.setState({ providers: [] });
  flushSync(() => root.render(<Fixture key="empty" />));
  await settle();
  const emptyTrigger = element<HTMLButtonElement>(".composer-model-thinking-chip");
  emptyTrigger.focus();
  emptyTrigger.click();
  await until(() => !!document.querySelector(".composer-model-thinking-menu.is-open"), "empty model menu opens");
  await settle();
  assert(!!document.querySelector(".composer-model-empty"), "empty model state remains visible");
  assert(!!document.querySelector(".composer-model-settings"), "chat still offers model setup when no models exist");
  assert(document.activeElement === emptyTrigger, "empty model list must not steal focus into its management action");
  key(emptyTrigger, "Escape");
  await until(() => !document.querySelector(".composer-model-thinking-menu"), "empty model picker closes");
  useAppStore.setState({ providers: [provider] });
  flushSync(() => root.render(<Fixture key="fallback" initialModel="unavailable" />));
  await settle();
  element<HTMLButtonElement>(".composer-model-thinking-chip").click();
  await until(() => document.activeElement === document.querySelector('[title="model-a"]'), "without a matching selection the first model receives focus");
  key(element('[title="model-a"]'), "Escape");
  return result;
};
