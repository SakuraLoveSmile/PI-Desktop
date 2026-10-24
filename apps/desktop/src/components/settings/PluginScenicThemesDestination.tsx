import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { PluginScenicThemesDestinationMeta } from "@pi-desktop/shared";
import { api } from "../../lib/api";
import { useAppStore } from "../../stores/app-store";
import { Button, HelpIcon, cx } from "../ui";

type Props = {
  destination: PluginScenicThemesDestinationMeta;
  selectTheme: (themeId: string) => Promise<void>;
};

const clampBlur = (value: number) => Math.max(0, Math.min(20, Math.round(value)));

/**
 * The host owns every pixel of this destination. Plugins supply only the
 * already validated card metadata and declared backdrop assets.
 */
export function PluginScenicThemesDestination({ destination, selectTheme }: Props) {
  const { t } = useTranslation();
  const selectedTheme = useAppStore((state) => state.settings?.theme);
  const showToast = useAppStore((state) => state.showToast);
  const selectedCard = useMemo(
    () => destination.themes.find((theme) => theme.themeId === selectedTheme) ?? destination.themes[0],
    [destination.themes, selectedTheme],
  );
  const [confirmedBlur, setConfirmedBlur] = useState(selectedCard?.blur ?? 6);
  const [draftBlur, setDraftBlur] = useState(selectedCard?.blur ?? 6);
  const [saving, setSaving] = useState(false);
  const ownerRef = useRef({ pluginId: destination.pluginId, card: selectedCard });
  if (ownerRef.current.pluginId !== destination.pluginId || ownerRef.current.card !== selectedCard) {
    ownerRef.current = { pluginId: destination.pluginId, card: selectedCard };
  }
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  useEffect(() => {
    const blur = selectedCard?.blur ?? selectedCard?.blurDefault ?? 6;
    setConfirmedBlur(blur);
    setDraftBlur(blur);
    setSaving(false);
  }, [destination.pluginId, selectedCard]);

  if (!selectedCard) return null;

  const chooseTheme = async (themeId: string) => {
    try {
      await selectTheme(themeId);
    } catch (error) {
      showToast(error instanceof Error ? error.message : String(error), { variant: "error" });
    }
  };

  const apply = async () => {
    if (saving || draftBlur === confirmedBlur) return;
    const owner = ownerRef.current;
    const blur = draftBlur;
    setSaving(true);
    try {
      await api.setPluginScenicThemeBlur(destination.pluginId, selectedCard.themeId, blur);
      if (!mountedRef.current || ownerRef.current !== owner) return;
      setConfirmedBlur(blur);
      showToast(t("settings.pluginScenic.saved"), { variant: "success" });
    } catch (error) {
      if (!mountedRef.current || ownerRef.current !== owner) return;
      showToast(error instanceof Error ? error.message : String(error), { variant: "error" });
    } finally {
      if (mountedRef.current && ownerRef.current === owner) setSaving(false);
    }
  };

  return (
    <section className="plugin-scenic-themes-destination" aria-label={destination.label}>
      <p className="plugin-scenic-themes-description">{destination.description}</p>
      <div className="plugin-scenic-theme-grid">
        {destination.themes.map((theme) => {
          const selected = theme.themeId === selectedTheme;
          return (
            <button
              key={theme.themeId}
              type="button"
              className={cx("plugin-scenic-theme-card", selected && "active")}
              aria-pressed={selected}
              onClick={() => void chooseTheme(theme.themeId)}
            >
              <img src={theme.previewUrl} alt="" />
              <span className="plugin-scenic-theme-card-shade" aria-hidden />
              <span className="plugin-scenic-theme-card-content">
                <span className="plugin-scenic-theme-card-title">{theme.label}</span>
                <span className="plugin-scenic-theme-card-description">{theme.description}</span>
              </span>
              {selected && <span className="plugin-scenic-theme-card-check" aria-hidden>✓</span>}
            </button>
          );
        })}
      </div>
      <div className="plugin-scenic-blur-control">
        <div className="plugin-scenic-blur-copy">
          <span className="plugin-scenic-blur-label">
            {t("settings.pluginScenic.backdropBlur")}
            <HelpIcon label={t("settings.pluginScenic.appliesTo", { theme: selectedCard.label })} />
          </span>
        </div>
        <div className="plugin-scenic-blur-actions">
          <label className="sr-only" htmlFor="plugin-scenic-backdrop-blur">{t("settings.pluginScenic.backdropBlur")}</label>
          <input
            id="plugin-scenic-backdrop-blur"
            type="range"
            min="0"
            max="20"
            step="1"
            value={draftBlur}
            onChange={(event) => setDraftBlur(clampBlur(Number(event.target.value)))}
          />
          <output htmlFor="plugin-scenic-backdrop-blur">{draftBlur}px</output>
          <Button variant="primary" disabled={saving || draftBlur === confirmedBlur} onClick={() => void apply()}>
            {saving ? t("settings.pluginScenic.applying") : t("settings.pluginScenic.apply")}
          </Button>
        </div>
      </div>
    </section>
  );
}
