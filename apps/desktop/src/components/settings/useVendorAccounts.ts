/**
 * Vendor (OAuth) accounts for the model settings page (ADR 0098).
 *
 * Owns what an account row needs beyond its provider row: the vendor list the
 * runtime reports, the login attempt in flight, and the two writes that must
 * keep the app default consistent — removing an account and saving its edits.
 * Rendering stays with the caller.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import type { OAuthAccount, OAuthVendor, ProviderPublic } from "@pi-desktop/shared";
import { useAppStore } from "../../stores/app-store";
import { api } from "../../lib/api";
import {
  beginOAuthLogin,
  type OAuthLoginSession,
} from "../../lib/oauth-login-session";
import type { VendorAccountForm } from "./VendorAccountDialog";

/** A login in flight, together with the dialog reporting on it. */
export type ActiveLogin = { vendor: OAuthVendor; session: OAuthLoginSession };

export type AccountEntry = {
  vendor: OAuthVendor;
  account: OAuthAccount;
  /** 1-based position among this vendor's accounts. */
  ordinal: number;
  totalForVendor: number;
};

function providerIsReady(provider: ProviderPublic, excludedId?: string): boolean {
  return (
    provider.id !== excludedId &&
    provider.enabled &&
    !!provider.defaultModelId &&
    (provider.hasSecret || provider.hasOauth || provider.authKind === "none")
  );
}

export function useVendorAccounts() {
  const { t } = useTranslation();
  const providers = useAppStore((s) => s.providers);
  const settings = useAppStore((s) => s.settings);
  const refreshProviders = useAppStore((s) => s.refreshProviders);
  const showToast = useAppStore((s) => s.showToast);

  const [vendors, setVendors] = useState<OAuthVendor[] | null>(null);
  const [login, setLogin] = useState<ActiveLogin | null>(null);
  const [busyAccountId, setBusyAccountId] = useState<string | null>(null);
  const [savingAccount, setSavingAccount] = useState(false);

  const loadVendors = useCallback(async () => {
    try {
      const result = await api.listOauthVendors();
      setVendors(result.vendors);
    } catch {
      // A runtime without OAuth flows registered simply has no accounts to
      // offer; the accounts stay hidden rather than showing an error.
      setVendors([]);
    }
  }, []);

  useEffect(() => {
    void loadVendors();
  }, [loadVendors]);

  // Closing the dialog — done, cancelled, or the whole page going away — stops
  // the renderer listening. Cancelling the attempt itself is the dialog's job.
  useEffect(() => () => login?.session.dispose(), [login]);

  const accounts = useMemo<AccountEntry[]>(() => {
    if (!vendors) return [];
    return vendors.flatMap((vendor) => {
      const totalForVendor = vendor.accounts.length;
      return vendor.accounts.map((account, index) => ({
        vendor,
        account,
        ordinal: index + 1,
        totalForVendor,
      }));
    });
  }, [vendors]);

  /**
   * Started from the caller's click handler, never from an effect: a click
   * happens once, where StrictMode would run a mount effect twice and open two
   * browsers.
   */
  const startLogin = (vendor: OAuthVendor) => {
    setLogin({
      vendor,
      session: beginOAuthLogin({ api, vendorId: vendor.vendorId }),
    });
  };

  const finishLogin = useCallback(
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

  const closeLogin = () => {
    setLogin(null);
    void loadVendors();
  };

  const removeAccount = async (entry: AccountEntry) => {
    const { account, vendor } = entry;
    setBusyAccountId(account.providerId);
    try {
      await api.deleteOauthAccount(account.providerId);

      // A deleted account cannot remain the global default. Pick the first
      // still-ready service, including an API provider, so the model picker
      // does not point at a deleted row after refresh.
      if (settings?.defaultProviderId === account.providerId) {
        const next = providers.find((provider) =>
          providerIsReady(provider, account.providerId),
        );
        const nextSettings = {
          ...settings,
          defaultProviderId: next?.id ?? "",
          defaultModelId: next?.defaultModelId ?? "",
        };
        await api.setSettings(nextSettings);
        useAppStore.setState({ settings: nextSettings });
      }
      await Promise.all([loadVendors(), refreshProviders()]);
      showToast(t("settings.vendorAccountRemoved", { vendor: vendor.name }), {
        variant: "success",
      });
    } catch (error) {
      showToast(error instanceof Error ? error.message : String(error), {
        variant: "error",
      });
    } finally {
      setBusyAccountId(null);
    }
  };

  /** Resolves true once the account is saved, so the caller can close its editor. */
  const saveAccount = async (
    provider: ProviderPublic,
    form: VendorAccountForm,
  ): Promise<boolean> => {
    if (!form.name.trim() || !form.modelId.trim()) return false;
    setSavingAccount(true);
    try {
      await api.updateProvider({
        id: provider.id,
        oauthAccountLabel: form.name.trim(),
        defaultModelId: form.modelId.trim(),
        models: form.models,
        headers: form.headers,
      });
      if (settings?.defaultProviderId === provider.id) {
        await api.setSettings({
          ...settings,
          defaultModelId: form.modelId.trim(),
        });
      }
      await Promise.all([loadVendors(), refreshProviders()]);
      showToast(t("settings.vendorAccountUpdated"), { variant: "success" });
      return true;
    } catch (error) {
      showToast(error instanceof Error ? error.message : String(error), {
        variant: "error",
      });
      return false;
    } finally {
      setSavingAccount(false);
    }
  };

  return {
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
  };
}
