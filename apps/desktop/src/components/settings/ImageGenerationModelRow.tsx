import { useTranslation } from "react-i18next";
import {
  imageGenerationBindings,
  modelIdsMatch,
  type AppSettings,
  type ImageGenerationBinding,
  type ProviderPublic,
} from "@pi-desktop/shared";
import { SettingsMenuSelect } from "./SettingsMenuSelect";

function imageModelOptionId(binding: ImageGenerationBinding): string {
  return `${binding.providerId}\u0000${binding.modelId}`;
}

export function ImageGenerationModelRow({
  settings,
  providers,
  busy = false,
  onChange,
}: {
  settings: AppSettings;
  providers: ProviderPublic[];
  busy?: boolean;
  onChange?: (binding: ImageGenerationBinding) => void;
}) {
  const { t } = useTranslation();
  const binding = settings.imageGeneration;
  const candidates = imageGenerationBindings(settings.imageGenerationModels, binding);
  if (!binding || candidates.length === 0) return null;

  const activeCandidate = candidates.find((candidate) =>
    candidate.providerId === binding.providerId &&
    modelIdsMatch(candidate.modelId, binding.modelId),
  );
  const provider = providers.find((entry) => entry.id === binding.providerId);
  const valid = !!provider?.enabled && provider.authKind !== "oauth" &&
    !!provider.baseUrl && (provider.hasSecret || provider.authKind === "none") &&
    provider.models.some((model) => model.id === binding.modelId);
  const options = candidates.map((candidate) => {
    const candidateProvider = providers.find((entry) => entry.id === candidate.providerId);
    const available = candidateProvider?.enabled &&
      candidateProvider.authKind !== "oauth" &&
      !!candidateProvider.baseUrl &&
      (candidateProvider.hasSecret || candidateProvider.authKind === "none") &&
      candidateProvider.models.some((model) => model.id === candidate.modelId);
    return {
      id: imageModelOptionId(candidate),
      label: `${candidateProvider?.name ?? candidate.providerId} · ${candidate.modelId}`,
      disabled: !available,
    };
  });

  return (
    <div className="settings-row model-default-row model-image-row">
      <div className="settings-row-copy model-default-copy">
        <div className="settings-row-title model-default-label">{t("settings.imageModel")}</div>
        <div className="settings-row-detail model-default-value">
          {valid && provider ? (
            <>
              <span className="model-default-provider">{provider.name}</span>
              <span className="model-default-sep" aria-hidden>·</span>
              <span className="model-default-model font-mono">{binding.modelId}</span>
            </>
          ) : (
            <span className="model-default-empty" role="status">{t("settings.imageModelUnavailable")}</span>
          )}
        </div>
      </div>
      {onChange && candidates.length > 1 ? (
        <SettingsMenuSelect
          className="model-image-selector"
          label={t("settings.imageModel")}
          value={activeCandidate ? imageModelOptionId(activeCandidate) : ""}
          options={options}
          busy={busy}
          onChange={(id) => {
            const next = candidates.find((candidate) => imageModelOptionId(candidate) === id);
            if (next) onChange(next);
          }}
        />
      ) : null}
    </div>
  );
}
