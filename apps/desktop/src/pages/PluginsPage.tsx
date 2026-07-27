import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAppStore } from "../stores/app-store";
import { api } from "../lib/api";
import { Button, Panel, cx } from "../components/ui";
import { IconAt, IconX } from "../components/icons";
import { Markdown } from "../components/Markdown";
import type {
  MarketPluginDetail,
  MarketPluginSummary,
  PluginSummary,
} from "@pi-desktop/shared";

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

function formatBytes(size?: number): string {
  if (!size || size <= 0) return "-";
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(2)} MB`;
}

function formatDate(value?: string): string {
  if (!value) return "-";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleDateString();
}

function shortSha(value?: string): string {
  if (!value) return "-";
  return value.length > 12 ? `${value.slice(0, 12)}…` : value;
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
  const [pendingInstall, setPendingInstall] = useState<{
    id: string;
    name: string;
    permissions: string[];
    version?: string;
  } | null>(null);
  const [autoUpdate, setAutoUpdate] = useState(true);
  const [marketSource, setMarketSource] = useState<string>("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<MarketPluginDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [selectedVersion, setSelectedVersion] = useState<string>("");

  const refreshMarket = async (q = query, opts?: { refreshRemote?: boolean }) => {
    setMarketLoading(true);
    try {
      if (opts?.refreshRemote) {
        const meta = await api.marketRefresh(true);
        setMarketSource(meta.sourceUrl || meta.homepage || "");
        showToast(
          t("plugins.marketRefreshed", {
            count: meta.pluginCount,
            defaultValue: `Marketplace refreshed (${meta.pluginCount} plugins)`,
          }),
          { variant: "success" },
        );
      }
      const res = await api.marketSearch(q);
      setMarket(res.plugins ?? []);
      if (!marketSource) {
        setMarketSource(
          res.providerId === "official"
            ? "https://github.com/vastsa/pi-desktop-plugins"
            : res.providerId || "",
        );
      }
    } catch (e) {
      showToast(e instanceof Error ? e.message : String(e), { variant: "error" });
    } finally {
      setMarketLoading(false);
    }
  };

  const openDetail = async (id: string) => {
    setSelectedId(id);
    setDetailLoading(true);
    try {
      const res = await api.marketGetDetail(id);
      const raw = res.plugin as MarketPluginDetail & {
        summary?: MarketPluginSummary;
      };
      const plugin: MarketPluginDetail = raw.summary
        ? {
            ...raw.summary,
            readmeMarkdown: raw.readmeMarkdown,
            versions: raw.versions ?? [],
            screenshots: raw.screenshots,
            homepage: raw.homepage,
            repository: raw.repository,
            permissions: raw.permissions ?? raw.summary.permissionSummary ?? [],
            safetyNotes: raw.safetyNotes,
          }
        : raw;
      setDetail(plugin);
      setSelectedVersion(plugin.versions?.[0]?.version || plugin.latestVersion || "");
    } catch (e) {
      setDetail(null);
      showToast(e instanceof Error ? e.message : String(e), { variant: "error" });
    } finally {
      setDetailLoading(false);
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

  const activeVersion = useMemo(() => {
    if (!detail?.versions?.length) return null;
    return (
      detail.versions.find((v) => v.version === selectedVersion) ||
      detail.versions[0] ||
      null
    );
  }, [detail, selectedVersion]);

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

  const queueInstall = (input: {
    id: string;
    name: string;
    permissions: string[];
    version?: string;
  }) => {
    setPendingInstall(input);
    setAutoUpdate(true);
  };

  const confirmInstall = async () => {
    if (!pendingInstall) return;
    setBusyId(pendingInstall.id);
    try {
      await api.marketInstall({
        id: pendingInstall.id,
        version: pendingInstall.version,
        enable: true,
        autoUpdate,
        grantedPermissions: pendingInstall.permissions ?? [],
      });
      await refreshPlugins();
      await refreshMarket();
      if (selectedId === pendingInstall.id) {
        await openDetail(pendingInstall.id);
      }
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
                        onClick={() =>
                          queueInstall({
                            id: plugin.id,
                            name: plugin.name,
                            version: plugin.updateAvailable?.version,
                            permissions: [
                              ...(plugin.permissions ?? []),
                              ...(plugin.updateAvailable?.permissionDiff ?? []),
                            ],
                          })
                        }
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
          <div className={cx("plugins-market", selectedId && "with-detail")}>
            <div className="plugins-market-main">
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
                <Button
                  variant="secondary"
                  onClick={() => void refreshMarket(query, { refreshRemote: true })}
                >
                  {t("plugins.refreshMarket")}
                </Button>
              </div>
              {marketSource ? (
                <div className="plugins-market-source">
                  {t("plugins.marketSource", { url: marketSource })}
                </div>
              ) : null}
              {marketLoading ? (
                <Panel className="page-card page-empty">
                  <div className="text-md text-text-secondary">
                    {t("plugins.marketLoading")}
                  </div>
                </Panel>
              ) : market.length === 0 ? (
                <Panel className="page-card page-empty">
                  <div className="text-base-plus font-medium">
                    {t("plugins.marketEmpty")}
                  </div>
                </Panel>
              ) : (
                <div className="plugins-market-grid">
                  {market.map((item) => {
                    const installed = installedById.get(item.id);
                    const active = selectedId === item.id;
                    return (
                      <Panel
                        key={item.id}
                        className={cx("plugins-market-card", active && "active")}
                      >
                        <button
                          type="button"
                          className="plugins-market-card-hit"
                          onClick={() => void openDetail(item.id)}
                        >
                          <div className="plugins-market-card-top">
                            <div>
                              <div className="plugins-name">
                                {item.name}
                                {item.verified ? (
                                  <span className="plugins-badge">
                                    {t("plugins.verified")}
                                  </span>
                                ) : null}
                              </div>
                              <div className="plugins-meta">
                                {item.author} · v{item.latestVersion}
                                {item.downloads != null
                                  ? ` · ${t("plugins.downloads", {
                                      count: item.downloads,
                                    })}`
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
                        </button>
                        <div className="plugins-market-actions">
                          <Button
                            variant="secondary"
                            onClick={() => void openDetail(item.id)}
                          >
                            {t("plugins.viewDetails")}
                          </Button>
                          {installed ? (
                            item.updateAvailable ? (
                              <Button
                                variant="primary"
                                disabled={busyId === item.id}
                                onClick={() =>
                                  queueInstall({
                                    id: item.id,
                                    name: item.name,
                                    permissions: item.permissionSummary ?? [],
                                    version: item.latestVersion,
                                  })
                                }
                              >
                                {t("plugins.updateNow")}
                              </Button>
                            ) : (
                              <Button variant="secondary" disabled>
                                {t("plugins.installedLabel")}
                              </Button>
                            )
                          ) : (
                            <Button
                              variant="primary"
                              disabled={busyId === item.id}
                              onClick={() =>
                                queueInstall({
                                  id: item.id,
                                  name: item.name,
                                  permissions: item.permissionSummary ?? [],
                                  version: item.latestVersion,
                                })
                              }
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

            {selectedId ? (
              <aside className="plugins-detail" aria-label={t("plugins.detailTitle")}>
                <div className="plugins-detail-header">
                  <div>
                    <div className="plugins-detail-kicker">{t("plugins.detailTitle")}</div>
                    <h2 className="plugins-detail-title">
                      {detail?.name || selectedId}
                      {detail?.verified ? (
                        <span className="plugins-badge">{t("plugins.verified")}</span>
                      ) : null}
                    </h2>
                    <div className="plugins-meta">
                      {detail?.id || selectedId}
                      {detail?.author ? ` · ${detail.author}` : ""}
                    </div>
                  </div>
                  <button
                    type="button"
                    className="plugins-detail-close"
                    aria-label={t("plugins.closeDetail")}
                    onClick={() => {
                      setSelectedId(null);
                      setDetail(null);
                    }}
                  >
                    <IconX size={14} />
                  </button>
                </div>

                {detailLoading ? (
                  <div className="plugins-detail-empty">{t("plugins.detailLoading")}</div>
                ) : !detail ? (
                  <div className="plugins-detail-empty">{t("plugins.detailFailed")}</div>
                ) : (
                  <div className="plugins-detail-body">
                    <p className="plugins-detail-desc">{detail.description}</p>

                    <div className="plugins-detail-links">
                      {detail.repository ? (
                        <span>{t("plugins.repository")}: {detail.repository}</span>
                      ) : null}
                      {detail.homepage ? (
                        <span>{t("plugins.homepage")}: {detail.homepage}</span>
                      ) : null}
                    </div>

                    {detail.safetyNotes ? (
                      <div className="plugins-detail-callout">
                        <div className="plugins-detail-section-title">
                          {t("plugins.safetyNotes")}
                        </div>
                        <p>{detail.safetyNotes}</p>
                      </div>
                    ) : null}

                    <div className="plugins-detail-section">
                      <div className="plugins-detail-section-title">
                        {t("plugins.versions")}
                      </div>
                      <div className="plugins-version-list">
                        {(detail.versions ?? []).map((version) => (
                          <button
                            key={version.version}
                            type="button"
                            className={cx(
                              "plugins-version-item",
                              selectedVersion === version.version && "active",
                            )}
                            onClick={() => setSelectedVersion(version.version)}
                          >
                            <span className="plugins-version-main">
                              <strong>v{version.version}</strong>
                              <span>{formatDate(version.publishedAt)}</span>
                            </span>
                            <span className="plugins-version-meta">
                              {formatBytes(version.sizeBytes)} · {shortSha(version.shasum)}
                            </span>
                            {version.changelog ? (
                              <span className="plugins-version-changelog">
                                {version.changelog}
                              </span>
                            ) : null}
                          </button>
                        ))}
                      </div>
                    </div>

                    {activeVersion ? (
                      <div className="plugins-detail-section">
                        <div className="plugins-detail-section-title">
                          {t("plugins.selectedVersion")}
                        </div>
                        <div className="plugins-detail-facts">
                          <div>
                            <span>{t("plugins.version")}</span>
                            <strong>v{activeVersion.version}</strong>
                          </div>
                          <div>
                            <span>{t("plugins.publishedAt")}</span>
                            <strong>{formatDate(activeVersion.publishedAt)}</strong>
                          </div>
                          <div>
                            <span>{t("plugins.packageSize")}</span>
                            <strong>{formatBytes(activeVersion.sizeBytes)}</strong>
                          </div>
                          <div>
                            <span>{t("plugins.checksum")}</span>
                            <strong title={activeVersion.shasum}>
                              {shortSha(activeVersion.shasum)}
                            </strong>
                          </div>
                        </div>
                        {activeVersion.changelog ? (
                          <div className="plugins-detail-changelog">
                            <div className="plugins-detail-section-title">
                              {t("plugins.changelog")}
                            </div>
                            <p>{activeVersion.changelog}</p>
                          </div>
                        ) : null}
                        <div className="plugins-perms">
                          {(activeVersion.permissions ?? detail.permissions ?? [])
                            .map((perm) => permissionLabel(perm, t))
                            .join(" · ")}
                        </div>
                      </div>
                    ) : null}

                    <div className="plugins-detail-section">
                      <div className="plugins-detail-section-title">
                        {t("plugins.readme")}
                      </div>
                      {detail.readmeMarkdown ? (
                        <div className="plugins-detail-readme">
                          <Markdown source={detail.readmeMarkdown} />
                        </div>
                      ) : (
                        <div className="plugins-detail-empty">
                          {t("plugins.readmeEmpty")}
                        </div>
                      )}
                    </div>

                    <div className="plugins-detail-actions">
                      {installedById.get(detail.id) ? (
                        installedById.get(detail.id)?.version ===
                        (activeVersion?.version || detail.latestVersion) ? (
                          <Button variant="secondary" disabled>
                            {t("plugins.installedLabel")}
                          </Button>
                        ) : (
                          <Button
                            variant="primary"
                            disabled={busyId === detail.id}
                            onClick={() =>
                              queueInstall({
                                id: detail.id,
                                name: detail.name,
                                version:
                                  activeVersion?.version || detail.latestVersion,
                                permissions:
                                  activeVersion?.permissions ??
                                  detail.permissions ??
                                  [],
                              })
                            }
                          >
                            {t("plugins.updateNow")}
                          </Button>
                        )
                      ) : (
                        <Button
                          variant="primary"
                          disabled={busyId === detail.id}
                          onClick={() =>
                            queueInstall({
                              id: detail.id,
                              name: detail.name,
                              version:
                                activeVersion?.version || detail.latestVersion,
                              permissions:
                                activeVersion?.permissions ??
                                detail.permissions ??
                                [],
                            })
                          }
                        >
                          {t("plugins.installVersion", {
                            version:
                              activeVersion?.version || detail.latestVersion,
                          })}
                        </Button>
                      )}
                    </div>
                  </div>
                )}
              </aside>
            ) : null}
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
              {pendingInstall.version ? (
                <p className="plugins-meta">
                  {t("plugins.installingVersion", {
                    version: pendingInstall.version,
                  })}
                </p>
              ) : null}
              <ul className="plugins-perm-list">
                {(pendingInstall.permissions ?? []).map((perm) => (
                  <li key={perm}>
                    <strong>{permissionLabel(perm, t)}</strong>
                    <span>
                      {t(`plugins.permissionHelp.${perm}`, { defaultValue: perm })}
                    </span>
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
