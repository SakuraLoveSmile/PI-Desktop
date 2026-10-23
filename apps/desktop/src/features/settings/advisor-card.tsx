/**
 * Advisor model settings (docs/spec/03-runtime/04-advisor-tool.md).
 *
 * One row picks the model the Advisor tool consults. The tool is off until a
 * model is picked, so a session never sends its conversation to a second
 * provider by default. The picker is the shared ModelPinMenu, and "Off" is its
 * clear row.
 */
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import type { AppSettings } from "@pi-desktop/shared";
import { ModelPinMenu } from "../../components/settings/ModelPinMenu";
import { defaultModelOptions } from "../../components/settings/default-model";
import { providerDisplayName } from "../../lib/provider-display";
import { useAppStore } from "../../stores/app-store";
import { SettingsCard, SettingsRow } from "./primitives";
import { advisorPinPatch, advisorPinStatus } from "./advisor-pin";

export function AdvisorCard({
  settings,
  saveSettings,
}: {
  settings: AppSettings;
  saveSettings: (patch: Partial<AppSettings>) => Promise<void>;
}) {
  const { t } = useTranslation();
  const providers = useAppStore((state) => state.providers);
  const showToast = useAppStore((state) => state.showToast);

  // The same runnable set the Composer offers, so a pin is always a model the
  // user could also send a message with.
  const options = useMemo(
    () => defaultModelOptions(providers.filter((provider) => provider.enabled)),
    [providers],
  );
  const status = advisorPinStatus(settings, options);
  const pinnedProviderId = settings.advisorProviderId ?? "";
  const pinnedModelId = settings.advisorModelId ?? "";
  const pinnedProvider =
    providers.find((provider) => provider.id === pinnedProviderId) ?? null;

  const pick = async (providerId: string, modelId: string) => {
    try {
      await saveSettings(advisorPinPatch(providerId, modelId));
    } catch (error) {
      showToast(error instanceof Error ? error.message : String(error), {
        variant: "error",
      });
    }
  };

  return (
    <SettingsCard title={t("settings.advisorTitle")} description={t("settings.advisorDesc")}>
      <SettingsRow
        title={t("settings.advisorModel")}
        detail={
          status === "off" ? (
            <span className="model-default-empty">{t("settings.advisorModelOff")}</span>
          ) : (
            <span className="model-default-value">
              <span className="model-default-provider">
                {pinnedProvider ? providerDisplayName(pinnedProvider) : pinnedProviderId}
              </span>
              <span className="model-default-sep" aria-hidden>
                ·
              </span>
              <span className="model-default-model font-mono">{pinnedModelId}</span>
              {status === "unlisted" ? (
                <span className="model-default-empty">
                  {" "}
                  {t("settings.advisorModelUnavailable")}
                </span>
              ) : null}
            </span>
          )
        }
      >
        <ModelPinMenu
          label={t("settings.advisorModel")}
          options={options}
          pinnedProviderId={pinnedProviderId}
          pinnedModelId={pinnedModelId}
          clearLabel={t("settings.advisorModelOff")}
          disabled={options.length === 0 && status === "off"}
          onPick={pick}
        />
      </SettingsRow>
    </SettingsCard>
  );
}
