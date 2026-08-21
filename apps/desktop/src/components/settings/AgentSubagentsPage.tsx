import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { UserSubagentRecord } from "@pi-desktop/shared";
import { api } from "../../lib/api";
import { useAppStore } from "../../stores/app-store";
import {
  AgentCapabilityIntro,
  AgentCapabilitySection,
  CapabilityEmpty,
  CapabilityToggle,
} from "./AgentCapabilityLayout";
import { IconBot } from "../icons";
import { cx } from "../ui";

const GLOBAL_SUBAGENTS_PATH = "~/.agents/subagents";

function SubagentRow({
  subagent,
  busy,
  onToggle,
}: {
  subagent: UserSubagentRecord;
  busy: boolean;
  onToggle: () => void;
}) {
  const { t } = useTranslation();
  const name = subagent.name || subagent.id;
  return (
    <div className={cx("agent-capability-row", !subagent.enabled && "is-off")} role="listitem">
      <span className="agent-capability-glyph" aria-hidden="true">
        <IconBot size={16} />
      </span>
      <div className="agent-capability-copy">
        <div className="agent-capability-row-title">
          <span className="agent-capability-name">{name}</span>
          <span className="agent-capability-badge">{t("settings.globalOnly")}</span>
        </div>
        <p
          className="agent-capability-description"
          title={subagent.description || t("settings.noCapabilityDescription")}
        >
          {subagent.description || t("settings.noCapabilityDescription")}
        </p>
        {subagent.tools?.length ? (
          <div className="agent-capability-meta">
            {subagent.tools.map((tool) => (
              <code key={tool}>{tool}</code>
            ))}
          </div>
        ) : null}
      </div>
      <CapabilityToggle
        checked={subagent.enabled}
        busy={busy}
        label={t("settings.toggleCapability", { name })}
        onChange={onToggle}
      />
    </div>
  );
}

export function AgentSubagentsPage() {
  const { t } = useTranslation();
  const showToast = useAppStore((state) => state.showToast);
  const [subagents, setSubagents] = useState<UserSubagentRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await api.listUserSubagents({ level: "global" });
      setSubagents(result.subagents ?? []);
    } catch (error) {
      showToast(error instanceof Error ? error.message : String(error), { variant: "error" });
      setSubagents([]);
    } finally {
      setLoading(false);
    }
  }, [showToast]);

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

  const toggle = async (subagent: UserSubagentRecord) => {
    if (busyId) return;
    setBusyId(subagent.id);
    try {
      await api.setUserSubagentEnabled(subagent.id, !subagent.enabled);
      await load();
      showToast(
        t(subagent.enabled ? "settings.capabilityDisabled" : "settings.capabilityEnabled", {
          name: subagent.name || subagent.id,
        }),
        { variant: "success" },
      );
    } catch (error) {
      showToast(error instanceof Error ? error.message : String(error), { variant: "error" });
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="agent-capability-page agent-subagents-page">
      <AgentCapabilityIntro
        description={t("settings.subagentsDescription")}
        note={t("settings.subagentsOnlyGlobal")}
      />
      <AgentCapabilitySection
        title={t("settings.globalLevel")}
        path={GLOBAL_SUBAGENTS_PATH}
        scope="global"
        description={t("settings.globalScopeDescription")}
        count={subagents.length}
        loading={loading}
        empty={t("settings.loadingCapabilities")}
        className="agent-capability-column-wide"
      >
        {subagents.length === 0 ? (
          <CapabilityEmpty message={t("settings.subagentsEmpty")} icon={<IconBot size={18} />} />
        ) : (
          subagents.map((subagent) => (
            <SubagentRow
              key={subagent.id}
              subagent={subagent}
              busy={loading || busyId !== null}
              onToggle={() => void toggle(subagent)}
            />
          ))
        )}
      </AgentCapabilitySection>
    </div>
  );
}
