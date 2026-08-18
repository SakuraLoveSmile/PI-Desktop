/**
 * Sign in with a vendor subscription instead of pasting an API key (ADR 0095).
 * The panel lists accounts, not vendors: one "add" button opens the picker, the
 * same shape as the provider list, so a runtime that knows seven OAuth vendors
 * does not spend seven rows saying nobody is signed in.
 */
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { OAuthVendor } from "@pi-desktop/shared";
import { useAppStore } from "../../stores/app-store";
import { api } from "../../lib/api";
import {
  beginOAuthLogin,
  type OAuthLoginSession,
} from "../../lib/oauth-login-session";
import { Badge, Button } from "../ui";
import { IconKey, IconLogOut } from "../icons";
import { OAuthLoginDialog } from "./OAuthLoginDialog";
import { VendorPickerDialog } from "./VendorPickerDialog";

/** A login in flight, together with the dialog reporting on it. */
type ActiveLogin = { vendor: OAuthVendor; session: OAuthLoginSession };

export function VendorAccountsSection() {
  const { t } = useTranslation();
  const refreshProviders = useAppStore((s) => s.refreshProviders);
  const showToast = useAppStore((s) => s.showToast);

  const [vendors, setVendors] = useState<OAuthVendor[] | null>(null);
  const [busyVendor, setBusyVendor] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const [login, setLogin] = useState<ActiveLogin | null>(null);

  const loadVendors = useCallback(async () => {
    try {
      const result = await api.listOauthVendors();
      setVendors(result.vendors);
    } catch {
      // A runtime without OAuth flows registered simply has no accounts to
      // offer; the section stays hidden rather than showing an error.
      setVendors([]);
    }
  }, []);

  useEffect(() => {
    void loadVendors();
  }, [loadVendors]);

  // Closing the dialog — done, cancelled, or the whole page going away — stops
  // the renderer listening. Cancelling the attempt itself is the dialog's job.
  useEffect(() => () => login?.session.dispose(), [login]);

  const signOut = async (vendor: OAuthVendor) => {
    setBusyVendor(vendor.vendorId);
    try {
      await api.logoutOauthVendor(vendor.vendorId);
      await loadVendors();
      await refreshProviders();
      showToast(t("settings.vendorSignedOut", { vendor: vendor.name }), {
        variant: "success",
      });
    } catch (error) {
      showToast(error instanceof Error ? error.message : String(error), {
        variant: "error",
      });
    } finally {
      setBusyVendor(null);
    }
  };

  const onLoginDone = useCallback(
    (accountLabel?: string) => {
      const vendorName = login?.vendor.name ?? "";
      setLogin(null);
      void loadVendors();
      void refreshProviders();
      showToast(
        accountLabel
          ? t("settings.vendorSignedInAs", { account: accountLabel })
          : t("settings.vendorSignedIn", { vendor: vendorName }),
        { variant: "success" },
      );
    },
    [login, loadVendors, refreshProviders, showToast, t],
  );

  // Nothing to offer until the runtime reports at least one OAuth vendor.
  if (!vendors || vendors.length === 0) return null;

  const accounts = vendors.filter((vendor) => vendor.signedIn);
  const available = vendors.filter((vendor) => !vendor.signedIn);

  return (
    <section className="settings-card-block">
      <div className="provider-section-head">
        <h3 className="settings-card-heading">{t("settings.vendorAccounts")}</h3>
        <Button
          variant="secondary"
          disabled={available.length === 0 || login !== null}
          title={available.length === 0 ? t("settings.vendorAllSignedIn") : undefined}
          onClick={() => setPicking(true)}
        >
          <span className="vendor-btn-inner">
            <IconKey size={14} />
            <span>{t("settings.vendorAddAccount")}</span>
          </span>
        </Button>
      </div>

      <div className="settings-panel">
        <div className="vendor-account-desc">{t("settings.vendorAccountsDesc")}</div>
        {accounts.length === 0 ? (
          <div className="vendor-account-empty">{t("settings.vendorNoAccounts")}</div>
        ) : (
          <div className="vendor-card-list">
            {accounts.map((vendor) => (
              <div key={vendor.vendorId} className="vendor-card">
                <div className="vendor-card-info">
                  <div className="vendor-card-title-line">
                    <span className="vendor-card-name">{vendor.name}</span>
                    {vendor.isSubscription ? (
                      <Badge tone="neutral">{t("settings.vendorSubscription")}</Badge>
                    ) : null}
                    <Badge tone="success">{t("settings.vendorConnected")}</Badge>
                  </div>
                  <div className="vendor-card-meta">
                    {vendor.accountLabel || t("settings.vendorSignedInGeneric")}
                  </div>
                </div>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={busyVendor === vendor.vendorId}
                  onClick={() => void signOut(vendor)}
                >
                  <span className="vendor-btn-inner">
                    <IconLogOut size={13} />
                    <span>{t("settings.vendorSignOut")}</span>
                  </span>
                </Button>
              </div>
            ))}
          </div>
        )}
      </div>

      {picking ? (
        <VendorPickerDialog
          vendors={available}
          onPick={(vendor) => {
            setPicking(false);
            // Started here, not in the dialog: a click happens once, where
            // StrictMode would run a mount effect twice and open two browsers.
            setLogin({
              vendor,
              session: beginOAuthLogin({ api, vendorId: vendor.vendorId }),
            });
          }}
          onClose={() => setPicking(false)}
        />
      ) : null}

      {login ? (
        <OAuthLoginDialog
          vendor={login.vendor}
          session={login.session}
          onDone={onLoginDone}
          onClose={() => {
            setLogin(null);
            void loadVendors();
          }}
        />
      ) : null}
    </section>
  );
}
