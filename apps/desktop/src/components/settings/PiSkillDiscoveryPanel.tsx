import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { PiSkillDiscovery } from "@pi-desktop/shared";
import { api } from "../../lib/api";
import { Button, TooltipButton } from "../ui";
import { IconX } from "../icons";

export function PiSkillDiscoveryPanel() {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [result, setResult] = useState<PiSkillDiscovery>({ candidates: [], errors: [] });
  const [refresh, setRefresh] = useState(0);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [discoveryError, setDiscoveryError] = useState("");
  const [importError, setImportError] = useState("");
  const revealButtonRef = useRef<HTMLButtonElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const focusAfterToggle = useRef<"reveal" | "heading" | null>(null);

  useLayoutEffect(() => {
    const target = focusAfterToggle.current === "reveal"
      ? revealButtonRef.current
      : focusAfterToggle.current === "heading" ? headingRef.current : null;
    target?.focus();
    focusAfterToggle.current = null;
  }, [open]);

  useEffect(() => {
    if (!open) return;
    let active = true;
    setLoading(true);
    setDiscoveryError("");
    void api.discoverPiSkills().then(value => {
      if (active) setResult(value);
    }, reason => {
      if (active) setDiscoveryError(String(reason));
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [open, refresh]);

  async function enable(id: string) {
    setBusy(true);
    setImportError("");
    try {
      const imported = await api.importPiSkills(id);
      if (!imported.canceled) {
        if (imported.dependencies?.state === "failed") {
          setImportError(t("plugins.importExtensionDepsFailed", { id: imported.id, error: imported.dependencies.error }));
        }
        setRefresh(value => value + 1);
      }
    } catch (reason) {
      setImportError(String(reason));
      // Host registration can succeed before the runtime fails to start.
      // Rediscover so a registered import stays manageable through Plugins.
      setRefresh(value => value + 1);
    }
    finally { setBusy(false); }
  }

  function handleReveal() {
    setLoading(true);
    setDiscoveryError("");
    focusAfterToggle.current = "heading";
    setOpen(true);
    setRefresh(value => value + 1);
  }

  if (!open) {
    return (
      <section
        className="settings-card-block pi-skill-discovery pi-skill-discovery-collapsed"
        aria-label={t("plugins.piSkillsTitle")}
      >
        <div className="pi-skill-discovery-summary">
          <h3 className="settings-card-heading">{t("plugins.piSkillsTitle")}</h3>
          <p className="settings-row-detail">{t("plugins.piSkillsSummary")}</p>
        </div>
        <Button
          type="button"
          ref={revealButtonRef}
          className="pi-skill-discovery-reveal"
          data-action="reveal-pi-skills"
          onClick={handleReveal}
        >
          {t("plugins.piSkillsReveal")}
        </Button>
      </section>
    );
  }

  return (
    <section className="settings-card-block pi-skill-discovery" aria-label={t("plugins.piSkillsTitle")}>
      <div className="pi-skill-discovery-header">
        <h3 ref={headingRef} tabIndex={-1} className="settings-card-heading">{t("plugins.piSkillsTitle")}</h3>
        <TooltipButton
          type="button"
          className="icon-btn pi-skill-discovery-dismiss"
          data-action="dismiss-pi-skills"
          ariaLabel={t("plugins.piSkillsDismiss")}
          tooltip={t("plugins.piSkillsDismiss")}
          disabled={busy}
          onClick={() => {
            focusAfterToggle.current = "reveal";
            setOpen(false);
          }}
        >
          <IconX size={14} aria-hidden="true" />
        </TooltipButton>
      </div>
      <div className="pi-skill-discovery-body">
        <p className="settings-row-detail">{t("plugins.piSkillsHint")}</p>
        <Button
          type="button"
          disabled={loading || busy}
          onClick={() => {
            setLoading(true);
            setDiscoveryError("");
            setRefresh(value => value + 1);
          }}
        >
          {t("plugins.piSkillsRefresh")}
        </Button>
        {loading ? (
          <p role="status" className="pi-skill-discovery-status">{t("plugins.piSkillsLoading")}</p>
        ) : discoveryError ? (
          <div role="alert" className="pi-skill-discovery-error">
            <p>{t("plugins.piSkillsDiscoveryFailed")}</p>
            <details>
              <summary>{t("plugins.details")}</summary>
              <p>{discoveryError}</p>
            </details>
          </div>
        ) : result.candidates.length === 0 && result.errors.length === 0 ? (
          <p className="pi-skill-discovery-status">{t("plugins.piSkillsEmpty")}</p>
        ) : (
          result.candidates.map(candidate => (
            <div key={candidate.id} className="settings-row">
              <div className="settings-row-copy">
                <strong className="settings-row-title">{candidate.name}</strong>
                <div className="settings-row-detail">{candidate.path}</div>
                <div className="settings-row-detail">{candidate.skills.join(", ")}</div>
                {candidate.hasExtensions && <p>{t("plugins.piSkillsExecutable")}</p>}
              </div>
              <Button
                type="button"
                disabled={busy || candidate.imported}
                onClick={() => { void enable(candidate.id); }}
              >
                {t(candidate.imported ? "plugins.piSkillsImported" : "plugins.piSkillsImport")}
              </Button>
            </div>
          ))
        )}
        {importError && <p role="alert" className="pi-skill-discovery-error">{importError}</p>}
        {!loading && !discoveryError && result.errors.length > 0 && (
          <div role="alert" className="pi-skill-discovery-error">
            <p>{t("plugins.piSkillsDiscoveryPartial")}</p>
            <details>
              <summary>{t("plugins.details")}</summary>
              {result.errors.map(message => <p key={message}>{message}</p>)}
            </details>
          </div>
        )}
      </div>
    </section>
  );
}
