/**
 * Sign in with a vendor subscription instead of pasting an API key (ADR 0098).
 * Vendor accounts are separate from API providers in the settings hierarchy;
 * each account row owns exactly one OAuth provider row and can be removed on
 * its own.
 */
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useAppStore } from "../../stores/app-store";
import { api } from "../../lib/api";
import { Badge, Button, TooltipButton, cx } from "../ui";
import { IconKey, IconPencil, IconPlug, IconTrash } from "../icons";
import { OAuthLoginDialog } from "./OAuthLoginDialog";
import {
  VendorAccountDialog,
  type VendorAccountForm,
} from "./VendorAccountDialog";
import { VendorPickerDialog } from "./VendorPickerDialog";
import { useVendorAccounts, type AccountEntry } from "./useVendorAccounts";

export function VendorAccountsSection() {
  const { t } = useTranslation();
  const providers = useAppStore((s) => s.providers);
  const showToast = useAppStore((s) => s.showToast);
  const {
    vendors,
    accounts,
    login,
    busyAccountId,
    savingAccount,
    startLogin,
    finishLogin,
    closeLogin,
    removeAccount,
    saveAccount,
  } = useVendorAccounts();

  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const [editingAccount, setEditingAccount] = useState<AccountEntry | null>(null);
  const [testingAccount, setTestingAccount] = useState<string | null>(null);

  const saveEditingAccount = async (form: VendorAccountForm) => {
    const entry = editingAccount;
    const provider = entry
      ? providers.find((candidate) => candidate.id === entry.account.providerId)
      : null;
    if (!entry || !provider) return;
    if (await saveAccount(provider, form)) setEditingAccount(null);
  };

  const testAccount = async (entry: AccountEntry) => {
    const provider = providers.find((candidate) => candidate.id === entry.account.providerId);
    if (!provider) return;
    setTestingAccount(provider.id);
    try {
      const result = (await api.testProvider(provider.id)) as {
        ok?: boolean;
        message?: string;
        status?: number;
      };
      if (result.ok) {
        showToast(t("settings.testOk"), { variant: "success" });
      } else {
        showToast(
          result.message ||
            (result.status
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
      setTestingAccount(null);
    }
  };

  // Nothing to offer until the runtime reports at least one OAuth vendor.
  if (!vendors || vendors.length === 0) return null;

  const editingProvider = editingAccount
    ? providers.find((candidate) => candidate.id === editingAccount.account.providerId) ?? null
    : null;

  return (
    <section className="settings-card-block vendor-accounts-block">
      <div className="provider-section-head">
        <div>
          <div className="settings-card-heading-line">
            <h3 className="settings-card-heading">{t("settings.vendorAccounts")}</h3>
            {accounts.length > 0 ? (
              <span className="provider-section-count">{accounts.length}</span>
            ) : null}
          </div>
        </div>
        <Button
          variant="primary"
          disabled={login !== null}
          onClick={() => setPicking(true)}
        >
          <span className="vendor-btn-inner">
            <IconKey size={14} />
            <span>{t("settings.vendorAddAccount")}</span>
          </span>
        </Button>
      </div>

      <div className="settings-panel provider-list-panel">
        {accounts.length === 0 ? (
          <div className="vendor-account-empty">{t("settings.vendorNoAccounts")}</div>
        ) : (
          <div className="provider-row-list">
            {accounts.map((entry) => {
              const { vendor, account } = entry;
              const provider = providers.find((candidate) => candidate.id === account.providerId);
              const connected = account.connected;
              const accountName =
                account.accountLabel ||
                provider?.oauthAccountLabel ||
                t("settings.vendorSignedInGeneric");
              const duplicateLabel =
                entry.totalForVendor > 1
                  ? ` · ${t("settings.vendorAccountNumber", { number: entry.ordinal })}`
                  : "";
              const confirming = confirmDeleteId === account.providerId;
              const busy = busyAccountId === account.providerId;
              const testing = testingAccount === account.providerId;
              const rowBusy = busy || testing;
              return (
                <div
                  key={account.providerId}
                  className={cx(
                    "provider-row",
                    "vendor-account-row",
                    !connected && "is-disconnected",
                  )}
                >
                  <div className="provider-row-info">
                    <div className="provider-row-title-line">
                      <span className="provider-row-name">{vendor.name}</span>
                      {vendor.isSubscription ? (
                        <Badge tone="neutral">{t("settings.vendorSubscription")}</Badge>
                      ) : null}
                      <Badge tone={connected ? "success" : "warning"}>
                        {connected
                          ? t("settings.vendorConnected")
                          : t("settings.vendorDisconnected")}
                      </Badge>
                    </div>
                    <div className="provider-row-meta">
                      <span className="vendor-account-label">
                        {accountName}
                        {duplicateLabel}
                      </span>
                    </div>
                    {!connected ? (
                      <div className="vendor-account-status">
                        {t("settings.vendorDisconnectedDesc")}
                      </div>
                    ) : null}
                  </div>
                  <div className="provider-row-actions">
                    <TooltipButton
                      type="button"
                      className="icon-btn provider-icon-btn"
                      tooltip={t("settings.editVendorAccount")}
                      ariaLabel={t("settings.editVendorAccount")}
                      disabled={rowBusy || !provider}
                      onClick={() => setEditingAccount(entry)}
                    >
                      <IconPencil size={14} />
                    </TooltipButton>
                    <TooltipButton
                      type="button"
                      className={cx(
                        "icon-btn provider-icon-btn",
                        testing && "is-testing",
                      )}
                      tooltip={t("settings.testConnection")}
                      ariaLabel={t("settings.testConnection")}
                      disabled={rowBusy || !provider}
                      onClick={() => void testAccount(entry)}
                    >
                      <IconPlug size={14} />
                    </TooltipButton>
                    {confirming ? (
                      <button
                        type="button"
                        className="provider-delete-confirm"
                        disabled={rowBusy}
                        onBlur={() => setConfirmDeleteId(null)}
                        onClick={() => {
                          setConfirmDeleteId(null);
                          void removeAccount(entry);
                        }}
                      >
                        {t("settings.deleteConfirm")}
                      </button>
                    ) : (
                      <TooltipButton
                        type="button"
                        className="icon-btn provider-icon-btn provider-icon-btn-danger"
                        tooltip={t("settings.vendorRemoveAccount")}
                        ariaLabel={t("settings.vendorRemoveAccount")}
                        disabled={rowBusy}
                        onClick={() => setConfirmDeleteId(account.providerId)}
                      >
                        <IconTrash size={14} />
                      </TooltipButton>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {picking ? (
        <VendorPickerDialog
          vendors={vendors}
          onPick={(vendor) => {
            setPicking(false);
            // Started here, not in the dialog: a click happens once, where
            // StrictMode would run a mount effect twice and open two browsers.
            startLogin(vendor);
          }}
          onClose={() => setPicking(false)}
        />
      ) : null}

      {editingAccount && editingProvider ? (
        <VendorAccountDialog
          provider={editingProvider}
          initialName={
            editingAccount.account.accountLabel ||
            editingProvider.oauthAccountLabel ||
            editingProvider.name
          }
          saving={savingAccount}
          onClose={() => setEditingAccount(null)}
          onSave={(form) => void saveEditingAccount(form)}
        />
      ) : null}

      {login ? (
        <OAuthLoginDialog
          vendor={login.vendor}
          session={login.session}
          onDone={finishLogin}
          onClose={closeLogin}
        />
      ) : null}
    </section>
  );
}
