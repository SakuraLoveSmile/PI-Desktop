import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAppStore } from "../stores/app-store";
import { api } from "../lib/api";
import { Button, Panel, cx } from "../components/ui";
import { IconAt, IconX } from "../components/icons";
import type { MarketPluginSummary, PluginSummary } from "@pi-desktop/shared";

type TabId = "installed" | "market";

const RISK_ORDER = [
  "net.fetch",
  "fs.write.workspace",
  "agent.prompt.inject",
  "shell.openExternal",
  "fs.read.workspace",
  "clipboard.read",
  "clipboard.write",
  "agent.tool.register",
];

function permissionLabel(key: string, t: (k: string, o?: any) => string): string {
  return t(`plugins.permissions.${key}`, { defaultValue: key });
}

export function PluginsPage() {
  const { t } = useTranslation();
  const plugins = useAppStore((s) => s.plugins);
  const refreshPlugins = useAppStore((s) => s.refreshPlugins);
  const showToast = useAppStore((s) => s.showToast);

  const [tab, setTab] = useState<TabId>("installed");
  const [query, setQuery] = useState("");
  const [market, setMarket] = useState<MarketPluginSummary[]>([]);
  const [marketLoading, setMarketLoading] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [pendingInstall, setPendingInstall] = useState<MarketPluginSummary | null>(null);
  const [autoUpdate, setAutoUpdate] = useState(true);

  const refreshMarket = async (q = query) => {
    setMarketLoading(true);
    try {
      const res = await api.marketSearch(q);
      setMarket(res.plugins ?? []);
    } catch (e) {
      showToast(e instanceof Error ? e.message : String(e), { variant: "error" });
    } finally {
      setMarketLoading(false);
    }
  };

  useEffect(() => {
    if (tab === "market") void refreshMarket("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  const installedById = useMemo(() => {
    const map = new Map<string, PluginSummary>();
    for (const plugin of plugins) map.set(plugin.id, plugin);
    return map;
  }, [plugins]);

  const loadDev = async () => {
    try {
      await api.loadDevPlugin();
      await refreshPlugins();
      showToast(t("plugins.loadDevDone"), { variant: "success" });
    } catch (e) {
      showToast(e instanceof Error ? e.message : String(e), { variant: "error" });
    }
  };

  const installPackage = async () => {
    try {
      await api.installPluginFromPackage();
      await refreshPlugins();
      showToast(t("plugins.installPackageDone"), { variant: "success" });
    } catch (e) {
      showToast(e instanceof Error ? e.message : String(e), { variant: "error" });
    }
  };

  const checkUpdates = async () => {
    try {
      const res = await api.marketCheckUpdates();
      await refreshPlugins();
      const count = res.updates?.length ?? 0;
      showToast(t("plugins.updatesFound", { count }), {
        variant: count > 0 ? "success" : "info",
      });
    } catch (e) {
      showToast(e instanceof Error ? e.message : String(e), { variant: "error" });
    }
  };

  const applyAutoUpdates = async () => {
    try {
      const res = await api.marketApplyUpdates(true);
      await refreshPlugins();
      showToast(
        t("plugins.autoUpdatesApplied", { count: res.results?.length ?? 0 }),
        { variant: "success" },
      );
    } catch (e) {
      showToast(e instanceof Error ? e.message : String(e), { variant: "error" });
    }
  };

  const confirmInstall = async () => {
    if (!pendingInstall) return;
    setBusyId(pendingInstall.id);
    try {
      await api.marketInstall({
        id: pendingInstall.id,
        enable: true,
        autoUpdate,
        grantedPermissions: pendingInstall.permissionSummary ?? [],
      });
      await refreshPlugins();
      await refreshMarket();
      showToast(t("plugins.installed", { name: pendingInstall.name }), {
        variant: "success",
      });
      setPendingInstall(null);
    } catch (e) {
      showToast(e instanceof Error ? e.message : String(e), { variant: "error" });
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="thread-scroll">
      <div className="page-frame">
        <div className="page-header">
          <div>
            <h1 className="page-title">{t("plugins.title")}</h1>
            <div className="page-subtitle">{t("plugins.subtitle")}</div>
          </div>
          <div className="plugins-header-actions">
            <Button variant="secondary" onClick={() => void checkUpdates()}>
              {t("plugins.checkUpdates")}
            </Button>
            <Button variant="secondary" onClick={() => void applyAutoUpdates()}>
              {t("plugins.applyAutoUpdates")}
            </Button>
            <Button variant="secondary" onClick={() => void installPackage()}>
              {t("plugins.installPackage")}
            </Button>
            <Button variant="secondary" onClick={() => void loadDev()}>
              {t("plugins.loadDev")}
            </Button>
          </div>
        </div>

        <div className="plugins-tabs" role="tablist" aria-label={t("plugins.title")}>
          <button
            type="button"
            role="tab"
            aria-selected={tab === "installed"}
            className={cx("plugins-tab", tab === "installed" && "active")}
            onClick={() => setTab("installed")}
          >
            {t("plugins.tabInstalled")}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === "market"}
            className={cx("plugins-tab", tab === "market" && "active")}
            onClick={() => setTab("market")}
          >
            {t("plugins.tabMarket")}
          </button>
        </div>

        {tab === "installed" ? (
          plugins.length === 0 ? (
            <Panel className="page-card page-empty">
              <div className="page-empty-icon">
                <IconAt size={20} />
              </div>
              <div className="text-base-plus font-medium">{t("plugins.empty")}</div>
              <div className="mt-2 max-w-md text-md text-text-secondary">
                {t("plugins.emptyBody")}
              </div>
              <div className="plugins-empty-actions">
                <Button variant="primary" onClick={() => setTab("market")}>
                  {t("plugins.browseMarket")}
                </Button>
                <Button variant="secondary" onClick={() => void loadDev()}>
                  {t("plugins.loadDev")}
                </Button>
              </div>
            </Panel>
          ) : (
            <div className="plugins-list" role="list" aria-label={t("plugins.tabInstalled")}>
              {plugins.map((plugin) => (
                <div
                  key={plugin.id}
                  role="listitem"
                  className={cx("plugins-row", !plugin.enabled && "off")}
                >
                  <span className="plugins-glyph">
                    <IconAt size={15} />
                  </span>
                  <span className="plugins-copy">
                    <span className="plugins-name">
                      {plugin.name}
                      {plugin.updateAvailable ? (
                        <span className="plugins-badge">
                          {t("plugins.updateAvailable", {
                            version: plugin.updateAvailable.version,
                          })}
                        </span>
                      ) : null}
                    </span>
                    <span className="plugins-meta">
                      {plugin.id} · v{plugin.version} · {plugin.source}
                      {plugin.autoUpdate ? ` · ${t("plugins.autoUpdateOn")}` : ""}
                    </span>
                    {plugin.permissions?.length ? (
                      <span className="plugins-perms">
                        {plugin.permissions
                          .slice()
                          .sort((a, b) => RISK_ORDER.indexOf(a) - RISK_ORDER.indexOf(b))
                          .map((perm) => permissionLabel(perm, t))
                          .join(" · ")}
                      </span>
                    ) : null}
                  </span>
                  <div className="plugins-row-actions">
                    {plugin.ui?.panel ? (
                      <button
                        type="button"
                        className="plugins-action"
                        onClick={async () => {
                          try {
                            await api.openPluginPanel(plugin.id);
                          } catch (e) {
                            showToast(e instanceof Error ? e.message : String(e), {
                              variant: "error",
                            });
                          }
                        }}
                      >
                        {t("plugins.openPanel")}
                      </button>
                    ) : null}
                    <button
                      type="button"
                      className="plugins-action"
                      onClick={async () => {
                        try {
                          await api.setPluginAutoUpdate(plugin.id, !plugin.autoUpdate);
                          await refreshPlugins();
                        } catch (e) {
                          showToast(e instanceof Error ? e.message : String(e), {
                            variant: "error",
                          });
                        }
                      }}
                    >
                      {plugin.autoUpdate
                        ? t("plugins.disableAutoUpdate")
                        : t("plugins.enableAutoUpdate")}
                    </button>
                    {plugin.updateAvailable ? (
                      <button
                        type="button"
                        className="plugins-action"
                        onClick={async () => {
                          setBusyId(plugin.id);
                          try {
                            await api.marketInstall({
                              id: plugin.id,
                              version: plugin.updateAvailable?.version,
                              enable: true,
                              autoUpdate: !!plugin.autoUpdate,
                              grantedPermissions: [
                                ...(plugin.permissions ?? []),
                                ...(plugin.updateAvailable?.permissionDiff ?? []),
                              ],
                            });
                            await refreshPlugins();
                            showToast(
                              t("plugins.updated", {
                                name: plugin.name,
                                version: plugin.updateAvailable?.version,
                              }),
                              { variant: "success" },
                            );
                          } catch (e) {
                            showToast(e instanceof Error ? e.message : String(e), {
                              variant: "error",
                            });
                          } finally {
                            setBusyId(null);
                          }
                        }}
                      >
                        {busyId === plugin.id
                          ? t("plugins.updating")
                          : t("plugins.updateNow")}
                      </button>
                    ) : null}
                    <button
                      type="button"
                      className="plugins-uninstall"
                      aria-label={t("plugins.uninstall")}
                      title={t("plugins.uninstall")}
                      onClick={async () => {
                        try {
                          await api.uninstallPlugin(plugin.id);
                          await refreshPlugins();
                        } catch (e) {
                          showToast(e instanceof Error ? e.message : String(e), {
                            variant: "error",
                          });
                        }
                      }}
                    >
                      <IconX size={14} />
                      {t("plugins.uninstall")}
                    </button>
                    <button
                      type="button"
                      className={cx("settings-toggle", plugin.enabled && "on")}
                      role="switch"
                      aria-checked={plugin.enabled}
                      aria-label={
                        plugin.enabled ? t("plugins.disable") : t("plugins.enable")
                      }
                      onClick={async () => {
                        try {
                          if (plugin.enabled) await api.disablePlugin(plugin.id);
                          else await api.enablePlugin(plugin.id);
                          await refreshPlugins();
                        } catch (e) {
                          showToast(e instanceof Error ? e.message : String(e), {
                            variant: "error",
                          });
                        }
                      }}
                    >
                      <span className="settings-toggle-thumb" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )
        ) : (
          <div className="plugins-market">
            <div className="plugins-market-bar">
              <input
                className="plugins-search"
                value={query}
                placeholder={t("plugins.marketSearchPlaceholder")}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void refreshMarket(query);
                }}
              />
              <Button variant="secondary" onClick={() => void refreshMarket(query)}>
                {t("plugins.search")}
              </Button>
            </div>
            {marketLoading ? (
              <Panel className="page-card page-empty">
                <div className="text-md text-text-secondary">{t("plugins.marketLoading")}</div>
              </Panel>
            ) : market.length === 0 ? (
              <Panel className="page-card page-empty">
                <div className="text-base-plus font-medium">{t("plugins.marketEmpty")}</div>
              </Panel>
            ) : (
              <div className="plugins-market-grid">
                {market.map((item) => {
                  const installed = installedById.get(item.id);
                  return (
                    <Panel key={item.id} className="plugins-market-card">
                      <div className="plugins-market-card-top">
                        <div>
                          <div className="plugins-name">
                            {item.name}
                            {item.verified ? (
                              <span className="plugins-badge">{t("plugins.verified")}</span>
                            ) : null}
                          </div>
                          <div className="plugins-meta">
                            {item.author} · v{item.latestVersion}
                            {item.downloads != null
                              ? ` · ${t("plugins.downloads", { count: item.downloads })}`
                              : ""}
                          </div>
                        </div>
                      </div>
                      <div className="plugins-market-desc">{item.description}</div>
                      <div className="plugins-perms">
                        {(item.permissionSummary ?? [])
                          .map((perm) => permissionLabel(perm, t))
                          .join(" · ")}
                      </div>
                      <div className="plugins-market-actions">
                        {installed ? (
                          <>
                            <span className="plugins-meta">
                              {t("plugins.installedVersion", {
                                version: installed.version,
                              })}
                            </span>
                            {item.updateAvailable ? (
                              <Button
                                variant="primary"
                                disabled={busyId === item.id}
                                onClick={() => setPendingInstall(item)}
                              >
                                {t("plugins.updateNow")}
                              </Button>
                            ) : (
                              <Button variant="secondary" disabled>
                                {t("plugins.installedLabel")}
                              </Button>
                            )}
                          </>
                        ) : (
                          <Button
                            variant="primary"
                            disabled={busyId === item.id}
                            onClick={() => setPendingInstall(item)}
                          >
                            {t("plugins.install")}
                          </Button>
                        )}
                      </div>
                    </Panel>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>

      {pendingInstall ? (
        <div className="plugins-modal-backdrop" role="presentation">
          <div
            className="plugins-modal"
            role="dialog"
            aria-modal="true"
            aria-label={t("plugins.permissionReview")}
          >
            <div className="plugins-modal-title">
              {t("plugins.permissionReviewTitle", { name: pendingInstall.name })}
            </div>
            <div className="plugins-modal-body">
              <p>{t("plugins.permissionReviewBody")}</p>
              <ul className="plugins-perm-list">
                {(pendingInstall.permissionSummary ?? []).map((perm) => (
                  <li key={perm}>
                    <strong>{permissionLabel(perm, t)}</strong>
                    <span>{t(`plugins.permissionHelp.${perm}`, { defaultValue: perm })}</span>
                  </li>
                ))}
              </ul>
              <label className="plugins-auto-update">
                <input
                  type="checkbox"
                  checked={autoUpdate}
                  onChange={(e) => setAutoUpdate(e.target.checked)}
                />
                {t("plugins.enableAutoUpdateOnInstall")}
              </label>
            </div>
            <div className="plugins-modal-actions">
              <Button variant="secondary" onClick={() => setPendingInstall(null)}>
                {t("plugins.cancel")}
              </Button>
              <Button
                variant="primary"
                disabled={busyId === pendingInstall.id}
                onClick={() => void confirmInstall()}
              >
                {busyId === pendingInstall.id
                  ? t("plugins.installing")
                  : t("plugins.acceptInstall")}
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
