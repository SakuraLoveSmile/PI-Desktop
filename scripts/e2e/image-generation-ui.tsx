import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import { createInstance } from "i18next";
import { I18nextProvider } from "react-i18next";
import { catalogs } from "@pi-desktop/i18n";
import type { AppSettings, ProviderPublic, UiMessage } from "@pi-desktop/shared";
import { ModelConfigPage } from "../../apps/desktop/src/components/settings/ModelConfigPage";
import { GeneratedImages } from "../../apps/desktop/src/features/chat/transcript/GeneratedImages";
import { api } from "../../apps/desktop/src/lib/api";
import { useAppStore } from "../../apps/desktop/src/stores/app-store";

declare global {
  var imageGenerationProbe: () => Promise<unknown>;
}
const assert = (condition: unknown, message: string) => {
  if (!condition) throw new Error(message);
};
const painted = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
async function until(condition: () => boolean, message: string) {
  const deadline = performance.now() + 6000;
  while (!condition() && performance.now() < deadline) await painted();
  assert(condition(), message);
}

globalThis.imageGenerationProbe = async () => {
  const i18n = createInstance();
  await i18n.init({
    lng: "en",
    resources: { en: { translation: catalogs.en }, "zh-CN": { translation: catalogs["zh-CN"] } },
  });
  let settings = {
    defaultMode: "agent",
    defaultProviderId: "chat",
    defaultModelId: "chat-model",
    language: "en",
  } as AppSettings;
  const provider: ProviderPublic = {
    id: "p",
    name: "Images",
    baseUrl: "https://example.com/v1",
    vendorKey: "custom",
    type: "openai_compatible",
    protocol: "openai_compatible",
    apiStyle: "chat_completions",
    authKind: "api_key_and_base_url",
    enabled: true,
    hasSecret: true,
    supportsReasoning: false,
    supportedThinkingLevels: [],
    createdAt: "",
    updatedAt: "",
    models: ["image-one", "image-two"].map((id) => ({
      id,
      contextWindow: 32000,
      maxTokens: 4096,
      thinkingLevels: [],
      defaultThinkingLevel: null,
    })),
  };
  api.getSettings = async () => structuredClone(settings);
  api.setSettings = async (next) => {
    settings = structuredClone(next);
    return { ok: true };
  };
  api.listProviders = async () => ({ providers: [provider] });
  api.listSessions = async () => ({ sessions: [] });
  api.getOnboarding = async () => ({ dismissed: true });
  api.listProviderModels = async () => ({ models: [], source: "remote" });
  api.modelCatalogStatus = async () => ({
    loaded: true,
    source: "bundled",
    catalogPath: "",
    providerCount: 1,
    modelCount: 2,
  });
  api.updateProvider = async () => ({ provider });
  api.fsReadImageDataUrl = async () => ({
    kind: "image",
    dataUrl:
      "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a9mQAAAAASUVORK5CYII=",
  });
  useAppStore.setState({ settings, providers: [provider] });
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const render = (message?: UiMessage) =>
    flushSync(() =>
      root.render(
        <I18nextProvider i18n={i18n}>
          {message ? <GeneratedImages message={message} /> : <ModelConfigPage />}
        </I18nextProvider>,
      ),
    );
  const click = (element: HTMLElement | undefined | null) => {
    assert(element, "missing click target");
    flushSync(() => element!.click());
  };
  const button = (text: string) =>
    [...document.querySelectorAll<HTMLButtonElement>("button")].find(
      (element) => element.textContent?.trim() === text,
    );
  try {
    for (const locale of ["en", "zh-CN"]) {
      await i18n.changeLanguage(locale);
      render();
      const edit =
        container.querySelector<HTMLButtonElement>(
          'button[aria-label="' + i18n.t("settings.editProvider") + '"]',
        ) ??
        container.querySelector<HTMLButtonElement>(
          ".model-provider-row button[aria-label*='Edit']",
        );
      // Enter from the real model settings page, not the advanced pane alone.
      click(edit);
      await until(
        () => !!button(i18n.t("settings.setImageModel")),
        "advanced image-model action missing",
      );
      click(button(i18n.t("settings.setImageModel")));
      assert(!settings.imageGeneration, "draft selection persisted before Save");
      click(button(i18n.t("settings.cancel")));
      assert(!settings.imageGeneration, "cancel changed binding");
      click(
        container.querySelector<HTMLButtonElement>(
          'button[aria-label="' + i18n.t("settings.editProvider") + '"]',
        ),
      );
      await until(() => !!button(i18n.t("settings.setImageModel")), "second edit did not mount");
      click(button(i18n.t("settings.setImageModel")));
      click(button(i18n.t("settings.saveProvider")));
      await until(
        () =>
          settings.imageGeneration?.modelId === "image-one" &&
          !document.querySelector(".provider-setup"),
        "saved image model missing",
      );
      assert(settings.defaultModelId === "chat-model", "image model changed default chat model");
      const row = [...container.querySelectorAll<HTMLElement>(".settings-row")].find((element) =>
        element.textContent?.includes(i18n.t("settings.imageModel")),
      )!;
      click(
        [...row.querySelectorAll<HTMLButtonElement>("button")].find(
          (element) => element.textContent === i18n.t("settings.changeDefaultModel"),
        ),
      );
      await until(() => !!button("Images / image-two"), "replacement picker missing");
      click(button("Images / image-two"));
      await until(
        () => settings.imageGeneration?.modelId === "image-two",
        "replacement did not persist",
      );
      click(button(i18n.t("settings.clearImageModel")));
      await until(() => settings.imageGeneration === null, "clear did not persist");
    }
    const message = {
      id: "image",
      role: "tool",
      content: "",
      createdAt: "",
      toolName: "GenerateImages",
      toolResult: {
        details: {
          kind: "generated-images",
          results: [
            { index: 0, status: "succeeded", path: "/scratch/result.png", mimeType: "image/png" },
            { index: 1, status: "failed", errorCode: "IMAGE_TIMEOUT" },
          ],
        },
      },
    } as UiMessage;
    render(message);
    await until(() => !!container.querySelector("img"), "generated preview missing");
    assert(container.textContent?.includes("IMAGE_TIMEOUT"), "partial failure missing");
    render({
      ...message,
      toolResult: {
        details: { kind: "image-generation-error", errorCode: "IMAGE_NOT_CONFIGURED" },
      },
    });
    click(button(i18n.t("settings.configureImageModel")));
    assert(
      useAppStore.getState().settingsTab === "ai" && useAppStore.getState().page === "settings",
      "setup action did not navigate",
    );
    return {
      ok: true,
      locales: ["en", "zh-CN"],
      scenarios: [
        "advanced-save-cancel",
        "replace-clear",
        "chat-default-preserved",
        "image-preview-partial-failure",
        "setup-navigation",
      ],
      apiBoundary: "fixture",
    };
  } finally {
    flushSync(() => root.unmount());
    container.remove();
  }
};
