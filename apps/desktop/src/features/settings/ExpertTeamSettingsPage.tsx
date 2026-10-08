import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  EXPERT_TEAM_PRESET_IDS,
  EXPERT_TEAM_CONFIGURABLE_TOOLS,
  isSessionThinkingLevel,
  resolveExpertTeamRoleConfig,
  type ExpertTeamPresetId,
  type ExpertTeamRoleConfig,
  type ProjectRecord,
} from "@pi-desktop/shared";
import { api } from "../../lib/api";
import { useAppStore } from "../../stores/app-store";
import { Badge, Button, Checkbox, CheckboxGroup, Field, SegmentedControl, Textarea } from "../../components/ui";
import { SettingsMenuSelect } from "../../components/settings/SettingsMenuSelect";
import { SettingsCard, SettingsRow } from "./primitives";
import {
  EXPERT_TEAM_USER_SCOPE,
  ExpertTeamSettingsConflict,
  expertTeamModelOptions,
  expertTeamRouteValue,
  expertTeamScopeRole,
  expertTeamThinkingLevels,
  persistExpertTeamRole,
  persistExpertTeamProjectRemoval,
} from "./expert-team-settings";
import "../../styles/settings-expert-team.css";

export function ExpertTeamSettingsPage() {
  const { t } = useTranslation();
  const settings = useAppStore((state) => state.settings);
  const activeProjectPath = useAppStore((state) => state.activeProjectPath ?? state.workspace?.path);
  const [projects, setProjects] = useState<ProjectRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [scope, setScope] = useState(EXPERT_TEAM_USER_SCOPE);
  const [editing, setEditing] = useState<ExpertTeamPresetId | null>(null);
  const [saving, setSaving] = useState(false);
  const [reload, setReload] = useState(0);
  const [scopeError, setScopeError] = useState<string | null>(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  useEffect(() => {
    let current = true;
    setLoading(true);
    setLoadFailed(false);
    void api.listProjects().then(({ projects: loaded }) => {
      if (current) setProjects(loaded);
    }, () => { if (current) setLoadFailed(true); }).finally(() => {
      if (current) setLoading(false);
    });
    return () => { current = false; };
  }, [reload]);

  const changeScope = (next: string) => {
    setScope(next);
    setEditing(null);
    setScopeError(null);
  };
  if (!settings) return null;
  const missingProjects = Object.keys(settings.expertTeam?.projectOverrides ?? {}).filter((path) => !projects.some((project) => project.path === path));
  const projectUnavailable = Boolean(scope) && !loading && !loadFailed && missingProjects.includes(scope);
  const removeUnavailableScope = async () => {
    if (saving || !projectUnavailable) return;
    setSaving(true);
    setScopeError(null);
    try {
      const persisted = await persistExpertTeamProjectRemoval({ scope,
        expected: settings.expertTeam?.projectOverrides[scope], isCurrent: () => mounted.current,
        getSettings: api.getSettings, setSettings: api.setSettings });
      if (persisted) useAppStore.setState({ settings: persisted });
      if (mounted.current && persisted) changeScope(EXPERT_TEAM_USER_SCOPE);
    } catch (cause) {
      if (cause instanceof ExpertTeamSettingsConflict && cause.confirmedSettings) {
        useAppStore.setState({ settings: cause.confirmedSettings });
      }
      if (mounted.current) setScopeError(t(cause instanceof ExpertTeamSettingsConflict ? "settings.expertTeam.conflict" : "settings.expertTeam.saveFailed"));
    } finally { if (mounted.current) setSaving(false); }
  };
  return (
    <div className="expert-team-settings" data-testid="expert-team-settings">
      <p className="expert-team-settings-description">{t("settings.expertTeam.description")}</p>
      <SegmentedControl
        value={scope}
        onChange={changeScope}
        label={t("settings.expertTeam.projectScope")}
        role="tablist"
        className="expert-team-scope-tabs"
        disabled={saving}
        options={[
          { value: EXPERT_TEAM_USER_SCOPE, id: "expert-team-scope-user", label: t("settings.expertTeam.userScope"), controls: "expert-team-roles" },
          ...projects.map((project, index) => ({ value: project.path, id: `expert-team-scope-project-${index}`,
            label: <span title={project.path}>{project.name}{project.path === activeProjectPath
              ? <span className="expert-team-current-project"> · {t("settings.expertTeam.currentProject")}</span> : null}</span>,
            controls: "expert-team-roles" })),
          ...missingProjects.map((path, index) => ({ value: path, id: `expert-team-scope-missing-${index}`, label: <span title={path}>
            {path.split(/[/\\]/).at(-1)} <span aria-hidden>⚠</span>
          </span>, controls: "expert-team-roles" })),
        ]}
      />
      {loadFailed ? <div className="expert-team-load-error" role="alert">
        {t("settings.expertTeam.loadFailed")}
        <Button size="sm" variant="secondary" onClick={() => setReload((value) => value + 1)}>{t("errors.action.retry")}</Button>
      </div> : loading ? <p role="status">{t("common.loading")}</p> : projects.length === 0
        ? <p className="expert-team-settings-description">{t("settings.expertTeam.emptyProjects")}</p> : null}
      <div className="expert-team-builtins-copy">
        <h3>{t("settings.expertTeam.builtinTitle")}</h3>
        <p>{t(scope ? "settings.expertTeam.projectInherit" : "settings.expertTeam.builtinDescription")}</p>
        {scope ? <code className="expert-team-project-path">{scope}</code> : null}
      </div>
      {projectUnavailable ? <div className="expert-team-load-error" role="alert">
        {t("settings.expertTeam.projectUnavailable")}
        <Button size="sm" variant="secondary" disabled={saving} onClick={() => void removeUnavailableScope()}>{t("settings.expertTeam.removeProjectOverrides")}</Button>
      </div> : null}
      {scopeError ? <p className="expert-team-error" role="alert">{scopeError}</p> : null}
      <div id="expert-team-roles" role="tabpanel" aria-label={t("settings.expertTeam.builtinTitle")} className="expert-team-role-list">
        {EXPERT_TEAM_PRESET_IDS.map((role) => {
          const saved = expertTeamScopeRole(settings.expertTeam, scope, role);
          const effective = resolveExpertTeamRoleConfig(settings.expertTeam, role, scope);
          return <SettingsCard key={role}>
            <div className="expert-team-role-card" data-testid={`expert-team-role-${role}`}>
              <div className="expert-team-role-heading">
                <h4 className="settings-card-heading">{t(`settings.expertTeam.roles.${role}.name`)}</h4>
                <Button variant="ghost" size="sm" disabled={saving || projectUnavailable} aria-expanded={editing === role}
                  onClick={() => setEditing(editing === role ? null : role)}>
                  {t(editing === role ? "settings.expertTeam.cancel" : "settings.expertTeam.edit")}
                </Button>
              </div>
              <p>{t(`settings.expertTeam.roles.${role}.description`)}</p>
              {Object.keys(effective).length ? <div className="expert-team-role-summary">
                <Badge>{t(saved ? "settings.expertTeam.pinned" : "settings.expertTeam.inherited")}</Badge>
                {effective.modelId ? <span>{effective.modelId}</span> : null}
              </div> : null}
              {editing === role ? <ExpertTeamRoleEditor key={`${scope}:${role}`} scope={scope} role={role}
                expected={saved} onSaved={() => setEditing(null)} onBusy={setSaving} /> : null}
            </div>
          </SettingsCard>;
        })}
      </div>
    </div>
  );
}

function ExpertTeamRoleEditor({ scope, role, expected, onSaved, onBusy }: {
  scope: string;
  role: ExpertTeamPresetId;
  expected: ExpertTeamRoleConfig | undefined;
  onSaved: () => void;
  onBusy: (busy: boolean) => void;
}) {
  const { t } = useTranslation();
  const providers = useAppStore((state) => state.providers);
  const catalogs = useAppStore((state) => state.providerModels);
  const team = useAppStore((state) => state.settings?.expertTeam);
  const [draft, setDraft] = useState<ExpertTeamRoleConfig>(() => ({ ...expected }));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const current = useRef(true);
  const baseline = useRef(expected);
  useEffect(() => {
    current.current = true;
    return () => { current.current = false; };
  }, []);
  const inherited = scope ? team?.userDefaults[role] ?? {} : {};
  const effective = { ...inherited, ...draft };
  const modelOptions = useMemo(() => expertTeamModelOptions(providers), [providers]);
  const modelValue = expertTeamRouteValue(draft);
  const effectiveValue = expertTeamRouteValue(effective);
  const unavailableModel = Boolean(effectiveValue) && !modelOptions.some((option) => option.id === effectiveValue);
  const levels = expertTeamThinkingLevels(effective, providers, catalogs);
  const unsupportedThinking = effective.thinkingLevel !== undefined && !levels.includes(effective.thinkingLevel);
  const unsupportedTools = (draft.tools ?? []).some((tool) => !(EXPERT_TEAM_CONFIGURABLE_TOOLS as readonly string[]).includes(tool));
  const instructionsTooLong = Array.from(draft.instructions ?? "").length > 16000;
  const validationKey = unavailableModel ? "unavailableModel" : unsupportedThinking ? "unsupportedThinking"
    : unsupportedTools ? "unsupportedTools" : instructionsTooLong ? "instructionsTooLong" : null;
  const setField = <K extends keyof ExpertTeamRoleConfig>(field: K, value: ExpertTeamRoleConfig[K]) => {
    setError(null);
    setDraft((previous) => {
      const next = { ...previous };
      if (value === undefined) delete next[field];
      else next[field] = value;
      return next;
    });
  };

  const save = async (reset: boolean) => {
    if (saving || (!reset && validationKey)) return;
    setSaving(true);
    onBusy(true);
    setError(null);
    try {
      const persisted = await persistExpertTeamRole({ scope, role,
        config: reset ? undefined : draft, expected: baseline.current,
        isCurrent: () => current.current,
        getSettings: api.getSettings, setSettings: api.setSettings });
      if (persisted) useAppStore.setState({ settings: persisted });
      if (current.current && persisted) onSaved();
    } catch (cause) {
      if (cause instanceof ExpertTeamSettingsConflict && cause.confirmedSettings) {
        useAppStore.setState({ settings: cause.confirmedSettings });
      }
      if (current.current) setError(t(cause instanceof ExpertTeamSettingsConflict
        ? "settings.expertTeam.conflict" : "settings.expertTeam.saveFailed"));
    } finally {
      if (current.current) { setSaving(false); onBusy(false); }
    }
  };

  const inheritedRoute = modelOptions.find((option) => option.id === expertTeamRouteValue(inherited));
  const inheritedRouteLabel = inheritedRoute?.label ?? (inherited.modelId ? `${inherited.providerId} · ${inherited.modelId}` : "");
  return <div className="expert-team-role-editor">
    <div className="expert-team-model-fields">
      <Field label={t("settings.expertTeam.model")}>
        <SettingsMenuSelect fullWidth label={t("settings.expertTeam.model")} disabled={saving} value={modelValue}
          options={[
            { id: "", label: `${t("settings.expertTeam.inherit")}${inheritedRouteLabel ? ` · ${inheritedRouteLabel}` : ""}` },
            ...modelOptions,
            ...(modelValue && !modelOptions.some((option) => option.id === modelValue)
              ? [{ id: modelValue, label: `${draft.providerId} · ${draft.modelId}`, disabled: true }] : []),
          ]}
          onChange={(value) => {
            const choice = modelOptions.find((option) => option.id === value);
            setError(null);
            setDraft((previous) => {
              const next = { ...previous };
              if (choice) { next.providerId = choice.providerId; next.modelId = choice.modelId; }
              else { delete next.providerId; delete next.modelId; }
              return next;
            });
          }}
        />
      </Field>
      <Field label={t("settings.expertTeam.thinking")}>
        <SettingsMenuSelect fullWidth label={t("settings.expertTeam.thinking")} disabled={saving}
          value={draft.thinkingLevel ?? ""}
          options={[
            { id: "", label: `${t("settings.expertTeam.inherit")}${inherited.thinkingLevel ? ` · ${inherited.thinkingLevel}` : ""}` },
            ...levels.map((level) => ({ id: level, label: level === "omit" ? t("extensions.subagents.thinkingOmit") : level })),
            ...(draft.thinkingLevel && !levels.includes(draft.thinkingLevel)
              ? [{ id: draft.thinkingLevel, label: draft.thinkingLevel, disabled: true }] : []),
          ]}
          onChange={(value) => setField("thinkingLevel", isSessionThinkingLevel(value) ? value : undefined)}
        />
      </Field>
    </div>
    <div>
      <SettingsRow title={t("settings.expertTeam.tools")}>
      <Checkbox label={t("settings.expertTeam.toolsInherit")} checked={draft.tools === undefined} disabled={saving}
        onChange={(event) => setField("tools", event.target.checked ? undefined : [...(inherited.tools ?? [])])} />
      </SettingsRow>
      <CheckboxGroup label={t("settings.expertTeam.tools")} className="expert-team-tools"
        options={EXPERT_TEAM_CONFIGURABLE_TOOLS.map((tool) => ({ value: tool, label: tool }))}
        values={draft.tools ?? inherited.tools ?? []} disabled={saving || draft.tools === undefined}
        onChange={(tools) => setField("tools", tools)} />
    </div>
    <div>
      <SettingsRow title={t("settings.expertTeam.instructions")}>
      <Checkbox label={t("settings.expertTeam.instructionsInherit")} checked={draft.instructions === undefined}
        disabled={saving} onChange={(event) => setField("instructions", event.target.checked ? undefined : inherited.instructions ?? "")} />
      </SettingsRow>
      <Textarea rows={5} aria-label={t("settings.expertTeam.instructions")}
        placeholder={t("settings.expertTeam.instructionsPlaceholder")} value={draft.instructions ?? inherited.instructions ?? ""}
        disabled={saving || draft.instructions === undefined} aria-invalid={instructionsTooLong}
        onChange={(event) => setField("instructions", event.target.value)} />
    </div>
    {validationKey || error ? <p role="alert" className="expert-team-error">{validationKey ? t(`settings.expertTeam.${validationKey}`, { max: 16000 }) : error}</p> : null}
    <div className="expert-team-editor-actions">
      <Button variant="secondary" size="sm" disabled={saving || expected === undefined} onClick={() => void save(true)}>{t("settings.expertTeam.reset")}</Button>
      <Button size="sm" disabled={saving || Boolean(validationKey)} onClick={() => void save(false)}>{t(saving ? "settings.expertTeam.saving" : "settings.expertTeam.save")}</Button>
    </div>
  </div>;
}
