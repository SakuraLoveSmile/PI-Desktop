import React, { act, useState } from "react";
import { createRoot } from "react-dom/client";
import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import { catalogs, flattenCatalog } from "@pi-desktop/i18n";
import { IPC, PROMPT_ENHANCEMENT_DEFAULT_USER_TEMPLATE, PROMPT_ENHANCEMENT_DRAFT_VARIABLE } from "@pi-desktop/shared";
import { LiveVoiceSettings } from "../../src/features/settings/voice/LiveVoiceSettings";
import { NetworkProxySection } from "../../src/components/settings/NetworkProxySection";
import { DeveloperSection, CloseBehaviorSection } from "../../src/features/settings/developer-sections";
import { PromptEnhancementCard } from "../../src/features/settings/prompt-enhancement-card";
import { useAppStore } from "../../src/stores/app-store";

window.IS_REACT_ACT_ENVIRONMENT = true;
const listeners = new Map();
const settings = { liveVoice: { enabled: false, selectedBindingId: "gemini", bindings: [
  { id: "gemini", adapterId: "gemini-live", providerId: "google", modelId: "old-model", voice: "Kore" },
] } };
let providerFailure = false;
const providers = [{ id: "google", name: "Google test account", vendorKey: "google", authKind: "api-key", apiStyle: "google_generative_ai", enabled: true, hasSecret: true, baseUrl: "https://invalid.example", models: [{ id: "test-model", thinkingLevels: ["off"] }], defaultModelId: "test-model" }];
const status = { enabled: false, bindings: [{ bindingId: "gemini", adapterId: "gemini-live", selectable: true }], call: null };
const unexpected = [];
const calls = [];
let closeReadFailure = true;
let closeWriteFailure = false;
let closeBehavior = "tray";
let settingsWriteFailure = false;
let writtenSettings;
window.piDesktop = {
  on(channel, callback) {
    const handlers = listeners.get(channel) ?? new Set();
    handlers.add(callback); listeners.set(channel, handlers);
    return () => handlers.delete(callback);
  },
  async invoke(channel, request) {
    if (channel === IPC.invoke.settingsGet) return { ok: true, data: settings };
    if (channel === IPC.invoke.liveVoiceStatus) return { ok: true, data: status };
    if (channel === IPC.invoke.providersList) return providerFailure
      ? { ok: false, error: { code: "FIXTURE", message: "accounts unavailable" } }
      : { ok: true, data: { providers } };
    if (channel === IPC.invoke.closeBehaviorGet) return closeReadFailure
      ? { ok: false, error: { code: "FIXTURE", message: "close preference unavailable" } }
      : { ok: true, data: { behavior: closeBehavior } };
    if (channel === IPC.invoke.closeBehaviorSet) {
      if (closeWriteFailure) return { ok: false, error: { code: "FIXTURE", message: "close preference rejected" } };
      closeBehavior = request.behavior;
      return { ok: true, data: { behavior: closeBehavior } };
    }
    if (channel === IPC.invoke.settingsSet) {
      if (settingsWriteFailure) return { ok: false, error: { code: "FIXTURE", message: "preference rejected" } };
      writtenSettings = request;
      return { ok: true, data: request };
    }
    if (channel === IPC.invoke.devtoolsToggle) {
      calls.push({ channel, request });
      return { ok: true, data: { open: request.open } };
    }
    if (channel === IPC.invoke.networkProxyTest) {
      calls.push({ channel, request });
      return { ok: true, data: { ok: false, error: "fixture connection failed" } };
    }
    unexpected.push(channel);
    throw new Error("Unexpected preference fixture IPC: " + channel);
  },
};
await i18n.use(initReactI18next).init({ lng: "en", keySeparator: false,
  resources: { en: { translation: flattenCatalog(catalogs.en) } } });
const root = createRoot(document.getElementById("root"));
const check = (value, message) => { if (!value) throw new Error(message); };
const input = (key) => document.querySelector('input[aria-label="' + i18n.t(key) + '"]');
const change = async (element, value) => {
  await act(async () => {
    Object.getOwnPropertyDescriptor(element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype, "value").set.call(element, value);
    element.dispatchEvent(new Event("input", { bubbles: true }));
  });
};
const named = (key, selector = "button", scope = document) => {
  const label = i18n.t(key);
  return [...scope.querySelectorAll(selector)].find(element => element.getAttribute("aria-label") === label || element.textContent.trim() === label);
};
const click = async (key, scope = document) => {
  const element = named(key, "button", scope);
  check(element && !element.disabled, "Missing enabled control: " + key);
  await act(async () => element.click());
};
const blur = async element => { await act(async () => element.dispatchEvent(new FocusEvent("focusout", { bubbles: true }))); };
window.runTests = async () => {
  const checks = [];
  let rejectSave = true;
  let saved;
  function VoiceHarness() {
    const [current, setCurrent] = useState(settings);
    saved = current;
    return <LiveVoiceSettings t={i18n.t.bind(i18n)} settings={current} saveSettings={async patch => {
      if (rejectSave) throw new Error("settings rejected");
      setCurrent(s => ({ ...s, ...patch }));
    }} />;
  }
  await act(async () => root.render(<VoiceHarness />));
  const model = input("liveVoice.model");
  check(model?.value === "old-model", "Configured model is visible");
  await change(model, "edited-model");
  await act(async () => model.dispatchEvent(new FocusEvent("focusout", { bubbles: true })));
  check(input("liveVoice.model")?.value === "edited-model", "Failed voice save must preserve the model draft");
  rejectSave = false;
  await act(async () => model.dispatchEvent(new FocusEvent("focusout", { bubbles: true })));
  check(saved.liveVoice.bindings[0].modelId === "edited-model", "Retry saves the preserved model draft");
  checks.push("voice draft save failure and retry");
  const voice = input("liveVoice.voice");
  rejectSave = true;
  await change(voice, "edited-voice");
  await blur(voice);
  check(input("liveVoice.voice").value === "edited-voice" && document.querySelector('[role="alert"]'),
    "Voice draft remains editable with an inline save error");
  rejectSave = false;
  await blur(voice);
  check(saved.liveVoice.bindings[0].voice === "edited-voice", "Voice draft retry uses the edited value");
  await act(async () => {
    for (const listener of listeners.get(IPC.event.liveVoiceChanged) ?? []) listener({ callId: "fixture-call", revision: 1, bindingId: "gemini", phase: "connected" });
  });
  check(input("liveVoice.model").disabled && input("liveVoice.voice").disabled &&
    document.body.textContent.includes(i18n.t("liveVoice.bindingLockedDetail")),
    "Active binding fields are locked with the reason visible");
  await act(async () => {
    for (const listener of listeners.get(IPC.event.liveVoiceChanged) ?? []) listener({ callId: "fixture-call", revision: 2, bindingId: "gemini", phase: "ended" });
  });
  check(!input("liveVoice.model").disabled, "Ending the call unlocks its binding fields");
  checks.push("voice locked binding and unlock");
  providerFailure = true;
  await act(async () => root.render(<VoiceHarness key="failed-account-read" />));
  check(document.querySelector('[role="alert"]')?.textContent.includes(i18n.t("liveVoice.providersLoadFailed")),
    "Account loading failure is visible");
  providerFailure = false;
  await click("errors.action.retry");
  check(!document.querySelector('[role="alert"]') && document.body.textContent.includes("Google test account"),
    "Account list retry restores the selection");
  checks.push("voice account loading error and retry");

  let proxySaved;
  let proxyReject = false;
  const proxyPatches = [];
  function ProxyHarness() {
    const [current, setCurrent] = useState({ networkProxy: { mode: "system" } });
    proxySaved = current;
    return <NetworkProxySection settings={current} saveSettings={async patch => {
      if (proxyReject) throw new Error("proxy rejected");
      proxyPatches.push(patch);
      setCurrent(s => ({ ...s, ...patch }));
    }} />;
  }
  await act(async () => root.render(<ProxyHarness />));
  check(!input("settings.proxyUrl"), "Custom proxy fields are hidden for system mode");
  await click("settings.proxyCustom");
  check(proxySaved.networkProxy.mode === "custom" && input("settings.proxyUrl"),
    "Custom mode persists and reveals its fields");
  await change(input("settings.proxyUrl"), "invalid proxy");
  await blur(input("settings.proxyUrl"));
  check(input("settings.proxyUrl").getAttribute("aria-invalid") === "true" &&
    proxyPatches.length === 1, "Invalid proxy stays visible and is never persisted");
  proxyReject = true;
  await change(input("settings.proxyUrl"), "http://localhost:8080");
  await blur(input("settings.proxyUrl"));
  check(input("settings.proxyUrl").value === "http://localhost:8080", "Rejected proxy save retains the URL draft");
  proxyReject = false;
  await blur(input("settings.proxyUrl"));
  check(proxySaved.networkProxy.url === "http://localhost:8080", "Proxy URL retry persists its normalized value");
  await click("settings.proxyTest");
  check(document.body.textContent.includes("fixture connection failed") && calls.some(call => call.channel === IPC.invoke.networkProxyTest),
    "Proxy test failure is visible without contacting a network");
  await click("settings.proxyDirect");
  check(proxySaved.networkProxy.mode === "direct" && !input("settings.proxyUrl"), "Direct mode hides custom fields after saving");
  checks.push("proxy conditional fields, validation, failed save draft and retry");

  await act(async () => root.render(<CloseBehaviorSection />));
  check(document.body.textContent.includes(i18n.t("settings.closeBehaviorLoadError")) &&
    named("settings.closeBehaviorTray").disabled, "Failed close preference read cannot masquerade as an unset choice");
  closeReadFailure = false;
  await click("errors.action.retry");
  check(named("settings.closeBehaviorTray").getAttribute("aria-checked") === "true", "Retry reads the stored close choice");
  closeWriteFailure = true;
  await click("settings.closeBehaviorQuit");
  check(closeBehavior === "tray" && document.querySelector('[role="alert"]'), "Failed close choice keeps the saved selection");
  closeWriteFailure = false;
  await click("settings.closeBehaviorQuit");
  check(closeBehavior === "quit" && named("settings.closeBehaviorQuit").getAttribute("aria-checked") === "true",
    "Close preference retries and confirms the new selection");
  checks.push("close preference loading, retry, failure and save");

  let developerReject = true;
  function DeveloperHarness() {
    const [current, setCurrent] = useState({ developerMode: false });
    return <DeveloperSection settings={current} saveSettings={async patch => {
      if (developerReject) throw new Error("Developer mode rejected");
      setCurrent(s => ({ ...s, ...patch }));
    }} />;
  }
  await act(async () => root.render(<DeveloperHarness />));
  check(named("settings.openDevTools").disabled, "Developer console remains gated by developer mode");
  await click("settings.developerMode");
  check(named("settings.openDevTools").disabled && document.querySelector('[role="alert"]'),
    "Rejected developer toggle keeps the console locked and reports its failure");
  developerReject = false;
  await click("settings.developerMode");
  await click("settings.openDevTools");
  check(calls.some(call => call.channel === IPC.invoke.devtoolsToggle && call.request.open === true),
    "Successful toggle unlocks the existing developer console IPC");
  checks.push("developer mode failure recovery and console gate");

  let templateReject = true;
  let templateSaved;
  function TemplateHarness() {
    const [current, setCurrent] = useState({ promptEnhancementUserTemplate: "" });
    templateSaved = current;
    return <PromptEnhancementCard settings={current} saveSettings={async patch => {
      if (templateReject) throw new Error("template rejected");
      setCurrent(s => ({ ...s, ...patch }));
    }} />;
  }
  useAppStore.setState({ settings: { language: "en", defaultMode: "agent", theme: "light", enterToSend: true }, providers, providerModels: {} });
  await act(async () => root.render(<TemplateHarness />));
  check(document.body.textContent.includes(i18n.t("settings.promptEnhancementDefaultTemplateActive")), "Built-in template status is visible before editing");
  await click("settings.promptEnhancementEdit");
  let template = document.querySelector("textarea");
  check(template.value === PROMPT_ENHANCEMENT_DEFAULT_USER_TEMPLATE, "Template editor opens on the effective built-in template");
  await change(template, "Rewrite carefully: " + PROMPT_ENHANCEMENT_DRAFT_VARIABLE);
  await click("common.save");
  check(document.querySelector('[role="dialog"]') && template.value.startsWith("Rewrite carefully:") && document.querySelector('[role="alert"]'),
    "Failed template save keeps the editor and draft open");
  templateReject = false;
  await click("common.save");
  check(!document.querySelector('[role="dialog"]') && templateSaved.promptEnhancementCustomTemplate === true &&
    document.body.textContent.includes(i18n.t("settings.promptEnhancementCustomTemplateActive")),
    "Retry explicitly saves the custom template and updates its status");
  await click("settings.promptEnhancementEdit");
  await click("settings.promptEnhancementRestore");
  await click("common.save");
  check(templateSaved.promptEnhancementUserTemplate === "" && templateSaved.promptEnhancementCustomTemplate === false,
    "Restoring the built-in clears the override rather than freezing a copy");
  await click("settings.changeDefaultModel");
  const modelOption = document.querySelector('[role="option"][aria-label="Google test account · test-model"]');
  check(modelOption, "Prompt model picker uses configured account/model pairs");
  settingsWriteFailure = true;
  await act(async () => modelOption.click());
  check(document.querySelector('[role="option"]') && document.querySelector('[role="alert"]')?.textContent === "preference rejected",
    "Failed model save keeps the picker and its retry option available");
  settingsWriteFailure = false;
  await act(async () => modelOption.click());
  check(!document.querySelector('[role="option"]') && writtenSettings.promptEnhancementProviderId === "google" &&
    writtenSettings.promptEnhancementModelId === "test-model", "Retry saves the selected provider/model pair and closes the picker");
  check(named("settings.promptEnhancementThinking").disabled,
    "A configured model without reasoning keeps its thinking row disabled");
  await act(async () => useAppStore.setState({
    providers: [{ ...providers[0], supportsReasoning: true, supportedThinkingLevels: ["off", "low"], models: [{ id: "test-model", thinkingLevels: ["off", "low"] }] }],
  }));
  await click("settings.promptEnhancementThinking");
  const thinkingOptions = [...document.querySelectorAll('[role="option"]')].map(option => option.textContent.trim());
  check(thinkingOptions.length === 2 && thinkingOptions.includes("low") && !thinkingOptions.includes("high"),
    "The thinking picker offers the selected model's actual ladder");
  const low = [...document.querySelectorAll('[role="option"]')].find(option => option.textContent.trim() === "low");
  await act(async () => low.click());
  check(writtenSettings.promptEnhancementThinkingLevel === "low", "Selecting a supported thinking level persists it");
  await act(async () => useAppStore.setState({
    providers,
    settings: { ...useAppStore.getState().settings, promptEnhancementProviderId: "", promptEnhancementModelId: "", promptEnhancementThinkingLevel: "high" },
  }));
  await click("settings.changeDefaultModel");
  await act(async () => document.querySelector('[role="option"][aria-label="Google test account · test-model"]').click());
  check(writtenSettings.promptEnhancementThinkingLevel === "off", "Switching to a model without reasoning clamps the stored level");
  await click("settings.changeDefaultModel");
  await act(async () => named("settings.promptEnhancementModelFollow", '[role="option"]').click());
  check(writtenSettings.promptEnhancementProviderId === null && writtenSettings.promptEnhancementModelId === null,
    "Following the Composer clears both pin ids with explicit nulls");
  check(!document.querySelector('[role="option"]') &&
    document.body.textContent.includes(i18n.t("settings.promptEnhancementModelFollow")),
    "Clearing a model confirms the inherited model and closes the shared picker");
  checks.push("prompt template status, explicit draft save/retry, default restore and model save retry");
  check(unexpected.length === 0, "Only declared external edges may be called");
  await act(async () => root.unmount());
  return "PASS: " + checks.join("; ");
};
