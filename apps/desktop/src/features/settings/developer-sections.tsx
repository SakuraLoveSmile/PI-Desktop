import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { AppSettings, CloseBehavior } from "@pi-desktop/shared";
import { useAppStore } from "../../stores/app-store";
import { api } from "../../lib/api";
import { Button, SegmentedControl, SettingsToggle } from "../../components/ui";
import { SettingsCard, SettingsRow } from "./primitives";

export function DeveloperSection({
  settings,
  saveSettings,
}: {
  settings: AppSettings;
  saveSettings: (patch: Partial<AppSettings>) => Promise<void>;
}) {
  const { t } = useTranslation();
  const showToast = useAppStore((s) => s.showToast);
  const enabled = settings.developerMode === true;
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const toggleDeveloperMode = async () => {
    setSaving(true);
    setSaveError(null);
    try {
      await saveSettings({ developerMode: !enabled });
    } catch (cause) {
      setSaveError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSaving(false);
    }
  };

  const openConsole = async () => {
    try {
      await api.toggleDevTools(true);
    } catch (e) {
      showToast(e instanceof Error ? e.message : String(e), { variant: "error" });
    }
  };

  return (
    <SettingsCard title={t("settings.developer")}>
      <SettingsRow
        title={t("settings.developerMode")}
        description={t("settings.developerModeDesc")}
      >
        <SettingsToggle
          checked={enabled}
          label={t("settings.developerMode")}
          busy={saving}
          onChange={() => void toggleDeveloperMode()}
        />
      </SettingsRow>
      {saveError ? <p className="settings-inline-error" role="alert">{saveError}</p> : null}
      <SettingsRow
        title={t("settings.devTools")}
        description={enabled ? undefined : t("settings.devToolsDisabledHint")}
      >
        <Button variant="secondary" disabled={!enabled} onClick={() => void openConsole()}>
          {t("settings.openDevTools")}
        </Button>
      </SettingsRow>
    </SettingsCard>
  );
}
/**
 * Windows/Linux only: how closing the main window behaves. The first close
 * prompts once (main-process dialog); the remembered choice can be changed
 * here between tray and quit, but never reverted to prompting.
 */
export function CloseBehaviorSection() {
  const { t } = useTranslation();
  const [behavior, setBehavior] = useState<CloseBehavior | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [request, setRequest] = useState(0);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLoadFailed(false);
    void api
      .getCloseBehavior()
      .then(({ behavior: next }) => {
        if (!cancelled) setBehavior(next);
      })
      .catch(() => {
        if (!cancelled) setLoadFailed(true);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [request]);

  // The "ask" state (unset) is transient and cannot be re-selected: once a
  // choice is made it is remembered permanently. An unset preference shows
  // no active option.
  const options: [CloseBehavior, string][] = [
    ["tray", "settings.closeBehaviorTray"],
    ["quit", "settings.closeBehaviorQuit"],
  ];

  const choose = async (next: CloseBehavior) => {
    setSaving(true);
    setSaveError(false);
    setSaved(false);
    try {
      await api.setCloseBehavior(next);
      setBehavior(next);
      setSaved(true);
    } catch {
      setSaveError(true);
    } finally {
      setSaving(false);
    }
  };

  return (
    <SettingsCard title={t("settings.closeBehaviorTitle")}>
      <SettingsRow
        title={t("settings.closeBehaviorTitle")}
        description={t("settings.closeBehaviorDesc")}
      >
        <SegmentedControl<CloseBehavior>
          value={behavior ?? ("" as CloseBehavior)}
          onChange={(value) => void choose(value)}
          options={options.map(([value, labelKey]) => ({ value, label: t(labelKey) }))}
          label={t("settings.closeBehaviorTitle")}
          disabled={loading || loadFailed || saving}
        />
      </SettingsRow>
      {loading ? <p className="settings-inline-status" role="status">{t("common.loading")}</p> : null}
      {loadFailed ? <div className="settings-inline-error" role="alert">
        {t("settings.closeBehaviorLoadError")}
        <Button variant="secondary" size="sm" onClick={() => setRequest((value) => value + 1)}>{t("errors.action.retry")}</Button>
      </div> : null}
      {saveError ? <p className="settings-inline-error" role="alert">{t("settings.closeBehaviorSaveError")}</p> : null}
      {saved ? <p className="settings-inline-status" role="status">{t("settings.preferenceSaved")}</p> : null}
    </SettingsCard>
  );
}
