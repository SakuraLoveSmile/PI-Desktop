import { useEffect, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { ProviderPublic } from "@pi-desktop/shared";
import { useAppStore } from "../../stores/app-store";
import { api } from "../../lib/api";
import { Badge, Button, cx } from "../ui";
import { IconPencil, IconPlug, IconPlus, IconServer, IconTrash } from "../icons";
import {
  API_STYLE_OPTIONS,
  EMPTY_PROVIDER_FORM,
  formFromProvider,
  hostFromBaseUrl,
  normalizeApiStyle,
  type ProviderForm,
} from "./provider-form";
import { ProviderDialog } from "./ProviderDialog";
import { VendorAccountsSection } from "./VendorAccountsSection";

const DELETE_CONFIRM_MS = 3000;

function SettingsRow({
  title,
  description,
  children,
}: {
  title: string;
  description?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="settings-row">
      <div className="settings-row-copy">
        <div className="settings-row-title">{title}</div>
        {description ? <div className="settings-row-desc">{description}</div> : null}
      </div>
      <div className="settings-row-control">{children}</div>
    </div>
  );
}

export function ProvidersSection() {
  const { t } = useTranslation();
  const providers = useAppStore((s) => s.providers);
  const settings = useAppStore((s) => s.settings);
  const refreshProviders = useAppStore((s) => s.refreshProviders);
  const showToast = useAppStore((s) => s.showToast);

  // null = closed, "" = add dialog, provider id = edit dialog.
  const [dialogFor, setDialogFor] = useState<string | null>(null);
  const [form, setForm] = useState<ProviderForm>(EMPTY_PROVIDER_FORM);
  const [saving, setSaving] = useState(false);
  const [testingId, setTestingId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  // Two-step delete: first click arms the button, second click deletes.
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const confirmTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!confirmDeleteId) return;
    confirmTimer.current = setTimeout(
      () => setConfirmDeleteId(null),
      DELETE_CONFIRM_MS,
    );
    return () => {
      if (confirmTimer.current) clearTimeout(confirmTimer.current);
    };
  }, [confirmDeleteId]);

  if (!settings) return null;

  const providerReady = (p: ProviderPublic) =>
    p.enabled && !!p.defaultModelId && (p.hasSecret || p.authKind === "none");
  const setField = <K extends keyof ProviderForm>(key: K, value: ProviderForm[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const editingProvider =
    dialogFor ? providers.find((p) => p.id === dialogFor) ?? null : null;

  const openAdd = () => {
    setForm(EMPTY_PROVIDER_FORM);
    setDialogFor("");
  };

  const openEdit = (provider: ProviderPublic) => {
    setForm(formFromProvider(provider));
    setDialogFor(provider.id);
  };

  const saveProvider = async () => {
    if (!form.name.trim()) return;
    setSaving(true);
    try {
      if (editingProvider) {
        await api.updateProvider({
          id: editingProvider.id,
          name: form.name.trim(),
          baseUrl: form.baseUrl.trim(),
          defaultModelId: form.modelId.trim(),
          apiStyle: form.apiStyle,
          ...(form.apiKey ? { secretValue: form.apiKey } : {}),
        });
        // Keep the global default model in step when it points at this provider.
        if (settings.defaultProviderId === editingProvider.id) {
          await api.setSettings({
            ...settings,
            defaultModelId: form.modelId.trim() || settings.defaultModelId,
          });
        }
        showToast(t("settings.providerUpdated"), { variant: "success" });
      } else {
        const created = await api.createProvider({
          name: form.name.trim(),
          vendorKey: "custom",
          type: "openai_compatible",
          protocol: "openai_compatible",
          baseUrl: form.baseUrl.trim(),
          authKind: "api_key_and_base_url",
          defaultModelId: form.modelId.trim(),
          secretValue: form.apiKey || undefined,
          apiStyle: form.apiStyle,
        });
        await api.setSettings({
          ...settings,
          defaultProviderId: created.provider.id,
          defaultModelId: form.modelId.trim() || settings.defaultModelId,
        });
        showToast(t("settings.providerSaved"), { variant: "success" });
      }
      setDialogFor(null);
      setForm(EMPTY_PROVIDER_FORM);
      await refreshProviders();
    } catch (e) {
      showToast(e instanceof Error ? e.message : String(e), { variant: "error" });
    } finally {
      setSaving(false);
    }
  };

  const toggleEnabled = async (provider: ProviderPublic) => {
    setBusyId(provider.id);
    try {
      await api.updateProvider({ id: provider.id, enabled: !provider.enabled });
      await refreshProviders();
      showToast(
        t(provider.enabled ? "settings.providerDisabled" : "settings.providerEnabled"),
        { variant: "success" },
      );
    } catch (error) {
      showToast(error instanceof Error ? error.message : String(error), {
        variant: "error",
      });
    } finally {
      setBusyId(null);
    }
  };

  const setDefaultModel = async (providerId: string) => {
    const provider = providers.find((p) => p.id === providerId);
    if (!provider) return;
    await api.setSettings({
      ...settings,
      defaultProviderId: provider.id,
      defaultModelId: provider.defaultModelId || settings.defaultModelId,
    });
    await refreshProviders();
  };

  const makeDefault = async (provider: ProviderPublic) => {
    setBusyId(provider.id);
    try {
      await api.setSettings({
        ...settings,
        defaultProviderId: provider.id,
        defaultModelId: provider.defaultModelId || settings.defaultModelId,
      });
      await refreshProviders();
      showToast(t("settings.defaultUpdated"), { variant: "success" });
    } catch (error) {
      showToast(error instanceof Error ? error.message : String(error), {
        variant: "error",
      });
    } finally {
      setBusyId(null);
    }
  };

  const removeProvider = async (provider: ProviderPublic) => {
    setConfirmDeleteId(null);
    setBusyId(provider.id);
    try {
      await api.deleteProvider(provider.id);
      await refreshProviders();
      showToast(t("settings.providerRemoved"), { variant: "success" });
    } catch (error) {
      showToast(error instanceof Error ? error.message : String(error), {
        variant: "error",
      });
    } finally {
      setBusyId(null);
    }
  };

  const testProvider = async (provider: ProviderPublic) => {
    setTestingId(provider.id);
    try {
      const result = (await api.testProvider(provider.id)) as {
        ok?: boolean;
        message?: string;
        network?: string;
        status?: number;
      };
      if (result?.ok) {
        showToast(t("settings.testOk"), { variant: "success" });
      } else {
        showToast(
          result?.message ||
            (result?.status
              ? t("settings.testFailedStatus", { status: result.status })
              : t("settings.testFailed")),
          { variant: "error" },
        );
      }
    } catch (error) {
      showToast(error instanceof Error ? error.message : String(error), {
        variant: "error",
      });
    } finally {
      setTestingId(null);
    }
  };

  return (
    <div className="settings-stack">
      <section className="settings-card-block">
        <h3 className="settings-card-heading">{t("settings.defaultsTitle")}</h3>
        <div className="settings-panel">
          <SettingsRow
            title={t("settings.defaultModel")}
            description={t("settings.defaultModelDesc")}
          >
            <select
              className="field-select"
              value={
                providers.some((p) => p.id === settings.defaultProviderId && providerReady(p))
                  ? settings.defaultProviderId
                  : ""
              }
              disabled={!providers.some(providerReady)}
              onChange={(e) => void setDefaultModel(e.target.value)}
            >
              {!providers.some(providerReady) ? (
                <option value="">{t("settings.defaultModelNone")}</option>
              ) : !providers.some(
                  (p) => p.id === settings.defaultProviderId && providerReady(p),
                ) ? (
                <option value="">{t("settings.noDefaultProvider")}</option>
              ) : null}
              {providers.filter(providerReady).map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} · {p.defaultModelId}
                </option>
              ))}
            </select>
          </SettingsRow>
        </div>
      </section>

      <VendorAccountsSection />

      <section className="settings-card-block">
        <div className="provider-section-head">
          <h3 className="settings-card-heading">{t("settings.providers")}</h3>
          <Button variant="primary" onClick={openAdd}>
            <span className="provider-add-btn-inner">
              <IconPlus size={14} />
              <span>{t("settings.addProvider")}</span>
            </span>
          </Button>
        </div>

        {dialogFor !== null ? (
          <ProviderDialog
            editingProvider={editingProvider}
            form={form}
            setField={setField}
            saving={saving}
            onClose={() => setDialogFor(null)}
            onSave={() => void saveProvider()}
          />
        ) : null}

        <div className="settings-panel provider-list-panel">
          {providers.length === 0 ? (
            <div className="provider-empty">
              <div className="provider-empty-icon" aria-hidden>
                <IconServer size={18} />
              </div>
              <div className="provider-empty-title">{t("settings.noProviders")}</div>
              <div className="provider-empty-desc">{t("settings.noProvidersDesc")}</div>
              <Button variant="primary" onClick={openAdd}>
                <span className="provider-add-btn-inner">
                  <IconPlus size={14} />
                  <span>{t("settings.addProvider")}</span>
                </span>
              </Button>
            </div>
          ) : (
            <div className="provider-row-list">
              {providers.map((provider) => {
                const isDefault = settings.defaultProviderId === provider.id;
                const rowBusy = busyId === provider.id || testingId === provider.id;
                const styleLabelKey = API_STYLE_OPTIONS.find(
                  ([style]) => style === normalizeApiStyle(provider.apiStyle),
                )?.[1];
                const confirming = confirmDeleteId === provider.id;
                return (
                  <div
                    key={provider.id}
                    className={cx("provider-row", !provider.enabled && "is-disabled")}
                  >
                    <div className="provider-row-info">
                      <div className="provider-row-title-line">
                        <span className="provider-row-name">{provider.name}</span>
                        {isDefault ? (
                          <Badge tone="success">{t("settings.default")}</Badge>
                        ) : null}
                        {provider.hasOauth ? (
                          <Badge tone="neutral">
                            {provider.oauthAccountLabel ||
                              t("settings.vendorAccountBadge")}
                          </Badge>
                        ) : null}
                        {!provider.hasSecret && provider.authKind !== "none" ? (
                          <Badge tone="warning">{t("settings.noSecret")}</Badge>
                        ) : null}
                      </div>
                      <div className="provider-row-meta">
                        <span>{hostFromBaseUrl(provider.baseUrl)}</span>
                        <span className="provider-meta-dot" aria-hidden>
                          ·
                        </span>
                        <span className="font-mono">
                          {provider.defaultModelId || t("settings.noModel")}
                        </span>
                        {styleLabelKey ? (
                          <>
                            <span className="provider-meta-dot" aria-hidden>
                              ·
                            </span>
                            <span>{t(styleLabelKey)}</span>
                          </>
                        ) : null}
                      </div>
                    </div>

                    <div className="provider-row-actions">
                      {!isDefault ? (
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={rowBusy}
                          onClick={() => void makeDefault(provider)}
                        >
                          {t("settings.makeDefault")}
                        </Button>
                      ) : null}
                      <button
                        type="button"
                        className="icon-btn provider-icon-btn"
                        title={t("settings.editProvider")}
                        aria-label={t("settings.editProvider")}
                        disabled={rowBusy}
                        onClick={() => openEdit(provider)}
                      >
                        <IconPencil size={14} />
                      </button>
                      <button
                        type="button"
                        className={cx(
                          "icon-btn provider-icon-btn",
                          testingId === provider.id && "is-testing",
                        )}
                        title={t("settings.testConnection")}
                        aria-label={t("settings.testConnection")}
                        disabled={rowBusy}
                        onClick={() => void testProvider(provider)}
                      >
                        <IconPlug size={14} />
                      </button>
                      {confirming ? (
                        <button
                          type="button"
                          className="provider-delete-confirm"
                          disabled={rowBusy}
                          onBlur={() => setConfirmDeleteId(null)}
                          onClick={() => void removeProvider(provider)}
                        >
                          {t("settings.deleteConfirm")}
                        </button>
                      ) : (
                        <button
                          type="button"
                          className="icon-btn provider-icon-btn provider-icon-btn-danger"
                          title={t("settings.delete")}
                          aria-label={t("settings.delete")}
                          disabled={rowBusy}
                          onClick={() => setConfirmDeleteId(provider.id)}
                        >
                          <IconTrash size={14} />
                        </button>
                      )}
                      <button
                        type="button"
                        className={cx("settings-toggle", provider.enabled && "on")}
                        role="switch"
                        aria-checked={provider.enabled}
                        aria-label={t("settings.enabledToggle")}
                        title={t("settings.enabledToggle")}
                        disabled={rowBusy}
                        onClick={() => void toggleEnabled(provider)}
                      >
                        <span className="settings-toggle-thumb" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
