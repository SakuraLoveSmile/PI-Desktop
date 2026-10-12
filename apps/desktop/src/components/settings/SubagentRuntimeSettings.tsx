import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  MAX_SUBAGENT_MAX_CONCURRENCY,
  MAX_SUBAGENT_MAX_DEPTH,
  normalizeSubagentLimits,
  type AppSettings,
  type SubagentLimitField,
} from "@pi-desktop/shared";
import { SettingsCard, SettingsRow } from "../../features/settings/primitives";
import { useAppStore } from "../../stores/app-store";
import { Input } from "../ui";
import { persistSubagentLimit } from "./subagent-runtime-settings";

function LimitRow({ field, value, min, max, title, description }: {
  field: SubagentLimitField;
  value: number;
  min: number;
  max: number;
  title: string;
  description: string;
}) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState(String(value));
  const [saving, setSaving] = useState(false);
  const pending = useRef(false);
  const mounted = useRef(false);
  const showToast = useAppStore((state) => state.showToast);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  useEffect(() => { setDraft(String(value)); }, [value]);

  const commit = async () => {
    if (pending.current || draft.trim() === String(value)) return;
    pending.current = true;
    setSaving(true);
    try {
      const confirmed = await persistSubagentLimit(field, draft);
      if (confirmed) useAppStore.setState({ settings: confirmed });
      else {
        setDraft(String(value));
        showToast(t("settings.subagentLimitInvalid", { min, max }), { variant: "error" });
      }
    } catch (error) {
      if (mounted.current) setDraft(String(value));
      showToast(error instanceof Error ? error.message : t("settings.subagentLimitSaveError"), { variant: "error" });
    } finally {
      pending.current = false;
      if (mounted.current) setSaving(false);
    }
  };

  return (
    <SettingsRow title={title} description={description}>
      <div className="settings-number-control">
        <Input type="number" min={min} max={max} step={1} inputMode="numeric"
          aria-label={title} value={draft} disabled={saving}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={() => void commit()}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              event.currentTarget.blur();
            }
          }} />
      </div>
    </SettingsRow>
  );
}

export function SubagentRuntimeSettings({ settings }: { settings: AppSettings | undefined }) {
  const { t } = useTranslation();
  if (!settings) return null;
  const limits = normalizeSubagentLimits(settings);
  return (
    <SettingsCard title={t("settings.subagentRuntimeLimits")} description={t("settings.subagentRuntimeLimitsDesc")}>
      <LimitRow field="subagentMaxDepth" value={limits.maxDepth} min={0} max={MAX_SUBAGENT_MAX_DEPTH}
        title={t("settings.subagentMaxDepth")} description={t("settings.subagentMaxDepthDesc")} />
      <LimitRow field="subagentMaxConcurrency" value={limits.maxConcurrency} min={1} max={MAX_SUBAGENT_MAX_CONCURRENCY}
        title={t("settings.subagentMaxConcurrency")} description={t("settings.subagentMaxConcurrencyDesc")} />
    </SettingsCard>
  );
}
