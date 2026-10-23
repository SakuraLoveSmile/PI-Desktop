import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { ProjectGroupRecord } from "@pi-desktop/shared";
import { api } from "../../lib/api";
import { useAppStore } from "../../stores/app-store";
import { ProjectMemoryDialog } from "../../components/ProjectMemoryDialog";
import { Button } from "../../components/ui";
import { SettingsCard, SettingsRow } from "./primitives";
import { collapseMemoryProjectGroups } from "../../lib/memory-projects";

export function MemorySettingsPage() {
  const { t } = useTranslation();
  const showToast = useAppStore((state) => state.showToast);
  const setSettingsTab = useAppStore((state) => state.setSettingsTab);
  const [groups, setGroups] = useState<ProjectGroupRecord[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [revision, setRevision] = useState(0);
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

  return (
    <div className="settings-stack memory-settings">
      <SettingsCard
        title={t("settings.memory.projectsTitle")}
        description={t("settings.memory.description")}
      >
        {failed ? (
          <SettingsRow title={t("settings.memory.loadFailed")}>
            <Button variant="secondary" onClick={() => setRevision((value) => value + 1)}>
              {t("errors.action.retry")}
            </Button>
          </SettingsRow>
        ) : groups === null ? (
          <div className="settings-row" role="status">{t("common.loading")}</div>
        ) : groups.length === 0 ? (
          <SettingsRow title={t("settings.memory.empty")}>
            <Button variant="secondary" onClick={() => setSettingsTab("projects")}>
              {t("settings.nav.projects")}
            </Button>
          </SettingsRow>
        ) : groups.map((group) => (
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
