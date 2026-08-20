import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { UserSkillRecord } from "@pi-desktop/shared";
import { api } from "../../lib/api";
import { useAppStore } from "../../stores/app-store";
import {
  AgentCapabilityColumn,
  AgentProjectPicker,
  CapabilityButton,
  CapabilityEmpty,
  CapabilityToggle,
  useAgentProjects,
} from "./AgentCapabilityLayout";
import { IconBookOpen, IconDownload } from "../icons";
import { cx } from "../ui";

const GLOBAL_SKILLS_PATH = "~/.agents/skills";

function projectSkillsPath(projectPath: string | null): string {
  return projectPath ? `${projectPath}/.agents/skills` : "<project-root>/.agents/skills";
}

function SkillRow({
  skill,
  onToggle,
  busy,
}: {
  skill: UserSkillRecord;
  onToggle: () => void;
  busy: boolean;
}) {
  const { t } = useTranslation();
  const name = skill.name || skill.id;
  return (
    <div className={cx("agent-capability-row", !skill.enabled && "is-off")} role="listitem">
      <span className="agent-capability-glyph" aria-hidden="true">
        <IconBookOpen size={16} />
      </span>
      <div className="agent-capability-copy">
        <div className="agent-capability-row-title">
          <span className="agent-capability-name">{name}</span>
          {skill.source === "imported" ? (
            <span className="agent-capability-badge">{t("settings.imported")}</span>
          ) : null}
        </div>
        <p className="agent-capability-description">
          {skill.description || t("settings.noCapabilityDescription")}
        </p>
      </div>
      <CapabilityToggle
        checked={skill.enabled}
        disabled={busy}
        label={t("settings.toggleCapability", { name })}
        onChange={onToggle}
      />
    </div>
  );
}

export function AgentSkillsPage() {
  const { t } = useTranslation();
  const showToast = useAppStore((state) => state.showToast);
  const { selectedProjectPath, setSelectedProjectPath, options } = useAgentProjects();
  const [globalSkills, setGlobalSkills] = useState<UserSkillRecord[]>([]);
  const [projectSkills, setProjectSkills] = useState<UserSkillRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyKey, setBusyKey] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [global, project] = await Promise.all([
        api.listUserSkills({
          level: "global",
          ...(selectedProjectPath ? { projectPath: selectedProjectPath } : {}),
        }),
        selectedProjectPath
          ? api.listUserSkills({ level: "project", projectPath: selectedProjectPath })
          : Promise.resolve({ skills: [] as UserSkillRecord[] }),
      ]);
      setGlobalSkills(global.skills ?? []);
      setProjectSkills(project.skills ?? []);
    } catch (error) {
      showToast(error instanceof Error ? error.message : String(error), { variant: "error" });
      setGlobalSkills([]);
      setProjectSkills([]);
    } finally {
      setLoading(false);
    }
  }, [selectedProjectPath, showToast]);

  useEffect(() => {
    void load();
    const offPluginChanged = api.onPluginChanged(() => void load());
    const offHostStatus = api.onHostStatus((status) => {
      if (status.ok) void load();
    });
    return () => {
      offPluginChanged();
      offHostStatus();
    };
  }, [load]);

  const toggle = async (skill: UserSkillRecord, level: "global" | "project") => {
    const key = `${level}:${skill.id}`;
    if (busyKey) return;
    setBusyKey(key);
    try {
      await api.setUserSkillEnabled(skill.id, !skill.enabled, {
        level,
        ...(selectedProjectPath ? { projectPath: selectedProjectPath } : {}),
      });
      await load();
      showToast(
        t(skill.enabled ? "settings.capabilityDisabled" : "settings.capabilityEnabled", {
          name: skill.name || skill.id,
        }),
        { variant: "success" },
      );
    } catch (error) {
      showToast(error instanceof Error ? error.message : String(error), { variant: "error" });
    } finally {
      setBusyKey(null);
    }
  };

  const importSkill = async (level: "global" | "project") => {
    if (level === "project" && !selectedProjectPath) {
      showToast(t("settings.selectProjectFirst"), { variant: "error" });
      return;
    }
    const key = `import:${level}`;
    if (busyKey) return;
    setBusyKey(key);
    try {
      const result = await api.importUserSkill({
        level,
        ...(level === "project" && selectedProjectPath
          ? { projectPath: selectedProjectPath }
          : {}),
      });
      if (!result.canceled) {
        await load();
        if (result.skill) {
          showToast(t("settings.skillImported", { name: result.skill.name }), {
            variant: "success",
          });
        }
      }
    } catch (error) {
      showToast(error instanceof Error ? error.message : String(error), { variant: "error" });
    } finally {
      setBusyKey(null);
    }
  };

  const importButton = (level: "global" | "project") => (
    <CapabilityButton onClick={() => void importSkill(level)}>
      <IconDownload size={14} />
      {t("settings.importSkill")}
    </CapabilityButton>
  );

  return (
    <div className="agent-capability-page">
      <p className="agent-capability-intro">{t("settings.capabilityPriority")}</p>
      <div className="agent-capability-columns">
        <AgentCapabilityColumn
          title={t("settings.globalLevel")}
          path={GLOBAL_SKILLS_PATH}
          scope="global"
          count={globalSkills.length}
          action={importButton("global")}
          loading={loading}
          empty={t("settings.loadingCapabilities")}
        >
          {globalSkills.length === 0 ? (
            <CapabilityEmpty message={t("settings.skillsEmpty")} icon={<IconBookOpen size={18} />} />
          ) : (
            globalSkills.map((skill) => (
              <SkillRow
                key={skill.id}
                skill={skill}
                busy={busyKey === `global:${skill.id}`}
                onToggle={() => void toggle(skill, "global")}
              />
            ))
          )}
        </AgentCapabilityColumn>

        <AgentCapabilityColumn
          title={t("settings.projectLevel")}
          path={projectSkillsPath(selectedProjectPath)}
          scope="project"
          count={projectSkills.length}
          action={
            <div className="agent-capability-column-actions">
              <AgentProjectPicker
                value={selectedProjectPath}
                options={options}
                label={t("settings.selectProject")}
                onChange={setSelectedProjectPath}
              />
              {importButton("project")}
            </div>
          }
          loading={loading}
          empty={t("settings.loadingCapabilities")}
        >
          {!selectedProjectPath ? (
            <CapabilityEmpty message={t("settings.selectProjectFirst")} />
          ) : projectSkills.length === 0 ? (
            <CapabilityEmpty message={t("settings.skillsEmpty")} icon={<IconBookOpen size={18} />} />
          ) : (
            projectSkills.map((skill) => (
              <SkillRow
                key={skill.id}
                skill={skill}
                busy={busyKey === `project:${skill.id}`}
                onToggle={() => void toggle(skill, "project")}
              />
            ))
          )}
        </AgentCapabilityColumn>
      </div>
    </div>
  );
}
