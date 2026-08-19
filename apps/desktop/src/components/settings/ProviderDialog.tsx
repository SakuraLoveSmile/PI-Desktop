import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import type { ProviderPublic } from "@pi-desktop/shared";
import { Button, Field, Input, Select } from "../ui";
import { IconClose } from "../icons";
import { ModelCombobox } from "./ModelCombobox";
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
  const discovered = "models" in models ? models.models : [];

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || saving) return;
      onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [saving, onClose]);

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
            <ModelCombobox
              value={form.modelId}
              models={discovered}
              loading={models.status === "loading"}
              loadingLabel={t("settings.modelsLoading")}
              placeholder={t("settings.searchOrEnterModel")}
              onChange={(modelId) => setField("modelId", modelId)}
            />
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
