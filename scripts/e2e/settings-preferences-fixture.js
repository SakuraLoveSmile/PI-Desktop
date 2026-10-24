import { IPC } from "@pi-desktop/shared";

/** Isolated account/status data; never starts media or talks to a provider. */
export function createPreferencesFixture(parameters = new URLSearchParams()) {
  const voiceState = parameters.get("voice") ?? "ready";
  const providers = [
    { id: "fixture-codex", name: "Codex test account", vendorKey: "openai-codex", authKind: "oauth", apiStyle: "openai_responses", enabled: true, hasSecret: true, hasOauth: true, models: [{ id: "gpt-test", thinkingLevels: ["off", "low", "high"] }], defaultModelId: "gpt-test" },
    { id: "fixture-google", name: "Google test account", vendorKey: "google", authKind: "api-key", apiStyle: "google_generative_ai", enabled: true, hasSecret: true, baseUrl: "https://invalid.example", models: [{ id: "gemini-test", thinkingLevels: ["off", "low", "high"] }], defaultModelId: "gemini-test" },
    { id: "fixture-openai", name: "OpenAI compatible test service", vendorKey: "openai", authKind: "api-key", apiStyle: "openai_responses", enabled: true, hasSecret: true, baseUrl: "https://invalid.example", models: [{ id: "gpt-test", thinkingLevels: ["off", "low", "high"] }], defaultModelId: "gpt-test" },
  ];
  const initialSettings = { liveVoice: {
    enabled: false,
    ...(voiceState !== "empty" ? { selectedBindingId: "fixture-gemini", bindings: [
      { id: "fixture-gemini", adapterId: "gemini-live", providerId: voiceState === "missing" ? "removed-account" : "fixture-google", modelId: "gemini-3.8-live", voice: "Kore" },
    ] } : { bindings: [] }),
  } };
  let closeBehavior = "tray";
  let providersFailed = voiceState === "load-error";
  const mutations = [];
  return {
    initialSettings,
    providers,
    mutations,
    invoke(channel, input) {
      switch (channel) {
        case IPC.invoke.providersList:
          if (!parameters.has("voice") && !parameters.has("preferences")) return { handled: false };
          if (providersFailed) { providersFailed = false; throw new Error("Fixture account list failed; retry is available"); }
          return { handled: true, data: { providers } };
        case IPC.invoke.liveVoiceStatus:
          return { handled: true, data: {
            enabled: false,
            selectedBindingId: initialSettings.liveVoice.selectedBindingId,
            bindings: initialSettings.liveVoice.bindings.map((binding) => ({
              bindingId: binding.id, adapterId: binding.adapterId,
              configured: true, credentialsPresent: voiceState !== "missing",
              selectable: voiceState !== "missing",
              ...(voiceState === "missing" ? { reason: "missing-provider" } : {}),
            })), call: null,
          } };
        case IPC.invoke.closeBehaviorGet: return { handled: true, data: { behavior: closeBehavior } };
        case IPC.invoke.closeBehaviorSet:
          closeBehavior = input.behavior;
          mutations.push({ channel, input });
          return { handled: true, data: { behavior: closeBehavior } };
        case IPC.invoke.networkProxyTest:
          mutations.push({ channel, input });
          return { handled: true, data: { ok: false, error: "Isolated fixture does not contact a real proxy" } };
        case IPC.invoke.devtoolsToggle:
          mutations.push({ channel, input });
          return { handled: true, data: { open: input?.open === true } };
        default: return { handled: false };
      }
    },
  };
}
