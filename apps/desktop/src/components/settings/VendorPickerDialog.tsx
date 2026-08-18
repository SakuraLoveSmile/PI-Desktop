/**
 * Pick which vendor to sign in to (ADR 0095). The account list stays short by
 * asking only when the user wants a new account, the same way a provider row
 * starts from one "add" button rather than a card per known service.
 */
import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import type { OAuthVendor } from "@pi-desktop/shared";
import { Button } from "../ui";

export function VendorPickerDialog({
  vendors,
  onPick,
  onClose,
}: {
  /** Vendors that are not signed in yet; never empty when this is rendered. */
  vendors: OAuthVendor[];
  onPick: (vendor: OAuthVendor) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return (
    <div className="overlay provider-dialog-overlay" role="presentation">
      <div
        className="dialog oauth-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="vendor-picker-title"
      >
        <h3 id="vendor-picker-title" className="provider-dialog-title">
          {t("settings.vendorPickTitle")}
        </h3>
        <div className="oauth-status">{t("settings.vendorPickDesc")}</div>
        <div className="oauth-options">
          {vendors.map((vendor) => (
            <button
              key={vendor.vendorId}
              type="button"
              className="oauth-option"
              onClick={() => onPick(vendor)}
            >
              <span className="oauth-option-label">{vendor.name}</span>
              {/* The vendor's own call to action when it has one; otherwise
                  say whether this is a subscription rather than pay-per-use. */}
              {vendor.loginLabel || vendor.isSubscription ? (
                <span className="oauth-option-desc">
                  {vendor.loginLabel || t("settings.vendorSubscription")}
                </span>
              ) : null}
            </button>
          ))}
        </div>
        <div className="provider-dialog-actions">
          <Button variant="ghost" onClick={onClose}>
            {t("settings.cancel")}
          </Button>
        </div>
      </div>
    </div>
  );
}
