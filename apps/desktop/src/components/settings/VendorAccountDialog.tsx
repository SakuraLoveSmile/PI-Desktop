import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { ProviderPublic } from "@pi-desktop/shared";
import { Button, Field, Input } from "../ui";
import { IconClose } from "../icons";
import { ModelCombobox } from "./ModelCombobox";
import { normalizeApiStyle } from "./provider-form";
import { useProviderModels } from "./useProviderModels";

export type VendorAccountForm = {
  name: string;
  modelId: string;
};

export function VendorAccountDialog({
  provider,
  initialName,
  onClose,
  onSave,
  saving,
}: {
  provider: ProviderPublic;
  initialName: string;
  onClose: () => void;
  onSave: (form: VendorAccountForm) => void;
  saving: boolean;
}) {
  const { t } = useTranslation();
  const [form, setForm] = useState<VendorAccountForm>({
    name: initialName,
    modelId: provider.defaultModelId ?? "",
  });
  const models = useProviderModels(
    true,
    {
      baseUrl: provider.baseUrl ?? "",
      apiKey: "",
      apiStyle: normalizeApiStyle(provider.apiStyle),
    },
    provider,
  );

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !saving) onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose, saving]);

  return (
    <div
      className="overlay provider-dialog-overlay"
      role="presentation"
      onClick={() => {
        if (!saving) onClose();
      }}
    >
      <div
        className="dialog provider-dialog vendor-account-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="vendor-account-dialog-title"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="provider-dialog-head">
          <h3 id="vendor-account-dialog-title" className="provider-dialog-title">
            {t("settings.editVendorAccountTitle")}
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

        <div className="provider-form-grid vendor-account-form-grid">
          <Field label={t("settings.name")}>
            <Input
              value={form.name}
              onChange={(event) =>
                setForm((current) => ({ ...current, name: event.target.value }))
              }
              autoFocus
            />
          </Field>
          <Field
            label={t("settings.defaultModel")}
            hint={
              models.status === "loading"
                ? t("settings.modelsLoading")
                : models.status === "error"
                  ? t("settings.modelsFetchHint")
                  : undefined
            }
          >
            <ModelCombobox
              value={form.modelId}
              models={models.status !== "idle" ? models.models : []}
              loading={models.status === "loading"}
              loadingLabel={t("settings.modelsLoading")}
              placeholder={t("settings.searchOrEnterModel")}
              onChange={(modelId) =>
                setForm((current) => ({ ...current, modelId }))
              }
            />
          </Field>
        </div>

        <div className="provider-dialog-actions">
          <Button variant="ghost" disabled={saving} onClick={onClose}>
            {t("settings.cancel")}
          </Button>
          <Button
            variant="primary"
            disabled={saving || !form.name.trim() || !form.modelId.trim()}
            onClick={() => onSave(form)}
          >
            {saving ? t("settings.saving") : t("settings.saveVendorAccount")}
          </Button>
        </div>
      </div>
    </div>
  );
}
