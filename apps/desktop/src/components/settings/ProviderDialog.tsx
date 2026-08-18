import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { useTranslation } from "react-i18next";
import type { ProviderPublic } from "@pi-desktop/shared";
import { Button, Field, Input, Select, cx } from "../ui";
import { IconClose } from "../icons";
import {
  CUSTOM_API_STYLE_OPTIONS,
  type ApiStyle,
  type ProviderForm,
} from "./provider-form";
import { useProviderModels } from "./useProviderModels";

export function ProviderDialog({
  editingProvider,
  form,
  setField,
  saving,
  onClose,
  onSave,
}: {
  editingProvider: ProviderPublic | null;
  form: ProviderForm;
  setField: <K extends keyof ProviderForm>(key: K, value: ProviderForm[K]) => void;
  saving: boolean;
  onClose: () => void;
  onSave: () => void;
}) {
  const { t } = useTranslation();
  const models = useProviderModels(true, form, editingProvider);

  const [menuOpen, setMenuOpen] = useState(false);
  const [highlight, setHighlight] = useState(-1);
  const comboRef = useRef<HTMLDivElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || saving) return;
      onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [saving, onClose]);

  useEffect(() => {
    if (!menuOpen) return;
    const onPointer = (event: MouseEvent) => {
      if (!comboRef.current?.contains(event.target as Node)) setMenuOpen(false);
    };
    window.addEventListener("mousedown", onPointer);
    return () => window.removeEventListener("mousedown", onPointer);
  }, [menuOpen]);

  const discovered = "models" in models ? models.models : [];
  const needle = form.modelId.trim().toLowerCase();
  const isExactPick = discovered.some((m) => m.modelId === form.modelId);
  // An exact selection shows the full list again so nearby options stay reachable.
  const filtered =
    needle && !isExactPick
      ? discovered.filter(
          (m) =>
            m.modelId.toLowerCase().includes(needle) ||
            (m.displayName ?? "").toLowerCase().includes(needle),
        )
      : discovered;

  useEffect(() => {
    if (!menuOpen) return;
    setHighlight(filtered.length ? 0 : -1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [menuOpen, needle, filtered.length]);

  useEffect(() => {
    if (!menuOpen || highlight < 0) return;
    listRef.current
      ?.querySelector(`[data-model-index="${highlight}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [menuOpen, highlight]);

  const pickModel = (modelId: string) => {
    setField("modelId", modelId);
    setMenuOpen(false);
  };

  const onComboKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (!menuOpen) {
        setMenuOpen(true);
        return;
      }
      if (!filtered.length) return;
      const delta = event.key === "ArrowDown" ? 1 : -1;
      setHighlight((current) => {
        const base = current < 0 ? (delta > 0 ? -1 : filtered.length) : current;
        return (base + delta + filtered.length) % filtered.length;
      });
    } else if (event.key === "Enter") {
      if (menuOpen && highlight >= 0 && filtered[highlight]) {
        event.preventDefault();
        pickModel(filtered[highlight].modelId);
      }
    } else if (event.key === "Escape" && menuOpen) {
      event.stopPropagation();
      setMenuOpen(false);
    }
  };

  const showMenu = menuOpen && filtered.length > 0;

  return (
    <div
      className="overlay provider-dialog-overlay"
      role="presentation"
      onClick={() => {
        if (saving) return;
        onClose();
      }}
    >
      <div
        className="dialog provider-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="provider-dialog-title"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="provider-dialog-head">
          <h3 id="provider-dialog-title" className="provider-dialog-title">
            {editingProvider
              ? t("settings.editProviderTitle")
              : t("settings.addProviderTitle")}
          </h3>
          <button
            type="button"
            className="provider-dialog-close"
            aria-label={t("settings.cancel")}
            disabled={saving}
            onClick={onClose}
          >
            <IconClose size={16} />
          </button>
        </div>

        <div className="provider-form-grid">
          <Field label={t("settings.name")}>
            <Input
              value={form.name}
              onChange={(e) => setField("name", e.target.value)}
              autoFocus
            />
          </Field>
          <Field label={t("settings.apiStyle")} hint={t("settings.apiStyleDesc")}>
            <Select
              value={form.apiStyle}
              onChange={(e) => setField("apiStyle", e.target.value as ApiStyle)}
            >
              {CUSTOM_API_STYLE_OPTIONS.map(([value, labelKey]) => (
                <option key={value} value={value}>
                  {t(labelKey)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t("settings.baseUrl")}>
            <Input
              value={form.baseUrl}
              onChange={(e) => setField("baseUrl", e.target.value)}
              className="font-mono text-sm-plus"
              placeholder="https://api.example.com/v1"
            />
          </Field>
          <Field
            label={t("settings.modelId")}
            hint={
              models.status === "error"
                ? t("settings.modelsFetchHint")
                : undefined
            }
          >
            <div className="provider-model-combo" ref={comboRef}>
              <Input
                value={form.modelId}
                onChange={(e) => {
                  setField("modelId", e.target.value);
                  setMenuOpen(true);
                }}
                onFocus={() => setMenuOpen(true)}
                onKeyDown={onComboKeyDown}
                className="font-mono text-sm-plus"
                placeholder={t("settings.searchOrEnterModel")}
                spellCheck={false}
                autoCorrect="off"
                autoCapitalize="off"
                autoComplete="off"
                role="combobox"
                aria-expanded={showMenu}
                aria-autocomplete="list"
              />
              {models.status === "loading" ? (
                <span
                  className="provider-model-spinner"
                  aria-label={t("settings.modelsLoading")}
                />
              ) : null}
              {showMenu ? (
                <div className="provider-model-menu" role="listbox" ref={listRef}>
                  {filtered.map((model, index) => (
                    <button
                      key={model.modelId}
                      type="button"
                      role="option"
                      aria-selected={form.modelId === model.modelId}
                      data-model-index={index}
                      className={cx(
                        "provider-model-option",
                        index === highlight && "highlighted",
                        form.modelId === model.modelId && "selected",
                      )}
                      onMouseEnter={() => setHighlight(index)}
                      // Fires before the input's blur; click would come too late.
                      onMouseDown={(event) => {
                        event.preventDefault();
                        pickModel(model.modelId);
                      }}
                    >
                      <span className="provider-model-option-id font-mono">
                        {model.modelId}
                      </span>
                      {model.displayName && model.displayName !== model.modelId ? (
                        <span className="provider-model-option-name">
                          {model.displayName}
                        </span>
                      ) : null}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          </Field>
          <Field
            label={t("settings.apiKey")}
            hint={
              editingProvider && editingProvider.hasSecret
                ? t("settings.apiKeyKeepHint")
                : t("settings.apiKeyHint")
            }
          >
            <Input
              type="password"
              value={form.apiKey}
              onChange={(e) => setField("apiKey", e.target.value)}
              placeholder="sk-…"
              className="font-mono text-sm-plus"
              autoComplete="off"
            />
          </Field>
        </div>

        <div className="provider-dialog-actions">
          <Button variant="ghost" disabled={saving} onClick={onClose}>
            {t("settings.cancel")}
          </Button>
          <Button
            variant="primary"
            disabled={
              saving ||
              !form.name.trim() ||
              !form.baseUrl.trim() ||
              !form.modelId.trim()
            }
            onClick={onSave}
          >
            {saving ? t("settings.saving") : t("settings.saveProvider")}
          </Button>
        </div>
      </div>
    </div>
  );
}
