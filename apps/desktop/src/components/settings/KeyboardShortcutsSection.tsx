import { useMemo, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { useTranslation } from "react-i18next";
import {
  KEYBOARD_SHORTCUTS,
  defaultKeybinding,
  isAllowedKeybinding,
  isReservedKeybinding,
  keybindingDisplayParts,
  keybindingFromEvent,
  keybindingsConflict,
  resolveKeybinding,
  type AppSettings,
  type KeyboardShortcutDefinition,
  type KeyboardShortcutGroup,
  type KeyboardShortcutId,
  type ShortcutPlatform,
} from "@pi-desktop/shared";
import { IconPower, IconSnapshot } from "../icons";
import { Badge, Button, Input, SegmentedControl, TooltipButton } from "../ui";
import { SettingsEmptyState } from "../../features/settings/primitives";

type Props = {
  settings: AppSettings;
  platform: ShortcutPlatform;
  saveSettings: (patch: Partial<AppSettings>) => Promise<void>;
};

const GROUP_ORDER: readonly KeyboardShortcutGroup[] = [
  "navigation",
  "agent",
  "window",
];

function shortcutLabelKey(id: KeyboardShortcutId): string {
  return `settings.shortcutAction.${id}`;
}

function Keybinding({
  binding,
  platform,
  unboundLabel,
}: {
  binding: string | null;
  platform: ShortcutPlatform;
  unboundLabel: string;
}) {
  if (!binding) {
    return (
      <span className="shortcut-unbound" aria-label={unboundLabel}>
        {unboundLabel}
      </span>
    );
  }
  const parts = keybindingDisplayParts(binding, platform);
  return (
    <span className="shortcut-keybinding" aria-label={parts.join("+")}>
      {parts.map((part, index) => (
        <span key={`${part}-${index}`} className="shortcut-key-part">
          {index > 0 ? <span className="shortcut-key-plus">+</span> : null}
          <kbd>{part}</kbd>
        </span>
      ))}
    </span>
  );
}

export function KeyboardShortcutsSection({ settings, platform, saveSettings }: Props) {
  const { t } = useTranslation();
  const [recordingId, setRecordingId] = useState<KeyboardShortcutId | null>(null);
  const [savingId, setSavingId] = useState<KeyboardShortcutId | null>(null);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<"all" | "modified">("all");
  const [resetting, setResetting] = useState(false);
  const [resetError, setResetError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<{ id: KeyboardShortcutId; message: string } | null>(
    null,
  );

  const groups = useMemo(
    () =>
      GROUP_ORDER.map((group) => ({
        group,
        shortcuts: KEYBOARD_SHORTCUTS.filter((shortcut) => {
          if (shortcut.group !== group) return false;
          if (filter === "modified" && !Object.prototype.hasOwnProperty.call(settings.keybindings ?? {}, shortcut.id)) return false;
          const binding = resolveKeybinding(shortcut, settings.keybindings, platform);
          const searchable = [
            t(shortcutLabelKey(shortcut.id)),
            binding ?? t("settings.shortcutUnbound"),
            binding ? keybindingDisplayParts(binding, platform).join("+") : "",
          ].join(" ").toLocaleLowerCase();
          return searchable.includes(query.trim().toLocaleLowerCase());
        }),
      })).filter(({ shortcuts }) => shortcuts.length > 0),
    [filter, platform, query, settings.keybindings, t],
  );
  const hasOverrides = Object.keys(settings.keybindings ?? {}).length > 0;
  const visibleCount = groups.reduce((count, { shortcuts }) => count + shortcuts.length, 0);
  const busy = savingId !== null || resetting;

  const storeBinding = async (
    shortcut: KeyboardShortcutDefinition,
    binding: string | null,
    mode: "binding" | "disabled" | "default" = "binding",
  ) => {
    setSaved(false);
    setResetError(null);
    const next = { ...(settings.keybindings ?? {}) };
    if (mode === "default") {
      delete next[shortcut.id];
    } else if (mode === "disabled") {
      next[shortcut.id] = null;
    } else if (!binding || binding === defaultKeybinding(shortcut, platform)) {
      delete next[shortcut.id];
    } else {
      next[shortcut.id] = binding;
    }
    const conflict = KEYBOARD_SHORTCUTS.find(
      (candidate) =>
        candidate.id !== shortcut.id &&
        keybindingsConflict(
          resolveKeybinding(candidate, settings.keybindings, platform),
          resolveKeybinding(shortcut, next, platform),
        ),
    );
    if (conflict) {
      setError({
        id: shortcut.id,
        message: t("settings.shortcutConflict", {
          action: t(shortcutLabelKey(conflict.id)),
        }),
      });
      return;
    }
    setSavingId(shortcut.id);
    setError(null);
    setSaved(false);
    try {
      await saveSettings({ keybindings: next });
      setRecordingId(null);
      setSaved(true);
    } catch (saveError) {
      setError({
        id: shortcut.id,
        message:
          saveError instanceof Error ? saveError.message : t("settings.shortcutSaveFailed"),
      });
    } finally {
      setSavingId(null);
    }
  };

  const resetAll = async () => {
    setRecordingId(null);
    setError(null);
    setResetError(null);
    setSaved(false);
    setResetting(true);
    try {
      await saveSettings({ keybindings: {} });
      setSaved(true);
    } catch (cause) {
      setResetError(cause instanceof Error ? cause.message : t("settings.shortcutSaveFailed"));
    } finally {
      setResetting(false);
    }
  };

  const recordBinding = (
    event: ReactKeyboardEvent<HTMLButtonElement>,
    shortcut: KeyboardShortcutDefinition,
  ) => {
    if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return;
    event.preventDefault();
    event.stopPropagation();
    if (event.key === "Escape") {
      setRecordingId(null);
      setError(null);
      return;
    }
    const binding = keybindingFromEvent(event.nativeEvent, platform);
    if (!binding || !isAllowedKeybinding(binding)) {
      setError({ id: shortcut.id, message: t("settings.shortcutRequiresModifier") });
      return;
    }
    if (isReservedKeybinding(binding, platform)) {
      setError({ id: shortcut.id, message: t("settings.shortcutReserved") });
      return;
    }
    void storeBinding(shortcut, binding);
  };

  return (
    <section className="settings-card-block">
      <div className="settings-card-heading-row">
        <div>
          <h3 className="settings-card-heading">{t("settings.keyboard")}</h3>
        </div>
        <Button
          type="button"
          variant="ghost"
          className="settings-text-action"
          disabled={!hasOverrides || busy}
          onClick={() => void resetAll()}
        >
          <IconSnapshot size={13} />
          <span>{t("settings.shortcutResetAll")}</span>
        </Button>
      </div>
      <div className="shortcut-filters">
        <Input
          value={query}
          onChange={(event) => { setQuery(event.target.value); setRecordingId(null); }}
          placeholder={t("settings.shortcutSearch")}
          aria-label={t("settings.shortcutSearch")}
          onKeyDown={(event) => {
            if (event.key === "Escape" && !event.nativeEvent.isComposing && event.nativeEvent.keyCode !== 229 && query) {
              event.preventDefault();
              event.stopPropagation();
              setQuery("");
            }
          }}
        />
        <SegmentedControl
          value={filter}
          onChange={(value) => { setFilter(value); setRecordingId(null); }}
          label={t("settings.shortcutFilter")}
          options={[
            { value: "all", label: t("settings.shortcutFilterAll") },
            { value: "modified", label: t("settings.shortcutFilterModified") },
          ]}
        />
        <span className="shortcut-result-count" role="status">{t("settings.shortcutCount", { count: visibleCount })}</span>
      </div>
      {resetError ? <div className="shortcut-error" role="alert">{resetError}</div> : null}
      {saved ? <div className="shortcut-save-state" role="status">{t("settings.preferenceSaved")}</div> : null}
      {visibleCount === 0 ? <SettingsEmptyState message={t("settings.shortcutNoMatches")} action={
        <Button variant="secondary" size="sm" onClick={() => { setQuery(""); setFilter("all"); }}>{t("settings.shortcutClearFilters")}</Button>
      } /> : null}
      <div className="settings-panel shortcut-map">
        {groups.map(({ group, shortcuts }) => (
          <div key={group} className="shortcut-group">
            <div className="shortcut-group-label">
              {t(`settings.shortcutGroup.${group}`)}
            </div>
            {shortcuts.map((shortcut) => {
              const binding = resolveKeybinding(shortcut, settings.keybindings, platform);
              const customized = Object.prototype.hasOwnProperty.call(
                settings.keybindings ?? {},
                shortcut.id,
              );
              const disabled = customized && settings.keybindings?.[shortcut.id] === null;
              const recording = recordingId === shortcut.id;
              const rowError = error?.id === shortcut.id ? error.message : null;
              return (
                <div key={shortcut.id} className="shortcut-row">
                  <div className="shortcut-row-copy">
                    <div className="settings-row-title">
                      {t(shortcutLabelKey(shortcut.id))}
                      {customized ? <Badge tone="neutral">{t("settings.shortcutFilterModified")}</Badge> : null}
                    </div>
                    {recording ? <div className="shortcut-recording-hint" role="status">{t("settings.shortcutRecordingCancel")}</div> : null}
                    {rowError ? (
                      <div className="shortcut-error" role="alert">
                        {rowError}
                      </div>
                    ) : null}
                  </div>
                  <div className="shortcut-row-controls">
                    <button
                      type="button"
                      className={`shortcut-recorder${recording ? " recording" : ""}`}
                      aria-label={t("settings.shortcutChange", {
                        action: t(shortcutLabelKey(shortcut.id)),
                      })}
                      aria-pressed={recording}
                      disabled={busy}
                      onClick={() => {
                        setError(null);
                        setSaved(false);
                        setRecordingId(shortcut.id);
                      }}
                      onBlur={() => setRecordingId((current) =>
                        current === shortcut.id ? null : current,
                      )}
                      onKeyDown={
                        recording
                          ? (event) => recordBinding(event, shortcut)
                          : undefined
                      }
                    >
                      {recording ? (
                        <span className="shortcut-recording-label">
                          {t("settings.shortcutRecording")}
                        </span>
                      ) : (
                        <Keybinding
                          binding={binding}
                          platform={platform}
                          unboundLabel={t("settings.shortcutUnbound")}
                        />
                      )}
                    </button>
                    <TooltipButton
                      type="button"
                      className="shortcut-disable"
                      tooltip={t("settings.shortcutDisable", {
                        action: t(shortcutLabelKey(shortcut.id)),
                      })}
                      ariaLabel={t("settings.shortcutDisable", {
                        action: t(shortcutLabelKey(shortcut.id)),
                      })}
                      disabled={disabled || busy}
                      onClick={() => void storeBinding(shortcut, null, "disabled")}
                    >
                      <IconPower size={13} />
                    </TooltipButton>
                    <TooltipButton
                      type="button"
                      className="shortcut-reset"
                      tooltip={t("settings.shortcutReset", {
                        action: t(shortcutLabelKey(shortcut.id)),
                      })}
                      ariaLabel={t("settings.shortcutReset", {
                        action: t(shortcutLabelKey(shortcut.id)),
                      })}
                      disabled={!customized || busy}
                      onClick={() => void storeBinding(shortcut, null, "default")}
                    >
                      <IconSnapshot size={13} />
                    </TooltipButton>
                  </div>
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </section>
  );
}
