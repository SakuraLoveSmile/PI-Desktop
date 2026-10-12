import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { DEFAULT_TEAM_RUN_LIMITS, validateTeamRunLimits } from "@pi-desktop/shared";
import { api } from "../../lib/api";
import { useAppStore } from "../../stores/app-store";
import { Button, Field, Input, SettingsToggle } from "../../components/ui";
import { CapabilityGroupHeader, CapabilityPanel } from "../../components/settings/AgentCapabilityLayout";
import { ExpertTeamSettingsConflict, persistTeamRunLimits } from "./expert-team-settings";

const HOUR = 60 * 60 * 1000;
export function TeamRunLimitsSettings() {
  const { t } = useTranslation();
  const saved = useAppStore((state) => state.settings?.expertTeam?.runLimits);
  const effective = saved ?? DEFAULT_TEAM_RUN_LIMITS;
  const [enabled, setEnabled] = useState(effective.enabled);
  const [soft, setSoft] = useState(String(effective.softMs / HOUR));
  const [hard, setHard] = useState(String(effective.hardMs / HOUR));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const current = useRef(true);
  useEffect(() => { current.current = true; return () => { current.current = false; }; }, []);
  useEffect(() => {
    setEnabled(effective.enabled); setSoft(String(effective.softMs / HOUR)); setHard(String(effective.hardMs / HOUR));
  }, [effective.enabled, effective.softMs, effective.hardMs]);
  const config = { enabled, softMs: Number(soft) * HOUR, hardMs: Number(hard) * HOUR };
  const valid = validateTeamRunLimits(config);
  const save = async () => {
    if (busy || !valid) return;
    setBusy(true); setError(null);
    try {
      const confirmed = await persistTeamRunLimits({ config, expected: saved, isCurrent: () => current.current,
        getSettings: api.getSettings, setSettings: api.setSettings });
      if (confirmed) useAppStore.setState({ settings: confirmed });
    } catch (cause) {
      if (cause instanceof ExpertTeamSettingsConflict && cause.confirmedSettings) useAppStore.setState({ settings: cause.confirmedSettings });
      if (current.current) setError(t(cause instanceof ExpertTeamSettingsConflict ? "settings.expertTeam.conflict" : "settings.expertTeam.saveFailed"));
    } finally { if (current.current) setBusy(false); }
  };
  return <CapabilityPanel loading={false} loadingLabel={t("common.loading")}>
    <CapabilityGroupHeader label={t("settings.expertTeam.runLimits.title")} count={2} />
    <div className="expert-team-role-editor">
      <Field label={t("settings.expertTeam.runLimits.enabled")}><SettingsToggle checked={enabled} onChange={() => setEnabled(!enabled)} disabled={busy} label={t("settings.expertTeam.runLimits.enabled")} /></Field>
      <p>{t("settings.expertTeam.runLimits.description")}</p>
      <Field label={t("settings.expertTeam.runLimits.soft")}>
        <Input type="number" value={soft} min="0" step="any" disabled={busy} aria-label={t("settings.expertTeam.runLimits.soft")} onChange={(event) => setSoft(event.target.value)} />
      </Field>
      <Field label={t("settings.expertTeam.runLimits.hard")}>
        <Input type="number" value={hard} min="0" step="any" disabled={busy} aria-label={t("settings.expertTeam.runLimits.hard")} onChange={(event) => setHard(event.target.value)} />
      </Field>
      {!valid && <p role="alert">{t("settings.expertTeam.runLimits.invalid")}</p>}
      {error && <p role="alert">{error}</p>}
      <div className="expert-team-editor-actions"><Button disabled={busy || !valid} onClick={() => void save()}>{t(busy ? "settings.expertTeam.saving" : "settings.expertTeam.save")}</Button></div>
    </div>
  </CapabilityPanel>;
}
