import { useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { useTranslation } from "react-i18next";
import type { PluginScenicThemesDestinationMeta } from "@pi-desktop/shared";
import {
  SETTINGS_NAV_GROUP_LABELS,
  searchSettings,
  type SettingsNavEntry,
  type SettingsNavGroupId,
  type SettingsTabId,
} from "../../lib/settings-search";
import { pluginViewIcon } from "../../lib/plugin-view-icons";
import {
  IconArchive, IconBookOpen, IconBot, IconChevronLeft, IconCloudDown,
  IconDownload, IconFileText, IconGlobe, IconInfo, IconKeyboard, IconMic,
  IconPalette, IconSearch, IconServer, IconSliders, IconSparkles, IconX,
} from "../../components/icons";
import { Badge, Button, Input, TooltipButton, cx } from "../../components/ui";

const ICONS = {
  general: IconSliders, ai: IconSparkles, shortcuts: IconKeyboard,
  instructions: IconFileText, agent: IconBot, skills: IconBookOpen,
  mcp: IconServer, subagents: IconBot, expertTeam: IconBot,
  import: IconDownload, projects: IconArchive, memory: IconBookOpen,
  sync: IconCloudDown, remoteHosts: IconGlobe, voice: IconMic, about: IconInfo,
};

type NavigationResult =
  | { id: string; entry: SettingsNavEntry; rowKey: string | null }
  | { id: string; extension: PluginScenicThemesDestinationMeta };

export function SettingsNavigation({
  entries, tab, developerMode, includeDevelopmentOnly, extensions,
  activeExtension, onSelect, onSelectExtension, onBack,
}: {
  entries: SettingsNavEntry[];
  tab: SettingsTabId;
  developerMode: boolean;
  includeDevelopmentOnly: boolean;
  extensions: PluginScenicThemesDestinationMeta[];
  activeExtension: PluginScenicThemesDestinationMeta | null;
  onSelect: (tab: SettingsTabId, rowKey: string | null) => void;
  onSelectExtension: (entry: PluginScenicThemesDestinationMeta) => void;
  onBack: () => void;
}) {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");
  const [selectedResult, setSelectedResult] = useState<string | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const resultRefs = useRef(new Map<string, HTMLButtonElement>());
  const searching = query.trim().length > 0;
  const [compact, setCompact] = useState(() => typeof window !== "undefined" && window.matchMedia("(max-width: 720px)").matches);
  const [directoryOpen, setDirectoryOpen] = useState(false);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const media = window.matchMedia("(max-width: 720px)");
    const update = () => { setCompact(media.matches); setDirectoryOpen(false); };
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  useLayoutEffect(() => {
    const dialog = dialogRef.current;
    if (compact && directoryOpen) {
      dialog?.showModal();
      searchRef.current?.focus({ preventScroll: true });
    } else if (dialog?.open) dialog.close();
  }, [compact, directoryOpen]);
  const closeDirectory = () => {
    setDirectoryOpen(false);
    dialogRef.current?.close();
    triggerRef.current?.focus({ preventScroll: true });
  };

  useLayoutEffect(() => { if (!compact) searchRef.current?.focus({ preventScroll: true }); }, [compact]);

  const results = useMemo<NavigationResult[]>(() => {
    const builtins = searching
      ? searchSettings(query, t, { limit: Infinity, developerMode, includeDevelopmentOnly })
      : entries.map((entry) => ({ tab: entry.id, rowKey: null }));
    const items: NavigationResult[] = [];
    for (const hit of builtins) {
      const entry = entries.find((candidate) => candidate.id === hit.tab);
      if (entry) items.push({ id: `builtin:${entry.id}:${hit.rowKey ?? ""}`, entry, rowKey: hit.rowKey });
    }
    const needle = query.trim().toLowerCase();
    for (const extension of extensions) {
      if (!searching || [extension.label, ...extension.keywords].some((value) => value.toLowerCase().includes(needle))) {
        items.push({ id: `extension:${extension.ref}`, extension });
      }
    }
    return items;
  }, [entries, query, searching, t, developerMode, includeDevelopmentOnly, extensions]);

  const groups = useMemo(() => {
    const grouped = new Map<SettingsNavGroupId | "extensions", NavigationResult[]>();
    for (const result of results) {
      const group = "entry" in result ? result.entry.group : "extensions";
      const items = grouped.get(group) ?? [];
      items.push(result);
      grouped.set(group, items);
    }
    return [...grouped.entries()];
  }, [results]);

  const clearSearch = () => {
    setQuery("");
    setSelectedResult(null);
    searchRef.current?.focus({ preventScroll: true });
  };
  const select = (result: NavigationResult) => {
    setSelectedResult(result.id);
    if ("entry" in result) onSelect(result.entry.id, result.rowKey);
    else onSelectExtension(result.extension);
    if (compact) closeDirectory();
  };
  const focusResult = (index: number) => {
    const result = results[index];
    if (!result) return;
    const button = resultRefs.current.get(result.id);
    button?.focus({ preventScroll: true });
    button?.scrollIntoView({ block: "nearest" });
  };
  const handleEscape = (event: KeyboardEvent<HTMLElement>) => {
    if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) {
      if (event.key === "Escape") event.preventDefault();
      return;
    }
    if (event.key === "Escape" && query) {
      event.preventDefault();
      event.stopPropagation();
      clearSearch();
    } else if (event.key === "Escape" && compact) {
      event.preventDefault();
      event.stopPropagation();
      closeDirectory();
    }
  };

  const navigation = (
    <aside className="settings-nav sidebar-surface" aria-label={t("settings.title")} onKeyDown={handleEscape}>
      {compact && <div className="settings-directory-heading">
        <span>{t("settings.categories")}</span>
        <TooltipButton tooltip={t("common.close")} onClick={closeDirectory}><IconX size={16} /></TooltipButton>
      </div>}
      <div className="settings-nav-top drag">
        <div className="settings-search-wrap no-drag">
          <IconSearch size={14} />
          <Input
            ref={searchRef}
            className="settings-search"
            value={query}
            onChange={(event) => { setQuery(event.target.value); setSelectedResult(null); }}
            onKeyDown={(event) => {
              if (!searching || event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return;
              if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                event.preventDefault();
                focusResult(event.key === "ArrowDown" ? 0 : results.length - 1);
              } else if (event.key === "Enter" && results[0]) {
                event.preventDefault();
                select(results[0]);
              }
            }}
            placeholder={t("settings.searchPlaceholder")}
            aria-label={t("settings.search")}
            aria-controls="settings-navigation-results"
          />
          {query && (
            <TooltipButton className="settings-search-clear" tooltip={t("settings.clearSearch")} onClick={clearSearch}>
              <IconX size={14} />
            </TooltipButton>
          )}
        </div>
      </div>
      <nav id="settings-navigation-results" className="settings-nav-scroll no-drag" aria-label={t("settings.title")}>
        {searching && (
          <div className="settings-search-summary" role="status">
            {results.length ? t("settings.searchResults", { count: results.length }) : t("settings.noResults")}
          </div>
        )}
        {groups.map(([group, items]) => (
          <div key={group} className="settings-nav-group">
            <div className="settings-nav-group-label">
              {t(group === "extensions" ? "settings.groupExtensions" : SETTINGS_NAV_GROUP_LABELS[group])}
            </div>
            {items.map((result) => {
              const builtin = "entry" in result;
              const Icon = builtin ? ICONS[result.entry.id] : (pluginViewIcon(result.extension.icon) ?? IconPalette);
              const current = builtin
                ? !activeExtension && tab === result.entry.id && (!searching || (selectedResult ? selectedResult === result.id : result.rowKey === null))
                : activeExtension?.ref === result.extension.ref;
              const label = builtin ? t(result.rowKey ?? result.entry.labelKey) : result.extension.label;
              return (
                <button
                  key={result.id}
                  ref={(node) => { if (node) resultRefs.current.set(result.id, node); else resultRefs.current.delete(result.id); }}
                  type="button"
                  className={cx("settings-nav-item", searching && "settings-search-result", current && "active")}
                  aria-current={current ? "page" : undefined}
                  onClick={() => select(result)}
                  onKeyDown={(event) => {
                    if (!searching || event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return;
                    const index = results.indexOf(result);
                    if (event.key === "ArrowDown") { event.preventDefault(); focusResult(Math.min(index + 1, results.length - 1)); }
                    else if (event.key === "ArrowUp") {
                      event.preventDefault();
                      if (index === 0) searchRef.current?.focus({ preventScroll: true });
                      else focusResult(index - 1);
                    }
                  }}
                >
                  <span className="settings-nav-icon"><Icon size={14} /></span>
                  <span className="settings-nav-copy">
                    <span className="settings-nav-label">{label}</span>
                    {searching && builtin && result.rowKey && (
                      <span className="settings-search-result-context">{t(result.entry.labelKey)}</span>
                    )}
                  </span>
                  {builtin && result.entry.experimentalBadgeKey && (
                    <Badge tone="warning" className="settings-nav-experimental">{t(result.entry.experimentalBadgeKey)}</Badge>
                  )}
                </button>
              );
            })}
          </div>
        ))}
      </nav>
      <div className="settings-nav-footer no-drag">
        <button type="button" className="settings-back no-drag" data-nav="back-to-app" onClick={() => { if (compact) closeDirectory(); onBack(); }}>
          <IconChevronLeft size={15} /><span>{t("settings.backToApp")}</span>
        </button>
      </div>
    </aside>
  );
  if (!compact) return navigation;
  return <>
    <Button ref={triggerRef} variant="secondary" className="settings-categories-toggle no-drag"
      aria-haspopup="dialog" aria-expanded={directoryOpen} aria-controls="settings-directory"
      onClick={() => setDirectoryOpen(true)}>
      <IconSliders size={15} />{t("settings.categories")}
    </Button>
    <dialog ref={dialogRef} id="settings-directory" className="settings-directory-dialog"
      aria-label={t("settings.categories")}
      onCancel={(event) => { event.preventDefault(); closeDirectory(); }}
      onClick={(event) => { if (event.target === event.currentTarget) closeDirectory(); }}>
      {navigation}
    </dialog>
  </>;
}
