import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { UiMessage } from "@pi-desktop/shared";
import { IconChevronDown, IconEyeOff, IconWrench } from "../../../components/icons";
import { Button, TooltipButton } from "../../../components/ui";
import { AnchoredMenu } from "../../../components/settings/AnchoredMenu";
import { SkillEditorSheet, skillDraftError, type SkillDraft } from "../../../components/settings/SkillEditorSheet";
import { api } from "../../../lib/api";
import { useAppStore } from "../../../stores/app-store";
import { SESSION_SKILL_SUGGESTIONS_PROMPT, sessionSkillSuggestions, skillSuggestionProject, type SessionSkillSuggestion } from "./session-skill-suggestions";
import { ignoreSkillSuggestion, isSkillSuggestionIgnored, readIgnoredSkillSuggestions, skillSuggestionIdentity, type IgnoredSkillSuggestion } from "./skill-suggestion-preferences";
import { useActivityDisclosure } from "./use-activity-disclosure";
import "./session-skill-suggestions.css";

export type SessionSkillSuggestionsProps = {
  sessionId: string;
  messages: UiMessage[];
  visible: boolean;
  supported: boolean;
  rangeLimited?: boolean;
  references?: { id: string; label: string; kind?: "skill" | "mcp"; onOpen?: () => void }[];
};

export function SessionSkillSuggestions(props: SessionSkillSuggestionsProps) {
  return <SessionSkillSuggestionsContent key={props.sessionId} {...props} />;
}

function SessionSkillSuggestionsContent({ sessionId, messages, visible, supported, rangeLimited = false, references = [] }: SessionSkillSuggestionsProps) {
  const { t } = useTranslation();
  const bodyId = useId();
  const disclosure = useActivityDisclosure(sessionId, "skills", true, [], false);
  const [showAllReferences, setShowAllReferences] = useState(false);
  const [open, setOpen] = useState(false);
  const [preferences, setPreferences] = useState<{ ignored: IgnoredSkillSuggestion[]; failed: boolean }>(() => {
    try { return { ignored: readIgnoredSkillSuggestions(window.localStorage), failed: false }; }
    catch { return { ignored: [], failed: true }; }
  });
  const [generating, setGenerating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [editor, setEditor] = useState<{ draft: SkillDraft; projectPath: string } | null>(null);
  const busy = useRef(false);
  const mounted = useRef(true);
  const options = useRef({ visible, supported, rangeLimited });
  options.current = { visible, supported, rangeLimited };
  const projectPath = useAppStore((state) => skillSuggestionProject(state, sessionId, supported, rangeLimited));
  const projectName = useAppStore((state) => state.sessions.find((session) => session.id === sessionId)?.projectName ?? undefined);
  const parsed = useMemo(() => sessionSkillSuggestions(messages), [messages]);
  const suggestions = parsed.suggestions.filter((suggestion) => !isSkillSuggestionIgnored(preferences.ignored,
    skillSuggestionIdentity(sessionId, parsed.messageId ?? "", suggestion)));
  const referenceNames = new Set(suggestions.map((suggestion) => `skill:${suggestion.name.toLowerCase()}`));
  const recordedReferences = references.filter((reference) => {
    const key = `${reference.kind ?? "skill"}:${reference.label.trim().toLowerCase()}`;
    if (referenceNames.has(key)) return false;
    referenceNames.add(key);
    return true;
  });
  const inlineItems = [
    ...suggestions.map((suggestion) => ({ id: `suggestion:${suggestion.name}`, kind: "suggestion" as const, suggestion })),
    ...recordedReferences.map((reference) => ({ id: reference.id, kind: "reference" as const, reference })),
  ];
  const visibleInlineItems = showAllReferences ? inlineItems : inlineItems.slice(0, 5);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  useEffect(() => {
    if (!visible) setOpen(false);
    if (!visible || (editor && editor.projectPath !== projectPath)) setEditor(null);
  }, [visible, projectPath, editor]);

  const currentProject = () => {
    const current = options.current;
    return current.visible ? skillSuggestionProject(useAppStore.getState(), sessionId, current.supported, current.rangeLimited) : null;
  };
  const ownsProject = (path: string) => mounted.current && options.current.visible &&
    useAppStore.getState().activeSessionId === sessionId &&
    useAppStore.getState().sessions.find((session) => session.id === sessionId)?.projectPath === path;
  const generate = async () => {
    const path = currentProject();
    if (busy.current || !path) return;
    busy.current = true;
    setGenerating(true);
    setFailure(null);
    try {
      const accepted = await useAppStore.getState().sendPrompt(SESSION_SKILL_SUGGESTIONS_PROMPT, undefined, sessionId);
      if (ownsProject(path) && !accepted) {
        setFailure(t("panel.activity.skills.generationFailed"));
      }
    } catch (error) {
      if (ownsProject(path)) {
        setFailure(error instanceof Error ? error.message : t("panel.activity.skills.generationFailed"));
      }
    } finally {
      busy.current = false;
      if (mounted.current) setGenerating(false);
    }
  };
  const review = (suggestion: SessionSkillSuggestion) => {
    const path = currentProject();
    if (!path || busy.current) return;
    setFailure(null);
    setOpen(false);
    setEditor({ projectPath: path, draft: { ...suggestion, id: "", enabled: false, scope: { mode: "projects", projects: [path] } } });
  };
  const ignore = (suggestion: SessionSkillSuggestion): boolean => {
    if (busy.current || !parsed.messageId) return false;
    try {
      const ignored = ignoreSkillSuggestion(window.localStorage, skillSuggestionIdentity(sessionId, parsed.messageId, suggestion));
      setPreferences({ ignored, failed: false });
      return true;
    } catch {
      setPreferences((current) => ({ ...current, failed: true }));
      return false;
    }
  };
  const save = async () => {
    if (!editor || busy.current || currentProject() !== editor.projectPath || skillDraftError(editor.draft)) return;
    const { draft, projectPath: targetProject } = editor;
    busy.current = true;
    setSaving(true);
    try {
      await api.createUserSkill({ name: draft.name.trim(), description: draft.description.trim(), body: draft.body,
        enabled: draft.enabled, level: "project", projectPath: targetProject, scope: { mode: "projects", projects: [targetProject] } });
      if (ownsProject(targetProject)) {
        setEditor(null);
        useAppStore.getState().showToast(t("settings.skillCreated", { name: draft.name.trim() }), { variant: "success" });
      }
    } catch (error) {
      if (ownsProject(targetProject)) {
        useAppStore.getState().showToast(error instanceof Error ? error.message : t("panel.activity.skills.saveFailed"), { variant: "error" });
      }
    } finally {
      busy.current = false;
      if (mounted.current) setSaving(false);
    }
  };

  return <section className="session-skill-suggestions" hidden={!visible}>
    <div className="session-skill-suggestions-heading">
      <Button variant="ghost" className="session-skill-suggestions-toggle" aria-expanded={disclosure.open} aria-controls={bodyId}
        onClick={disclosure.toggle}>
        <span>{t("panel.activity.skills.sectionTitle")}</span><IconChevronDown size={13} aria-hidden />
      </Button>
      <AnchoredMenu open={open && visible} onClose={() => setOpen(false)} align="end" role="dialog"
        className="session-skill-suggestions-menu" menuClassName="session-skill-suggestions-popover"
        label={t("panel.activity.skills.title")} restoreFocus={visible && !editor}
        trigger={(ref) => <Button ref={ref} variant="ghost" className="session-skill-suggestions-count"
          aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
          {suggestions.length ? t("panel.activity.skills.count", { count: suggestions.length }) : t("panel.activity.skills.generate")}
        </Button>}>
        <h3 className="session-skill-suggestions-popover-title" tabIndex={-1}>{t("panel.activity.skills.title")}</h3>
        {!projectPath && <p className="session-activity-notice">{t("panel.activity.skills.unavailable")}</p>}
        {parsed.invalid && <p role="alert" className="session-activity-error">{t("panel.activity.skills.invalid")}</p>}
        {failure && <p role="alert" className="session-activity-error">{failure}</p>}
        {preferences.failed && <p role="alert" className="session-activity-error">{t("panel.activity.skills.preferencesFailed")}</p>}
        {suggestions.length ? <ul className="session-skill-suggestions-list">{suggestions.map((suggestion) => <li key={suggestion.name} className="session-skill-suggestion">
          <div className="session-skill-suggestion-heading">
            <span className="session-skill-suggestion-name" title={suggestion.name}>{suggestion.name}</span>
            <div className="session-skill-suggestion-actions">
              <Button variant="ghost" className="session-skill-suggestion-create" disabled={!projectPath || saving}
                onClick={() => review(suggestion)}>{t("panel.activity.skills.create")}</Button>
              <Button variant="ghost" className="session-skill-suggestion-ignore" disabled={generating || saving}
                onClick={(event) => {
                  const row = event.currentTarget.closest("li");
                  const popup = event.currentTarget.closest(".session-skill-suggestions-popover");
                  const nextFocus = row?.nextElementSibling?.querySelector<HTMLElement>("button:not([disabled])") ??
                    row?.previousElementSibling?.querySelector<HTMLElement>("button:not([disabled])") ??
                    popup?.querySelector<HTMLElement>(".session-skill-suggestions-generate:not([disabled])") ??
                    popup?.querySelector<HTMLElement>(".session-skill-suggestions-popover-title");
                  if (ignore(suggestion)) nextFocus?.focus();
                }}>{t("panel.activity.skills.ignore")}</Button>
            </div>
          </div>
          <span className="session-skill-suggestion-description">{suggestion.description}</span>
          <div className="session-skill-suggestion-rationale">
            <span>{t("panel.activity.skills.whyRecommended")}</span>
            <span className="session-skill-suggestion-reason">{suggestion.reason ?? t("panel.activity.skills.reasonUnavailable")}</span>
          </div>
        </li>)}</ul> : <p className="session-activity-empty">{t("panel.activity.skills.empty")}</p>}
        <Button size="sm" className="session-skill-suggestions-generate" disabled={!projectPath || generating || saving}
          onClick={() => { void generate(); }}>{t("panel.activity.skills.generate")}</Button>
      </AnchoredMenu>
    </div>
    {disclosure.open && <div id={bodyId} className="session-skill-suggestions-body">
      {inlineItems.length ? <>
        <ul className="session-skill-references">
          {visibleInlineItems.map((item) => <li key={item.id} className="session-skill-reference-row">
            {item.kind === "suggestion" ? <>
              <Button variant="ghost" className="session-skill-reference" title={item.suggestion.name} onClick={() => setOpen(true)}>
                <span className="session-skill-reference-icon"><IconWrench size={17} aria-hidden /></span>
                <span className="session-skill-reference-name">{item.suggestion.name}</span>
              </Button>
              <TooltipButton type="button" className="btn btn-ghost icon-btn icon-btn-square session-skill-reference-ignore" tooltip={t("panel.activity.skills.ignore")}
                disabled={generating || saving} onClick={(event) => {
                  const row = event.currentTarget.closest("li");
                  const section = event.currentTarget.closest(".session-skill-suggestions");
                  const nextFocus = row?.nextElementSibling?.querySelector<HTMLElement>("button:not([disabled])") ??
                    row?.previousElementSibling?.querySelector<HTMLElement>("button:not([disabled])") ??
                    section?.querySelector<HTMLElement>(".session-skill-suggestions-toggle");
                  if (ignore(item.suggestion)) nextFocus?.focus();
                }}><IconEyeOff size={14} aria-hidden /></TooltipButton>
            </> : item.reference.onOpen ? <Button variant="ghost" className="session-skill-reference" title={item.reference.label} onClick={item.reference.onOpen}>
              <span className="session-skill-reference-icon"><IconWrench size={17} aria-hidden /></span>
              <span className="session-skill-reference-name">{item.reference.label}</span>
            </Button> : <div className="session-skill-reference" title={item.reference.label}>
              <span className="session-skill-reference-icon"><IconWrench size={17} aria-hidden /></span>
              <span className="session-skill-reference-name">{item.reference.label}</span>
            </div>}
          </li>)}
        </ul>
        {inlineItems.length > 5 && <Button variant="ghost" className="session-skill-references-toggle" aria-expanded={showAllReferences}
          onClick={() => setShowAllReferences((value) => !value)}>
          {showAllReferences ? t("panel.activity.skills.showLess") : t("panel.activity.skills.showAll", { count: inlineItems.length })}
        </Button>}
      </> : <p className="session-activity-empty">{t("panel.activity.skills.empty")}</p>}
      {preferences.failed && !open && <p role="alert" className="session-activity-error">{t("panel.activity.skills.preferencesFailed")}</p>}
    </div>}
    {visible && editor && editor.projectPath === projectPath && <SkillEditorSheet draft={editor.draft}
      setDraft={(draft) => { if (!busy.current) setEditor((current) => current ? { ...current, draft } : current); }}
      editing={null} saving={saving} level="project" projectName={projectName ?? editor.projectPath}
      onClose={() => { if (!busy.current) setEditor(null); }} onSave={() => { void save(); }} />}
  </section>;
}
