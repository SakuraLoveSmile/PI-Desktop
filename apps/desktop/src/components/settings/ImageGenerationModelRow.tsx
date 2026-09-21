import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { AppSettings, ImageGenerationBinding, ProviderPublic } from "@pi-desktop/shared";
import { api } from "../../lib/api";
import { useAppStore } from "../../stores/app-store";
import { Button, Input } from "../ui";
import { AnchoredMenu } from "./AnchoredMenu";

export function ImageGenerationModelRow({
  settings,
  providers,
}: {
  settings: AppSettings;
  providers: ProviderPublic[];
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const binding = settings.imageGeneration;
  const provider = providers.find((entry) => entry.id === binding?.providerId);
  const eligible = (entry: ProviderPublic) =>
    entry.enabled &&
    entry.authKind !== "oauth" &&
    !!entry.baseUrl &&
    (entry.hasSecret || entry.authKind === "none");
  const valid =
    provider &&
    eligible(provider) &&
    provider.models.some((model) => model.id === binding?.modelId);
  const options = providers
    .filter(eligible)
    .flatMap((entry) => entry.models.map((model) => ({ provider: entry, model })))
    .filter(({ provider: entry, model }) =>
      `${entry.name} ${model.id} ${model.alias ?? ""}`
        .toLowerCase()
        .includes(query.trim().toLowerCase()),
    );
  const save = async (next: ImageGenerationBinding | null) => {
    setBusy(true);
    setError("");
    try {
      await api.setSettings({ ...(await api.getSettings()), imageGeneration: next });
      useAppStore.setState({ settings: await api.getSettings() });
      setOpen(false);
    } catch {
      setError(t("settings.imageModelSaveFailed"));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="settings-panel">
      <div className="settings-row">
        <div className="settings-row-copy">
          <div className="settings-row-title">{t("settings.imageModel")}</div>
          <div className="settings-row-detail">
            {binding
              ? `${provider?.name ?? binding.providerId} / ${binding.modelId}`
              : t("settings.imageModelUnset")}
          </div>
          {binding && !valid ? (
            <div role="status">{t("settings.imageModelUnavailable")}</div>
          ) : null}
          {error ? <div role="alert">{error}</div> : null}
        </div>
        <AnchoredMenu
          open={open}
          onClose={() => setOpen(false)}
          label={t("settings.imageModel")}
          align="end"
          menuClassName="model-default-menu"
          trigger={(ref) => (
            <Button
              ref={ref}
              variant="ghost"
              disabled={busy}
              aria-haspopup="listbox"
              aria-expanded={open}
              onClick={() => {
                setQuery("");
                setOpen(!open);
              }}
            >
              {t("settings.changeDefaultModel")}
            </Button>
          )}
        >
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t("settings.defaultModelSearch")}
            aria-label={t("settings.defaultModelSearch")}
            autoFocus
          />
          <ul className="model-default-list">
            {options.map(({ provider: entry, model }) => (
              <li key={`${entry.id}:${model.id}`}>
                <button
                  type="button"
                  role="option"
                  className="model-default-option"
                  aria-selected={binding?.providerId === entry.id && binding.modelId === model.id}
                  disabled={busy}
                  onClick={() => void save({ providerId: entry.id, modelId: model.id })}
                >
                  {entry.name} / {model.alias || model.id}
                </button>
              </li>
            ))}
          </ul>
          {!options.length ? (
            <div className="model-default-no-results">{t("settings.noModelMatches")}</div>
          ) : null}
        </AnchoredMenu>
        {binding ? (
          <Button variant="ghost" disabled={busy} onClick={() => void save(null)}>
            {t("settings.clearImageModel")}
          </Button>
        ) : null}
      </div>
    </div>
  );
}
