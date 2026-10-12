import { useTranslation } from "react-i18next";
import { Panel, Select } from "../../components/ui";
import type { ContextInsightsPreferences } from "./preferences";

export function ContextInsightsPreferencesPanel({
  preferences,
  onChange,
}: {
  preferences: ContextInsightsPreferences;
  onChange: (patch: Partial<ContextInsightsPreferences>) => void;
}) {
  const { t } = useTranslation();
  return (
    <Panel className="ci-card">
      <details>
        <summary>{t("contextInsights.preferences")}</summary>
        <div className="ci-preferences">
          <label>
            {t("contextInsights.placement")}
            <Select
              value={preferences.placement}
              onChange={(event) =>
                onChange({ placement: event.target.value === "modal" ? "modal" : "panel" })
              }
            >
              <option value="panel">{t("contextInsights.panel")}</option>
              <option value="modal">{t("contextInsights.modal")}</option>
            </Select>
          </label>
          <label>
            {t("contextInsights.granularity")}
            <Select
              value={preferences.granularity}
              onChange={(event) =>
                onChange({ granularity: event.target.value === "turn" ? "turn" : "step" })
              }
            >
              <option value="step">{t("contextInsights.step")}</option>
              <option value="turn">{t("contextInsights.turn")}</option>
            </Select>
          </label>
          <label>
            {t("contextInsights.measure")}
            <Select
              value={preferences.measure}
              onChange={(event) =>
                onChange({ measure: event.target.value === "delta" ? "delta" : "total" })
              }
            >
              <option value="total">{t("contextInsights.total")}</option>
              <option value="delta">{t("contextInsights.delta")}</option>
            </Select>
          </label>
        </div>
        <p className="ci-muted">{t("contextInsights.defaultsNote")}</p>
      </details>
    </Panel>
  );
}
