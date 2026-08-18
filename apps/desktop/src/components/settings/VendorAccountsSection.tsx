/**
 * Sign in with a vendor subscription instead of pasting an API key (ADR 0095).
 * The card list is derived from the runtime's built-in provider catalog, so a
 * vendor that gains or loses an OAuth flow needs no change here.
 */
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { OAuthVendor } from "@pi-desktop/shared";
import { useAppStore } from "../../stores/app-store";
import { api } from "../../lib/api";
import { Badge, Button } from "../ui";
import { IconKey, IconLogOut } from "../icons";
import { OAuthLoginDialog } from "./OAuthLoginDialog";

type ActiveLogin = { loginId: string; vendor: OAuthVendor };

export function VendorAccountsSection() {
  const { t } = useTranslation();
  const refreshProviders = useAppStore((s) => s.refreshProviders);
  const showToast = useAppStore((s) => s.showToast);

  const [vendors, setVendors] = useState<OAuthVendor[] | null>(null);
  const [busyVendor, setBusyVendor] = useState<string | null>(null);
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

  const startLogin = async (vendor: OAuthVendor) => {
    setBusyVendor(vendor.vendorId);
    try {
      const started = await api.startOauthLogin(vendor.vendorId);
      setLogin({ loginId: started.loginId, vendor });
    } catch (error) {
      showToast(error instanceof Error ? error.message : String(error), {
        variant: "error",
      });
    } finally {
      setBusyVendor(null);
    }
  };

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

  return (
    <section className="settings-card-block">
      <h3 className="settings-card-heading">{t("settings.vendorAccounts")}</h3>
      <div className="settings-panel">
        <div className="vendor-account-desc">{t("settings.vendorAccountsDesc")}</div>
        <div className="vendor-card-list">
          {vendors.map((vendor) => (
            <div key={vendor.vendorId} className="vendor-card">
              <div className="vendor-card-info">
                <div className="vendor-card-title-line">
                  <span className="vendor-card-name">{vendor.name}</span>
                  {vendor.isSubscription ? (
                    <Badge tone="neutral">{t("settings.vendorSubscription")}</Badge>
                  ) : null}
                  {vendor.signedIn ? (
                    <Badge tone="success">{t("settings.vendorConnected")}</Badge>
                  ) : null}
                </div>
                {/* A vendor's own call to action, or the account it is signed
                    into; the button already says what clicking does. */}
                {vendor.signedIn || vendor.loginLabel ? (
                  <div className="vendor-card-meta">
                    {vendor.signedIn
                      ? vendor.accountLabel || t("settings.vendorSignedInGeneric")
                      : vendor.loginLabel}
                  </div>
                ) : null}
              </div>
              {vendor.signedIn ? (
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
              ) : (
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={busyVendor === vendor.vendorId || login !== null}
                  onClick={() => void startLogin(vendor)}
                >
                  <span className="vendor-btn-inner">
                    <IconKey size={13} />
                    <span>{t("settings.vendorSignIn")}</span>
                  </span>
                </Button>
              )}
            </div>
          ))}
        </div>
      </div>

      {login ? (
        <OAuthLoginDialog
          loginId={login.loginId}
          vendor={login.vendor}
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
