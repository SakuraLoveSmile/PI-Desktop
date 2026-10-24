import { lazy, Suspense, useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { AgentInstructionFile, AppSettings, UpdatePreference } from "@pi-desktop/shared";
import { api } from "../../lib/api";
import { useAppStore } from "../../stores/app-store";
import { useUpdateState } from "../../hooks/use-update-state";
import { Button, Textarea } from "../../components/ui";
import { IconFileText } from "../../components/icons";
import { SettingsMenuSelect } from "../../components/settings/SettingsMenuSelect";
import { persistUpdatePreference } from "./update-preference";
import { SettingsCard, SettingsRow } from "./primitives";

const ReleaseNotesDialog = lazy(() =>
  import("../../components/ReleaseNotesDialog").then((module) => ({
    default: module.ReleaseNotesDialog,
  })),
);

export function AgentInstructionsSection() {
  const { t } = useTranslation();
  const [global, setGlobal] = useState<AgentInstructionFile | null>(null);
  const [globalDraft, setGlobalDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<{ operation: "load" | "save"; message: string } | null>(null);
  const [saved, setSaved] = useState(false);
  const request = useRef(0);
  const mounted = useRef(false);

  const load = useCallback(async () => {
    const generation = ++request.current;
    setLoading(true);
    setError(null);
    setSaved(false);
    try {
      const result = await api.getAgentInstructions();
      if (!mounted.current || generation !== request.current) return;
      setGlobal(result.global);
      setGlobalDraft(result.global.content);
    } catch (cause) {
      if (mounted.current && generation === request.current) {
        setError({ operation: "load", message: cause instanceof Error ? cause.message : String(cause) });
      }
    } finally {
      if (mounted.current && generation === request.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    void load();
    return () => { mounted.current = false; request.current += 1; };
  }, [load]);

  const save = async () => {
    if (!global || loading || saving) return;
    const submitted = globalDraft;
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const result = await api.saveAgentInstructions("global", submitted);
      if (!mounted.current) return;
      setGlobal(result.file);
      setSaved(true);
    } catch (cause) {
      if (mounted.current) setError({ operation: "save", message: cause instanceof Error ? cause.message : String(cause) });
    } finally {
      if (mounted.current) setSaving(false);
    }
  };

  const globalDirty = global !== null && globalDraft !== global.content;
  return (
    <div className="settings-stack">
      <SettingsCard
        title={t("settings.instructionsGlobal")}
        description={t("settings.instructionsGlobalDesc")}
      >
        <div className="settings-form-grid">
          <Textarea
            className="field-textarea settings-instruction-editor"
            value={globalDraft}
            onChange={(event) => { setGlobalDraft(event.target.value); setSaved(false); }}
            disabled={loading || global === null || saving}
            aria-busy={loading || saving}
            aria-label={t("settings.instructionsGlobal")}
            spellCheck={false}
            autoCorrect="off"
            autoCapitalize="off"
          />
          {global?.path ? <code className="settings-instruction-path">{global.path}</code> : null}
        </div>
        {loading ? <p role="status">{t("common.loading")}</p> : null}
        {error ? <div className="settings-inline-error" role="alert">
          <span>{t(error.operation === "load" ? "settings.instructionsLoadFailed" : "settings.instructionsSaveFailed", { message: error.message })}</span>
          {!global ? <Button size="sm" variant="secondary" onClick={() => void load()}>{t("errors.action.retry")}</Button> : null}
        </div> : null}
        <div className="settings-panel-actions">
          <span className="settings-save-status" role="status">{globalDirty ? t("settings.instructionsUnsaved") : saved ? t("settings.instructionsSaved") : ""}</span>
          <Button
            variant="primary"
            disabled={!globalDirty || saving}
            onClick={() => void save()}
          >
            {saving ? t("settings.saving") : t("settings.instructionsSave")}
          </Button>
        </div>
      </SettingsCard>
    </div>
  );
}

export function UpdatesRow({
  currentVersion,
  settings,
  saveSettings,
}: {
  currentVersion?: string;
  settings: AppSettings | null;
  saveSettings: (patch: Partial<AppSettings>) => Promise<void>;
}) {
  const { t } = useTranslation();
  const update = useUpdateState();
  const showToast = useAppStore((state) => state.showToast);
  const [releaseNotesOpen, setReleaseNotesOpen] = useState(false);
  const [preferenceSaving, setPreferenceSaving] = useState(false);
  const selectedPreference: UpdatePreference =
    update?.automaticSupported === false
      ? "manual"
      : settings?.updatePreference ??
        update?.preference ??
        update?.defaultPreference ??
        "manual";
  const savePreference = useCallback(async (value: string) => {
    if (value !== "automatic" && value !== "manual") return;
    setPreferenceSaving(true);
    try {
      await persistUpdatePreference(value, saveSettings);
    } catch {
      if (useAppStore.getState().settings?.updatePreference !== value) {
        showToast(t("updates.preferenceSaveFailed"), { variant: "error" });
      }
    } finally {
      setPreferenceSaving(false);
    }
  }, [saveSettings, showToast, t]);
  const closeReleaseNotes = useCallback(() => setReleaseNotesOpen(false), []);
  const disabled = !update || update.mode === "disabled";
  const busy = update?.status === "checking" || update?.status === "downloading";
  const preferenceLocked =
    !update ||
    update.mode === "disabled" ||
    !settings ||
    update.status === "downloading";

  let action: ReactNode;
  if (update?.status === "downloaded") {
    action = (
      <Button
        variant="primary"
        onClick={() => void api.updatesInstall().catch(() => undefined)}
      >
        {t("updates.restart")}
      </Button>
    );
  } else if (update?.status === "available" && update.mode === "manual") {
    action = (
      <Button
        variant="secondary"
        onClick={() => void api.updatesOpenReleases().catch(() => undefined)}
      >
        {t("updates.viewRelease")}
      </Button>
    );
  } else {
    action = (
      <Button
        variant="secondary"
        disabled={disabled || busy}
        onClick={() => void api.updatesCheck().catch(() => undefined)}
      >
        {busy ? t("updates.checking") : t("updates.check")}
      </Button>
    );
  }

  let statusText: string | null = null;
  if (disabled) {
    statusText = t("updates.devDisabled");
  } else {
    switch (update.status) {
      case "checking":
        statusText = t("updates.checking");
        break;
      case "up-to-date":
        statusText = t("updates.upToDate");
        break;
      case "available":
        statusText = `${t("updates.available", { version: update.availableVersion })}${
          update.mode === "manual" ? ` ${t("updates.manualHint")}` : ""
        }`;
        break;
      case "downloading":
        statusText = t("updates.downloading", {
          percent: update.progressPercent ?? 0,
        });
        break;
      case "downloaded":
        statusText = t("updates.downloaded", {
          version: update.availableVersion,
        });
        break;
      case "error":
        statusText = t("updates.error", { message: update.error ?? "" });
        break;
      default:
        statusText = null;
    }
  }

  return (
    <>
      <SettingsRow
        title={t("updates.preferenceTitle")}
        description={t("updates.preferenceDesc")}
      >
        <div className="flex flex-col items-end gap-1.5">
          <SettingsMenuSelect
            label={t("updates.preferenceTitle")}
            value={selectedPreference}
            options={[
              {
                id: "automatic",
                label: t("updates.automatic"),
                disabled:
                  update?.automaticSupported !== true || preferenceLocked,
              },
              {
                id: "manual",
                label: t("updates.manual"),
                disabled: preferenceLocked,
              },
            ]}
            disabled={preferenceLocked}
            busy={preferenceSaving || update?.status === "downloading"}
            onChange={(value) => void savePreference(value)}
          />
          {update?.automaticSupported === false ? (
            <div className="text-right text-xs-plus text-text-muted">
              {t("updates.automaticUnsupported")}
            </div>
          ) : null}
          {update?.automaticSupported && update.defaultPreference === "manual" ? (
            <div className="text-right text-xs-plus text-text-muted">
              {t("updates.automaticPortableWarning")}
            </div>
          ) : null}
        </div>
      </SettingsRow>
      <SettingsRow title={t("updates.title")} description={t("updates.desc")}>
        <div className="flex flex-col items-end gap-1.5">
          <div className="update-settings-actions">
            <Button
              variant="secondary"
              onClick={() => setReleaseNotesOpen(true)}
            >
              <IconFileText size={14} />
              {t("updates.releaseNotes")}
            </Button>
            {action}
          </div>
          {statusText ? (
            <div className="text-right text-xs-plus text-text-muted">{statusText}</div>
          ) : null}

        </div>
        {releaseNotesOpen ? (
          <Suspense
            fallback={
              <div
                className="route-pending"
                role="status"
                aria-label={t("app.loadingView")}
              >
                <span className="route-pending-indicator" aria-hidden />
              </div>
            }
          >
            <ReleaseNotesDialog
              currentVersion={update?.currentVersion ?? currentVersion}
              availableVersion={update?.availableVersion}
              onClose={closeReleaseNotes}
            />
          </Suspense>
        ) : null}
      </SettingsRow>
    </>
  );
}
