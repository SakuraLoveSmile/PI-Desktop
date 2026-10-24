import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import { createInstance } from "i18next";
import { I18nextProvider } from "react-i18next";
import { catalogs } from "@pi-desktop/i18n";
import { IPC, type AppSettings, type OAuthVendor } from "@pi-desktop/shared";
import { ModelConfigPage } from "../../apps/desktop/src/components/settings/ModelConfigPage";
import { ProviderSetupDialog } from "../../apps/desktop/src/components/settings/ProviderSetupDialog";
import { OAuthLoginDialog } from "../../apps/desktop/src/components/settings/OAuthLoginDialog";
import { useAppStore } from "../../apps/desktop/src/stores/app-store";
import { api } from "../../apps/desktop/src/lib/api";
import { beginOAuthLogin } from "../../apps/desktop/src/lib/oauth-login-session";
import { createModelsFixture, modelFixtureProvider } from "./settings-models-fixture";

declare global { var settingsModelsUsabilityProbe: () => Promise<unknown>; }
const assert = (value: unknown, message: string) => { if (!value) throw new Error(message); };
const tick = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
const until = async (condition: () => boolean, message: string) => {
  const deadline = performance.now() + 5000;
  while (!condition() && performance.now() < deadline) await tick();
  assert(condition(), message);
};
const click = (node: HTMLElement | null | undefined) => { assert(node, "Missing click target"); flushSync(() => node!.click()); };
const input = (node: HTMLInputElement | null, value: string) => {
  assert(node, "Missing input");
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(node, value);
  flushSync(() => node!.dispatchEvent(new Event("input", { bubbles: true })));
};

globalThis.settingsModelsUsabilityProbe = async () => {
  const i18n = createInstance();
  await i18n.init({ lng: "en", resources: { en: { translation: catalogs.en }, "zh-CN": { translation: catalogs["zh-CN"] } }, interpolation: { escapeValue: false } });
  const host = document.createElement("div"); document.body.append(host);
  const root = createRoot(host);
  const previous = useAppStore.getState();
  const fixture = createModelsFixture(new URLSearchParams("models=empty"));
  let settings = { defaultMode: "agent", defaultProviderId: "", defaultModelId: "", theme: "light", language: "en" } as AppSettings;
  const toasts: string[] = [];
  const unexpected: string[] = [];
  const listeners = new Map<string, Set<(event: unknown) => void>>();
  const priorPreload = window.piDesktop;
  window.piDesktop = {
    platform: "darwin",
    on(channel, listener) {
      const bucket = listeners.get(channel) ?? new Set(); bucket.add(listener as (event: unknown) => void); listeners.set(channel, bucket);
      return () => bucket.delete(listener as (event: unknown) => void);
    },
    async invoke(channel, value) {
      const result = fixture.invoke(channel, value);
      if (result.handled) return { ok: true, data: result.data };
      switch (channel) {
        case IPC.invoke.settingsGet: return { ok: true, data: settings };
        case IPC.invoke.settingsSet: settings = value as AppSettings; return { ok: true, data: settings };
        case IPC.invoke.providersOauthStart:
          for (const listener of listeners.get(IPC.event.providersOauth) ?? []) listener({ kind: "authUrl", loginId: "fixture-login", vendorId: "fixture", url: "https://fixture.invalid/login", opened: false });
          return { ok: true, data: { loginId: "fixture-login" } };
        case IPC.invoke.providersOauthCancel:
          assert(value === "fixture-login", "Cancel targeted a different login");
          for (const listener of listeners.get(IPC.event.providersOauth) ?? []) listener({ kind: "cancelled", loginId: "fixture-login", vendorId: "fixture" });
          return { ok: true, data: { ok: true } };
        default: unexpected.push(channel); throw new Error(`Unexpected model fixture IPC: ${channel}`);
      }
    },
  };
  useAppStore.setState({ settings, providers: [], showToast: (message) => { toasts.push(message); }, refreshProviders: async () => {
    const result = await api.listProviders(); useAppStore.setState({ providers: result.providers, settings });
  } });
  const render = (element: React.ReactNode) => flushSync(() => root.render(<I18nextProvider i18n={i18n}>{element}</I18nextProvider>));
  const button = (key: string) => [...document.querySelectorAll<HTMLButtonElement>("button")].find((node) => node.textContent?.trim() === i18n.t(key));
  const scenarios: string[] = [];
  try {
    for (const locale of ["en", "zh-CN"]) {
      await i18n.changeLanguage(locale);
      fixture.providers.splice(0); useAppStore.setState({ providers: [], settings: { ...settings, defaultProviderId: "", defaultModelId: "" } });
      render(<ModelConfigPage key={locale} />);
      await tick();
      const addButtons = [...document.querySelectorAll("button")].filter((node) => node.textContent?.trim() === i18n.t("settings.addProvider"));
      assert(addButtons.length === 1, "Empty services should offer one Add entry");
      click(button("settings.configureServices"));
      assert(document.querySelector(".provider-setup-dialog"), "Unavailable model should open service setup");
      click(button("settings.cancel"));
      click(addButtons[0]);
      assert(document.querySelector(".service-chooser"), "Add service should open chooser");
      click(button("settings.cancel"));
      scenarios.push(`${locale}:empty-add-and-default-setup`);

      const provider = modelFixtureProvider(); fixture.providers.push(provider);
      let saved = 0;
      render(<ProviderSetupDialog key={`${locale}-editor`} provider={provider} onClose={() => {}} onSaved={() => { saved++; }} />);
      assert(document.querySelector(".provider-setup-actions button"), "Save and Cancel must be in footer");
      assert(!document.querySelector(".provider-setup-head-actions .btn-primary"), "Header should not duplicate Save");
      input(document.querySelector<HTMLInputElement>(".provider-setup-custom-identity-row input"), "Draft name");
      fixture.controls.failSave = true;
      click(button("settings.saveProvider"));
      await until(() => Boolean(document.querySelector(".provider-setup-error")), "Save failure should stay visible");
      assert(document.querySelector<HTMLInputElement>(".provider-setup-custom-identity-row input")?.value === "Draft name", "Failed save discarded draft");
      fixture.controls.failSave = false;
      click(button("settings.saveProvider"));
      await until(() => saved === 1, "Retry did not save service");
      const update = fixture.calls.filter((call) => call.channel === IPC.invoke.providersUpdate).at(-1)?.input;
      assert(update.name === "Draft name" && !("secretValue" in update), "Save changed blank-key retention semantics");
      fixture.controls.failTest = true;
      click(button("settings.testConnection"));
      await until(() => document.querySelector(".provider-connection-feedback")?.textContent === "Fixture connection refused", "Connection error must stay near credentials");
      fixture.controls.failDiscovery = true;
      click(document.querySelector(".provider-models-reload"));
      await until(() => Boolean(document.querySelector(".provider-models-error")), "Model error should be visible near list");
      assert(document.querySelector(".provider-models-row"), "Refresh error discarded existing model list");
      fixture.controls.failDiscovery = false;
      click(document.querySelector(".provider-models-reload"));
      await until(() => !document.querySelector(".provider-models-error"), "Retry did not clear model error");
      scenarios.push(`${locale}:edit-failure-draft-retry-key-retention-and-local-errors`);

      const next = modelFixtureProvider("second"); next.models = [{ ...next.models[0], id: "second-chat" }]; next.defaultModelId = "second-chat";
      fixture.providers.push(next); settings = { ...settings, defaultProviderId: provider.id, defaultModelId: "fixture-chat" };
      useAppStore.setState({ settings, providers: structuredClone(fixture.providers) });
      render(<ModelConfigPage key={`${locale}-default`} />); await tick();
      click(button("settings.changeDefaultModel")); await tick();
      fixture.controls.failRefresh = true;
      click(document.querySelector<HTMLElement>('[aria-label="Fixture service · second-chat"]'));
      await until(() => settings.defaultProviderId === "second", "Default selection was not persisted");
      await until(() => toasts.some((message) => message === i18n.t("settings.modelSavedRefreshFailed", { error: "Fixture refresh failed" })), "Saved/refresh failure should be reported distinctly");
      assert(useAppStore.getState().settings?.defaultProviderId === "second", "Saved default not reflected locally");
      fixture.controls.failRefresh = false;
      scenarios.push(`${locale}:default-save-and-refresh-failure`);

      const account = { ...modelFixtureProvider("account"), authKind: "oauth", hasOauth: true, oauthAccountLabel: "Fixture account" };
      fixture.providers.splice(0, fixture.providers.length, account);
      settings = { ...settings, defaultProviderId: account.id, defaultModelId: account.defaultModelId };
      useAppStore.setState({ settings, providers: structuredClone(fixture.providers) });
      render(<ModelConfigPage key={`${locale}-account`} />); await tick();
      click(document.querySelector(".model-provider-row"));
      assert(document.querySelector(".vendor-account-dialog"), "Account row should open account editor");
      input(document.querySelector<HTMLInputElement>(".vendor-account-body input"), "Account draft");
      fixture.controls.failSave = true;
      click(button("settings.save"));
      await until(() => Boolean(document.querySelector(".vendor-account-actions [role=alert]")), "Account save error should remain visible");
      assert(document.querySelector<HTMLInputElement>(".vendor-account-body input")?.value === "Account draft", "Account failure discarded draft");
      fixture.controls.failSave = false;
      fixture.controls.failRefresh = true;
      click(button("settings.save"));
      await until(() => !document.querySelector(".vendor-account-dialog"), "Saved account should close even when list refresh fails");
      assert(fixture.providers[0].oauthAccountLabel === "Account draft", "Account retry did not save label");
      fixture.controls.failRefresh = false;
      scenarios.push(`${locale}:account-edit-failure-draft-retry-refresh`);
    }
    let closed = 0;
    const session = beginOAuthLogin({ api, vendorId: "fixture" });
    const vendor = { vendorId: "fixture", name: "Fixture vendor", accounts: [] } as unknown as OAuthVendor;
    render(<OAuthLoginDialog vendor={vendor} session={session} onDone={() => {}} onClose={() => { closed++; }} />);
    await until(() => Boolean(document.querySelector(".oauth-link")), "OAuth manual link missing");
    assert(document.querySelector<HTMLAnchorElement>(".oauth-link")?.href === "https://fixture.invalid/login", "OAuth manual link changed");
    click(button("settings.cancel"));
    await until(() => closed === 1, "OAuth Cancel must cancel underlying attempt and close");
    session.dispose();
    scenarios.push("oauth-manual-open-and-cancellation");
    assert(unexpected.length === 0, `Unexpected IPC: ${unexpected.join(", ")}`);
    return { ok: true, scenarios, externalBoundary: "strict fixture preload", hostPersistence: "not exercised", liveAccounts: "not exercised" };
  } finally {
    flushSync(() => root.unmount()); host.remove(); useAppStore.setState(previous); window.piDesktop = priorPreload;
  }
};
