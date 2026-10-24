import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import type { ProjectGroupRecord } from "@pi-desktop/shared";
import { api } from "../../lib/api";
import { useAppStore } from "../../stores/app-store";
import { ProjectMemoryDialog } from "../../components/ProjectMemoryDialog";
import { collapseMemoryProjectGroups } from "../../lib/memory-projects";
import { Button, Input } from "../../components/ui";
import { SettingsCard, SettingsEmptyState, SettingsRow, SettingsWorkbenchHeader } from "./primitives";

export function MemorySettingsPage() {
  const { t } = useTranslation();
  const showToast = useAppStore((state) => state.showToast);
  const setSettingsTab = useAppStore((state) => state.setSettingsTab);
  const [groups, setGroups] = useState<ProjectGroupRecord[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [revision, setRevision] = useState(0);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<ProjectGroupRecord | null>(null);

  useEffect(() => {
    let cancelled = false;
    setFailed(false);
    setGroups(null);
    void api.listProjectGroups().then(({ groups: result }) => {
      if (!cancelled) setGroups(collapseMemoryProjectGroups(result));
    }).catch(() => {
      if (!cancelled) setFailed(true);
    });
    return () => { cancelled = true; };
  }, [revision]);

  const filteredGroups = useMemo(() => {
    const search = query.trim().toLocaleLowerCase();
    return (groups ?? []).filter((group) => !search || `${group.memoryProject?.name ?? group.name} ${group.memoryProject?.primaryPath ?? group.primaryPath} ${group.name} ${group.primaryPath}`.toLocaleLowerCase().includes(search));
  }, [groups, query]);

  return (
    <div className="settings-stack memory-settings">
      <SettingsWorkbenchHeader description={t("settings.memory.description")}>
        <div className="memory-settings-search">
          <Input
            value={query}
            placeholder={t("settings.memory.search")}
            aria-label={t("settings.memory.search")}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape" && !event.nativeEvent.isComposing) {
                event.preventDefault();
                setQuery("");
              }
            }}
          />
          {groups ? <span className="memory-settings-count" role="status">{t("settings.memory.resultCount", { count: filteredGroups.length, total: groups.length })}</span> : null}
        </div>
      </SettingsWorkbenchHeader>
      <SettingsCard title={t("settings.memory.projectsTitle")}>
        {failed ? (
          <SettingsRow title={t("settings.memory.loadFailed")}>
            <Button variant="secondary" onClick={() => setRevision((value) => value + 1)}>
              {t("errors.action.retry")}
            </Button>
          </SettingsRow>
        ) : groups === null ? (
          <div className="settings-row" role="status">{t("common.loading")}</div>
        ) : groups.length === 0 ? (
          <SettingsEmptyState message={t("settings.memory.empty")} action={
            <Button variant="secondary" onClick={() => setSettingsTab("projects")}>
              {t("settings.nav.projects")}
            </Button>
          } />
        ) : filteredGroups.length === 0 ? (
          <SettingsEmptyState message={t("project.noSearchResults")} action={
            <Button variant="secondary" onClick={() => setQuery("")}>{t("project.clearSearch")}</Button>
          } />
        ) : filteredGroups.map((group) => (
          <SettingsRow
            key={group.memoryProject?.id ?? group.id}
            title={group.memoryProject?.name ?? group.name}
            detail={<span className="memory-settings-path" title={group.memoryProject?.primaryPath ?? group.primaryPath}>
              {group.memoryProject?.primaryPath ?? group.primaryPath}
            </span>}
          >
            <Button
              variant="secondary"
              aria-label={`${t("project.editMemory")} · ${group.memoryProject?.name ?? group.name}`}
              onClick={() => setSelected(group)}
            >
              {t("project.editMemory")}
            </Button>
          </SettingsRow>
        ))}
      </SettingsCard>
      {selected ? (
        <ProjectMemoryDialog
          project={{
            name: selected.memoryProject?.name ?? selected.name,
            path: selected.primaryPath,
            groupId: selected.id,
            legacy: selected.legacy,
            memoryOwner: selected.memoryProject ? `memory:${selected.memoryProject.id}` : undefined,
          }}
          onClose={() => setSelected(null)}
          onSaved={() => showToast(t("project.memorySaved"), { variant: "success" })}
          onError={() => showToast(t("project.memoryRequestFailed"), { variant: "error" })}
        />
      ) : null}
    </div>
  );
}
